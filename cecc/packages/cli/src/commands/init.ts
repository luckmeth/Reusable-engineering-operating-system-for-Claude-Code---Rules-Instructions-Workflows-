import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  Store,
  ceccPaths,
  createProjectConfig,
  claudeCodeAdapter,
  defaultPolicySet,
  isInitialized,
  loadProjectConfig,
  savePolicySet,
  saveProjectConfig,
  ruleCount,
  git,
} from '@cecc/core';
import { c, heading, kv } from '../ui.js';

/**
 * Project initialization.
 *
 * Wiring the hooks is the part that matters: CLAUDE.md instructions are advice
 * an agent may or may not follow, while a hook is executed by the harness and
 * therefore deterministic. Anything CECC needs to guarantee has to run here.
 */
export async function initCommand(root: string, opts: { force?: boolean; environment?: string } = {}): Promise<number> {
  if (isInitialized(root) && !opts.force) {
    const existing = loadProjectConfig(root);
    console.log(`${c.yellow('CECC is already initialized here.')}`);
    console.log(kv('Project', existing?.name ?? '(unreadable config)'));
    console.log(c.gray('\n  Re-run with --force to regenerate configuration.'));
    return 0;
  }

  const paths = ceccPaths(root);
  mkdirSync(paths.dir, { recursive: true });

  const environment = (opts.environment ?? 'development') as 'development' | 'staging' | 'production';
  const project = createProjectConfig(root, { environment });
  saveProjectConfig(project);

  const policies = defaultPolicySet(environment);
  savePolicySet(paths.policies, policies);

  // Creating the store applies migrations, so a failure surfaces now rather
  // than inside a hook where it would be invisible.
  const store = new Store(paths.db);
  store.upsertProject(project);
  const stored = store.getProjectByRoot(root) ?? project;
  store.audit(stored.id, 'user', 'cecc.initialized', { environment, ruleCount: ruleCount() });
  store.close();

  // Keep CECC's own state out of git. The database holds redacted evidence, but
  // it is still local telemetry and does not belong in a shared repository.
  const gitignore = join(root, '.gitignore');
  const ignoreLine = '.cecc/';
  try {
    const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
    if (!current.split('\n').some((l) => l.trim() === ignoreLine)) {
      writeFileSync(gitignore, `${current}${current.endsWith('\n') || !current ? '' : '\n'}\n# CECC local event store\n${ignoreLine}\n`, 'utf8');
    }
  } catch {
    // Not fatal — report it in the summary instead of failing init.
  }

  const hookResult = installHooks(root);
  const version = await claudeCodeAdapter.detectVersion();
  const isRepo = await git.isGitRepo(root);

  console.log(heading('CECC initialized'));
  console.log(kv('Project', stored.name));
  console.log(kv('Root', root));
  console.log(kv('Environment', environment));
  console.log(kv('Rules registered', String(ruleCount())));
  console.log(kv('Default mode', c.yellow('warn') + c.gray('  (records and warns; blocks nothing)')));
  console.log(kv('Git repository', isRepo ? c.green('yes') : c.yellow('no — git signals unavailable')));
  console.log(kv('Claude Code', version ? c.green(version) : c.yellow('not detected on PATH')));

  console.log(heading('Detected stack'));
  console.log(kv('Framework', stored.stack.framework ?? c.gray('unknown')));
  console.log(kv('Database', stored.stack.database ?? c.gray('unknown')));
  console.log(kv('Package manager', stored.stack.packageManager ?? c.gray('unknown')));
  console.log(kv('Test runner', stored.stack.testRunner ?? c.gray('unknown')));
  console.log(kv('Supabase', stored.stack.hasSupabase ? c.green('yes — RLS rules active') : c.gray('no — RLS rules skipped')));

  console.log(heading('Claude Code integration'));
  for (const line of hookResult.messages) console.log(`  ${line}`);

  console.log(heading('Next'));
  console.log(c.gray('  cecc doctor      verify the integration end to end'));
  console.log(c.gray('  cecc scan        analyse the current working tree'));
  console.log(c.gray('  cecc status      workflow stage, findings and blockers'));
  console.log('');

  return 0;
}

interface HookInstallResult {
  messages: string[];
  installed: boolean;
}

/**
 * Registers CECC with Claude Code's hook system.
 *
 * Existing hooks are preserved. Overwriting another tool's configuration to
 * install monitoring would be precisely the kind of unannounced change CECC
 * reports on, so the merge is additive and idempotent.
 */
export function installHooks(root: string): HookInstallResult {
  const messages: string[] = [];
  const settingsPath = join(root, '.claude', 'settings.json');
  const hookEntry = `node "${join(root, 'node_modules', '@cecc', 'cli', 'dist', 'hook.js')}"`;

  // Prefer a path that survives being run from a subdirectory.
  const localHook = join(root, 'cecc', 'packages', 'cli', 'dist', 'hook.js');
  const command = existsSync(localHook) ? `node "${localHook}"` : hookEntry;

  const events = ['SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'];

  try {
    mkdirSync(join(root, '.claude'), { recursive: true });

    interface HookCommand { type: string; command: string }
    interface HookMatcher { matcher?: string; hooks: HookCommand[] }
    type Settings = { hooks?: Record<string, HookMatcher[]> } & Record<string, unknown>;

    const settings: Settings = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as Settings)
      : {};
    settings.hooks ??= {};

    let added = 0;
    for (const event of events) {
      const existing = settings.hooks[event] ?? [];
      const alreadyPresent = existing.some((m) => m.hooks?.some((h) => h.command?.includes('cecc')));
      if (alreadyPresent) continue;

      existing.push({ matcher: '', hooks: [{ type: 'command', command }] });
      settings.hooks[event] = existing;
      added += 1;
    }

    if (added > 0) {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      messages.push(`${c.green('✔')} Registered ${added} hook(s) in ${relative(root, settingsPath)}`);
    } else {
      messages.push(`${c.green('✔')} Hooks already registered in ${relative(root, settingsPath)}`);
    }
    messages.push(c.gray(`  Command: ${command}`));
    messages.push(c.gray(`  Events:  ${events.join(', ')}`));
    messages.push(c.gray('  Run `npm run build` in cecc/ before the hooks can execute.'));
    return { messages, installed: true };
  } catch (err) {
    messages.push(`${c.yellow('!')} Could not write .claude/settings.json: ${err instanceof Error ? err.message : String(err)}`);
    messages.push(c.gray('  Add the hook manually — see docs/CLAUDE_CODE_INTEGRATION.md'));
    return { messages, installed: false };
  }
}
