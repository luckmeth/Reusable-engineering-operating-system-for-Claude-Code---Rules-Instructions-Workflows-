import { findSegments, hasFlag, parseCommand } from '../../analyze/command.js';
import { detectSandbox } from '../../env.js';
import { commandEvidence, lineEvidence, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';

/**
 * Bypass detection: the agent turning off a safety mechanism rather than
 * satisfying it.
 *
 * These are the highest-signal rules in CECC. A bypass is rarely ambiguous —
 * `--no-verify` means exactly one thing — and it is precisely the class of
 * shortcut that looks like progress in a transcript and costs a breach later.
 */

const AGENT_001: Rule = {
  id: 'AGENT-001',
  name: 'Permission bypass',
  category: 'AGENT_SECURITY',
  layer: 'AGENT',
  severity: 'high',
  detection: 'RULE_BASED',
  description: 'Agent permission checks were skipped or run in an unrestricted mode.',
  why:
    'Permission prompts are the last human checkpoint before an agent touches the filesystem, the network or credentials. ' +
    'Skipping them on a real workstation means any mistake or injected instruction executes unreviewed.',
  remediation:
    'Run without the bypass flag and grant specific permissions instead, or confine unrestricted runs to a disposable container with no production credentials.',

  matches(ctx) {
    return (
      ctx.event.type === 'session.started' ||
      (ctx.event.command != null && /dangerously|bypassPermissions|--bare/.test(ctx.event.command))
    );
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];
    const sandbox = detectSandbox();

    // Environment decides severity. The same flag is routine in a throwaway
    // container and alarming on a laptop holding production keys.
    const severity = sandbox.isolated ? 'low' : 'critical';
    const environmentNote = sandbox.isolated
      ? `Mitigated: running in an isolated environment (${sandbox.signal}).`
      : `Not mitigated: this appears to be a persistent workstation (${sandbox.signal}).`;

    // Signal 1: the agent reported its own permission mode at session start.
    const mode = ctx.event.metadata['permissionMode'];
    if (typeof mode === 'string' && /bypass|dangerous|acceptAll|dontAsk/i.test(mode)) {
      results.push({
        title: `Agent session running with permission mode '${mode}'`,
        severity,
        confidence: 0.95,
        verification: 'VERIFIED',
        affectedFiles: [],
        affectedLines: [],
        evidence: [
          { kind: 'config', label: 'Reported permission mode', detail: mode },
          { kind: 'config', label: 'Environment assessment', detail: `${environmentNote} (confidence ${sandbox.confidence})` },
        ],
        impact:
          `Every tool call in this session proceeds without per-action approval. ${environmentNote} ` +
          'Any instruction the agent picks up — including one embedded in repository content — executes unreviewed.',
        recommendation: this.remediation,
        discriminator: `mode:${mode}`,
      });
    }

    // Signal 2: the bypass appears in an executed command line.
    if (ctx.parsedCommand) {
      for (const segment of ctx.parsedCommand.segments) {
        if (hasFlag(segment, '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions')) {
          results.push({
            title: 'Agent invoked with permission checks disabled',
            severity,
            confidence: 0.97,
            verification: 'VERIFIED',
            affectedFiles: [],
            affectedLines: [],
            evidence: [commandEvidence(segment.raw), { kind: 'config', label: 'Environment assessment', detail: environmentNote }],
            impact: `The spawned agent runs with no permission checks at all. ${environmentNote}`,
            recommendation: this.remediation,
            command: ctx.event.command,
            discriminator: 'flag:skip-permissions',
          });
        }
      }
    }

    return results;
  },
};

