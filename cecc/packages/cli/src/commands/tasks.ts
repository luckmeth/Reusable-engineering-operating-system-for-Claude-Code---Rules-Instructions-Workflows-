import { Store, ceccPaths, ingestTasks, type ProjectConfig, type Task } from '@cecc/core';
import { c, heading, kv, relativeTime, table } from '../ui.js';

const STATUS_COLOR: Record<string, (s: string) => string> = {
  TODO: c.gray,
  IN_PROGRESS: c.cyan,
  BLOCKED: c.red,
  REVIEW: c.yellow,
  DONE: c.green,
  VERIFIED: c.green,
};

const PRIORITY_COLOR: Record<string, (s: string) => string> = {
  critical: c.red,
  high: c.yellow,
  medium: c.gray,
  low: c.dim,
};

/**
 * `cecc tasks` — show the task list, and refresh it from the repository.
 *
 * Ingestion is explicit rather than automatic on every command. Rewriting the
 * task list as a side effect of asking to look at it would make `cecc tasks`
 * destructive, and a tool that changes state when you read it is one nobody
 * trusts to read.
 */
export async function tasksCommand(
  root: string,
  project: ProjectConfig,
  opts: { ingest?: boolean; dryRun?: boolean; json?: boolean; all?: boolean; noTodos?: boolean } = {},
): Promise<number> {
  const store = new Store(ceccPaths(root).db);

  try {
    if (opts.ingest || opts.dryRun) {
      const report = await ingestTasks({
        root,
        project,
        store,
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.noTodos ? { skipTodoScan: true } : {}),
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return 0;
      }

      console.log(heading(report.dryRun ? 'Task ingest (dry run — nothing written)' : 'Task ingest'));
      console.log(kv('Documents', report.documents.length > 0 ? report.documents.join(', ') : c.gray('none found')));
      console.log(kv('Files scanned', String(report.filesScanned)));
      console.log(kv('Discovered', String(report.discovered)));
      console.log(kv('New', report.created.length > 0 ? c.green(String(report.created.length)) : '0'));
      console.log(kv('Updated', String(report.updated.length)));
      console.log(kv('Unchanged', String(report.unchanged)));
      console.log(
        kv(
          'Removed',
          report.removed.length > 0 ? c.yellow(`${report.removed.length} — source line no longer exists`) : '0',
        ),
      );
      console.log(kv('Duration', `${report.durationMs}ms`));

      for (const task of report.created.slice(0, 10)) {
        console.log(c.gray(`      + ${task.title.slice(0, 90)}`));
      }
      if (report.created.length > 10) console.log(c.gray(`      + ${report.created.length - 10} more`));
      console.log('');
    }

    const tasks = store.listTasks(project.id);
    const visible = opts.all ? tasks : tasks.filter((t) => t.status !== 'DONE' && t.status !== 'VERIFIED');

    if (opts.json && !opts.ingest && !opts.dryRun) {
      console.log(JSON.stringify(visible, null, 2));
      return 0;
    }
    if (opts.json) return 0;

    console.log(heading(`Tasks — ${project.name}`));

    if (visible.length === 0) {
      console.log(c.gray(tasks.length === 0
        ? '  No tasks recorded. Run `cecc tasks --ingest` to read them from docs/TASKS.md and source comments.\n'
        : '  Nothing open. Run with --all to include finished tasks.\n'));
      return 0;
    }

    const rows = [...visible]
      .sort((a, b) => order(a) - order(b))
      .slice(0, 60)
      .map((t) => [
        (STATUS_COLOR[t.status] ?? c.gray)(t.status),
        (PRIORITY_COLOR[t.priority] ?? c.gray)(t.priority),
        t.title.length > 68 ? `${t.title.slice(0, 67)}…` : t.title,
        c.gray(t.origin),
        c.gray(relativeTime(t.updatedAt)),
      ]);

    console.log(table(rows, ['STATUS', 'PRIORITY', 'TITLE', 'ORIGIN', 'UPDATED']));
    console.log(c.gray(`\n  ${visible.length} open · ${tasks.length} total.`));
    console.log(c.gray('  Ingested tasks mirror the repository — edit the source line, then re-run --ingest.\n'));
    return 0;
  } finally {
    store.close();
  }
}

const STATUS_ORDER: Record<string, number> = { BLOCKED: 0, IN_PROGRESS: 1, REVIEW: 2, TODO: 3, DONE: 4, VERIFIED: 5 };
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const order = (t: Task): number => (STATUS_ORDER[t.status] ?? 9) * 10 + (PRIORITY_ORDER[t.priority] ?? 9);
