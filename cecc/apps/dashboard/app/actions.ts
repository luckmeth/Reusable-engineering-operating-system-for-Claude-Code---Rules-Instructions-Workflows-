'use server';

import { revalidatePath } from 'next/cache';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Store,
  ceccPaths,
  loadPolicySet,
  loadProjectConfig,
  pinStage,
  savePolicySet,
  setRuleMode,
  WORKFLOW_STAGES,
  type PolicyMode,
  type WorkflowStage,
} from '@cecc/core';
import { collectLabels, importDataset, saveModel, trainModel } from '@cecc/ml';
import { resolveRoot } from '@/lib/server';

/**
 * The control plane.
 *
 * These are the only ways the dashboard changes state, and each one is a
 * named, narrow operation — there is deliberately no generic "run this command"
 * action. The dashboard is a local page, but it is still a different trust
 * domain from the agent: a page that could execute arbitrary commands would be
 * a far better target than anything it protects.
 *
 * Every mutation validates its input against a closed set, writes to the audit
 * log, and reports success or failure in words the person can act on.
 */

const exec = promisify(execFile);

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Extra detail worth showing, e.g. metrics after training. */
  detail?: string;
}

function withProject<T>(fn: (ctx: { root: string; store: Store; projectId: string }) => T): T {
  const root = resolveRoot();
  const project = loadProjectConfig(root);
  if (!project) throw new Error('CECC is not initialized for this directory.');
  const store = new Store(ceccPaths(root).db);
  try {
    return fn({ root, store, projectId: project.id });
  } finally {
    store.close();
  }
}

const actor = (): string => process.env['USER'] ?? 'dashboard-user';

// ------------------------------------------------------------------ findings

