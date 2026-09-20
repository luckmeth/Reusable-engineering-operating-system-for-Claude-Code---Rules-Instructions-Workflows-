import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findLockfiles, mapSeverity, toScannerFinding } from './shared.js';
import { scannerResult, type ExternalScanner, type ScannerOptions, type ScannerRun } from './types.js';
import type { NewFinding } from '../types/finding.js';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns/';

/** Cap on packages sent in one run — keeps a huge monorepo from a multi-minute scan. */
const MAX_PACKAGES = 900;
/** Cap on advisories whose details are fetched. Ids alone are not actionable. */
const MAX_DETAILS = 60;

interface LockfileV2 {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; dev?: boolean; link?: boolean; resolved?: string }>;
  dependencies?: Record<string, { version?: string; dev?: boolean; dependencies?: unknown }>;
}

interface OsvBatchResponse {
  results?: Array<{ vulns?: Array<{ id: string; modified?: string }> }>;
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ package?: { name?: string; ecosystem?: string }; ranges?: unknown }>;
  references?: Array<{ type?: string; url?: string }>;
}

interface PackageRef {
  name: string;
  version: string;
  dev: boolean;
  /** Lockfile this version was resolved in — findings point back at it. */
  lockfile: string;
}

/**
 * Reads the resolved package set from every npm lockfile in the project.
 *
 * Only npm lockfiles are supported. pnpm and yarn use different formats, and a
 * half-correct parser for either would under-report — which for a security
 * scanner is worse than saying plainly that it does not handle them.
 */
export function readNpmLockfile(root: string): { lockfiles: string[]; packages: PackageRef[] } | null {
  const lockfiles = findLockfiles(root);
  if (lockfiles.length === 0) return null;

  const seen = new Map<string, PackageRef>();

  for (const lockfile of lockfiles) {
    let parsed: LockfileV2;
    try {
      parsed = JSON.parse(readFileSync(join(root, lockfile), 'utf8')) as LockfileV2;
    } catch {
      continue; // one unreadable lockfile must not discard the others
    }

    let before = seen.size;

    // Lockfile v2/v3: the `packages` map is keyed by install path.
    for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
      if (!path || entry.link) continue; // "" is the root project; links are workspaces
      const marker = 'node_modules/';
      const index = path.lastIndexOf(marker);
      if (index === -1) continue;
      const name = path.slice(index + marker.length);
      if (!name || !entry.version) continue;
      const key = `${name}@${entry.version}`;
      if (!seen.has(key)) seen.set(key, { name, version: entry.version, dev: entry.dev === true, lockfile });
    }

    // Lockfile v1 fallback, only when v2 parsing produced nothing for this file.
    if (seen.size === before) {
      const walk = (deps: Record<string, { version?: string; dev?: boolean; dependencies?: unknown }> | undefined): void => {
        for (const [name, entry] of Object.entries(deps ?? {})) {
          if (entry.version) {
            const key = `${name}@${entry.version}`;
            if (!seen.has(key)) seen.set(key, { name, version: entry.version, dev: entry.dev === true, lockfile });
          }
          walk(entry.dependencies as Record<string, { version?: string; dev?: boolean }> | undefined);
        }
      };
      walk(parsed.dependencies);
    }
  }

  return { lockfiles, packages: [...seen.values()] };
}

