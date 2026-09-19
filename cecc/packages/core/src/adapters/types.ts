import type { NewEvent } from '../types/event.js';
import type { ContentChange } from '../types/event.js';

/**
 * Agent adapter contract.
 *
 * CECC's event model is agent-agnostic on purpose. Claude Code is the first
 * adapter, not the architecture: the interesting behaviours CECC detects —
 * weakening a test to make it pass, deleting an authorization check, committing
 * past the hooks — are not specific to any one agent, and the rules that detect
 * them should not have to be rewritten per vendor.
 *
 * An adapter's entire job is translation. It must not make security decisions,
 * and it must never widen the event vocabulary to suit its source.
 */
export interface AgentAdapter {
  /** Stable id recorded on every event, e.g. 'claude-code'. */
  id: string;
  displayName: string;

  /** Detected agent version, or null when it cannot be determined. */
  detectVersion(): Promise<string | null>;

  /** True when this adapter recognizes the payload. */
  canHandle(payload: unknown): boolean;

  /**
   * Translates a native payload into normalized events.
   *
   * Returns an array because one native event can carry several observations —
   * a completed Bash call is both a command result and, when it was a test run,
   * a test result.
   */
  normalize(payload: unknown, ctx: AdapterContext): NormalizedActivity;

  /** Whether the agent can be told to block this action, and how to phrase it. */
  buildBlockResponse(reason: string): unknown;
}

export interface AdapterContext {
  projectId: string;
  sessionId: string;
  workflowRunId: string | null;
  projectRoot: string;
  /** Reads a file from disk when the payload omits prior content. */
  readFile?: (path: string) => string | null;
}

export interface NormalizedActivity {
  events: NewEvent[];
  /** File changes extracted from the payload, ready for the rule engine. */
  changes: ContentChange[];
  /** Adapter-native session id, so repeated hooks converge on one CECC session. */
  externalSessionId: string | null;
  /** Reported permission mode — material to rule AGENT-001. */
  permissionMode: string | null;
  /** True when this event type can be blocked by returning a decision. */
  blockable: boolean;
  /** Anything the adapter could not map, kept for diagnosis rather than discarded. */
  unmapped: Record<string, unknown>;
}
