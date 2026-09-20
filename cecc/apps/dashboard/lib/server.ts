import 'server-only';
import { loadModel, rankFindings, type TrainedModel, type TriageScore } from '@cecc/ml';
import {
  Store,
  ceccPaths,
  evaluateGates,
  findProjectRoot,
  isProtectedPath,
  loadPolicySet,
  loadProjectConfig,
  type Finding,
  type ProjectConfig,
} from '@cecc/core';

/**
 * Server-side access to the local CECC store.
 *
 * The dashboard reads the SQLite database directly rather than going through a
 * separate API process. CECC is local-first and single-user, so an extra
 * service would add a port, a lifecycle and a trust boundary without buying
 * anything. WAL mode lets these reads run while hook processes write.
 *
 * `server-only` makes importing this from a client component a build error
 * rather than a runtime leak — the database path and its contents never belong
 * in a browser bundle.
 */

export interface DashboardContext {
  root: string;
  project: ProjectConfig;
  /** Convenience alias — callers overwhelmingly want just the id. */
  projectId: string;
  store: Store;
}

export class NotInitializedError extends Error {
  constructor(readonly searchedFrom: string) {
    super('CECC is not initialized for this directory');
  }
}

/**
 * Resolves the project.
 *
 * CECC_PROJECT_ROOT wins so the dashboard can be pointed at a project other
 * than the one it is running from, which is the normal case when the dashboard
 * lives inside the CECC repository itself.
 */
export function resolveRoot(): string {
  const configured = process.env['CECC_PROJECT_ROOT'];
  if (configured) return configured;
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

/**
 * Opens a store for one request.
 *
 * Deliberately not cached across requests: a long-lived handle would hold a
 * stale snapshot while hooks append, and the dashboard's whole job is showing
 * what is happening right now. Opening SQLite is inexpensive.
 */
export function openContext(): DashboardContext {
  const root = resolveRoot();
  const project = loadProjectConfig(root);
  if (!project) throw new NotInitializedError(root);
  return { root, project, projectId: project.id, store: new Store(ceccPaths(root).db) };
}

/** Runs `fn` with a store and always closes it, even on throw. */
export function withStore<T>(fn: (ctx: DashboardContext) => T): T {
  const ctx = openContext();
  try {
    return fn(ctx);
  } finally {
    ctx.store.close();
  }
}

export interface TriageInfo {
  /** Findings in the order the model suggests reading them. */
  ordered: Finding[];
  scores: Record<string, TriageScore>;
  applied: boolean;
  reason: string;
  model: TrainedModel | null;
}

export interface OverviewData {
  project: ProjectConfig;
  root: string;
  session: ReturnType<Store['getCurrentSession']>;
  run: ReturnType<Store['getWorkflowRunBySession']>;
  findings: Finding[];
  events: ReturnType<Store['recentSessionEvents']>;
  tests: ReturnType<Store['listTestResults']>;
  tasks: ReturnType<Store['listTasks']>;
  readiness: ReturnType<typeof evaluateGates>;
  eventCount: number;
  chain: ReturnType<Store['verifyEventChain']>;
  protectedTouched: string[];
  triage: TriageInfo;
}

export function getOverview(): OverviewData {
  return withStore((ctx) => {
    const { store, project, root } = ctx;
    const policies = loadPolicySet(ceccPaths(root).policies, project.environment).set;

    const session = store.getCurrentSession(project.id);
    const run = session ? store.getWorkflowRunBySession(session.id) : null;
    const events = session ? store.recentSessionEvents(session.id, 400) : [];
    const findings = store.listFindings({ projectId: project.id, status: ['open'], limit: 300 });
    const tests = store.listTestResults(project.id, 25);
    const tasks = store.listTasks(project.id);

    const protectedTouched = [...new Set(events.flatMap((e) => e.filePaths))].filter((f) => isProtectedPath(policies, f));

    // The model only reorders. It never creates, closes or re-grades a finding,
    // and it declines entirely when it cannot beat chance on held-out data.
    const model = loadModel(ceccPaths(root).dir);
    const ranked = rankFindings(findings, model);

    return {
      project,
      root,
      session,
      run,
      findings: ranked.ordered,
      triage: {
        ordered: ranked.ordered,
        scores: Object.fromEntries(ranked.scores),
        applied: ranked.applied,
        reason: ranked.reason,
        model,
      },
      events,
      tests,
      tasks,
      readiness: evaluateGates({ events, findings, tests, tasks, run, uncommittedFiles: [], protectedTouched }),
      eventCount: store.countEvents(project.id),
      chain: store.verifyEventChain(project.id),
      protectedTouched,
    };
  });
}
