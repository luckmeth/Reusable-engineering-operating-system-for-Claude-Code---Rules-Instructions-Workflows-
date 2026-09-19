import type { ChangedLine, ContentChange } from '../types/event.js';

/**
 * Normalizes file changes into one shape.
 *
 * Rules are written once against ContentChange and then work regardless of
 * whether the change arrived from an agent's Edit tool, a Write tool, or a git
 * diff. The `removed` side is what makes "a security control was deleted"
 * detectable at all, so every producer populates it when the information exists.
 */

function toLines(text: string, startLine: number | null): ChangedLine[] {
  if (!text) return [];
  return text.split('\n').map((line, i) => ({
    line: startLine === null ? null : startLine + i,
    text: line,
  }));
}

/**
 * Builds a change from an edit that replaces `oldString` with `newString`.
 *
 * When the surrounding file content is supplied, the real line number of the
 * replaced region is recovered so findings can point at a line rather than just
 * a file. Without it, line numbers stay null — an honest unknown beats a
 * fabricated number that sends a reviewer to the wrong place.
 */
export function changeFromEdit(
  file: string,
  oldString: string,
  newString: string,
  fileContentBefore?: string,
): ContentChange {
  let startLine: number | null = null;
  if (fileContentBefore && oldString) {
    const index = fileContentBefore.indexOf(oldString);
    if (index >= 0) {
      startLine = fileContentBefore.slice(0, index).split('\n').length;
    }
  }
  return {
    file,
    removed: toLines(oldString, startLine),
    added: toLines(newString, startLine),
    isNewFile: false,
    isDeletion: false,
    origin: 'tool',
  };
}

/** Builds a change from a whole-file write. */
export function changeFromWrite(file: string, content: string, existedBefore: boolean, previous?: string): ContentChange {
  return {
    file,
    added: toLines(content, 1),
    removed: previous ? toLines(previous, 1) : [],
    fullContent: content,
    isNewFile: !existedBefore,
    isDeletion: false,
    origin: 'tool',
  };
}

/**
 * Parses a unified diff into per-file changes.
 *
 * Line numbers come from the hunk headers, so a finding produced from a diff
 * points at the line in the post-change file — the line a reviewer will open.
 */
export function parseUnifiedDiff(diff: string): ContentChange[] {
  if (!diff) return [];
  const changes: ContentChange[] = [];
  let current: ContentChange | null = null;
  let newLineNo = 0;
  let oldLineNo = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (current) changes.push(current);
      // `diff --git a/path b/path` — take the b-side as the current path.
      const match = /diff --git a\/(.+?) b\/(.+)$/.exec(line);
      current = {
        file: match?.[2] ?? match?.[1] ?? 'unknown',
        added: [],
        removed: [],
        isNewFile: false,
        isDeletion: false,
        origin: 'diff',
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode')) {
      current.isNewFile = true;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.isDeletion = true;
      continue;
    }
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLineNo = match?.[1] ? Number(match[1]) : 0;
      newLineNo = match?.[2] ? Number(match[2]) : 0;
      continue;
    }
    // '+++' / '---' are file headers, not content.
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    if (line.startsWith('+')) {
      current.added.push({ line: newLineNo, text: line.slice(1) });
      newLineNo += 1;
    } else if (line.startsWith('-')) {
      current.removed.push({ line: oldLineNo, text: line.slice(1) });
      oldLineNo += 1;
    } else if (line.startsWith(' ')) {
      newLineNo += 1;
      oldLineNo += 1;
    }
  }

  if (current) changes.push(current);
  return changes;
}

export const addedText = (change: ContentChange): string => change.added.map((l) => l.text).join('\n');
export const removedText = (change: ContentChange): string => change.removed.map((l) => l.text).join('\n');

/** Full post-change text when known, else just the added lines. */
export const searchableText = (change: ContentChange): string => change.fullContent ?? addedText(change);

/** Added lines matching a pattern, with their line numbers for evidence. */
export function matchAdded(change: ContentChange, pattern: RegExp): ChangedLine[] {
  return change.added.filter((l) => {
    pattern.lastIndex = 0;
    return pattern.test(l.text);
  });
}

export function matchRemoved(change: ContentChange, pattern: RegExp): ChangedLine[] {
  return change.removed.filter((l) => {
    pattern.lastIndex = 0;
    return pattern.test(l.text);
  });
}

/**
 * Lines removed and not put back in any form.
 *
 * The distinction that makes control-removal detection usable: moving a check,
 * reindenting it, or renaming a variable inside it should not look like
 * deleting it. Comparing on normalized text keeps refactors quiet and real
 * deletions loud.
 */
export function trulyRemoved(change: ContentChange, pattern: RegExp): ChangedLine[] {
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const addedNormalized = new Set(change.added.map((l) => normalize(l.text)));
  return matchRemoved(change, pattern).filter((l) => !addedNormalized.has(normalize(l.text)));
}

// --------------------------------------------------------------- file classes

const TEST_FILE = /(^|[/\\])(?:tests?|__tests__|spec|e2e)[/\\]|\.(?:test|spec)\.[jt]sx?$|_test\.(?:py|go|rb)$/i;
const MIGRATION_FILE = /(^|[/\\])migrations?[/\\]|\.sql$/i;
const CONFIG_FILE = /(^|[/\\])(?:\.env|next\.config|vercel\.json|wrangler\.toml|tsconfig|eslint|\.eslintrc|package\.json|supabase\/config\.toml|docker|\.github[/\\]workflows)/i;
const CLIENT_FILE = /(^|[/\\])(?:components|app|pages|src\/client|public)[/\\]|\.(?:tsx|jsx|vue|svelte)$/i;
const SERVER_FILE = /(^|[/\\])(?:server|api|route|middleware|actions|lib\/server)[/\\]|route\.[jt]s$|\.server\.[jt]s$/i;

export const isTestFile = (path: string): boolean => TEST_FILE.test(path);
export const isMigrationFile = (path: string): boolean => MIGRATION_FILE.test(path);
export const isConfigFile = (path: string): boolean => CONFIG_FILE.test(path);
export const isServerFile = (path: string): boolean => SERVER_FILE.test(path);

/**
 * Whether a file plausibly ships to the browser.
 *
 * Deliberately conservative: a file marked 'use client' is client code even if
 * it sits under a server-looking directory, and an explicit server marker wins
 * over the path heuristic. Getting this wrong in the permissive direction means
 * missing a leaked credential, so ambiguity resolves toward "client".
 */
export function isClientReachable(path: string, content?: string): boolean {
  if (content) {
    if (/^\s*['"]use client['"]/m.test(content)) return true;
    if (/^\s*import\s+['"]server-only['"]/m.test(content)) return false;
    if (/^\s*['"]use server['"]/m.test(content)) return false;
  }
  if (SERVER_FILE.test(path)) return false;
  return CLIENT_FILE.test(path);
}
