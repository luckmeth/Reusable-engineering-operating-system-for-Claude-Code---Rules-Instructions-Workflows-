import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  Store,
  ceccPaths,
  describeCoverage,
  git,
  ingest,
  loadPolicySet,
  newId,
  runExternalScanners,
  runRules,
  parseCommand,
  type ContentChange,
  type ExternalScanReport,
  type Finding,
  type ProjectConfig,
  type ScannerRun,
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
  opts: {
    all?: boolean;
    staged?: boolean;
    path?: string;
    json?: boolean;
    limit?: number;
    external?: boolean;
    online?: boolean;
    scanner?: string;
  } = {},
): Promise<number> {
  const paths = ceccPaths(root);
  const store = new Store(paths.db);
  const policies = loadPolicySet(paths.policies, project.environment).set;

  try {
    // --external is a different job from rule scanning: it asks other tools
    // about dependencies and source, not about what the agent just did.
    if (opts.external) {
      return await externalScan(root, project, store, opts);
    }

    const collected = await collectChanges(root, opts);
    const changes = collected.changes;

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
      console.log(
        JSON.stringify(
          { scanned: changes.length, eligible: collected.eligible, notScanned: collected.skipped, durationMs, findings: produced, errors },
          null,
          2,
        ),
      );
      return produced.some((f) => f.severity === 'critical' || f.severity === 'high') ? 1 : 0;
    }

    console.log(heading('Scan complete'));
    console.log(kv('Scope', opts.all ? 'all tracked files' : opts.staged ? 'staged changes' : 'working-tree changes'));
    console.log(kv('Files analysed', String(changes.length)));
    if (collected.skipped > 0) {
      console.log(kv('Not scanned', c.yellow(`${collected.skipped} of ${collected.eligible} — limit reached`)));
      console.log(c.gray(`      Raise it with --limit ${collected.eligible}. Those files were not examined.`));
    }
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
      console.log(c.gray('  This means no rule matched — not that the code is secure.'));
      if (collected.skipped > 0) {
        console.log(c.yellow(`  ${collected.skipped} eligible file(s) were never read. Coverage is partial.`));
      }
      console.log('');
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


// ------------------------------------------------------------- external scan

/**
 * `cecc scan --external` — run third-party scanners and record what they said.
 *
 * The whole value here is honest bookkeeping. A scanner that did not run is
 * written into the event timeline as a coverage gap with the reason, so a later
 * "no findings" can never be mistaken for "checked and clean".
 */
async function externalScan(
  root: string,
  project: ProjectConfig,
  store: Store,
  opts: { online?: boolean; scanner?: string; json?: boolean },
): Promise<number> {
  const session =
    store.getCurrentSession(project.id) ??
    store.ensureSession({
      projectId: project.id,
      externalId: `scan-${newId().slice(0, 8)}`,
      agentId: null,
      startReason: 'cecc scan --external',
    });

  const report = await runExternalScanners({
    root,
    project,
    allowNetwork: opts.online ?? false,
    ...(opts.scanner ? { only: [opts.scanner] } : {}),
  });

  const produced: Finding[] = [];
  for (const run of report.runs) {
    // One event per scanner, whatever the outcome. The gap is the record.
    const event = store.appendEvent({
      projectId: project.id,
      sessionId: session.id,
      workflowRunId: null,
      agentId: null,
      source: 'security',
      type: 'security.external-scan',
      severity: run.outcome === 'failed' ? 'medium' : 'info',
      status: run.outcome === 'ran' ? 'success' : run.outcome === 'failed' ? 'failed' : 'warning',
      command: `cecc scan --external --scanner ${run.scannerId}`,
      tool: run.scannerId,
      filePaths: [],
      metadata: {
        scanner: run.scannerId,
        outcome: run.outcome,
        note: run.note,
        version: run.version,
        findings: run.findings.length,
        durationMs: run.durationMs,
        ...(run.error ? { error: run.error } : {}),
      },
      evidence: [],
      durationMs: run.durationMs,
      parentEventId: null,
    });

    for (const finding of run.findings) {
      produced.push(store.upsertFinding({ ...finding, sessionId: session.id, relatedEvents: [event.id] }));
    }
  }

  store.audit(project.id, 'user', 'scan.external.completed', {
    ran: report.ran,
    skipped: report.skipped,
    findings: report.totalFindings,
    online: opts.online ?? false,
  });

  if (opts.json) {
    console.log(JSON.stringify({ ...report, findings: produced }, null, 2));
    return produced.some((f) => f.severity === 'critical' || f.severity === 'high') ? 1 : 0;
  }

  console.log(heading('External scanners'));
  for (const run of report.runs) printScannerRun(run);

  console.log(kv('Coverage', report.skipped > 0 ? c.yellow(describeCoverage(report)) : c.green(describeCoverage(report))));
  console.log(kv('Duration', `${report.durationMs}ms`));

  if (produced.length === 0) {
    console.log(`\n  ${report.ran === 0 ? c.yellow('No external scanner ran.') : c.green('No findings from the scanners that ran.')}`);
    console.log(c.gray(report.ran === 0
      ? '  Nothing was checked. This is not a clean result.\n'
      : '  This covers only what those scanners look at.\n'));
    return 0;
  }

  console.log('');
  for (const finding of [...produced].sort((a, b) => rank(b.severity) - rank(a.severity)).slice(0, 25)) {
    printFinding(finding);
  }
  if (produced.length > 25) console.log(c.gray(`  ... and ${produced.length - 25} more. Run \`cecc findings\` to page through them.\n`));

  const blocking = produced.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (blocking.length > 0) console.log(c.red(`  ${blocking.length} finding(s) at high or critical severity.\n`));
  return blocking.length > 0 ? 1 : 0;
}

const OUTCOME_LABEL: Record<ScannerRun['outcome'], (s: string) => string> = {
  ran: c.green,
  unavailable: c.gray,
  'not-applicable': c.gray,
  'needs-network': c.yellow,
  failed: c.red,
};

function printScannerRun(run: ScannerRun): void {
  const paint = OUTCOME_LABEL[run.outcome] ?? c.gray;
  const mark = run.outcome === 'ran' ? '✔' : run.outcome === 'failed' ? '✖' : '·';
  console.log(`  ${paint(mark)} ${c.bold(run.name.padEnd(12))} ${paint(run.outcome)}`);
  console.log(c.gray(`      ${run.note}`));
  if (run.version) console.log(c.gray(`      version: ${run.version}`));
  if (run.error) console.log(c.gray(`      error:   ${run.error.split('\n')[0]?.slice(0, 120)}`));
}

export type { ExternalScanReport };

const rank = (s: string): number => ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 })[s] ?? 0;

