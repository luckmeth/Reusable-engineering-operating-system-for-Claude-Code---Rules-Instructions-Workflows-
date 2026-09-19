/**
 * Shell command analysis.
 *
 * Not a shell grammar — a security-relevant approximation. Agents issue commands
 * like `cd x && git commit --no-verify` or `curl … | bash`, and rules need to
 * reason about each piece separately. Treating the whole string as one blob
 * misses the dangerous half of a compound command, which is exactly where the
 * dangerous half tends to hide.
 */

export interface CommandSegment {
  /** Executable name with any path stripped: '/usr/bin/git' -> 'git'. */
  program: string;
  args: string[];
  /** The segment as written, for evidence. */
  raw: string;
  /** How this segment was joined to the previous one. */
  connector: 'first' | '&&' | '||' | ';' | '|' | '&';
  /** True when this segment receives piped stdin — `curl … | bash` is the classic. */
  pipedInto: boolean;
}

export interface ParsedCommand {
  raw: string;
  segments: CommandSegment[];
  /** Env assignments preceding a command, e.g. `FOO=1 npm test`. */
  envAssignments: Record<string, string>;
  hasPipe: boolean;
  hasRedirect: boolean;
  /** Command substitution `$(...)` or backticks — user input here is injectable. */
  hasSubstitution: boolean;
}

const CONNECTOR_TOKENS = new Set(['&&', '||', ';', '|', '&']);

/**
 * Tokenizes respecting quotes. Quoted content keeps its quotes stripped but is
 * never split, so `rm -rf "my dir"` stays two arguments rather than three.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;

    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
      continue;
    }

    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      hasContent = true;
      i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current || hasContent) tokens.push(current);
      current = '';
      hasContent = false;
      continue;
    }

    // Two-character connectors must be recognised before single characters.
    const two = input.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      if (current || hasContent) tokens.push(current);
      tokens.push(two);
      current = '';
      hasContent = false;
      i += 1;
      continue;
    }

    if (ch === ';' || ch === '|' || ch === '&') {
      if (current || hasContent) tokens.push(current);
      tokens.push(ch);
      current = '';
      hasContent = false;
      continue;
    }

    current += ch;
    hasContent = true;
  }

  if (current || hasContent) tokens.push(current);
  return tokens;
}

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = (raw ?? '').trim();
  const result: ParsedCommand = {
    raw: trimmed,
    segments: [],
    envAssignments: {},
    hasPipe: false,
    hasRedirect: /(^|[^0-9&>])>{1,2}[^>]/.test(trimmed) || /\s<\s/.test(trimmed),
    hasSubstitution: /\$\([^)]*\)|`[^`]*`/.test(trimmed),
  };
  if (!trimmed) return result;

  const tokens = tokenize(trimmed);
  let connector: CommandSegment['connector'] = 'first';
  let pipedInto = false;
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const env: Record<string, string> = {};
    let idx = 0;
    // Leading NAME=value pairs are environment, not the program.
    while (idx < buffer.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(buffer[idx]!)) {
      const [name, ...rest] = buffer[idx]!.split('=');
      if (name) env[name] = rest.join('=');
      idx += 1;
    }
    const programToken = buffer[idx];
    if (programToken) {
      const program = programToken.split('/').pop() ?? programToken;
      result.segments.push({
        program,
        args: buffer.slice(idx + 1),
        raw: buffer.join(' '),
        connector,
        pipedInto,
      });
      Object.assign(result.envAssignments, env);
    }
    buffer = [];
  };

  for (const token of tokens) {
    if (CONNECTOR_TOKENS.has(token)) {
      flush();
      pipedInto = token === '|';
      if (token === '|') result.hasPipe = true;
      connector = token as CommandSegment['connector'];
      continue;
    }
    buffer.push(token);
  }
  flush();

  return result;
}

/** True when any segment runs `program` (optionally with a matching subcommand). */
export function hasProgram(parsed: ParsedCommand, program: string, subcommand?: string): boolean {
  return parsed.segments.some(
    (s) => s.program === program && (subcommand === undefined || s.args[0] === subcommand || s.args.includes(subcommand)),
  );
}

export function findSegments(parsed: ParsedCommand, program: string): CommandSegment[] {
  return parsed.segments.filter((s) => s.program === program);
}

/** True when a flag appears, tolerating `--flag=value` form. */
export function hasFlag(segment: CommandSegment, ...flags: string[]): boolean {
  return segment.args.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

/**
 * Classifies what a command is for, so the workflow engine can infer stage
 * transitions and the test monitor knows when to parse output.
 */
export type CommandIntent =
  | 'test'
  | 'lint'
  | 'typecheck'
  | 'build'
  | 'install'
  | 'git-read'
  | 'git-write'
  | 'security-scan'
  | 'deploy'
  | 'migration'
  | 'search'
  | 'read'
  | 'other';

const SCRIPT_INTENTS: Array<[RegExp, CommandIntent]> = [
  [/\b(test|vitest|jest|mocha|pytest|playwright|cypress|ava|tap)\b/, 'test'],
  [/\b(lint|eslint|biome|ruff|flake8|clippy)\b/, 'lint'],
  [/\b(typecheck|tsc|type-check|mypy)\b/, 'typecheck'],
  [/\b(build|compile|bundle)\b/, 'build'],
  [/\b(audit|semgrep|trivy|snyk|gitleaks|bandit|osv-scanner)\b/, 'security-scan'],
  [/\b(deploy|vercel|netlify|fly)\b/, 'deploy'],
  [/\b(migrate|migration|db:push|db:reset)\b/, 'migration'],
];

export function classifyCommand(parsed: ParsedCommand): CommandIntent {
  for (const segment of parsed.segments) {
    const line = `${segment.program} ${segment.args.join(' ')}`;

    if (segment.program === 'git') {
      const sub = segment.args.find((a) => !a.startsWith('-')) ?? '';
      if (['status', 'diff', 'log', 'show', 'branch', 'blame'].includes(sub)) return 'git-read';
      if (['commit', 'push', 'merge', 'rebase', 'reset', 'checkout', 'restore', 'clean', 'tag'].includes(sub)) {
        return 'git-write';
      }
      return 'git-read';
    }

    if (['npm', 'pnpm', 'yarn', 'bun'].includes(segment.program)) {
      if (segment.args.some((a) => ['install', 'add', 'i', 'ci'].includes(a))) return 'install';
      if (segment.args.includes('audit')) return 'security-scan';
    }

    if (['grep', 'rg', 'ag', 'find', 'fd'].includes(segment.program)) return 'search';
    if (['cat', 'head', 'tail', 'less', 'sed'].includes(segment.program)) return 'read';
    if (segment.program === 'supabase' && segment.args.some((a) => a.startsWith('db'))) return 'migration';

    for (const [pattern, intent] of SCRIPT_INTENTS) {
      if (pattern.test(line)) return intent;
    }
  }
  return 'other';
}
