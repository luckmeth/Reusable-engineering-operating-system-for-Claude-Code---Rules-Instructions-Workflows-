import type { EventSource, EventStatus, Evidence, Severity } from './common.js';

/**
 * Canonical event types.
 *
 * `tool.*` events are agent-agnostic on purpose: Claude Code is the first
 * adapter, not the model. An adapter's job is to map its native events onto
 * this vocabulary, never to widen it ad hoc.
 */
export const EVENT_TYPES = [
  // agent lifecycle
  'session.started',
  'session.ended',
  'prompt.submitted',
  'agent.stopped',
  'agent.notification',
  'context.compacted',
  // tool activity
  'tool.started',
  'tool.completed',
  'tool.failed',
  'tool.blocked',
  // filesystem
  'file.read',
  'file.created',
  'file.modified',
  'file.deleted',
  // process
  'command.started',
  'command.completed',
  'command.failed',
  // git
  'git.status',
  'git.commit',
  'git.branch',
  'git.push',
  // validation
  'test.run',
  'lint.run',
  'typecheck.run',
  'build.run',
  // analysis
  'security.scan',
  'dependency.scan',
  'finding.opened',
  'finding.resolved',
  // workflow
  'workflow.stage.entered',
  'workflow.stage.completed',
  'workflow.gate.evaluated',
  'task.updated',
  // cecc's own audit trail
  'cecc.initialized',
  'cecc.policy.changed',
  'cecc.enforcement',
  'cecc.integrity',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The normalized event. Everything CECC knows enters through this shape.
 *
 * `seq` is assigned by the store, not the producer: wall-clock timestamps from
 * concurrent hook processes are not reliably ordered, and event order is
 * evidence.
 */
export interface CeccEvent {
  id: string;
  seq: number;
  timestamp: string;
  projectId: string;
  sessionId: string;
  workflowRunId: string | null;
  /** Which adapter produced this, e.g. 'claude-code'. null for CECC's own events. */
  agentId: string | null;
  source: EventSource;
  type: EventType;
  severity: Severity;
  status: EventStatus;
  /** Shell command, when the event represents process execution. */
  command: string | null;
  /** Tool name as reported by the agent adapter, e.g. 'Edit', 'Bash'. */
  tool: string | null;
  filePaths: string[];
  metadata: Record<string, unknown>;
  evidence: Evidence[];
  durationMs: number | null;
  parentEventId: string | null;
  /** Hash of the significant payload — used for dedup and integrity checks. */
  contentHash: string | null;
  /**
   * Rule ids that produced findings from this event.
   *
   * CECC's own annotation rather than an observation, written after the
   * event is stored. Correlation patterns match on it, which is far more
   * reliable than re-deriving intent from file paths.
   */
  findingRuleIds: string[];
}

/** What a producer supplies; the store fills in the rest. */
export type NewEvent = Omit<CeccEvent, 'id' | 'seq' | 'timestamp' | 'contentHash' | 'findingRuleIds'> &
  Partial<Pick<CeccEvent, 'id' | 'timestamp' | 'contentHash' | 'findingRuleIds'>>;

/**
 * A normalized file change.
 *
 * Rules operate on this rather than on raw tool payloads or raw diffs, so a
 * rule written once works whether the change arrived from an agent's Edit tool,
 * a Write tool, or a git diff. `removed` is what makes control-removal
 * detection possible, so adapters must populate it whenever it is knowable.
 */
export interface ContentChange {
  file: string;
  /** Lines present after the change. */
  added: ChangedLine[];
  /** Lines present before the change and now gone. */
  removed: ChangedLine[];
  /** Full post-change content when available (Write tool, file read). */
  fullContent?: string;
  isNewFile: boolean;
  isDeletion: boolean;
  /** How this change was observed, for evidence attribution. */
  origin: 'tool' | 'diff' | 'filesystem';
}

export interface ChangedLine {
  /** 1-indexed line number when known, null for patch fragments without context. */
  line: number | null;
  text: string;
}
