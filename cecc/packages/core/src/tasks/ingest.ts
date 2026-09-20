import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortHash } from '../hash.js';
import * as git from '../monitors/git.js';
import type { Store } from '../storage/store.js';
import type { ProjectConfig } from '../types/project.js';
import type { Task, TaskStatus } from '../types/task.js';
import { findTaskDocuments, parseTaskDocument, scanTodoMarkers, type DiscoveredTask } from './discover.js';

export * from './discover.js';

export interface TaskIngestOptions {
  root: string;
  project: ProjectConfig;
  store: Store;
  /** Skip the source-comment sweep — it is the expensive half. */
  skipTodoScan?: boolean;
  /** Skip the markdown documents. */
  skipDocuments?: boolean;
  /** Report what would change without writing anything. */
  dryRun?: boolean;
}

export interface TaskIngestReport {
  created: Task[];
  updated: Task[];
  unchanged: number;
  /** Ingested tasks whose source line is gone. Removed unless this is a dry run. */
  removed: Array<{ id: string; title: string; origin: string }>;
  documents: string[];
  filesScanned: number;
  discovered: number;
  durationMs: number;
  dryRun: boolean;
}

/**
 * Deterministic id for an ingested task.
 *
 * Derived from the source key rather than random, so re-running ingestion
 * updates the same row. Line numbers are excluded from the key upstream — code
 * moves constantly, and a task that duplicated itself every time a file was
 * reformatted would be worse than no task list at all.
 */
export function ingestedTaskId(projectId: string, task: DiscoveredTask): string {
  return shortHash(`${projectId}|${task.origin}|${task.key}`);
}

/** Statuses a person (or the workflow) set, which a re-scan must not overwrite. */
const USER_OWNED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFIED']);

/**
 * Decides the status of a task that already exists.
 *
 * The source document owns "is this finished" — a ticked checkbox is an
 * explicit statement. Everything in between is the developer's, because CECC
 * cannot see from a file that someone started work this morning.
 */
export function reconcileStatus(source: DiscoveredTask, existing: Task | null): TaskStatus {
  if (!existing) return source.status;
  if (source.status === 'DONE') return 'DONE';
  // Reaching here means the source does not say DONE. If the store does, the
  // box was unticked or the marker came back, and the source is authoritative.
  if (existing.status === 'DONE') return source.status;
  return USER_OWNED.has(existing.status) ? existing.status : source.status;
}

/**
 * Reads tasks out of the repository and reconciles them with the store.
 *
 * Ingested tasks are a projection of files, not a second source of truth. That
 * is why a task whose source line disappeared is removed rather than left
 * behind: a tracker that accumulates entries nobody can trace back to anything
 * is how task lists stop being read.
 */
export async function ingestTasks(opts: TaskIngestOptions): Promise<TaskIngestReport> {
  const started = Date.now();
  const { root, project, store } = opts;

  const documents = opts.skipDocuments ? [] : findTaskDocuments(root);
  const discovered: DiscoveredTask[] = [];

  for (const doc of documents) {
    try {
      discovered.push(...parseTaskDocument(readFileSync(join(root, doc), 'utf8'), doc));
    } catch {
      // An unreadable document is reported by its absence from `documents`
      // consumers see; it must not abort the rest of the ingest.
    }
  }

  let files: string[] = [];
  if (!opts.skipTodoScan) {
    files = await git.getTrackedFiles(root).catch(() => [] as string[]);
    discovered.push(...scanTodoMarkers({ root, files }));
  }

  const existing = store.listTasks(project.id);
  const byId = new Map(existing.map((t) => [t.id, t]));

  const created: Task[] = [];
  const updated: Task[] = [];
  let unchanged = 0;
  const liveIds = new Set<string>();

  for (const source of discovered) {
    const id = ingestedTaskId(project.id, source);
    liveIds.add(id);
    const prior = byId.get(id) ?? null;
    const status = reconcileStatus(source, prior);

    const affectedFiles = [source.file];
    const description = source.description;

    if (
      prior &&
      prior.title === source.title &&
      prior.description === description &&
      prior.status === status &&
      prior.priority === source.priority
    ) {
      unchanged += 1;
      continue;
    }

    if (opts.dryRun) {
      (prior ? updated : created).push({
        ...(prior ?? emptyTask(id, project.id)),
        title: source.title,
        description,
        priority: source.priority,
        status,
        affectedFiles,
        origin: source.origin,
      });
      continue;
    }

    const saved = store.upsertTask({
      ...(prior ?? {}),
      id,
      projectId: project.id,
      title: source.title,
      description,
      priority: source.priority,
      status,
      stage: prior?.stage ?? null,
      dependencies: prior?.dependencies ?? [],
      affectedFiles,
      tests: prior?.tests ?? [],
      securityChecks: prior?.securityChecks ?? [],
      acceptanceCriteria: prior?.acceptanceCriteria ?? [],
      evidenceEventIds: prior?.evidenceEventIds ?? [],
      origin: source.origin,
      ...(prior ? { createdAt: prior.createdAt } : {}),
    });
    (prior ? updated : created).push(saved);
  }

  // Only ingested tasks are pruned. A task someone typed in is theirs.
  const stale = existing.filter((t) => (t.origin === 'docs' || t.origin === 'todo-scan') && !liveIds.has(t.id));
  if (!opts.dryRun && stale.length > 0) {
    store.deleteTasks(stale.map((t) => t.id));
  }

  if (!opts.dryRun) {
    store.audit(project.id, 'cecc', 'tasks.ingested', {
      created: created.length,
      updated: updated.length,
      removed: stale.length,
      unchanged,
      documents,
      filesScanned: files.length,
    });
  }

  return {
    created,
    updated,
    unchanged,
    removed: stale.map((t) => ({ id: t.id, title: t.title, origin: t.origin })),
    documents,
    filesScanned: files.length,
    discovered: discovered.length,
    durationMs: Date.now() - started,
    dryRun: opts.dryRun ?? false,
  };
}

/** Shape used only to render a dry-run preview of a task that does not exist yet. */
function emptyTask(id: string, projectId: string): Task {
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    title: '',
    description: '',
    priority: 'medium',
    status: 'TODO',
    stage: null,
    dependencies: [],
    affectedFiles: [],
    tests: [],
    securityChecks: [],
    acceptanceCriteria: [],
    evidenceEventIds: [],
    origin: 'docs',
    createdAt: now,
    updatedAt: now,
  };
}
