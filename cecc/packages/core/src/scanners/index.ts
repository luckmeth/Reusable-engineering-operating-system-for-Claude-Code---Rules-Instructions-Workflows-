import { npmAuditScanner } from './npm-audit.js';
import { osvScanner } from './osv.js';
import { semgrepScanner } from './semgrep.js';
import type { ExternalScanner, ScannerOptions, ScannerRun } from './types.js';
import type { ProjectConfig } from '../types/project.js';

export * from './types.js';
export { npmAuditScanner } from './npm-audit.js';
export { osvScanner, readNpmLockfile } from './osv.js';
export { semgrepScanner } from './semgrep.js';

export const EXTERNAL_SCANNERS: ExternalScanner[] = [npmAuditScanner, osvScanner, semgrepScanner];

export function getScanner(id: string): ExternalScanner | undefined {
  return EXTERNAL_SCANNERS.find((s) => s.id === id);
}

export interface ExternalScanOptions {
  root: string;
  project: ProjectConfig;
  allowNetwork?: boolean;
  timeoutMs?: number;
  /** Restrict to specific scanner ids. Empty or omitted runs all of them. */
  only?: string[];
}

export interface ExternalScanReport {
  runs: ScannerRun[];
  /** Scanners that produced results. */
  ran: number;
  /** Scanners that did not run, for any reason. This is the coverage gap. */
  skipped: number;
  totalFindings: number;
  durationMs: number;
}

/**
 * Runs the external scanners and reports what actually happened.
 *
 * Scanners run sequentially, not in parallel. They are subprocesses that each
 * want CPU and a network connection, and a developer's machine running a scan
 * mid-session should stay usable. The whole set finishing a few seconds later
 * costs nothing; a stalled editor costs the tool its welcome.
 *
 * A scanner that throws is contained here. One broken integration must not take
 * down the rest of the scan, and the failure is reported as a run outcome so it
 * shows up as a gap rather than as silence.
 */
export async function runExternalScanners(opts: ExternalScanOptions): Promise<ExternalScanReport> {
  const started = Date.now();
  const selected = opts.only?.length
    ? EXTERNAL_SCANNERS.filter((s) => opts.only?.includes(s.id))
    : EXTERNAL_SCANNERS;

  const scannerOptions: ScannerOptions = {
    root: opts.root,
    project: opts.project,
    allowNetwork: opts.allowNetwork ?? false,
    timeoutMs: opts.timeoutMs ?? 120_000,
  };

  const runs: ScannerRun[] = [];
  for (const scanner of selected) {
    try {
      runs.push(await scanner.run(scannerOptions));
    } catch (err) {
      runs.push({
        scannerId: scanner.id,
        name: scanner.name,
        outcome: 'failed',
        findings: [],
        note: `${scanner.name} threw while running. This is a CECC integration bug, not a clean result.`,
        version: null,
        durationMs: 0,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }

  const ran = runs.filter((r) => r.outcome === 'ran').length;
  return {
    runs,
    ran,
    skipped: runs.length - ran,
    totalFindings: runs.reduce((sum, r) => sum + r.findings.length, 0),
    durationMs: Date.now() - started,
  };
}

/**
 * One line summarising coverage, for the CLI and the dashboard.
 *
 * Worded so that partial coverage never reads as a pass. "2 of 3 scanners ran"
 * is the honest headline; "no issues found" on its own would not be.
 */
export function describeCoverage(report: ExternalScanReport): string {
  if (report.runs.length === 0) return 'No external scanners selected.';
  if (report.skipped === 0) {
    return `${report.ran} of ${report.runs.length} external scanners ran. ${report.totalFindings} finding(s).`;
  }
  return `${report.ran} of ${report.runs.length} external scanners ran — ${report.skipped} did not, so coverage is incomplete.`;
}
