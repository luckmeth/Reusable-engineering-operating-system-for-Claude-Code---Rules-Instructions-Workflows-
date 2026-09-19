import type {
  DetectionMethod,
  Evidence,
  FindingCategory,
  FindingStatus,
  SecurityLayer,
  SourceLocation,
  Severity,
  VerificationState,
} from './common.js';

/**
 * A finding is a claim about the project, the agent, or CECC itself, backed by
 * evidence.
 *
 * Deliberately absent: a numeric "security score". A single number invites false
 * confidence and hides the distinction between "checked and clean" and "never
 * checked". Findings, evidence and verification state carry that information
 * honestly; a score would throw it away.
 */
export interface Finding {
  id: string;
  /**
   * Stable identity across scans: same rule + same location + same trigger.
   * Re-detecting bumps `occurrences` instead of creating a duplicate.
   */
  fingerprint: string;
  ruleId: string;
  title: string;
  category: FindingCategory;
  layer: SecurityLayer;
  severity: Severity;
  /** 0..1. Never fabricate precision — rules declare a calibrated default. */
  confidence: number;
  verification: VerificationState;
  detection: DetectionMethod;
  status: FindingStatus;
  /** Component that produced it, e.g. 'command-monitor', 'correlation-engine'. */
  source: string;
  projectId: string;
  sessionId: string | null;
  workflowRunId: string | null;
  affectedFiles: string[];
  affectedLines: SourceLocation[];
  command: string | null;
  evidence: Evidence[];
  /** Why it matters, in concrete terms. */
  impact: string;
  /** What to actually do about it. */
  recommendation: string;
  relatedEvents: string[];
  relatedFindings: string[];
  relatedTests: string[];
  relatedCommits: string[];
  occurrences: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  suppression: Suppression | null;
}

/**
 * Suppressions are always recorded with a reason and an author. A finding that
 * vanishes with no trace is indistinguishable from a finding that was never
 * raised, which defeats the point of an audit trail.
 */
export interface Suppression {
  reason: string;
  by: string;
  createdAt: string;
  /** ISO date. Expiring suppressions stop silent permanent muting. */
  expiresAt: string | null;
}

export type NewFinding = Omit<
  Finding,
  'id' | 'fingerprint' | 'occurrences' | 'firstDetectedAt' | 'lastDetectedAt' | 'resolvedAt' | 'suppression'
> &
  Partial<Pick<Finding, 'id' | 'fingerprint' | 'firstDetectedAt'>>;
