import type { Environment, PolicyMode, Severity } from './common.js';

/**
 * Per-rule enforcement policy.
 *
 * Policies live in a file that CECC treats as protected: an agent quietly
 * relaxing enforcement mid-task is itself a finding (see rule AGENT-028).
 */
export interface Policy {
  ruleId: string;
  enabled: boolean;
  mode: PolicyMode;
  /** Empty means "all environments". */
  environments: Environment[];
  /** Findings below this severity are recorded but never block. */
  severityThreshold: Severity;
  /** Glob-ish path prefixes this rule ignores. */
  exclusions: string[];
  rationale: string;
  owner: string;
  updatedAt: string;
}

export interface PolicySet {
  version: number;
  /** Fallback when no per-rule policy exists. */
  defaultMode: PolicyMode;
  environment: Environment;
  policies: Record<string, Policy>;
  protectedPaths: string[];
  /** Enforcement posture for changes touching protectedPaths. */
  protectedPathMode: PolicyMode;
  /** Integrity hash of the policy file at last legitimate write. */
  checksum: string | null;
  updatedAt: string;
}
