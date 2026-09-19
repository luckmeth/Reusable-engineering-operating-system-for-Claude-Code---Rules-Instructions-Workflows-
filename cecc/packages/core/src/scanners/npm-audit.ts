import { join } from 'node:path';
import { findLockfiles, lockfileDir, mapSeverity, parseLooseJson, probeVersion, runTool, toScannerFinding } from './shared.js';
import { scannerResult, type ExternalScanner, type ScannerOptions, type ScannerRun } from './types.js';
import type { NewFinding } from '../types/finding.js';

/** Shape of `npm audit --json` (npm 7+). Only the fields CECC reads are typed. */
interface AuditReport {
  vulnerabilities?: Record<string, AuditVulnerability>;
  metadata?: { vulnerabilities?: Record<string, number>; dependencies?: unknown };
  error?: { code?: string; summary?: string; detail?: string };
}

interface AuditVulnerability {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  range?: string;
  fixAvailable?: boolean | { name?: string; version?: string; isSemVerMajor?: boolean };
  via?: Array<string | { title?: string; url?: string; source?: number; severity?: string; cwe?: string[] }>;
  effects?: string[];
}

/**
 * npm's own advisory check.
 *
 * `--package-lock-only` keeps the audit off the installed tree: it reads the
 * lockfile, so the result describes what the project declares rather than
 * whatever happens to be in node_modules on this machine. That makes the
 * finding reproducible for anyone else who checks out the same commit.
 */
export const npmAuditScanner: ExternalScanner = {
  id: 'npm-audit',
  name: 'npm audit',
  ruleId: 'SCAN-NPM-AUDIT',
  requiresNetwork: true,

  async run(opts: ScannerOptions): Promise<ScannerRun> {
    const started = Date.now();
    const self = { id: this.id, name: this.name };

    const lockfiles = findLockfiles(opts.root);
    if (lockfiles.length === 0) {
      return scannerResult(self, 'not-applicable', 'No package-lock.json found at or below the project root.');
    }

    if (!opts.allowNetwork) {
      return scannerResult(
        self,
        'needs-network',
        'npm audit queries the registry advisory database. Re-run with --online to allow it.',
      );
    }

    const version = await probeVersion('npm', ['--version'], opts.root);
    if (version === null) {
      return scannerResult(self, 'unavailable', 'npm is not on PATH.');
    }

    const findings: NewFinding[] = [];
    const failures: string[] = [];

    // Each lockfile is its own dependency tree and gets its own audit. Auditing
    // only the root of a monorepo would silently miss every workspace.
    for (const lockfile of lockfiles) {
      const cwd = join(opts.root, lockfileDir(lockfile));
      const result = await runTool(
        'npm',
        ['audit', '--json', '--package-lock-only', '--audit-level=info'],
        cwd,
        opts.timeoutMs,
      );

      const report = parseLooseJson<AuditReport>(result.stdout);
      if (!report) {
        failures.push(`${lockfile}: no parseable JSON (${(result.stderr || 'empty output').trim().slice(0, 120)})`);
        continue;
      }
      if (report.error) {
        failures.push(`${lockfile}: ${report.error.summary ?? report.error.code ?? 'unknown error'}`);
        continue;
      }
      findings.push(...auditToFindings(report, lockfile, opts));
    }

    const durationMs = Date.now() - started;

    // Every tree failing is a failed run, not a clean one.
    if (failures.length === lockfiles.length) {
      return scannerResult(self, 'failed', 'npm audit could not complete for any lockfile.', {
        version: `npm ${version}`,
        durationMs,
        error: failures.join(' | ').slice(0, 500),
      });
    }

    return scannerResult(
      self,
      'ran',
      [
        findings.length === 0
          ? `No advisories across ${lockfiles.length} lockfile(s).`
          : `${findings.length} package(s) with published advisories across ${lockfiles.length} lockfile(s).`,
        failures.length > 0 ? `${failures.length} lockfile(s) could not be audited — coverage is incomplete.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      {
        findings,
        version: `npm ${version}`,
        durationMs,
        ...(failures.length > 0 ? { error: failures.join(' | ').slice(0, 500) } : {}),
      },
    );
  },
};

/** Turns one audit report into findings scoped to the lockfile it came from. */
function auditToFindings(report: AuditReport, lockfile: string, opts: ScannerOptions): NewFinding[] {
  const findings: NewFinding[] = [];

  for (const [pkgName, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    const severity = mapSeverity(vuln.severity, 'low');
    const advisories = (vuln.via ?? []).filter((v): v is Exclude<typeof v, string> => typeof v === 'object');
    const titles = advisories.map((a) => a.title).filter((t): t is string => Boolean(t));
    const urls = advisories.map((a) => a.url).filter((u): u is string => Boolean(u));
    // A transitive vulnerability's `via` is a list of package names, not
    // advisories; say which path pulls it in rather than showing nothing.
    const viaPackages = (vuln.via ?? []).filter((v): v is string => typeof v === 'string');

    const fix = vuln.fixAvailable;
    const fixText =
      fix === true
        ? 'A fix is available via `npm audit fix`.'
        : fix && typeof fix === 'object'
          ? `Fix: upgrade to ${fix.name ?? pkgName}@${fix.version ?? 'a patched version'}${fix.isSemVerMajor ? ' (major version bump — review the changelog)' : ''}.`
          : 'No fix is published yet. Assess whether the vulnerable path is reachable, and pin or replace the package if it is.';

    findings.push(
      toScannerFinding({
        ruleId: npmAuditScanner.ruleId,
        project: opts.project,
        sessionId: null,
        workflowRunId: null,
        title: `Vulnerable dependency: ${pkgName}${vuln.range ? ` ${vuln.range}` : ''}`,
        category: 'DEPENDENCIES',
        layer: 'APPLICATION',
        severity,
        // The advisory is a published fact; whether this project reaches the
        // vulnerable code path is not, so this is not full confidence.
        confidence: vuln.isDirect ? 0.9 : 0.8,
        verification: 'LIKELY',
        affectedFiles: [lockfile],
        evidence: [
          { kind: 'config', label: 'Package', detail: `${pkgName}${vuln.range ? ` (${vuln.range})` : ''}${vuln.isDirect ? ' — direct dependency' : ' — transitive dependency'}`, file: lockfile },
          ...(titles.length > 0 ? [{ kind: 'output' as const, label: 'Advisory', detail: titles.slice(0, 4).join(' · ').slice(0, 400) }] : []),
          ...(viaPackages.length > 0 ? [{ kind: 'output' as const, label: 'Reached through', detail: viaPackages.slice(0, 8).join(' → ').slice(0, 300) }] : []),
          ...(urls.length > 0 ? [{ kind: 'output' as const, label: 'Reference', detail: urls.slice(0, 3).join(' ') }] : []),
          ...((vuln.effects ?? []).length > 0 ? [{ kind: 'output' as const, label: 'Affects', detail: (vuln.effects ?? []).slice(0, 8).join(', ').slice(0, 300) }] : []),
        ],
        impact:
          `npm's advisory database reports a ${severity} severity vulnerability in ${pkgName}, which ${lockfile} depends on ` +
          `${vuln.isDirect ? 'directly' : 'transitively'}. A dependency runs with the full privileges of the process that imports it, so a ` +
          'vulnerability there is a vulnerability in your application regardless of how carefully your own code is written.',
        recommendation: fixText,
        discriminator: `${lockfile}:${pkgName}@${vuln.range ?? '*'}`,
        source: 'scanner:npm-audit',
      }),
    );
  }

  return findings;
}
