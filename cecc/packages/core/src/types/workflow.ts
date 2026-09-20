import type { Severity } from './common.js';

/** The default pipeline. Projects may customize the stage list later. */
export const WORKFLOW_STAGES = [
  'DISCOVER',
  'UNDERSTAND',
  'INSPECT',
  'PLAN',
  'IMPLEMENT',
  'TEST',
  'SECURITY_REVIEW',
  'CODE_REVIEW',
  'READY',
  'DEPLOY',
  'VERIFY',
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const STAGE_STATES = ['pending', 'active', 'complete', 'blocked', 'skipped'] as const;
export type StageState = (typeof STAGE_STATES)[number];

export interface StageRecord {
  stage: WorkflowStage;
  state: StageState;
  startedAt: string | null;
  endedAt: string | null;
  /** 'agent' | 'user' | 'cecc' — who drove the work in this stage. */
  actor: string | null;
  /** Evidence event ids that justified entering this stage. */
  evidenceEventIds: string[];
  completedChecks: string[];
  failedChecks: string[];
  pendingChecks: string[];
  blockers: string[];
  warnings: string[];
  /** True when CECC inferred the stage; false when a human set it. */
  inferred: boolean;
  durationMs: number | null;
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  sessionId: string;
  currentStage: WorkflowStage;
  /** Set by a human override; suppresses inference until cleared. */
  pinnedStage: WorkflowStage | null;
  stages: StageRecord[];
  startedAt: string;
  endedAt: string | null;
}

/**
 * A gate is a precondition for declaring work done. Gates are evaluated from
 * recorded evidence, never from an agent asserting completion.
 */
export interface GateResult {
  id: string;
  label: string;
  state: 'pass' | 'fail' | 'pending' | 'not_applicable';
  /** Human-readable reason, always populated for fail/pending. */
  detail: string;
  severity: Severity;
  /** True when this gate failing prevents READY. */
  blocking: boolean;
  evidenceEventIds: string[];
  relatedFindingIds: string[];
}

export interface ReadinessReport {
  ready: boolean;
  gates: GateResult[];
  blockers: string[];
  evaluatedAt: string;
}