/** Default ceiling on a full-tree scan. Overridable with --limit. */
export const DEFAULT_SCAN_LIMIT = 5000;

interface CollectedChanges {
  changes: ContentChange[];
  /** Eligible files the limit excluded. Non-zero means coverage is partial. */
  skipped: number;
  eligible: number;
}

async function collectChanges(
  root: string,
  opts: { all?: boolean; staged?: boolean; path?: string; limit?: number },
): Promise<CollectedChanges> {
  if (opts.path) {
    const target = join(root, opts.path);
    if (!existsSync(target)) return { changes: [], skipped: 0, eligible: 0 };
    const change = fileAsChange(root, target);
    return { changes: change ? [change] : [], skipped: 0, eligible: 1 };
  }

  if (opts.all) {
    const files = await git.getTrackedFiles(root).catch(() => [] as string[]);
    const eligible = files.filter((f) => SCANNABLE.test(f) && !SKIP_DIR.test(f));
    const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_SCAN_LIMIT;
    const selected = eligible.slice(0, limit);
    return {
      changes: selected
        .map((f) => fileAsChange(root, join(root, f)))
        .filter((c): c is ContentChange => c !== null),
      // Silently truncating a security scan produces a result that reads as
      // "clean" for files nobody looked at. The count is carried out so the
      // command can say so.
      skipped: eligible.length - selected.length,
      eligible: eligible.length,
    };
  }

  try {
    const diff = await git.getWorkingDiff(root, opts.staged ?? false);
    // An empty unstaged diff with staged content is a common state; fall back.
    const resolved = diff.length === 0 && !opts.staged ? await git.getWorkingDiff(root, true) : diff;
    return { changes: resolved, skipped: 0, eligible: resolved.length };
  } catch {
    return { changes: [], skipped: 0, eligible: 0 };
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
