import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  Store,
  ceccPaths,
  git,
  ingest,
  loadPolicySet,
  newId,
  runRules,
  parseCommand,
  type ContentChange,
  type Finding,
  type ProjectConfig,
} from '@cecc/core';
import { c, heading, kv, SEVERITY_COLOR, wrapText } from '../ui.js';

/**
 * `cecc scan` — analyse the current state rather than waiting for live events.
 *
 * Scope defaults to the working-tree diff, not the whole repository. Two
 * reasons: analysing only what changed is what makes repeated scans cheap
 * enough to run constantly, and pre-existing code is a different conversation
 * from code this session introduced. `--all` opts into the full sweep.
 */
export async function scanCommand(
  root: string,
  project: ProjectConfig,
  opts: { all?: boolean; staged?: boolean; path?: string; json?: boolean } = {},
): Promise<number> {
  const paths = ceccPaths(root);
  const store = new Store(paths.db);
  const policies = loadPolicySet(paths.policies, project.environment).set;

  try {
    const changes = await collectChanges(root, opts);

    if (changes.length === 0) {
      console.log(c.gray('\n  Nothing to scan. The working tree matches HEAD.'));
      console.log(c.gray('  Use --all to scan every tracked file, or --staged for the index.\n'));
      return 0;
    }

    const session = store.getCurrentSession(project.id) ?? store.ensureSession({
      projectId: project.id,
      externalId: `scan-${newId().slice(0, 8)}`,
      agentId: null,
      startReason: 'cecc scan',
    });

    // A synthetic event anchors the findings to something real in the timeline,
    // so a scan result is traceable the same way a live detection is.
    const scanEvent = store.appendEvent({
      projectId: project.id,
      sessionId: session.id,
      workflowRunId: null,
      agentId: null,
      source: 'security',
      type: 'security.scan',
      severity: 'info',
      status: 'success',
      command: `cecc scan${opts.all ? ' --all' : ''}`,
      tool: null,
      filePaths: changes.map((ch) => ch.file).slice(0, 200),
      metadata: { fileCount: changes.length, scope: opts.all ? 'all' : opts.staged ? 'staged' : 'working-tree' },
      evidence: [],
      durationMs: null,
      parentEventId: null,
    });

    const started = Date.now();
    const produced: Finding[] = [];
    const errors: string[] = [];

    // Rules are evaluated per file so one pathological file cannot stall the rest.
    for (const change of changes) {
      const result = runRules(
        {
          event: { ...scanEvent, filePaths: [change.file] },
          project,
          changes: [change],
          parsedCommand: null,
          store,
          now: new Date(),
        },
        policies,
      );

      for (const err of result.errors) errors.push(`${err.ruleId}: ${err.message}`);
      for (const finding of result.findings) produced.push(store.upsertFinding(finding));
    }

    const durationMs = Date.now() - started;
    store.audit(project.id, 'user', 'scan.completed', { files: changes.length, findings: produced.length, durationMs });

    if (opts.json) {
      console.log(JSON.stringify({ scanned: changes.length, durationMs, findings: produced, errors }, null, 2));
      return produced.some((f) => f.severity === 'critical' || f.severity === 'high') ? 1 : 0;
    }

    console.log(heading('Scan complete'));
    console.log(kv('Scope', opts.all ? 'all tracked files' : opts.staged ? 'staged changes' : 'working-tree changes'));
    console.log(kv('Files analysed', String(changes.length)));
    console.log(kv('Duration', `${durationMs}ms`));
    console.log(kv('Findings', produced.length === 0 ? c.green('none') : String(produced.length)));

    if (errors.length > 0) {
      // A rule that threw is a coverage gap and must not be silent.
      console.log(kv('Rule errors', c.yellow(`${errors.length} — coverage is incomplete`)));
      for (const err of errors.slice(0, 5)) console.log(c.gray(`      ${err}`));
    }

    if (produced.length === 0) {
      console.log(`\n  ${c.green('No findings in the scanned scope.')}`);
      // The distinction the whole product turns on.
      console.log(c.gray('  This means no rule matched — not that the code is secure.\n'));
      return 0;
    }

    const ordered = [...produced].sort((a, b) => rank(b.severity) - rank(a.severity));
    console.log('');
    for (const finding of ordered) {
      printFinding(finding);
    }

    const blocking = ordered.filter((f) => f.severity === 'critical' || f.severity === 'high');
    console.log(blocking.length > 0 ? c.red(`\n  ${blocking.length} finding(s) at high or critical severity.\n`) : '');
    return blocking.length > 0 ? 1 : 0;
  } finally {
    store.close();
  }
}

