import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskPriority, TaskStatus } from '../types/task.js';

/**
 * Task discovery.
 *
 * Two sources, both already in the repository: checkbox lists in a tasks
 * document, and TODO-style markers in source comments. Neither is a new place
 * to write things down — that is the point. A tracker CECC invented would be a
 * third list to keep in sync, and the two that already exist would rot.
 */
export interface DiscoveredTask {
  /** Stable identity within its origin. Deliberately excludes line numbers. */
  key: string;
  title: string;
  description: string;
  priority: TaskPriority;
  /** What the source says. The store keeps the user's status where it conflicts. */
  status: TaskStatus;
  origin: 'docs' | 'todo-scan';
  file: string;
  line: number | null;
}

/** Documents checked for checkbox lists, in priority order. */
export const TASK_DOCUMENTS = ['docs/TASKS.md', 'TASKS.md', 'docs/TODO.md', 'TODO.md'];

const CHECKBOX = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.+?)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/** Priority words a heading or an inline tag can carry. */
const PRIORITY_WORDS: Array<[RegExp, TaskPriority]> = [
  [/\b(critical|p0|urgent|blocker)\b/i, 'critical'],
  [/\b(high|p1|important)\b/i, 'high'],
  [/\b(low|p3|nice[- ]to[- ]have|someday|backlog)\b/i, 'low'],
  [/\b(medium|p2|normal)\b/i, 'medium'],
];

function priorityFrom(text: string, fallback: TaskPriority): TaskPriority {
  for (const [pattern, priority] of PRIORITY_WORDS) {
    if (pattern.test(text)) return priority;
  }
  return fallback;
}

/**
 * Maps a heading to a task status.
 *
 * `docs/TASKS.md` in this system is organised as Current / Next / Blocked /
 * Backlog, so the heading already carries the state the checkbox cannot.
 */
function statusFromHeading(heading: string): TaskStatus | null {
  const h = heading.toLowerCase();
  if (/\bblocked\b/.test(h)) return 'BLOCKED';
  if (/\b(in progress|current|doing|active)\b/.test(h)) return 'IN_PROGRESS';
  if (/\b(review|awaiting review)\b/.test(h)) return 'REVIEW';
  if (/\b(done|completed|shipped|verified)\b/.test(h)) return 'DONE';
  return null;
}

/** Strips markdown emphasis and links so titles read as plain sentences. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses checkbox items out of a markdown document.
 *
 * Nested items are flattened: indentation in a task list usually means detail
 * rather than a separate unit of work, and inventing a parent/child hierarchy
 * from whitespace produces relationships nobody wrote down.
 */
export function parseTaskDocument(content: string, file: string): DiscoveredTask[] {
  const lines = content.split('\n');
  const tasks: DiscoveredTask[] = [];
  const headings: string[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';

    const heading = HEADING.exec(raw);
    if (heading) {
      const depth = (heading[1] ?? '#').length;
      headings.length = Math.max(0, depth - 1);
      headings[depth - 1] = plainText(heading[2] ?? '');
      continue;
    }

    const checkbox = CHECKBOX.exec(raw);
    if (!checkbox) continue;

    const checked = (checkbox[1] ?? ' ').toLowerCase() === 'x';
    const title = plainText(checkbox[2] ?? '');
    if (!title) continue;

    const context = headings.filter(Boolean).join(' › ');
    const headingStatus = statusFromHeading(context);
    const status: TaskStatus = checked ? 'DONE' : (headingStatus ?? 'TODO');

    // A checked box always wins: the document says the work is finished, and a
    // heading cannot contradict an explicit tick.
    const priority = priorityFrom(title, priorityFrom(context, 'medium'));

    // Two identical lines in one document are two units of work, not one.
    const baseKey = `${file}#${title.toLowerCase().slice(0, 120)}`;
    const count = seen.get(baseKey) ?? 0;
    seen.set(baseKey, count + 1);

    tasks.push({
      key: count === 0 ? baseKey : `${baseKey}#${count}`,
      title: title.slice(0, 200),
      description: context ? `From ${file} under "${context}".` : `From ${file}.`,
      priority,
      status,
      origin: 'docs',
      file,
      line: i + 1,
    });
  }

  return tasks;
}

/** Marker words, with the priority each implies. FIXME is not a TODO. */
const MARKER_PRIORITY: Record<string, TaskPriority> = {
  FIXME: 'high',
  BUG: 'high',
  XXX: 'medium',
  HACK: 'medium',
  TODO: 'low',
};

/**
 * Matches a marker that is inside a comment.
 *
 * Requiring a comment prefix is what keeps the string `"TODO"` in application
 * code, and a rule pattern that merely names the word, out of the task list.
 * CECC's own rule sources are full of both, so this was not a hypothetical.
 */
const MARKER = /(?:\/\/|\/\*|^\s*\*|#|<!--|--)\s*(TODO|FIXME|HACK|XXX|BUG)\b[:\s-]*(.*)$/;

const SCANNABLE = /\.(?:ts|tsx|js|jsx|mjs|cjs|sql|py|go|rb|java|php|sh|css|scss|vue|svelte|yml|yaml)$/i;
const SKIP = /(?:^|\/)(?:node_modules|dist|build|\.next|coverage|vendor|\.git|\.cecc)\//;

export interface TodoScanOptions {
  root: string;
  files: string[];
  /** Guard against a pathological file turning a scan into a memory problem. */
  maxFileBytes?: number;
  maxResults?: number;
}

/** Scans tracked source files for TODO-style markers. */
export function scanTodoMarkers(opts: TodoScanOptions): DiscoveredTask[] {
  const maxFileBytes = opts.maxFileBytes ?? 1_000_000;
  const maxResults = opts.maxResults ?? 500;
  const tasks: DiscoveredTask[] = [];
  const seen = new Map<string, number>();

  for (const file of opts.files) {
    if (tasks.length >= maxResults) break;
    if (!SCANNABLE.test(file) || SKIP.test(file)) continue;

    const absolute = join(opts.root, file);
    let content: string;
    try {
      if (!existsSync(absolute) || statSync(absolute).size > maxFileBytes) continue;
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    if (!/TODO|FIXME|HACK|XXX|BUG/.test(content)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length && tasks.length < maxResults; i += 1) {
      const match = MARKER.exec(lines[i] ?? '');
      if (!match) continue;

      const marker = (match[1] ?? 'TODO').toUpperCase();
      const text = (match[2] ?? '').replace(/\*\/\s*$/, '').replace(/-->\s*$/, '').trim();
      // A bare marker with no text describes nothing actionable.
      if (text.length < 4) continue;

      const baseKey = `${file}#${marker}:${text.toLowerCase().slice(0, 120)}`;
      const count = seen.get(baseKey) ?? 0;
      seen.set(baseKey, count + 1);

      tasks.push({
        key: count === 0 ? baseKey : `${baseKey}#${count}`,
        title: `${marker}: ${text.slice(0, 160)}`,
        description: `Marker in ${file}:${i + 1}.`,
        priority: MARKER_PRIORITY[marker] ?? 'low',
        status: 'TODO',
        origin: 'todo-scan',
        file,
        line: i + 1,
      });
    }
  }

  return tasks;
}

/** Task documents that exist in this project. */
export function findTaskDocuments(root: string): string[] {
  return TASK_DOCUMENTS.filter((doc) => existsSync(join(root, doc)));
}
