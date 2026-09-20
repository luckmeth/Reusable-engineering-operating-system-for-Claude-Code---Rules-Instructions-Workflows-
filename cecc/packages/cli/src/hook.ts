/**
 * Claude Code hook entry point.
 *
 * This runs on the agent's critical path: it executes before or after every
 * tool call, and the agent waits for it. Three rules follow from that, and they
 * outrank detection coverage:
 *
 *   1. Never throw. An unhandled exception here surfaces as a hook failure and
 *      derails the developer's session. Every path is wrapped.
 *   2. Never hang. A hard deadline releases the action even if analysis is
 *      incomplete.
 *   3. Never block on uncertainty. Blocking requires an explicit block policy,
 *      high severity and high confidence together.
 *
 * On the deadline, CECC fails OPEN — the action proceeds. That is a deliberate
 * trade-off and worth stating plainly: a monitoring tool that freezes the
 * developer's workflow gets uninstalled, and an uninstalled tool detects
 * nothing at all. Timeouts are recorded to the audit log so the gap in coverage
 * is visible rather than silent.
 */
import { readFileSync } from 'node:fs';
import {
  Store,
  ceccPaths,
  findProjectRoot,
  ingest,
  loadProjectConfig,
  claudeCodeAdapter,
} from '@cecc/core';

/** Deadline for the whole hook. Beyond this the action is released. */
const DEADLINE_MS = Number(process.env['CECC_HOOK_TIMEOUT_MS'] ?? 4000);

function readStdin(): string {
  try {
    // fd 0 read is synchronous and finishes before the deadline matters; the
    // parent has already written and closed the pipe by the time we are invoked.
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Always exits 0. A non-zero exit from a monitor is the monitor causing the outage. */
function allow(output?: unknown): never {
  if (output !== undefined) process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

export async function runHook(): Promise<void> {
  const deadline = setTimeout(() => {
    // Nothing useful can be said about an analysis that did not finish.
    process.stdout.write('');
    process.exit(0);
  }, DEADLINE_MS);
  deadline.unref?.();

  let store: Store | null = null;

  try {
    const raw = readStdin();
    if (!raw.trim()) allow();

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Unparseable input is not an error worth interrupting anyone over.
      allow();
    }

    const cwd =
      (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>)['cwd'] === 'string'
        ? ((payload as Record<string, unknown>)['cwd'] as string)
        : null) ?? process.cwd();

    const root = findProjectRoot(cwd);
    if (!root) allow();

    const project = loadProjectConfig(root);
    // Not initialized here: stay silent rather than nagging on every tool call.
    if (!project) allow();

    store = new Store(ceccPaths(root).db);

    const result = ingest(payload, { projectRoot: root, project, store });

    // Only PreToolUse can prevent an action; everything else is after the fact.
    if (result.blockable && result.decision.action === 'block') {
      const reason = [
        result.decision.message,
        '',
        'This was blocked by a CECC policy set to "block" mode.',
        'Fix the underlying issue, or run `cecc policy set <RULE-ID> warn` if the rule is wrong here.',
      ].join('\n');

      clearTimeout(deadline);
      store.close();
      allow(claudeCodeAdapter.buildBlockResponse(reason));
    }

    // Warnings go to stderr, which Claude Code surfaces without blocking.
    if (result.decision.action === 'warn' && result.decision.reasons.length > 0) {
      const lines = result.decision.reasons
        .slice(0, 5)
        .map((r) => `  [${r.severity.toUpperCase()}] ${r.ruleId}: ${r.title}`);
      process.stderr.write(`CECC warning:\n${lines.join('\n')}\n`);
    }

    clearTimeout(deadline);
    store.close();
    allow();
  } catch (err) {
    // Last resort. Record what happened if the store is reachable, then release.
    try {
      if (store) {
        store.audit(null, 'cecc', 'hook.error', { message: err instanceof Error ? err.message : String(err) });
        store.close();
      }
    } catch {
      // Recording the failure failed too. Releasing the action still matters more.
    }
    clearTimeout(deadline);
    allow();
  }
}

// Executed directly by Claude Code as the hook command.
if (process.argv[1] && /hook\.js$/.test(process.argv[1])) {
  void runHook();
}
