#!/usr/bin/env node
/**
 * CECC command line.
 *
 * Argument parsing is hand-rolled rather than delegated to a library. The
 * parser is about forty lines, and a security tool that pulls in a dependency
 * tree to read `--flag` would fail its own rule AGENT-022.
 */
import { findProjectRoot, isInitialized, loadProjectConfig, ruleCount } from '@cecc/core';
import { c } from './ui.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { scanCommand } from './commands/scan.js';
import { doctorCommand } from './commands/doctor.js';
import { findingsCommand, policyCommand, reportCommand, rulesCommand, sessionCommand, workflowCommand } from './commands/misc.js';
import { tasksCommand } from './commands/tasks.js';
import { syncCommand } from './commands/sync.js';
import { runHook } from './hook.js';

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }
    const name = token.replace(/^--?/, '');
    if (name.includes('=')) {
      const [key, ...value] = name.split('=');
      if (key) flags[key] = value.join('=');
      continue;
    }
    const next = rest[i + 1];
    // A following token that is not itself a flag becomes this flag's value.
    if (next && !next.startsWith('-')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }

  return { command, positional, flags };
}

const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: string | boolean | undefined): boolean => v === true || v === 'true';

function usage(): void {
  console.log(`
${c.bold('CECC')} ${c.gray('— Claude Engineering Control Center')}
${c.gray(`Local-first engineering observability and security control for AI-assisted development. ${ruleCount()} rules active.`)}

${c.bold('SETUP')}
  ${c.cyan('cecc init')} ${c.gray('[--environment development|staging|production] [--force]')}
      Initialize CECC here and register Claude Code hooks.
  ${c.cyan('cecc doctor')}
      Verify the installation, hook wiring and event-chain integrity.

${c.bold('OBSERVE')}
  ${c.cyan('cecc status')} ${c.gray('[--json]')}
      Current stage, findings, validation state and what is blocking release.
  ${c.cyan('cecc session')} ${c.gray('[--id <id>] [--filter <text>]')}
      List sessions, or replay one as a chronological timeline.
  ${c.cyan('cecc workflow')} ${c.gray('[--pin <STAGE>] [--unpin]')}
      Show the workflow, or override an incorrect inference.
  ${c.cyan('cecc tasks')} ${c.gray('[--ingest] [--dry-run] [--all] [--no-todos]')}
      Task list, read from docs/TASKS.md checkboxes and source TODO markers.

${c.bold('ANALYSE')}
  ${c.cyan('cecc scan')} ${c.gray('[--all] [--staged] [--path <file>] [--limit N] [--json]')}
      Run detection rules over changes (default) or the whole tree.
  ${c.cyan('cecc scan --external')} ${c.gray('[--online] [--scanner npm-audit|osv|semgrep]')}
      Run third-party scanners. Network access is off unless --online is given.
  ${c.cyan('cecc findings')} ${c.gray('[--id <id>] [--layer agent|application|cecc] [--all]')}
      List findings with evidence, or inspect one in full.
  ${c.cyan('cecc findings --resolve <id>')} ${c.gray('| --suppress <id> --reason "..." [--days N]')}
      Close a finding, or suppress it with a recorded reason.

${c.bold('CONTROL')}
  ${c.cyan('cecc policy')} ${c.gray('[--set <RULE-ID> --mode observe|warn|block --reason "..."]')}
      Show or change enforcement policy.
  ${c.cyan('cecc rules')} ${c.gray('[--id <RULE-ID>]')}
      Browse the detection rules and what each one is for.
  ${c.cyan('cecc report')} ${c.gray('[--out report.md] [--json]')}
      Produce an evidence report, including stated limitations.
  ${c.cyan('cecc sync')} ${c.gray('[--push] [--out payload.json]')}
      Show exactly what cloud sync would transmit. Sends only with --push.

${c.gray('Docs: cecc/docs/  ·  Default enforcement mode for a new project is')} ${c.yellow('warn')}${c.gray(' — records and warns, blocks nothing.')}
`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // The hook is invoked by Claude Code, not by a human. Handle it first and
  // keep it free of any output the agent would have to read.
  if (args.command === 'hook') {
    await runHook();
    return 0;
  }

  if (args.command === 'help' || args.command === '--help' || args.command === '-h' || bool(args.flags['help'])) {
    usage();
    return 0;
  }

  if (args.command === 'version' || args.command === '--version') {
    console.log('cecc 0.1.0');
    return 0;
  }

  const cwd = str(args.flags['cwd']) ?? process.cwd();
  const root = findProjectRoot(cwd) ?? cwd;

  if (args.command === 'init') {
    return initCommand(root, { force: bool(args.flags['force']), environment: str(args.flags['environment']) });
  }

  if (args.command === 'doctor') {
    return doctorCommand(root);
  }

  if (args.command === 'rules') {
    return rulesCommand({ id: str(args.flags['id']) ?? args.positional[0], json: bool(args.flags['json']) });
  }

  // Everything below needs an initialized project.
  if (!isInitialized(root)) {
    console.error(c.red(`\n  CECC is not initialized in ${root}`));
    console.error(c.gray('  Run `cecc init` first.\n'));
    return 2;
  }

  const project = loadProjectConfig(root);
  if (!project) {
    console.error(c.red('\n  .cecc/config.json could not be read.'));
    console.error(c.gray('  Run `cecc init --force` to regenerate it.\n'));
    return 2;
  }

  switch (args.command) {
    case 'status':
      return statusCommand(root, project, { json: bool(args.flags['json']) });

    case 'scan':
    case 'security':
      return scanCommand(root, project, {
        all: bool(args.flags['all']),
        staged: bool(args.flags['staged']),
        path: str(args.flags['path']) ?? args.positional[0],
        json: bool(args.flags['json']),
        limit: args.flags['limit'] ? Number(args.flags['limit']) : undefined,
        external: bool(args.flags['external']),
        online: bool(args.flags['online']),
        scanner: str(args.flags['scanner']),
      });

    case 'findings':
      return findingsCommand(root, project, {
        id: str(args.flags['id']) ?? args.positional[0],
        layer: str(args.flags['layer']),
        severity: str(args.flags['severity']),
        all: bool(args.flags['all']),
        json: bool(args.flags['json']),
        resolve: str(args.flags['resolve']),
        suppress: str(args.flags['suppress']),
        reason: str(args.flags['reason']),
        days: args.flags['days'] ? Number(args.flags['days']) : undefined,
      });

    case 'policy':
      return policyCommand(root, project, {
        set: str(args.flags['set']),
        mode: str(args.flags['mode']),
        reason: str(args.flags['reason']),
        json: bool(args.flags['json']),
      });

    case 'workflow':
      return workflowCommand(root, project, { pin: str(args.flags['pin']), unpin: bool(args.flags['unpin']) });

    case 'tasks':
      return tasksCommand(root, project, {
        ingest: bool(args.flags['ingest']),
        dryRun: bool(args.flags['dry-run']) || bool(args.flags['dryRun']),
        json: bool(args.flags['json']),
        all: bool(args.flags['all']),
        noTodos: bool(args.flags['no-todos']) || bool(args.flags['noTodos']),
      });

    case 'session':
      return sessionCommand(root, project, {
        id: str(args.flags['id']) ?? args.positional[0],
        list: bool(args.flags['list']),
        filter: str(args.flags['filter']),
        limit: args.flags['limit'] ? Number(args.flags['limit']) : undefined,
      });

    case 'report':
      return reportCommand(root, project, { out: str(args.flags['out']), json: bool(args.flags['json']) });

    case 'sync':
      return syncCommand(root, project, {
        push: bool(args.flags['push']),
        json: bool(args.flags['json']),
        out: str(args.flags['out']),
        allowPrivate: bool(args.flags['allow-private']) || bool(args.flags['allowPrivate']),
        limit: args.flags['limit'] ? Number(args.flags['limit']) : undefined,
      });

    default:
      console.error(c.red(`\n  Unknown command '${args.command}'.\n`));
      usage();
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // A CLI crash is a bug in CECC. Report it plainly rather than as a stack dump.
    console.error(c.red(`\n  CECC failed: ${err instanceof Error ? err.message : String(err)}`));
    if (process.env['CECC_DEBUG'] && err instanceof Error) console.error(c.gray(err.stack ?? ''));
    console.error(c.gray('  Re-run with CECC_DEBUG=1 for a stack trace.\n'));
    process.exitCode = 1;
  });
