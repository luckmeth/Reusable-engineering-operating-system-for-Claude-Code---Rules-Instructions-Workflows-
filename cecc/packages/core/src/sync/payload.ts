import { sha256 } from '../hash.js';
import { redactDeep } from '../secrets.js';
import type { Store } from '../storage/store.js';
import type { Severity } from '../types/common.js';
import type { ProjectConfig } from '../types/project.js';

/**
 * What cloud sync is allowed to send.
 *
 * The default payload carries judgements and counts — which rule fired, how
 * severe, how it was verified — and no material. No file contents, no commands,
 * no diffs, no evidence text, no file paths. Those are what a source tree and a
 * terminal history actually are, and shipping them to a server by default would
 * make a local-first security tool into an exfiltration channel with a nice UI.
 *
 * `includeEvidence` opts into evidence text, commands and file paths. It is
 * off unless someone turns it on, and `cecc sync --dry-run` prints the exact
 * bytes either way, so the decision is made with the payload in view.
 */
export interface SyncFinding {
  /** Stable across machines for the same rule + location. Not the local row id. */
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  layer: string;
  category: string;
  verification: string;
  confidence: number;
  status: string;
  occurrences: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  /** Included only with evidence enabled. */
  title?: string;
  files?: string[];
  evidence?: Array<{ kind: string; label: string; detail: string }>;
  command?: string | null;
}

export interface SyncPayload {
  schema: 'cecc.sync.v1';
  generatedAt: string;
  project: {
    /** Local project id. Stable, and not derived from any path. */
    id: string;
    /** Hashed so a repository name never travels unless evidence is enabled. */
    nameHash: string;
    name?: string;
    environment: string;
    stack: ProjectConfig['stack'];
  };
  counts: {
    events: number;
    findingsOpen: number;
    findingsBySeverity: Record<string, number>;
    tasksOpen: number;
    sessions: number;
  };
  integrity: {
    chainOk: boolean;
    eventsChecked: number;
    reason: string | null;
  };
  workflow: {
    stage: string | null;
    pinned: boolean;
  };
  findings: SyncFinding[];
  /** Present only when evidence is enabled, so the omission is visible. */
  includesEvidence: boolean;
  /** Everything deliberately left out, named. */
  excluded: string[];
}

export interface BuildPayloadOptions {
  project: ProjectConfig;
  store: Store;
  includeEvidence: boolean;
  /** Cap on findings per push. The rest go in the next one. */
  limit?: number;
}

const NEVER_SENT = [
  'file contents',
  'diffs and patches',
  'the agent\'s prompts or reasoning',
  'environment variables',
  'secrets of any kind (redacted at storage, and again here)',
];

const WITHOUT_EVIDENCE = ['finding titles', 'file paths', 'commands', 'evidence text'];

export function buildSyncPayload(opts: BuildPayloadOptions): SyncPayload {
  const { project, store, includeEvidence } = opts;

  const open = store.listFindings({ projectId: project.id, status: ['open'], limit: opts.limit ?? 500 });
  const session = store.getCurrentSession(project.id);
  const run = session ? store.getWorkflowRunBySession(session.id) : null;
  const chain = store.verifyEventChain(project.id);

  const bySeverity: Record<string, number> = {};
  for (const finding of open) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }

  const findings: SyncFinding[] = open.map((f) => ({
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    severity: f.severity,
    layer: f.layer,
    category: f.category,
    verification: f.verification,
    confidence: f.confidence,
    status: f.status,
    occurrences: f.occurrences,
    firstDetectedAt: f.firstDetectedAt,
    lastDetectedAt: f.lastDetectedAt,
    ...(includeEvidence
      ? {
          title: f.title,
          files: f.affectedFiles,
          command: f.command,
          evidence: f.evidence.map((e) => ({ kind: e.kind, label: e.label, detail: e.detail })),
        }
      : {}),
  }));

  const payload: SyncPayload = {
    schema: 'cecc.sync.v1',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      nameHash: sha256(project.name).slice(0, 16),
      ...(includeEvidence ? { name: project.name } : {}),
      environment: project.environment,
      stack: project.stack,
    },
    counts: {
      events: store.countEvents(project.id),
      findingsOpen: open.length,
      findingsBySeverity: bySeverity,
      tasksOpen: store.listTasks(project.id).filter((t) => t.status !== 'DONE' && t.status !== 'VERIFIED').length,
      sessions: store.listSessions(project.id, 1000).length,
    },
    integrity: {
      chainOk: chain.ok,
      eventsChecked: chain.checked,
      reason: chain.ok ? null : (chain.reason ?? 'unknown'),
    },
    workflow: {
      stage: run?.currentStage ?? null,
      pinned: Boolean(run?.pinnedStage),
    },
    findings,
    includesEvidence: includeEvidence,
    excluded: includeEvidence ? NEVER_SENT : [...NEVER_SENT, ...WITHOUT_EVIDENCE],
  };

  // Secrets are already redacted on the way into storage. Running the redactor
  // again on the way out costs microseconds and closes the gap where a future
  // field is added to a finding without anyone rechecking this path.
  return redactDeep(payload) as SyncPayload;
}

/** Identifies a payload in the audit log without storing the payload itself. */
export function payloadDigest(payload: SyncPayload): string {
  return sha256(JSON.stringify(payload)).slice(0, 32);
}
