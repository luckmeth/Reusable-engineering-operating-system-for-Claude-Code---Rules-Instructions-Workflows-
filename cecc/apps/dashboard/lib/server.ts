import 'server-only';
import { loadModel, rankFindings, type TrainedModel, type TriageScore } from '@cecc/ml';
import {
  Store,
  accountTokens,
  allRules,
  ceccPaths,
  computePolicyChecksum,
  evaluateGates,
  findProjectRoot,
  isProtectedPath,
  loadPolicySet,
  loadProjectConfig,
  type CeccEvent,
  type Finding,
  type ProjectConfig,
  type TokenAccounting,
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

/**
 * Everything the control panel renders, gathered in one open of the store.
 *
 * The panel exists because judging a session meant visiting seven pages, and
 * the page people actually read was whichever they happened to land on.
 * Loading it here rather than having the panel call six loaders keeps it to a
 * single database open, which is what makes the page cheap enough to refresh.
 */
export interface ControlPanelData {
  project: ProjectConfig;
  root: string;
  session: ReturnType<Store['getCurrentSession']>;
  run: ReturnType<Store['getWorkflowRunBySession']>;
  findings: Finding[];
  events: CeccEvent[];
  readiness: ReturnType<typeof evaluateGates>;
  tokens: TokenAccounting;
  /** Detection rules by enforcement mode, for the controls summary. */
  policy: { total: number; observe: number; warn: number; block: number; checksum: string };
  agentObserved: boolean;
  sessionCount: number;
  eventCount: number;
}

/**
 * The small slice of state the shell needs on every page.
 *
 * Kept separate from `getControlPanel` because it runs on every navigation,
 * including pages that load nothing else. It opens the store once and asks
 * three cheap questions; anything heavier belongs on the page that needs it.
 *
 * Every failure mode ends at "not initialized" rather than throwing, because a
 * broken chrome would take every page down with it.
 */
export interface ShellState {
  initialized: boolean;
  projectName: string;
  environment: string;
  agentStatus: 'active' | 'idle' | 'unknown';
  counts: { findings: number; critical: number; sessions: number };
}

export function getShellState(root: string): ShellState {
  const empty: ShellState = {
    initialized: false,
    projectName: 'No project open',
    environment: 'development',
    agentStatus: 'unknown',
    counts: { findings: 0, critical: 0, sessions: 0 },
  };

  try {
    const project = loadProjectConfig(root);
    if (!project) return empty;

    const store = new Store(ceccPaths(root).db);
    try {
      const findings = store.listFindings({ projectId: project.id, status: ['open'], limit: 500 });
      const session = store.getCurrentSession(project.id);

      // "Active" means an agent session that has not ended, not merely that a
      // session row exists — scans open rows of their own.
      const live = session !== null && session.endedAt === null && session.agentId !== null;

      return {
        initialized: true,
        projectName: project.name,
        environment: project.environment,
        agentStatus: live ? 'active' : 'idle',
        counts: {
          findings: findings.length,
          critical: findings.filter((f) => f.severity === 'critical').length,
          sessions: store.listSessions(project.id, 200).length,
        },
      };
    } finally {
      store.close();
    }
  } catch {
    return empty;
  }
}

export function getControlPanel(): ControlPanelData {
  return withStore((ctx) => {
    const { store, project, root } = ctx;

    const session = store.getCurrentSession(project.id);
    const run = session ? store.getWorkflowRunBySession(session.id) : null;
    const findings = store.listFindings({ projectId: project.id, status: ['open'], limit: 300 });
    const tests = store.listTestResults(project.id, 25);
    const tasks = store.listTasks(project.id);

    // Two reads on purpose: the live feed seeds from the recent slice and then
    // streams, while the accounting needs the whole history to tell a second
    // read of a file from a first one.
    const events = store.queryEvents({ projectId: project.id, limit: 60 });
    const allEvents = store.queryEvents({ projectId: project.id, limit: 20_000 });

    const policySet = loadPolicySet(ceccPaths(root).policies, project.environment).set;
    const modes = Object.values(policySet.policies).reduce<Record<string, number>>((acc, p) => {
      acc[p.mode] = (acc[p.mode] ?? 0) + 1;
      return acc;
    }, {});

    const protectedTouched = [...new Set(events.flatMap((e) => e.filePaths))].filter((f) =>
      isProtectedPath(policySet, f),
    );

    return {
      project,
      root,
      session,
      run,
      findings,
      events,
      readiness: evaluateGates({ events, findings, tests, tasks, run, uncommittedFiles: [], protectedTouched }),
      tokens: accountTokens(allEvents),
      policy: {
        total: allRules().length,
        observe: modes['observe'] ?? 0,
        warn: modes['warn'] ?? 0,
        block: modes['block'] ?? 0,
        checksum: computePolicyChecksum(policySet).slice(0, 12),
      },
      agentObserved: allEvents.some((e) => e.source === 'agent'),
      sessionCount: store.listSessions(project.id, 200).length,
      eventCount: store.countEvents(project.id),
    };
  });
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
  /**
   * Has a coding agent ever been observed here?
   *
   * Not the same as "are there events". `cecc scan` and `cecc init` write
   * events of their own and open a session row, so a project that has only
   * ever been scanned looks busy by either of those measures while CECC still
   * has no idea what any agent did in it.
   */
  agentObserved: boolean;
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
      agentObserved: store.queryEvents({ projectId: project.id, sources: ['agent'], limit: 1 }).length > 0,
      chain: store.verifyEventChain(project.id),
      protectedTouched,
    };
  });
}