/** Picks the most useful severity OSV offers, preferring the database's own label. */
function osvSeverity(vuln: OsvVuln): string | null {
  const labelled = vuln.database_specific?.severity;
  if (labelled) return labelled;
  const cvss = vuln.severity?.find((s) => s.type?.startsWith('CVSS'))?.score;
  if (!cvss) return null;
  // A CVSS vector string carries no single number; a bare score does.
  const numeric = Number.parseFloat(cvss);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 9) return 'critical';
  if (numeric >= 7) return 'high';
  if (numeric >= 4) return 'moderate';
  return 'low';
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number, http: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string, timeoutMs: number, http: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await http(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OSV.dev — the open vulnerability database.
 *
 * It covers advisories npm's own feed does not, and it is queried by exact
 * package version rather than by semver range, so it disagrees with npm audit
 * usefully rather than redundantly. Both run; overlapping findings are separate
 * rows under separate rule ids so the source of each claim stays visible.
 *
 * This sends package names and versions to a third party. That is a disclosure
 * of the project's dependency inventory, so it is gated behind an explicit
 * opt-in and never happens by default.
 */
export const osvScanner: ExternalScanner = {
  id: 'osv',
  name: 'OSV.dev',
  ruleId: 'SCAN-OSV',
  requiresNetwork: true,

  async run(opts: ScannerOptions): Promise<ScannerRun> {
    const started = Date.now();
    const self = { id: this.id, name: this.name };

    const inventory = readNpmLockfile(opts.root);
    if (!inventory) {
      return scannerResult(self, 'not-applicable', 'No npm lockfile found. OSV support here covers package-lock.json only.');
    }
    if (inventory.packages.length === 0) {
      return scannerResult(self, 'not-applicable', 'The lockfile declares no resolved packages.');
    }
    if (!opts.allowNetwork) {
      return scannerResult(
        self,
        'needs-network',
        `OSV would send ${inventory.packages.length} package name/version pairs to api.osv.dev. Re-run with --online to allow it.`,
      );
    }

    const http = opts.fetchImpl ?? fetch;
    const packages = inventory.packages.slice(0, MAX_PACKAGES);
    const truncated = inventory.packages.length - packages.length;

    let batch: OsvBatchResponse;
    try {
      batch = await postJson<OsvBatchResponse>(
        OSV_BATCH_URL,
        { queries: packages.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) },
        opts.timeoutMs,
        http,
      );
    } catch (err) {
      return scannerResult(self, 'failed', 'Could not reach api.osv.dev.', {
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Map advisory id -> the packages it was returned for.
    const byVuln = new Map<string, PackageRef[]>();
    (batch.results ?? []).forEach((result, index) => {
      const pkg = packages[index];
      if (!pkg) return;
      for (const vuln of result.vulns ?? []) {
        const list = byVuln.get(vuln.id) ?? [];
        list.push(pkg);
        byVuln.set(vuln.id, list);
      }
    });

    if (byVuln.size === 0) {
      return scannerResult(
        self,
        'ran',
        `No OSV advisories for ${packages.length} resolved package(s) across ${inventory.lockfiles.length} lockfile(s).`,
        { durationMs: Date.now() - started },
      );
    }

    const ids = [...byVuln.keys()].slice(0, MAX_DETAILS);
    const details = await Promise.all(
      ids.map(async (id) => {
        try {
          return await getJson<OsvVuln>(`${OSV_VULN_URL}${encodeURIComponent(id)}`, opts.timeoutMs, http);
        } catch {
          // A detail fetch that fails still leaves a usable finding: the id is
          // enough to look the advisory up. Degrade, do not drop.
          return { id } as OsvVuln;
        }
      }),
    );

    const findings: NewFinding[] = details.map((vuln) => {
      const affected = byVuln.get(vuln.id) ?? [];
      const severity = mapSeverity(osvSeverity(vuln), 'medium');
      const names = [...new Set(affected.map((p) => `${p.name}@${p.version}`))];
      const devOnly = affected.length > 0 && affected.every((p) => p.dev);

      return toScannerFinding({
        ruleId: osvScanner.ruleId,
        project: opts.project,
        sessionId: null,
        workflowRunId: null,
        title: `${vuln.id}: ${vuln.summary ?? 'advisory affects a resolved dependency'}`.slice(0, 160),
        category: 'SUPPLY_CHAIN',
        layer: 'APPLICATION',
        // A dev-only dependency is still a real advisory, but it does not reach
        // production. Grading it identically is how a tool trains people to
        // ignore it, so it is recorded one band lower with the reason stated.
        severity: devOnly && severity !== 'info' ? downgrade(severity) : severity,
        confidence: 0.85,
        verification: 'LIKELY',
        affectedFiles: [...new Set(affected.map((p) => p.lockfile))].sort(),
        evidence: [
          { kind: 'config', label: 'Affected packages', detail: names.slice(0, 8).join(', ').slice(0, 400), file: affected[0]?.lockfile ?? inventory.lockfiles[0] },
          ...(vuln.aliases?.length ? [{ kind: 'output' as const, label: 'Also known as', detail: vuln.aliases.slice(0, 6).join(', ') }] : []),
          ...(vuln.details ? [{ kind: 'output' as const, label: 'Details', detail: vuln.details.slice(0, 500) }] : []),
          ...(devOnly ? [{ kind: 'output' as const, label: 'Scope', detail: 'Development dependency only — not shipped to production.' }] : []),
          { kind: 'output', label: 'Reference', detail: `https://osv.dev/vulnerability/${vuln.id}` },
        ],
        impact:
          `OSV.dev reports ${vuln.id} against ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}, ` +
          `at the exact version this lockfile resolves. ${devOnly ? 'It is a development dependency, so it does not reach production — but it does run on developer machines and in CI, which are credential-bearing environments.' : 'It runs with the same privileges as the rest of the application.'}`,
        recommendation:
          `Check https://osv.dev/vulnerability/${vuln.id} for the fixed version, then upgrade and re-run the scan. ` +
          'If no fix exists, decide whether the vulnerable code path is reachable here and record that decision as a suppression with a reason.',
        discriminator: `${vuln.id}:${names.sort().join(',')}`,
        source: 'scanner:osv',
      });
    });

    const note = [
      `${byVuln.size} advisory/advisories across ${packages.length} package(s) in ${inventory.lockfiles.length} lockfile(s).`,
      byVuln.size > ids.length ? `Details fetched for the first ${ids.length}.` : '',
      truncated > 0 ? `${truncated} package(s) beyond the ${MAX_PACKAGES} cap were not queried.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return scannerResult(self, 'ran', note, { findings, durationMs: Date.now() - started });
  },
};

const downgrade = (s: ReturnType<typeof mapSeverity>): ReturnType<typeof mapSeverity> =>
  ({ critical: 'high', high: 'medium', medium: 'low', low: 'info', info: 'info' } as const)[s];
