import type { NewFinding } from '../types/finding.js';
import type { ProjectConfig } from '../types/project.js';

/**
 * External scanners.
 *
 * CECC's own rules watch what the agent does. They say nothing about a
 * vulnerability published against a dependency three levels down, or a taint
 * path a purpose-built static analyser would find. Those tools already exist
 * and are better at it, so CECC runs them rather than reimplementing them.
 *
 * The contract that matters is the honest one: a scanner that is not installed,
 * or that could not reach the network, produces a recorded coverage gap — never
 * an empty result that reads as "clean". "No findings" and "never ran" must
 * stay distinguishable everywhere they are displayed.
 */
export interface ScannerOptions {
  root: string;
  project: ProjectConfig;
  /**
   * Whether this scanner may make outbound requests.
   *
   * Off by default. Querying a vulnerability database discloses the project's
   * dependency inventory to a third party, which is a decision for the person
   * running CECC, not a default.
   */
  allowNetwork: boolean;
  timeoutMs: number;
  /**
   * HTTP client override.
   *
   * Exists so the network-backed scanners can be tested against recorded
   * responses. Production callers leave it unset and get global fetch; nothing
   * about the request path changes between the two.
   */
  fetchImpl?: typeof fetch;
}

export type ScannerOutcome =
  /** Ran to completion. `findings` is authoritative for this scanner's scope. */
  | 'ran'
  /** The tool is not installed here. */
  | 'unavailable'
  /** Installed, but the project has nothing for it to read (no lockfile, etc.). */
  | 'not-applicable'
  /** Needs the network and was not allowed to use it. */
  | 'needs-network'
  /** Started and failed. `error` says how. */
  | 'failed';

export interface ScannerRun {
  scannerId: string;
  name: string;
  outcome: ScannerOutcome;
  /** Findings in CECC's model. Empty unless `outcome === 'ran'`. */
  findings: NewFinding[];
  /** One line a human can act on — why it did not run, or what it covered. */
  note: string;
  /** Tool version when it could be determined. Part of the evidence trail. */
  version: string | null;
  durationMs: number;
  error: string | null;
}

export interface ExternalScanner {
  id: string;
  name: string;
  /** Rule id its findings are filed under, so policy and suppression work normally. */
  ruleId: string;
  /** True when this scanner cannot work without outbound requests. */
  requiresNetwork: boolean;
  run(opts: ScannerOptions): Promise<ScannerRun>;
}

export function scannerResult(
  scanner: Pick<ExternalScanner, 'id' | 'name'>,
  outcome: ScannerOutcome,
  note: string,
  extra: Partial<Omit<ScannerRun, 'scannerId' | 'name' | 'outcome' | 'note'>> = {},
): ScannerRun {
  return {
    scannerId: scanner.id,
    name: scanner.name,
    outcome,
    note,
    findings: extra.findings ?? [],
    version: extra.version ?? null,
    durationMs: extra.durationMs ?? 0,
    error: extra.error ?? null,
  };
}