export function printFinding(finding: Finding): void {
  const sev = (SEVERITY_COLOR[finding.severity] ?? c.gray)(`[${finding.severity.toUpperCase()}]`);
  console.log(`  ${sev} ${c.bold(finding.title)}`);
  console.log(
    c.gray(
      `    ${finding.ruleId} · ${finding.layer} · ${finding.verification} · ${Math.round(finding.confidence * 100)}% confidence · ${finding.detection.toLowerCase()}`,
    ),
  );

  if (finding.affectedLines.length > 0) {
    const locations = finding.affectedLines.slice(0, 3).map((l) => `${l.file}:${l.line}`).join(', ');
    console.log(c.gray(`    at ${locations}${finding.affectedLines.length > 3 ? ` (+${finding.affectedLines.length - 3} more)` : ''}`));
  } else if (finding.affectedFiles.length > 0) {
    console.log(c.gray(`    in ${finding.affectedFiles.slice(0, 3).join(', ')}`));
  }

  console.log(c.gray('\n    Why it matters:'));
  console.log(wrapText(finding.impact, 76, '      '));

  if (finding.evidence.length > 0) {
    console.log(c.gray('\n    Evidence:'));
    for (const ev of finding.evidence.slice(0, 4)) {
      const where = ev.file ? `${ev.file}${ev.line ? `:${ev.line}` : ''} ` : '';
      console.log(c.gray(`      • ${ev.label}: `) + c.dim(`${where}${ev.detail.split('\n')[0]?.slice(0, 90) ?? ''}`));
    }
  }

  console.log(c.gray('\n    Fix:'));
  console.log(wrapText(finding.recommendation, 76, '      '));
  console.log('');
}

const rank = (s: string): number => ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 })[s] ?? 0;

async function collectChanges(root: string, opts: { all?: boolean; staged?: boolean; path?: string }): Promise<ContentChange[]> {
  if (opts.path) {
    const target = join(root, opts.path);
    if (!existsSync(target)) return [];
    return [fileAsChange(root, target)].filter((c): c is ContentChange => c !== null);
  }

  if (opts.all) {
    const files = await git.getTrackedFiles(root).catch(() => [] as string[]);
    return files
      .filter((f) => SCANNABLE.test(f) && !SKIP_DIR.test(f))
      .slice(0, 2000)
      .map((f) => fileAsChange(root, join(root, f)))
      .filter((c): c is ContentChange => c !== null);
  }

  try {
    const diff = await git.getWorkingDiff(root, opts.staged ?? false);
    // An empty unstaged diff with staged content is a common state; fall back.
    if (diff.length === 0 && !opts.staged) return await git.getWorkingDiff(root, true);
    return diff;
  } catch {
    return [];
  }
}

const SCANNABLE = /\.(?:ts|tsx|js|jsx|mjs|cjs|sql|json|ya?ml|toml|env|md|py|go|rb|java|php|sh)$/i;
const SKIP_DIR = /(?:^|\/)(?:node_modules|dist|build|\.next|coverage|vendor|\.git)\//;

/** Treats a whole file as an all-added change so content rules can run on it. */
function fileAsChange(root: string, absolutePath: string): ContentChange | null {
  try {
    const stats = statSync(absolutePath);
    // Skip anything large enough to be generated rather than authored.
    if (!stats.isFile() || stats.size > 1_500_000) return null;
    const content = readFileSync(absolutePath, 'utf8');
    return {
      file: relative(root, absolutePath),
      added: content.split('\n').map((text, i) => ({ line: i + 1, text })),
      removed: [],
      fullContent: content,
      isNewFile: false,
      isDeletion: false,
      origin: 'filesystem',
    };
  } catch {
    return null;
  }
}

export { ingest, parseCommand };
