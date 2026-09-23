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

/**
 * The added and removed sides of a change, as one string each.
 *
 * Memoized per change object. Rules ask for these constantly — a `matches()`
 * pre-filter and then the `evaluate()` body, across a dozen rules per file.
 * Rebuilding them each time allocated an array the length of the file plus a
 * copy of its text, once per rule, which profiling showed to be the dominant
 * cost of `cecc scan --all`.
 *
 * A WeakMap keyed on the change keeps each cached string alive exactly as long
 * as the change itself, so a long scan does not accumulate file contents.
 */
const ADDED_TEXT_CACHE = new WeakMap<ContentChange, string>();
const REMOVED_TEXT_CACHE = new WeakMap<ContentChange, string>();

export function addedText(change: ContentChange): string {
  const cached = ADDED_TEXT_CACHE.get(change);
  if (cached !== undefined) return cached;
  const text = change.added.map((l) => l.text).join('\n');
  ADDED_TEXT_CACHE.set(change, text);
  return text;
}

export function removedText(change: ContentChange): string {
  const cached = REMOVED_TEXT_CACHE.get(change);
  if (cached !== undefined) return cached;
  const text = change.removed.map((l) => l.text).join('\n');
  REMOVED_TEXT_CACHE.set(change, text);
  return text;
}

/** Full post-change text when known, else just the added lines. */
export const searchableText = (change: ContentChange): string => change.fullContent ?? addedText(change);

/**
 * Lines that define a pattern rather than use one.
 *
 * `const SENSITIVE = /password|token/i;` describes what to look for; it does
 * not leak anything. Any codebase with validation, sanitization or redaction
 * logic contains lines like this, and matching them produces findings that can
 * never be acted on. A security tool's own rule files are the extreme case —
 * this was found by scanning CECC with CECC.
 */
const PATTERN_DEFINITION =
  /^\s*(?:(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=|[\w$'"]+\s*:)\s*(?:new\s+RegExp\s*\(|\/(?![/*]))/;

/**
 * A substantial regex literal anywhere on the line — in a rule table, or as
 * the receiver of .test()/.exec()/.match(). In every case the line is
 * describing a pattern rather than exhibiting one.
 */
const INLINE_REGEX_LITERAL = /\/(?:[^/\\\n]|\\.){12,}\/[gimsuy]*\s*(?:[,;)\]}]|\.(?:test|exec|match|replace|source))/;

/**
 * A line dominated by a natural-language string literal.
 *
 * Error messages, impact descriptions and help text routinely contain the very
 * words security rules look for — "tenant", "password", "request body". The
 * text is describing a problem, not causing one. Detected by looking for a long
 * quoted run with enough spaces to be prose rather than a path, query or
 * template expression.
 */
export function isProseString(text: string): boolean {
  for (const match of text.matchAll(/(['"`])((?:[^\\]|\\.){40,}?)\1/g)) {
    const body = match[2] ?? '';

    // Interpolation means the string is being *built*, which is exactly the
    // dangerous case these rules exist to catch. A template carrying request
    // data into a query is never prose, however sentence-like it reads.
    // Without this exclusion the guard silently suppressed SQL injection
    // detection — caught by the rule's own positive test.
    if (/\$\{|\$\(|%s|\{\}|\+\s*\w+\s*\+/.test(body)) continue;

    // Query and markup languages are prose-shaped but are not prose.
    if (/\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|WHERE|FROM|JOIN)\b/i.test(body)) continue;
    if (/<\/?[a-z][^>]*>/i.test(body)) continue;

    const spaces = (body.match(/ /g) ?? []).length;
    // Several spaces and few operators reads as a sentence, not an expression.
    if (spaces >= 6 && !/[;{}()[\]=<>]{3,}/.test(body)) return true;
  }
  return false;
}

/**
 * Is this line a comment rather than code?
 *
 * Name-based rules match text, and text includes the sentence explaining why
 * the name used to be dangerous. Writing up a fixed vulnerability re-triggered
 * the rule that found it, at CRITICAL — the comment below `resultsPasswordOk`
 * in a project that had just moved its password check to the server.
 *
 * Only whole-line comments count. A trailing `// …` after real code leaves the
 * code on the line, so the line still deserves to be read.
 */
export function isCommentLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // JS/TS, JSDoc continuations, shell and env files, SQL, HTML/JSX.
  return /^(?:\/\/|\/\*|\*(?!\/)|\*\/|#|--|<!--)/.test(t);
}

export function isPatternDefinition(text: string): boolean {
  return PATTERN_DEFINITION.test(text) || INLINE_REGEX_LITERAL.test(text);
}

/** Added lines matching a pattern, with their line numbers for evidence. */
export function matchAdded(change: ContentChange, pattern: RegExp): ChangedLine[] {
  return change.added.filter((l) => {
    if (isPatternDefinition(l.text) || isProseString(l.text)) return false;
    pattern.lastIndex = 0;
    return pattern.test(l.text);
  });
}

export function matchRemoved(change: ContentChange, pattern: RegExp): ChangedLine[] {
  return change.removed.filter((l) => {
    if (isPatternDefinition(l.text) || isProseString(l.text)) return false;
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

/**
 * Documentation, including a repository's own security guidance.
 *
 * Code-security rules skip these: a snippet in a README is an illustration,
 * not something that executes, and flagging `tenant_id` in a paragraph
 * explaining why tenant_id must not come from the request is pure noise.
 *
 * Rules about *content* rather than code — hardcoded secrets (AGENT-006) and
 * agent-directed instructions (AGENT-027) — deliberately still run here. A real
 * credential in a README is a real leak, and documentation is exactly where
 * prompt injection hides.
 */
const DOCUMENTATION_FILE = /\.(?:mdx?|txt|rst|adoc)$/i;
export const isDocumentationFile = (path: string): boolean => DOCUMENTATION_FILE.test(path);

/** Files that code-security rules should not analyse. */
export const isNonExecutable = (path: string): boolean => isDocumentationFile(path);
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