export async function resolveFindingAction(findingId: string, note?: string): Promise<ActionResult> {
  if (!/^[a-f0-9-]{8,40}$/i.test(findingId)) return { ok: false, message: 'That finding id is not valid.' };

  try {
    const title = withProject(({ store }) => {
      const finding = store.getFinding(findingId);
      if (!finding) throw new Error('Finding not found.');
      store.resolveFinding(findingId, note);
      return finding.title;
    });
    revalidatePath('/');
    revalidatePath('/findings');
    return {
      ok: true,
      message: 'Marked as fixed.',
      // Closing a finding is also a training label, which is worth saying out
      // loud rather than collecting silently.
      detail: `"${title}" is closed. This also teaches the model that findings like it are worth acting on.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not update that finding.' };
  }
}

export async function suppressFindingAction(
  findingId: string,
  reason: string,
  days?: number,
): Promise<ActionResult> {
  if (!/^[a-f0-9-]{8,40}$/i.test(findingId)) return { ok: false, message: 'That finding id is not valid.' };

  // A reason is required, not optional. A finding that disappears without one
  // is indistinguishable from a finding that was never raised.
  if (!reason || reason.trim().length < 3) {
    return { ok: false, message: 'Tell us why you are dismissing this, so the decision is on record.' };
  }

  try {
    const expiresAt = days && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    withProject(({ store }) => {
      if (!store.getFinding(findingId)) throw new Error('Finding not found.');
      store.suppressFinding(findingId, reason.trim(), actor(), expiresAt);
    });
    revalidatePath('/');
    revalidatePath('/findings');
    return {
      ok: true,
      message: expiresAt ? `Dismissed until ${expiresAt.slice(0, 10)}.` : 'Dismissed.',
      detail: 'Your reason is recorded, and this teaches the model that findings like it are noise here.',
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not dismiss that finding.' };
  }
}

export async function reopenFindingAction(findingId: string): Promise<ActionResult> {
  if (!/^[a-f0-9-]{8,40}$/i.test(findingId)) return { ok: false, message: 'That finding id is not valid.' };
  try {
    withProject(({ store, projectId }) => {
      store.db.prepare("UPDATE findings SET status = 'open', resolved_at = NULL, suppression = NULL WHERE id = ?").run(findingId);
      store.audit(projectId, actor(), 'finding.reopened', { id: findingId });
    });
    revalidatePath('/findings');
    return { ok: true, message: 'Reopened.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reopen that finding.' };
  }
}

// -------------------------------------------------------------------- policy

export async function setRuleModeAction(ruleId: string, mode: string, reason: string): Promise<ActionResult> {
  if (!/^(?:AGENT|CORR)-\d{3}$/.test(ruleId)) return { ok: false, message: 'That rule id is not valid.' };
  if (!['observe', 'warn', 'block'].includes(mode)) return { ok: false, message: 'Mode must be observe, warn or block.' };

  try {
    const root = resolveRoot();
    const project = loadProjectConfig(root);
    if (!project) throw new Error('CECC is not initialized.');

    const paths = ceccPaths(root);
    const current = loadPolicySet(paths.policies, project.environment).set;
    const updated = setRuleMode(current, ruleId, mode as PolicyMode, reason, actor());
    savePolicySet(paths.policies, updated);

    withProject(({ store, projectId }) =>
      store.audit(projectId, actor(), 'policy.changed', { ruleId, mode, reason }),
    );

    revalidatePath('/controls');
    const explanation = {
      observe: 'recorded quietly, with no warning shown',
      warn: 'recorded and warned about, but never blocked',
      block: 'blocked before the action happens, when CECC is confident',
    }[mode];
    return { ok: true, message: `${ruleId} is now ${mode}.`, detail: `Findings from this rule will be ${explanation}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not change that policy.' };
  }
}

/**
 * Sets every rule to one posture at once.
 *
 * The single most useful control: a developer deciding "watch everything but
 * stop nothing" while they get comfortable, then tightening later. Block is
 * still gated per-finding by severity and confidence.
 */
export async function setGlobalModeAction(mode: string): Promise<ActionResult> {
  if (!['observe', 'warn', 'block'].includes(mode)) return { ok: false, message: 'Mode must be observe, warn or block.' };

  try {
    const root = resolveRoot();
    const project = loadProjectConfig(root);
    if (!project) throw new Error('CECC is not initialized.');

    const paths = ceccPaths(root);
    const current = loadPolicySet(paths.policies, project.environment).set;
    const updated = {
      ...current,
      defaultMode: mode as PolicyMode,
      policies: Object.fromEntries(
        Object.entries(current.policies).map(([id, policy]) => [
          id,
          { ...policy, mode: mode as PolicyMode, updatedAt: new Date().toISOString() },
        ]),
      ),
    };
    savePolicySet(paths.policies, updated);

    withProject(({ store, projectId }) =>
      store.audit(projectId, actor(), 'policy.global_mode_changed', { mode, ruleCount: Object.keys(updated.policies).length }),
    );

    revalidatePath('/controls');
    const detail = {
      observe: 'CECC will record everything and stay silent. Nothing will be blocked or warned about.',
      warn: 'CECC will record everything and warn you, but will never stop the agent.',
      block: 'CECC will stop the agent on high-confidence, high-severity problems. Everything else still only warns.',
    }[mode];
    return { ok: true, message: `All rules set to ${mode}.`, detail };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not change enforcement.' };
  }
}

// ------------------------------------------------------------------ workflow

export async function pinStageAction(stage: string | null): Promise<ActionResult> {
  if (stage !== null && !WORKFLOW_STAGES.includes(stage as WorkflowStage)) {
    return { ok: false, message: 'That is not a valid stage.' };
  }

  try {
    withProject(({ store, projectId }) => {
      const session = store.getCurrentSession(projectId);
      if (!session) throw new Error('There is no active session to adjust.');
      const run = store.getWorkflowRunBySession(session.id);
      if (!run) throw new Error('There is no workflow run to adjust.');
      store.saveWorkflowRun(pinStage(run, stage as WorkflowStage | null));
      store.audit(projectId, actor(), stage ? 'workflow.pinned' : 'workflow.unpinned', { stage });
    });
    revalidatePath('/');
    revalidatePath('/workflow');
    return {
      ok: true,
      message: stage ? `Stage set to ${stage}.` : 'Automatic stage detection resumed.',
      detail: stage ? 'CECC will stop guessing the stage until you release it.' : undefined,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not change the stage.' };
  }
}

// --------------------------------------------------------------------- scans

/**
 * Runs a scan by invoking the CLI.
 *
 * The argument list is fixed and built here, never assembled from user input,
 * and execFile is used so nothing reaches a shell. This is the only action that
 * starts a process, which is why it is the narrowest.
 */
export async function runScanAction(scope: 'changes' | 'all'): Promise<ActionResult> {
  if (scope !== 'changes' && scope !== 'all') return { ok: false, message: 'Unknown scan scope.' };

  try {
    const root = resolveRoot();
    // Resolved at runtime rather than with a literal relative URL: a bundler
    // treats `new URL('../…', import.meta.url)` as a module reference and
    // tries to resolve it at build time, which fails because the CLI is a
    // sibling package rather than an import of this app.
    const { resolve: resolvePath } = await import('node:path');
    const cli =
      process.env['CECC_CLI_PATH'] ??
      resolvePath(process.cwd(), '..', '..', 'packages', 'cli', 'dist', 'index.js');
    const args = [cli, 'scan', '--cwd', root, '--json', ...(scope === 'all' ? ['--all'] : [])];

    const { stdout } = await exec(process.execPath, args, { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { scanned: number; findings: unknown[]; durationMs: number };

    revalidatePath('/');
    revalidatePath('/findings');
    return {
      ok: true,
      message: `Scanned ${parsed.scanned} file${parsed.scanned === 1 ? '' : 's'}.`,
      detail:
        parsed.findings.length === 0
          ? 'Nothing matched. That means no rule found a problem — not that the code is guaranteed safe.'
          : `Found ${parsed.findings.length} thing${parsed.findings.length === 1 ? '' : 's'} worth looking at.`,
    };
  } catch (err) {
    // A scan that exits non-zero because it found something is not a failure.
    const message = err instanceof Error ? err.message : String(err);
    if (/stdout maxBuffer/.test(message)) return { ok: false, message: 'That scan produced too much output. Try scanning changes only.' };
    return { ok: false, message: `The scan could not complete: ${message.slice(0, 200)}` };
  }
}

// ------------------------------------------------------------ model training

export async function trainModelAction(): Promise<ActionResult> {
  try {
    const root = resolveRoot();
    const result = withProject(({ store, projectId }) => {
      const labels = collectLabels(store, projectId);
      const trained = trainModel(labels);
      if (trained.ok && trained.model) {
        saveModel(ceccPaths(root).dir, trained.model);
        store.audit(projectId, actor(), 'model.trained', {
          samples: trained.dataset.total,
          auc: trained.model.metrics[trained.model.preferred === 'logistic' ? 'logistic' : 'naiveBayes'].auc,
        });
      }
      return trained;
    });

    revalidatePath('/intelligence');
    revalidatePath('/findings');

    if (!result.ok) {
      return { ok: false, message: 'Not enough examples yet.', detail: result.reason ?? undefined };
    }

    const model = result.model!;
    const metrics = model.preferred === 'logistic' ? model.metrics.logistic : model.metrics.naiveBayes;
    return {
      ok: true,
      message: `Trained on ${result.dataset.total} of your decisions.`,
      detail: model.summary + ` Chosen model: ${model.preferred}. AUC ${metrics.auc.toFixed(2)}.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Training failed.' };
  }
}

export async function importDatasetAction(contents: string): Promise<ActionResult> {
  if (!contents || contents.trim().length === 0) return { ok: false, message: 'That file was empty.' };
  // Bounded so a pasted file cannot exhaust memory in the page process.
  if (contents.length > 8 * 1024 * 1024) return { ok: false, message: 'That dataset is too large (limit 8MB).' };

  try {
    const root = resolveRoot();
    const temp = `${ceccPaths(root).dir}/imported-dataset.jsonl`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(temp, contents, 'utf8');

    const { examples, result } = importDataset(temp);
    if (examples.length === 0) {
      return { ok: false, message: 'No usable rows in that file.', detail: result.errors.join('; ') || undefined };
    }

    const trained = trainModel(examples);
    if (!trained.ok || !trained.model) {
      return { ok: false, message: `Imported ${result.imported} rows, but they are not enough to train.`, detail: trained.reason ?? undefined };
    }

    saveModel(ceccPaths(root).dir, trained.model);
    withProject(({ store, projectId }) =>
      store.audit(projectId, actor(), 'model.imported', { imported: result.imported, skipped: result.skipped }),
    );

    revalidatePath('/intelligence');
    return {
      ok: true,
      message: `Imported ${result.imported} examples and trained a model.`,
      detail: trained.model.summary + (result.skipped > 0 ? ` ${result.skipped} rows were skipped.` : ''),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Import failed.' };
  }
}

// ------------------------------------------------------------- housekeeping

export async function pruneEventsAction(): Promise<ActionResult> {
  try {
    const root = resolveRoot();
    const project = loadProjectConfig(root);
    if (!project) throw new Error('CECC is not initialized.');

    const removed = withProject(({ store, projectId }) => {
      const n = store.pruneOldEvents(projectId, project.retentionDays);
      store.audit(projectId, actor(), 'events.pruned', { removed: n, retentionDays: project.retentionDays });
      return n;
    });

    revalidatePath('/');
    return {
      ok: true,
      message: `Removed ${removed} event${removed === 1 ? '' : 's'} older than ${project.retentionDays} days.`,
      // Findings survive pruning — they are the durable record.
      detail: 'Findings are kept. Only the raw activity log was trimmed.',
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not prune events.' };
  }
}

export async function verifyIntegrityAction(): Promise<ActionResult> {
  try {
    const result = withProject(({ store, projectId }) => store.verifyEventChain(projectId));
    return result.ok
      ? {
          ok: true,
          message: `All ${result.checked} records verified.`,
          detail: 'Nothing in the activity log has been altered since it was written.',
        }
      : {
          ok: false,
          message: `The record was altered at entry #${result.brokenAtSeq}.`,
          detail: `${result.reason}. Findings recorded after that point should be treated as unreliable.`,
        };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not verify the record.' };
  }
}
