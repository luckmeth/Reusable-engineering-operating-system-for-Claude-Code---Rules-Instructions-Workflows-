import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestTasks, ingestedTaskId, parseTaskDocument, reconcileStatus, scanTodoMarkers } from '../src/tasks/ingest.js';
import { tempStore } from './helpers.js';

const DOC = `# Tasks

## Current

- [ ] Add webhook idempotency table

## Blocked

- [ ] Domain transfer — waiting on the registrar

## Backlog

- [ ] Replace offset pagination with keyset

## Done

- [x] 2026-01-01 — RLS policies for all tenant tables
`;

describe('task document parsing', () => {
  it('takes status from the heading and DONE from a ticked box', () => {
    const tasks = parseTaskDocument(DOC, 'docs/TASKS.md');
    const byTitle = new Map(tasks.map((t) => [t.title, t]));

    expect(byTitle.get('Add webhook idempotency table')?.status).toBe('IN_PROGRESS');
    expect(byTitle.get('Domain transfer — waiting on the registrar')?.status).toBe('BLOCKED');
    expect(byTitle.get('Replace offset pagination with keyset')?.status).toBe('TODO');
    expect(byTitle.get('2026-01-01 — RLS policies for all tenant tables')?.status).toBe('DONE');
  });

  it('reads priority from the heading a task sits under', () => {
    const tasks = parseTaskDocument(DOC, 'docs/TASKS.md');
    expect(tasks.find((t) => t.title.startsWith('Replace offset'))?.priority).toBe('low'); // Backlog
    expect(tasks.find((t) => t.title.startsWith('Add webhook'))?.priority).toBe('medium');
  });

  it('strips markdown so the title reads as a sentence', () => {
    const tasks = parseTaskDocument('## Next\n\n- [ ] Rate limit `/api/login` and **reset**\n', 'TASKS.md');
    expect(tasks[0]?.title).toBe('Rate limit /api/login and reset');
  });

  it('keeps two identical lines as two tasks', () => {
    const tasks = parseTaskDocument('## Next\n- [ ] Same thing\n- [ ] Same thing\n', 'TASKS.md');
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((t) => t.key)).size).toBe(2);
  });

  it('excludes line numbers from the key so reformatting does not duplicate a task', () => {
    const a = parseTaskDocument('## Next\n- [ ] One thing\n', 'TASKS.md')[0];
    const b = parseTaskDocument('# Heading\n\ntext\n\n## Next\n\n- [ ] One thing\n', 'TASKS.md')[0];
    expect(a?.key).toBe(b?.key);
    expect(a?.line).not.toBe(b?.line);
  });
});

describe('TODO marker scanning', () => {
  it('finds markers in comments and grades FIXME above TODO', () => {
    const { dir } = tempStore();
    writeFileSync(
      join(dir, 'a.ts'),
      ['// TODO: paginate this endpoint before launch', 'const x = 1;', '// FIXME: this leaks the tenant id'].join('\n'),
    );

    const found = scanTodoMarkers({ root: dir, files: ['a.ts'] });

    expect(found).toHaveLength(2);
    expect(found[0]?.priority).toBe('low');
    expect(found[1]?.priority).toBe('high');
    expect(found[1]?.title).toContain('FIXME:');
  });

  it('ignores the word outside a comment, which is what rule sources are full of', () => {
    const { dir } = tempStore();
    writeFileSync(
      join(dir, 'rule.ts'),
      ['const MARKER = /TODO|FIXME/;', 'const label = "TODO items are tracked elsewhere";'].join('\n'),
    );

    expect(scanTodoMarkers({ root: dir, files: ['rule.ts'] })).toHaveLength(0);
  });

  it('skips a bare marker with nothing actionable after it', () => {
    const { dir } = tempStore();
    writeFileSync(join(dir, 'b.ts'), '// TODO\n// TODO: x\n');
    expect(scanTodoMarkers({ root: dir, files: ['b.ts'] })).toHaveLength(0);
  });
});

describe('ingest reconciliation', () => {
  const source = (status: 'TODO' | 'DONE') => ({
    key: 'k',
    title: 't',
    description: 'd',
    priority: 'medium' as const,
    status,
    origin: 'docs' as const,
    file: 'TASKS.md',
    line: 1,
  });

  const stored = (status: string) =>
    ({
      id: 'x',
      projectId: 'p',
      title: 't',
      description: 'd',
      priority: 'medium',
      status,
      stage: null,
      dependencies: [],
      affectedFiles: [],
      tests: [],
      securityChecks: [],
      acceptanceCriteria: [],
      evidenceEventIds: [],
      origin: 'docs',
      createdAt: '',
      updatedAt: '',
    }) as never;

  it('keeps a status the developer set', () => {
    expect(reconcileStatus(source('TODO'), stored('IN_PROGRESS'))).toBe('IN_PROGRESS');
    expect(reconcileStatus(source('TODO'), stored('REVIEW'))).toBe('REVIEW');
  });

  it('lets a ticked box close a task that was in progress', () => {
    expect(reconcileStatus(source('DONE'), stored('IN_PROGRESS'))).toBe('DONE');
  });

  it('reopens a task when the box is unticked', () => {
    expect(reconcileStatus(source('TODO'), stored('DONE'))).toBe('TODO');
  });
});

describe('ingestTasks', () => {
  function project(dir: string) {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'TASKS.md'), DOC);
  }

  it('is idempotent — a second run changes nothing', async () => {
    const { dir, store, project: config } = tempStore();
    project(dir);

    const first = await ingestTasks({ root: dir, project: config, store, skipTodoScan: true });
    const second = await ingestTasks({ root: dir, project: config, store, skipTodoScan: true });

    expect(first.created).toHaveLength(4);
    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toBe(4);
  });

  it('removes a task whose source line is gone, and leaves a hand-written one alone', async () => {
    const { dir, store, project: config } = tempStore();
    project(dir);
    await ingestTasks({ root: dir, project: config, store, skipTodoScan: true });

    const manual = store.upsertTask({
      projectId: config.id,
      title: 'Typed in by a person',
      description: '',
      priority: 'high',
      status: 'TODO',
      stage: null,
      dependencies: [],
      affectedFiles: [],
      tests: [],
      securityChecks: [],
      acceptanceCriteria: [],
      evidenceEventIds: [],
      origin: 'user',
    });

    writeFileSync(join(dir, 'docs', 'TASKS.md'), '# Tasks\n\n## Next\n\n- [ ] Only this one now\n');
    const report = await ingestTasks({ root: dir, project: config, store, skipTodoScan: true });

    expect(report.removed).toHaveLength(4);
    expect(store.getTask(manual.id)).not.toBeNull();
  });

  it('writes nothing on a dry run', async () => {
    const { dir, store, project: config } = tempStore();
    project(dir);

    const report = await ingestTasks({ root: dir, project: config, store, skipTodoScan: true, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.created).toHaveLength(4);
    expect(store.listTasks(config.id)).toHaveLength(0);
  });

  it('derives the same id for the same source line across runs', () => {
    const task = parseTaskDocument(DOC, 'docs/TASKS.md')[0]!;
    expect(ingestedTaskId('p', task)).toBe(ingestedTaskId('p', task));
    expect(ingestedTaskId('p', task)).not.toBe(ingestedTaskId('q', task));
  });
});