const AGENT_002: Rule = {
  id: 'AGENT-002',
  name: 'Verification bypass',
  category: 'CI_CD',
  layer: 'AGENT',
  severity: 'high',
  detection: 'RULE_BASED',
  description: 'A commit, push or build skipped the checks that were configured to gate it.',
  why:
    'Pre-commit hooks, CI gates and test runs exist because someone decided this code should not ship unchecked. ' +
    'Bypassing them converts a blocking control into an advisory one, silently and without a record.',
  remediation: 'Fix what the check reported and re-run it. If the check itself is wrong, change the check deliberately rather than stepping around it.',

  matches(ctx) {
    return ctx.event.command != null;
  },

  evaluate(ctx): RuleResult[] {
    if (!ctx.parsedCommand) return [];
    const results: RuleResult[] = [];

    for (const segment of findSegments(ctx.parsedCommand, 'git')) {
      const sub = segment.args.find((a) => !a.startsWith('-'));

      // `-n` is --no-verify for commit, but means something else elsewhere.
      const skipsHooks =
        hasFlag(segment, '--no-verify') || (sub === 'commit' && segment.args.includes('-n'));

      if (skipsHooks && (sub === 'commit' || sub === 'push')) {
        results.push({
          title: `git ${sub} bypassed pre-${sub} verification hooks`,
          confidence: 0.98,
          verification: 'VERIFIED',
          affectedFiles: [],
          affectedLines: [],
          evidence: [commandEvidence(segment.raw, `Verification skipped on git ${sub}`)],
          impact:
            `Whatever the repository's pre-${sub} hooks enforce — lint, formatting, tests, secret scanning — did not run. ` +
            'The commit is in history as though it had passed.',
          recommendation: this.remediation,
          command: ctx.event.command,
          discriminator: `git-${sub}`,
        });
      }
    }

    // Test/lint runners told to ignore their own failures.
    for (const segment of ctx.parsedCommand.segments) {
      const line = `${segment.program} ${segment.args.join(' ')}`;
      if (/--(?:passWithNoTests|no-tests|ignore-scripts=false)\b/.test(line)) continue;

      if (/\b(?:npm|pnpm|yarn)\b/.test(segment.program) && segment.args.includes('--no-verify')) {
        results.push({
          title: 'Package manager lifecycle verification skipped',
          severity: 'medium',
          confidence: 0.85,
          verification: 'VERIFIED',
          affectedFiles: [],
          affectedLines: [],
          evidence: [commandEvidence(segment.raw)],
          impact: 'Lifecycle scripts that gate this operation were skipped.',
          recommendation: this.remediation,
          command: ctx.event.command,
          discriminator: 'pm-no-verify',
        });
      }

      // `|| true` after a validation command discards its exit status entirely.
      if (
        segment.connector === '||' &&
        segment.program === 'true' &&
        /\b(test|lint|tsc|typecheck|audit|semgrep)\b/.test(ctx.parsedCommand.raw)
      ) {
        results.push({
          title: 'Validation command result discarded with `|| true`',
          severity: 'medium',
          confidence: 0.9,
          verification: 'VERIFIED',
          affectedFiles: [],
          affectedLines: [],
          evidence: [commandEvidence(ctx.parsedCommand.raw, 'Exit status suppressed')],
          impact:
            'The command always reports success regardless of whether the check passed. ' +
            'Any caller — including CI — will treat a failure as a pass.',
          recommendation: 'Let the command fail and address the failure, or handle specific expected exit codes explicitly.',
          command: ctx.event.command,
          discriminator: 'or-true',
        });
      }
    }

    return results;
  },
};

const DESTRUCTIVE_GIT: Array<{ test: (args: string[]) => boolean; label: string; severity: 'high' | 'critical' | 'medium' }> = [
  { test: (a) => a.includes('reset') && a.includes('--hard'), label: 'git reset --hard discards uncommitted work', severity: 'high' },
  { test: (a) => a.includes('push') && (a.includes('--force') || a.includes('-f')), label: 'Force push rewrites published history', severity: 'critical' },
  { test: (a) => a.includes('clean') && a.some((x) => /^-[a-z]*f/.test(x)), label: 'git clean -f deletes untracked files irreversibly', severity: 'high' },
  { test: (a) => a.includes('branch') && a.includes('-D'), label: 'Forced branch deletion', severity: 'medium' },
  { test: (a) => a.includes('commit') && a.includes('--amend'), label: 'Commit amended — rewrites history if already pushed', severity: 'medium' },
  { test: (a) => a.includes('filter-branch') || a.includes('filter-repo'), label: 'History rewrite across the repository', severity: 'critical' },
];

