import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { changeFromEdit, changeFromWrite } from '../analyze/content.js';
import { classifyCommand, parseCommand } from '../analyze/command.js';
import type { ContentChange, EventType, NewEvent } from '../types/event.js';
import type { AdapterContext, AgentAdapter, NormalizedActivity } from './types.js';

const exec = promisify(execFile);

/**
 * Claude Code adapter.
 *
 * The schema below is deliberately permissive: every field is optional and
 * unknown keys are preserved rather than rejected. CECC does not control the
 * hook payload format and must not break when it gains a field — a strict
 * schema here would mean that a routine agent update stops all monitoring,
 * which is the worst possible failure mode for a security tool.
 *
 * What the adapter observes is limited on purpose to observable engineering
 * signals: tool calls, their inputs and results, commands, file changes and
 * session lifecycle. It does not read, reconstruct or infer the model's private
 * reasoning, and `transcript_path` is recorded as a location only — never
 * opened. Everything CECC reports is derived from actions taken, not thoughts.
 */

const ToolInput = z
  .object({
    command: z.string().optional(),
    description: z.string().optional(),
    file_path: z.string().optional(),
    content: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    replace_all: z.boolean().optional(),
    pattern: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    edits: z
      .array(z.object({ old_string: z.string().optional(), new_string: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const HookPayload = z
  .object({
    session_id: z.string().optional(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    permission_mode: z.string().optional(),
    hook_event_name: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: ToolInput.optional(),
    tool_response: z.unknown().optional(),
    prompt: z.string().optional(),
    source: z.string().optional(),
    reason: z.string().optional(),
    trigger: z.string().optional(),
    stop_hook_active: z.boolean().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type ClaudeHookPayload = z.infer<typeof HookPayload>;

/** Hook events this adapter maps. Anything else is recorded as unmapped, not dropped. */
const KNOWN_HOOK_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStop',
  'Notification',
  'PreCompact',
]);

/** Only PreToolUse can prevent an action; everything else observes after the fact. */
const BLOCKABLE_EVENTS = new Set(['PreToolUse']);

function toRelative(projectRoot: string, filePath: string): string {
  if (!filePath) return filePath;
  const absolute = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
  const rel = relative(projectRoot, absolute);
  // A path outside the project stays absolute — silently rewriting it would
  // hide the fact that the agent reached outside the repository.
  return rel.startsWith('..') ? absolute : rel || filePath;
}

/** Extracts stdout/stderr/exit code from a tool_response of unknown shape. */
function readToolResponse(response: unknown): { output: string; exitCode: number | null; failed: boolean } {
  if (response == null) return { output: '', exitCode: null, failed: false };
  if (typeof response === 'string') return { output: response, exitCode: null, failed: false };
  if (typeof response !== 'object') return { output: String(response), exitCode: null, failed: false };

  const record = response as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['stdout', 'stderr', 'output', 'result', 'content', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value) parts.push(value);
  }

  const exitCodeRaw = record['exit_code'] ?? record['exitCode'] ?? record['code'] ?? record['status'];
  const exitCode = typeof exitCodeRaw === 'number' ? exitCodeRaw : null;

  const failed =
    record['is_error'] === true ||
    record['isError'] === true ||
    record['success'] === false ||
    record['interrupted'] === true ||
    (exitCode !== null && exitCode !== 0);

  return { output: parts.join('\n').slice(0, 200_000), exitCode, failed };
}

/**
 * How much text a tool response put into the context window.
 *
 * `readToolResponse` scans a fixed set of top-level keys because it is after
 * stdout and an exit code. The Read tool nests what matters one level down, in
 * `file.content`, so that function reported zero bytes for the single largest
 * consumer of context there is.
 *
 * The final fallback measures the serialized response. It over-counts by the
 * JSON punctuation, which is the right direction to be wrong in: an estimate
 * that silently reads zero is worse than one that is slightly high, because
 * zero looks like thrift.
 */
function responseContentLength(response: unknown): number {
  if (response == null) return 0;
  if (typeof response === 'string') return response.length;
  if (typeof response !== 'object') return String(response).length;

  const record = response as Record<string, unknown>;

  const file = record['file'];
  if (file && typeof file === 'object') {
    const content = (file as Record<string, unknown>)['content'];
    if (typeof content === 'string') return content.length;
  }

  for (const key of ['content', 'output', 'stdout', 'result', 'text']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value.length;
  }

  try {
    return JSON.stringify(response).length;
  } catch {
    return 0;
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  async detectVersion(): Promise<string | null> {
    try {
      // On Windows the npm-installed `claude` is a .cmd shim, which
      // CreateProcess cannot execute directly. Both the command and its
      // arguments are fixed literals, so going through the shell here adds no
      // injection surface.
      const { stdout } = await exec('claude', ['--version'], {
        timeout: 5000,
        shell: process.platform === 'win32',
      });
      // Output looks like "2.1.278 (Claude Code)" — take the version token.
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return version ?? (stdout.trim() || null);
    } catch {
      return null;
    }
  }

  canHandle(payload: unknown): boolean {
    const parsed = HookPayload.safeParse(payload);
    if (!parsed.success) return false;
    // A Claude Code hook payload always carries at least one of these.
    return Boolean(parsed.data.hook_event_name ?? parsed.data.session_id ?? parsed.data.tool_name);
  }

  normalize(payload: unknown, ctx: AdapterContext): NormalizedActivity {
    const parsed = HookPayload.safeParse(payload);
    if (!parsed.success) {
      return {
        events: [],
        changes: [],
        externalSessionId: null,
        permissionMode: null,
        blockable: false,
        unmapped: { parseError: parsed.error.issues.slice(0, 5), raw: truncate(payload) },
      };
    }

    const data = parsed.data;
    const hookEvent = data.hook_event_name ?? 'Unknown';
    const unmapped: Record<string, unknown> = {};
    if (!KNOWN_HOOK_EVENTS.has(hookEvent)) unmapped['unknownHookEvent'] = hookEvent;

    const base = {
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      workflowRunId: ctx.workflowRunId,
      agentId: this.id,
      source: 'agent' as const,
      severity: 'info' as const,
      parentEventId: null,
      durationMs: null,
    };

    const events: NewEvent[] = [];
    const changes: ContentChange[] = [];

    switch (hookEvent) {
      case 'SessionStart':
        events.push({
          ...base,
          type: 'session.started',
          status: 'started',
          command: null,
          tool: null,
          filePaths: [],
          evidence: [],
          metadata: {
            hookEvent,
            startReason: data.source ?? null,
            permissionMode: data.permission_mode ?? null,
            cwd: data.cwd ?? null,
            // Recorded as a location only. CECC never opens the transcript:
            // it is the agent's reasoning record, which is explicitly out of scope.
            transcriptPresent: Boolean(data.transcript_path),
          },
        });
        break;

      case 'SessionEnd':
        events.push({
          ...base,
          type: 'session.ended',
          status: 'success',
          command: null,
          tool: null,
          filePaths: [],
          evidence: [],
          metadata: { hookEvent, endReason: data.reason ?? null },
        });
        break;

      case 'UserPromptSubmit':
        events.push({
          ...base,
          source: 'user',
          type: 'prompt.submitted',
          status: 'started',
          command: null,
          tool: null,
          filePaths: [],
          evidence: [],
          // The prompt text is stored redacted by the store. It is the developer's
          // own instruction, which is an engineering signal, not model reasoning.
          metadata: { hookEvent, promptLength: data.prompt?.length ?? 0, prompt: truncateString(data.prompt, 2000) },
        });
        break;

      case 'Stop':
      case 'SubagentStop':
        events.push({
          ...base,
          type: 'agent.stopped',
          status: 'success',
          command: null,
          tool: null,
          filePaths: [],
          evidence: [],
          metadata: { hookEvent, subagent: hookEvent === 'SubagentStop', stopHookActive: data.stop_hook_active ?? false },
        });
        break;

      case 'PreCompact':
        events.push({
          ...base,
          type: 'context.compacted',
          status: 'success',
          command: null,
          tool: null,
          filePaths: [],
          evidence: [],
          metadata: { hookEvent, trigger: data.trigger ?? null },
        });
        break;

      case 'Notification':
        events.push({
          ...base,
          type: 'agent.notification',
          status: 'warning',
          command: null,
          tool: null,
          filePaths: [],
          evidence: [],
          metadata: { hookEvent, message: truncateString(data.message, 500) },
        });
        break;

      case 'PreToolUse':
      case 'PostToolUse': {
        const mapped = this.mapToolUse(hookEvent, data, ctx, base);
        events.push(...mapped.events);
        changes.push(...mapped.changes);
        Object.assign(unmapped, mapped.unmapped);
        break;
      }

      default:
        // An unrecognized hook event is still recorded. Losing it silently would
        // leave a gap in the evidence chain with nothing to explain the gap.
        events.push({
          ...base,
          type: 'agent.notification',
          status: 'warning',
          command: null,
          tool: data.tool_name ?? null,
          filePaths: [],
          evidence: [],
          metadata: { hookEvent, note: 'Hook event not recognized by this adapter version', raw: truncate(data) },
        });
        break;
    }

    return {
      events,
      changes,
      externalSessionId: data.session_id ?? null,
      permissionMode: data.permission_mode ?? null,
      blockable: BLOCKABLE_EVENTS.has(hookEvent),
      unmapped,
    };
  }

  private mapToolUse(
    hookEvent: string,
    data: ClaudeHookPayload,
    ctx: AdapterContext,
    base: Omit<NewEvent, 'type' | 'status' | 'command' | 'tool' | 'filePaths' | 'metadata' | 'evidence'>,
  ): { events: NewEvent[]; changes: ContentChange[]; unmapped: Record<string, unknown> } {
    const events: NewEvent[] = [];
    const changes: ContentChange[] = [];
    const unmapped: Record<string, unknown> = {};

    const tool = data.tool_name ?? 'Unknown';
    const input = data.tool_input ?? {};
    const isPost = hookEvent === 'PostToolUse';
    const response = isPost ? readToolResponse(data.tool_response) : { output: '', exitCode: null, failed: false };

    const filePath = input.file_path ? toRelative(ctx.projectRoot, input.file_path) : null;

    switch (tool) {
      case 'Bash':
      case 'BashOutput': {
        const command = input.command ?? '';
        const parsed = parseCommand(command);
        const intent = classifyCommand(parsed);

        // Command intent decides the event type, which is what lets the workflow
        // engine and gates reason about validation without re-parsing commands.
        const typeByIntent: Partial<Record<string, EventType>> = {
          test: 'test.run',
          lint: 'lint.run',
          typecheck: 'typecheck.run',
          build: 'build.run',
          'security-scan': 'security.scan',
        };

        const gitSubcommand = parsed.segments.find((s) => s.program === 'git')?.args.find((a) => !a.startsWith('-'));
        const gitType: EventType | null =
          gitSubcommand === 'commit' ? 'git.commit' : gitSubcommand === 'push' ? 'git.push' : gitSubcommand === 'status' ? 'git.status' : null;

        const type: EventType = isPost
          ? (typeByIntent[intent] ?? gitType ?? 'command.completed')
          : 'command.started';

        events.push({
          ...base,
          type,
          status: isPost ? (response.failed ? 'failed' : 'success') : 'started',
          severity: isPost && response.failed ? 'low' : 'info',
          command,
          tool,
          filePaths: [],
          evidence: [],
          metadata: {
            hookEvent,
            intent,
            exitCode: response.exitCode,
            // Output is capped: dumping whole build logs into the event store
            // bloats the database and buries the signal.
            output: truncateString(response.output, 8000),
            outputTruncated: response.output.length > 8000,
            description: input.description ?? null,
          },
        });
        break;
      }

      case 'Write': {
        if (!filePath) break;
        const absolute = isAbsolute(input.file_path ?? '') ? input.file_path! : resolve(ctx.projectRoot, input.file_path ?? '');
        const existed = existsSync(absolute);
        const previous = existed && ctx.readFile ? ctx.readFile(absolute) : null;

        if (!isPost) {
          // On PreToolUse the content is known before it lands, which is what
          // makes blocking a dangerous write possible at all.
          changes.push(changeFromWrite(filePath, input.content ?? '', existed, previous ?? undefined));
        }

        events.push({
          ...base,
          type: existed ? 'file.modified' : 'file.created',
          status: isPost ? (response.failed ? 'failed' : 'success') : 'started',
          command: null,
          tool,
          filePaths: [filePath],
          evidence: [],
          metadata: {
            hookEvent,
            bytes: (input.content ?? '').length,
            isNewFile: !existed,
            addedText: truncateString(input.content, 4000),
          },
        });
        break;
      }

      case 'Edit':
      case 'MultiEdit': {
        if (!filePath) break;
        const absolute = isAbsolute(input.file_path ?? '') ? input.file_path! : resolve(ctx.projectRoot, input.file_path ?? '');
        const before = ctx.readFile ? ctx.readFile(absolute) : null;

        type EditPair = { old_string?: string | undefined; new_string?: string | undefined };
        const edits: EditPair[] = input.edits?.length
          ? input.edits
          : [{ old_string: input.old_string, new_string: input.new_string }];

        if (!isPost) {
          for (const edit of edits) {
            changes.push(changeFromEdit(filePath, edit.old_string ?? '', edit.new_string ?? '', before ?? undefined));
          }
        }

        events.push({
          ...base,
          type: 'file.modified',
          status: isPost ? (response.failed ? 'failed' : 'success') : 'started',
          command: null,
          tool,
          filePaths: [filePath],
          evidence: [],
          metadata: {
            hookEvent,
            editCount: edits.length,
            replaceAll: input.replace_all ?? false,
            removedText: truncateString(edits.map((e) => e.old_string ?? '').join('\n'), 4000),
            addedText: truncateString(edits.map((e) => e.new_string ?? '').join('\n'), 4000),
          },
        });
        break;
      }

      case 'Read':
      case 'NotebookRead':
        if (!filePath) break;
        events.push({
          ...base,
          type: 'file.read',
          status: isPost ? 'success' : 'started',
          command: null,
          tool,
          filePaths: [filePath],
          evidence: [],
          // The size of what was read is only knowable on PostToolUse, and it
          // is what makes context accounting possible at all: reads are the
          // largest consumer and were previously the one unmeasured kind.
          metadata: isPost ? { hookEvent, bytes: responseContentLength(data.tool_response) } : { hookEvent },
        });
        break;

      case 'Glob':
      case 'Grep':
        events.push({
          ...base,
          type: isPost ? 'command.completed' : 'command.started',
          status: isPost ? 'success' : 'started',
          command: `${tool.toLowerCase()} ${input.pattern ?? ''}`.trim(),
          tool,
          filePaths: [],
          evidence: [],
          metadata: { hookEvent, pattern: input.pattern ?? null, searchPath: input.path ?? null, intent: 'search' },
        });
        break;

      default:
        // Unknown tools still produce an event. Coverage gaps should be visible.
        unmapped['unknownTool'] = tool;
        events.push({
          ...base,
          type: isPost ? 'command.completed' : 'command.started',
          status: isPost ? (response.failed ? 'failed' : 'success') : 'started',
          command: null,
          tool,
          filePaths: filePath ? [filePath] : [],
          evidence: [],
          metadata: { hookEvent, note: 'Tool not specifically mapped by this adapter version', inputKeys: Object.keys(input) },
        });
        break;
    }

    return { events, changes, unmapped };
  }

  /**
   * Builds the PreToolUse deny response.
   *
   * Claude Code reads `permissionDecision` from hook stdout for PreToolUse. The
   * reason is fed back to the agent, so it is phrased as an actionable
   * instruction rather than an error — a blocked action the agent cannot
   * understand just gets retried.
   */
  buildBlockResponse(reason: string): unknown {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  }
}

function truncateString(value: string | undefined | null, max: number): string | null {
  if (value == null) return null;
  return value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max} chars]` : value;
}

function truncate(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    return json && json.length > 4000 ? `${json.slice(0, 4000)}…` : value;
  } catch {
    return '[unserializable]';
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();

/** Reads a file for adapter context, returning null instead of throwing. */
export function safeReadFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    // Skip anything large enough to be a build artifact rather than source.
    const content = readFileSync(path, 'utf8');
    return content.length > 2_000_000 ? null : content;
  } catch {
    return null;
  }
}
