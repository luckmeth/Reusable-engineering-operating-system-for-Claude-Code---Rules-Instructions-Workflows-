import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  Store,
  SCHEMA_VERSION,
  ceccPaths,
  claudeCodeAdapter,
  computePolicyChecksum,
  detectSandbox,
  git,
  isInitialized,
  loadPolicySet,
  loadProjectConfig,
  ruleCount,
  PATTERNS,
  hookPathFromCommand,
  isCeccHookCommand,
} from '@cecc/core';
import { resolveHookPath } from './init.js';
import { c, heading, wrapText } from '../ui.js';

const exec = promisify(execFile);

/** Is `name` runnable from PATH? The argument is a literal at every call site. */
async function commandExists(name: string): Promise<boolean> {
  try {
    await exec(process.platform === 'win32' ? 'where' : 'which', [name], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

interface Check {
  label: string;
  state: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  fix?: string;
}

/**
 * `cecc doctor` — verifies the installation end to end.
 *
 * Reports what was actually observed rather than what is configured. The
 * distinction matters most for hooks: a hook entry present in settings.json
 * proves configuration, while a recorded agent event proves the integration
 * genuinely fires. Only the second is evidence that CECC is working.
 */
export async function doctorCommand(root: string): Promise<number> {
  const checks: Check[] = [];
  const paths = ceccPaths(root);

  // ---- installation
  checks.push(
    isInitialized(root)
      ? { label: 'CECC initialized', state: 'ok', detail: paths.dir }
      : { label: 'CECC initialized', state: 'fail', detail: 'No .cecc/config.json found', fix: 'Run `cecc init`' },
  );

  const project = loadProjectConfig(root);
  if (!project) {
    render(checks);
    return 1;
  }

  // ---- runtime
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 5);
  checks.push({
    label: 'Node runtime',
    state: nodeOk ? 'ok' : 'fail',
    detail: `v${process.versions.node}`,
    ...(nodeOk ? {} : { fix: 'CECC uses the built-in node:sqlite module, which needs Node 22.5 or newer.' }),
  });

  // ---- database
  try {
    const store = new Store(paths.db);
    const eventCount = store.countEvents(project.id);
    const chain = store.verifyEventChain(project.id);

    checks.push({ label: 'Event store', state: 'ok', detail: `schema v${SCHEMA_VERSION}, ${eventCount} events` });

    checks.push(
      chain.ok
        ? {
            label: 'Event chain integrity',
            state: 'ok',
            detail: `${chain.checked} events verified (tamper-evident, not tamper-proof)`,
          }
        : {
            label: 'Event chain integrity',
            state: 'fail',
            detail: `Chain breaks at seq ${chain.brokenAtSeq} after ${chain.checked} valid events`,
            fix: 'The event log was modified outside CECC. Treat earlier findings as unreliable and investigate who had write access.',
          },
    );

    const sessions = store.listSessions(project.id, 5);
    const agentEvents = store.queryEvents({ projectId: project.id, sources: ['agent'], limit: 1 });
    checks.push(
      agentEvents.length > 0
        ? { label: 'Agent events observed', state: 'ok', detail: `${sessions.length} session(s) recorded; hooks are firing` }
        : {
            label: 'Agent events observed',
            state: 'warn',
            detail: 'No agent events recorded yet',
            fix: 'Hooks are configured but have not fired. Build the CLI (`npm run build`) and start a Claude Code session in this project.',
          },
    );

    const bypassSessions = sessions.filter((s) => s.permissionMode && /bypass|dangerous/i.test(s.permissionMode));
    if (bypassSessions.length > 0) {
      checks.push({
        label: 'Agent permission mode',
        state: 'warn',
        detail: `${bypassSessions.length} session(s) ran with permission checks relaxed`,
        fix: 'See findings from rule AGENT-001.',
      });
    }

    store.close();
  } catch (err) {
    checks.push({
      label: 'Event store',
      state: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      fix: 'Delete .cecc/cecc.db and run `cecc init --force` if the database is corrupt.',
    });
  }

  // ---- policies
  const policyLoad = loadPolicySet(paths.policies, project.environment);
  if (policyLoad.usedDefaults && existsSync(paths.policies)) {
    checks.push({ label: 'Policies', state: 'fail', detail: 'Policy file exists but could not be parsed', fix: 'Run `cecc init --force` to regenerate.' });
  } else if (!policyLoad.integrityOk) {
    checks.push({
      label: 'Policy integrity',
      state: 'fail',
      detail: 'Policy checksum does not match the file contents',
      fix: 'The policy file was edited outside CECC. Review the diff — an agent relaxing its own policy is finding AGENT-028.',
    });
  } else {
    const modes = Object.values(policyLoad.set.policies).reduce<Record<string, number>>((acc, p) => {
      acc[p.mode] = (acc[p.mode] ?? 0) + 1;
      return acc;
    }, {});
    checks.push({
      label: 'Policies',
      state: 'ok',
      detail: `${Object.keys(policyLoad.set.policies).length} rules — ${Object.entries(modes).map(([m, n]) => `${n} ${m}`).join(', ')}`,
    });
    checks.push({
      label: 'Policy checksum',
      state: 'ok',
      detail: computePolicyChecksum(policyLoad.set).slice(0, 16),
    });
  }

  // ---- rules
  checks.push({ label: 'Detection rules', state: 'ok', detail: `${ruleCount()} rules, ${PATTERNS.length} correlation patterns` });

  // ---- claude code integration
  const version = await claudeCodeAdapter.detectVersion();
  checks.push(
    version
      ? { label: 'Claude Code', state: 'ok', detail: `v${version}` }
      : { label: 'Claude Code', state: 'warn', detail: 'Not found on PATH', fix: 'CECC works without it, but no agent events will be captured.' },
  );

  const settingsPath = join(root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    checks.push({ label: 'Hook registration', state: 'fail', detail: 'No .claude/settings.json', fix: 'Run `cecc init` to register hooks.' });
  } else {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
      };
      const expectedHookPath = resolveHookPath(root);
      const ceccHooksFor = (matchers: Array<{ hooks?: Array<{ command?: string }> }>) =>
        matchers.flatMap((m) => (m.hooks ?? []).filter((h) => isCeccHookCommand(h.command, expectedHookPath)));

      const registered = Object.entries(settings.hooks ?? {})
        .filter(([, matchers]) => ceccHooksFor(matchers).length > 0)
        .map(([event]) => event);

      checks.push(
        registered.length > 0
          ? { label: 'Hook registration', state: 'ok', detail: registered.join(', ') }
          : { label: 'Hook registration', state: 'fail', detail: 'settings.json has no CECC hooks', fix: 'Run `cecc init --force`.' },
      );

      // Two CECC hooks on one event means every action is recorded twice,
      // which inflates counts and can make a single change look like a
      // repeated pattern to the correlation rules.
      const duplicated = Object.entries(settings.hooks ?? {})
        .filter(([, matchers]) => ceccHooksFor(matchers).length > 1)
        .map(([event]) => event);
      if (duplicated.length > 0) {
        checks.push({
          label: 'Hook duplication',
          state: 'fail',
          detail: `${duplicated.join(', ')} registered more than once — events are recorded twice`,
          fix: 'Remove the duplicate CECC entries from .claude/settings.json.',
        });
      }

      // A configured hook pointing at a file that does not exist fails silently
      // at runtime, which is the worst kind of broken.
      const commands = Object.values(settings.hooks ?? {})
        .flatMap((m) => m.flatMap((x) => x.hooks ?? []))
        .map((h) => h.command ?? '')
        .filter((cmd) => isCeccHookCommand(cmd, expectedHookPath));
      const missing = commands.filter((cmd) => {
        const path = hookPathFromCommand(cmd);
        return path ? !existsSync(path) : false;
      });
      if (missing.length > 0) {
        checks.push({
          label: 'Hook executable',
          state: 'fail',
          detail: 'Hook command points at a file that does not exist',
          fix: 'Run `npm run build` in cecc/ to compile the hook handler.',
        });
      } else if (commands.length > 0) {
        checks.push({ label: 'Hook executable', state: 'ok', detail: 'Hook script present on disk' });
      }

      // A hook that shells out to `node` does nothing on a machine without
      // Node — and the desktop build is installed precisely by people who may
      // not have one. It fails silently on every event.
      if (commands.some((cmd) => /^\s*node\s/.test(cmd))) {
        const nodeFound = await commandExists('node');
        checks.push(
          nodeFound
            ? { label: 'Hook runtime', state: 'ok', detail: 'node is on PATH' }
            : {
                label: 'Hook runtime',
                state: 'fail',
                detail: 'The hook command runs `node`, which is not on PATH — hooks cannot fire',
                fix: 'Re-initialize from the desktop application: it writes a launcher that uses its own bundled runtime.',
              },
        );
      }
    } catch (err) {
      checks.push({ label: 'Hook registration', state: 'fail', detail: `settings.json is not valid JSON: ${err instanceof Error ? err.message : ''}` });
    }
  }

  // ---- git
  const isRepo = await git.isGitRepo(root);
  checks.push(
    isRepo
      ? { label: 'Git repository', state: 'ok', detail: await git.getCurrentBranch(root).catch(() => 'unknown branch') }
      : { label: 'Git repository', state: 'warn', detail: 'Not a git repository', fix: 'Git signals (diff, commits, branch) are unavailable.' },
  );

  // ---- environment
  const sandbox = detectSandbox();
  checks.push({
    label: 'Execution environment',
    state: 'info',
    detail: sandbox.isolated ? `isolated (${sandbox.signal})` : `workstation (${sandbox.signal})`,
  });

  // ---- privacy posture, stated plainly
  checks.push({
    label: 'Cloud sync',
    state: project.cloudSync.enabled ? 'warn' : 'ok',
    detail: project.cloudSync.enabled ? `enabled → ${project.cloudSync.endpoint ?? 'unset endpoint'}` : 'disabled — all data stays local',
  });

  render(checks);
  return checks.some((c) => c.state === 'fail') ? 1 : 0;
}

function render(checks: Check[]): void {
  console.log(heading('CECC doctor'));
  for (const check of checks) {
    const icon = { ok: c.green('✔'), warn: c.yellow('!'), fail: c.red('✖'), info: c.gray('·') }[check.state];
    console.log(`  ${icon} ${c.bold(check.label.padEnd(26))} ${check.detail}`);
    if (check.fix) console.log(c.gray(wrapText(check.fix, 76, '      → ')));
  }

  const failed = checks.filter((c) => c.state === 'fail').length;
  const warned = checks.filter((c) => c.state === 'warn').length;
  console.log(
    failed > 0
      ? c.red(`\n  ${failed} check(s) failed, ${warned} warning(s).\n`)
      : warned > 0
        ? c.yellow(`\n  All critical checks passed, ${warned} warning(s).\n`)
        : c.green('\n  All checks passed.\n'),
  );
}