const AGENT_024: Rule = {
  id: 'AGENT-024',
  name: 'Git history manipulation',
  category: 'CI_CD',
  layer: 'AGENT',
  severity: 'high',
  detection: 'RULE_BASED',
  description: 'A destructive or history-rewriting git command was executed.',
  why:
    'These commands destroy work that no other system has a copy of. Force-pushing a shared branch also breaks every ' +
    'collaborator’s checkout, and `reset --hard` can discard changes a human made and never committed.',
  remediation:
    'Prefer additive operations: merge instead of rebasing a shared branch, revert instead of rewriting, stash instead of resetting. Confirm with the human before any of these.',

  matches(ctx) {
    return ctx.event.command != null && ctx.event.command.includes('git');
  },

  evaluate(ctx): RuleResult[] {
    if (!ctx.parsedCommand) return [];
    const results: RuleResult[] = [];
    const isProduction = ctx.project.environment === 'production';

    for (const segment of findSegments(ctx.parsedCommand, 'git')) {
      for (const pattern of DESTRUCTIVE_GIT) {
        if (!pattern.test(segment.args)) continue;

        // Force-pushing a protected branch is categorically worse than a feature branch.
        const touchesMainline = segment.args.some((a) => /^(main|master|develop|production|release)$/.test(a));
        let severity = pattern.severity;
        if (touchesMainline && severity !== 'critical') severity = 'critical';
        if (isProduction && severity === 'medium') severity = 'high';

        results.push({
          title: pattern.label,
          severity,
          confidence: 0.96,
          verification: 'VERIFIED',
          affectedFiles: [],
          affectedLines: [],
          evidence: [
            commandEvidence(segment.raw),
            ...(touchesMainline
              ? [{ kind: 'config' as const, label: 'Target branch', detail: 'Command names a protected mainline branch' }]
              : []),
          ],
          impact:
            `${pattern.label}. ` +
            (touchesMainline
              ? 'It targets a mainline branch, so the effect is shared with everyone working on the repository.'
              : 'Work that exists only in the working tree or only on this branch may be unrecoverable.'),
          recommendation: this.remediation,
          command: ctx.event.command,
          discriminator: pattern.label,
        });
      }
    }
    return results;
  },
};

const AGENT_023: Rule = {
  id: 'AGENT-023',
  name: 'Unsafe shell shortcut',
  category: 'COMMAND_INJECTION',
  layer: 'AGENT',
  severity: 'high',
  detection: 'RULE_BASED',
  description: 'A shell command used a pattern that is dangerous regardless of intent.',
  why:
    'Piping a downloaded script straight into a shell executes whatever the server returns, at the moment it returns it, ' +
    'with no review and no record of what ran. World-writable permissions and unbounded recursive deletes are similarly ' +
    'irreversible and rarely what was actually needed.',
  remediation: 'Download, read, then execute as separate steps. Grant the narrowest permission that works. Scope deletes to an explicit path.',

  matches(ctx) {
    return ctx.event.command != null;
  },

  evaluate(ctx): RuleResult[] {
    const parsed = ctx.parsedCommand;
    if (!parsed) return [];
    const results: RuleResult[] = [];

    // curl/wget piped into a shell interpreter.
    for (const segment of parsed.segments) {
      if (!segment.pipedInto) continue;
      if (!['sh', 'bash', 'zsh', 'fish', 'python', 'python3', 'node', 'perl', 'ruby'].includes(segment.program)) continue;

      const upstream = parsed.segments[parsed.segments.indexOf(segment) - 1];
      if (!upstream || !['curl', 'wget', 'fetch'].includes(upstream.program)) continue;

      const url = upstream.args.find((a) => /^https?:\/\//.test(a)) ?? '(url not parsed)';
      results.push({
        title: `Remote script piped directly into ${segment.program}`,
        severity: 'critical',
        confidence: 0.97,
        verification: 'VERIFIED',
        affectedFiles: [],
        affectedLines: [],
        evidence: [commandEvidence(parsed.raw), { kind: 'output', label: 'Remote source', detail: url }],
        impact:
          'Whatever the remote server returns executes immediately with the current user’s privileges. ' +
          'The content is never reviewed, is not recorded anywhere, and can differ between the time it is inspected and the time it runs.',
        recommendation: 'Download to a file, read it, then run it as a separate step.',
        command: ctx.event.command,
        discriminator: `pipe-to-${segment.program}`,
      });
    }

    for (const segment of parsed.segments) {
      // World-writable permissions.
      if (segment.program === 'chmod') {
        const mode = segment.args.find((a) => /^[0-7]{3,4}$/.test(a));
        if (mode && /[0-7]?7{2,3}$/.test(mode) && mode.endsWith('7')) {
          const recursive = segment.args.some((a) => /^-[a-zA-Z]*R/.test(a));
          results.push({
            title: `chmod ${mode}${recursive ? ' -R' : ''} grants write access to every user`,
            severity: recursive ? 'high' : 'medium',
            confidence: 0.93,
            verification: 'VERIFIED',
            affectedFiles: segment.args.filter((a) => !a.startsWith('-') && a !== mode),
            affectedLines: [],
            evidence: [commandEvidence(segment.raw)],
            impact:
              'Any local user or process can modify these files. If the path is served or executed, this is a straightforward ' +
              'local privilege-escalation and tampering vector.',
            recommendation: 'Use the narrowest mode that works — typically 644 for files and 755 for directories.',
            command: ctx.event.command,
            discriminator: `chmod-${mode}`,
          });
        }
      }

      // Recursive force delete aimed at something broad.
      if (segment.program === 'rm') {
        const force = segment.args.some((a) => /^-[a-zA-Z]*r/i.test(a)) && segment.args.some((a) => /^-[a-zA-Z]*f/.test(a));
        const targets = segment.args.filter((a) => !a.startsWith('-'));
        const dangerous = targets.filter((t) => /^[/~]$|^\/\*|^\.\.?\/?$|^\$[A-Z_]+\/?$|^\/(?:etc|usr|var|home|opt)\b/.test(t));
        if (force && (dangerous.length > 0 || targets.length === 0)) {
          results.push({
            title: 'Recursive force delete targets a broad or unresolved path',
            severity: 'critical',
            confidence: 0.9,
            verification: 'VERIFIED',
            affectedFiles: targets,
            affectedLines: [],
            evidence: [commandEvidence(segment.raw), { kind: 'output', label: 'Targets', detail: targets.join(' ') || '(none parsed)' }],
            impact:
              'A recursive force delete against a broad path, or one built from an unset variable, can remove far more than intended and cannot be undone.',
            recommendation: 'Delete an explicit, fully-resolved path. Verify the expansion with `echo` before running the delete.',
            command: ctx.event.command,
            discriminator: 'rm-rf-broad',
          });
        }
      }
    }

    return results;
  },
};

/**
 * CECC watching itself.
 *
 * A monitoring system that any monitored process can quietly switch off is
 * theatre. This rule is the reason CECC's own config lives on the protected
 * path list, and why enforcement history is written to a separate audit table
 * from the event stream.
 */
const CECC_PATH = /(?:^|[/\\])\.cecc[/\\]|(?:^|[/\\])cecc\.config\.json$|(?:^|[/\\])\.claude[/\\]settings(?:\.local)?\.json$/;

const AGENT_028: Rule = {
  id: 'AGENT-028',
  name: 'CECC bypass attempt',
  category: 'AGENT_SECURITY',
  layer: 'CECC',
  severity: 'critical',
  detection: 'RULE_BASED',
  description: 'Something tried to disable, weaken or erase the monitoring system itself.',
  why:
    'Every other finding in CECC depends on CECC still running and still recording. A change that disables a hook, ' +
    'relaxes a policy or deletes the event log removes the evidence for everything that follows it, so it is treated as ' +
    'the most serious class of finding regardless of the stated reason.',
  remediation:
    'Revert the change. Policy and hook changes belong in a deliberate, separately reviewed commit made by a human — never as a side effect of implementation work.',

  matches(ctx) {
    const touchesCecc = ctx.event.filePaths.some((p) => CECC_PATH.test(p));
    const commandTouchesCecc = ctx.event.command != null && /\.cecc|cecc\s+(?:policy|stop)|--bare/.test(ctx.event.command);
    return touchesCecc || commandTouchesCecc;
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    // Agent editing CECC or hook configuration.
    for (const change of ctx.changes) {
      if (!CECC_PATH.test(change.file)) continue;

      // Only the agent doing this is suspicious; a human editing their own config is normal.
      const byAgent = ctx.event.source === 'agent';
      if (!byAgent) continue;

      const removedHooks = change.removed.filter((l) => /hook|cecc|PreToolUse|PostToolUse|SessionStart/i.test(l.text));
      const weakened = change.added.filter((l) => /"mode"\s*:\s*"observe"|"enabled"\s*:\s*false|"enforcement"\s*:\s*"off"/i.test(l.text));

      if (removedHooks.length === 0 && weakened.length === 0) {
        // Still worth recording that the agent touched protected config.
        results.push({
          title: `Agent modified protected monitoring configuration: ${change.file}`,
          severity: 'high',
          confidence: 0.8,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'Protected file modified by agent', detail: change.file, file: change.file }],
          impact: 'The agent changed configuration that governs how it is monitored. The change may be benign, but it was not reviewed.',
          recommendation: this.remediation,
          discriminator: `touched:${change.file}`,
        });
        continue;
      }

      results.push({
        title: `Agent weakened monitoring configuration: ${change.file}`,
        confidence: 0.94,
        verification: 'VERIFIED',
        affectedFiles: [change.file],
        affectedLines: [
          ...removedHooks.filter((l) => l.line !== null).map((l) => ({ file: change.file, line: l.line as number })),
          ...weakened.filter((l) => l.line !== null).map((l) => ({ file: change.file, line: l.line as number })),
        ],
        evidence: [
          ...removedHooks.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Hook or monitor removed')),
          ...weakened.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Enforcement relaxed')),
        ],
        impact:
          'Monitoring or enforcement was reduced by the agent during implementation work. Findings after this point may be incomplete, ' +
          'and the change hides exactly the class of problem CECC exists to surface.',
        recommendation: this.remediation,
        discriminator: `weakened:${change.file}`,
      });
    }

    // Commands aimed at the event store or at running the agent without hooks.
    if (ctx.parsedCommand) {
      for (const segment of ctx.parsedCommand.segments) {
        const line = segment.raw;
        if (/rm\s+.*\.cecc|rm\s+.*cecc\.db|DROP\s+TABLE\s+events/i.test(line)) {
          results.push({
            title: 'Attempt to delete the CECC event store',
            confidence: 0.95,
            verification: 'VERIFIED',
            affectedFiles: ['.cecc/'],
            affectedLines: [],
            evidence: [commandEvidence(line)],
            impact: 'Deleting the event store destroys the evidence trail for the entire session, including any findings already recorded.',
            recommendation: 'Restore from backup if possible. Event retention is configurable — use `cecc policy` rather than deleting the database.',
            command: ctx.event.command,
            discriminator: 'delete-store',
          });
        }
        if (segment.program === 'claude' && hasFlag(segment, '--bare')) {
          results.push({
            title: 'Agent relaunched with hooks disabled (--bare)',
            severity: 'high',
            confidence: 0.92,
            verification: 'VERIFIED',
            affectedFiles: [],
            affectedLines: [],
            evidence: [commandEvidence(line, 'Hooks skipped for the spawned session')],
            impact:
              'The spawned session runs without hooks, so CECC observes nothing it does. Any activity in that session is absent from the record.',
            recommendation: 'Run without --bare so monitoring stays active, or record explicitly why this session is exempt.',
            command: ctx.event.command,
            discriminator: 'bare-mode',
          });
        }
      }
    }

    return results;
  },
};

export const BYPASS_RULES = [AGENT_001, AGENT_002, AGENT_023, AGENT_024, AGENT_028];
registerRules(BYPASS_RULES);

export { AGENT_001, AGENT_002, AGENT_023, AGENT_024, AGENT_028 };

/** Exposed so the CLI can parse a command outside an event context. */
export { parseCommand };
