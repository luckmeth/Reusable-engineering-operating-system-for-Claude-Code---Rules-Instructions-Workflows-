import {
  Store,
  ceccPaths,
  evaluateGates,
  isProtectedPath,
  loadPolicySet,
  loadProjectConfig,
  git,
  WORKFLOW_STAGES,
  type ProjectConfig,
} from '@cecc/core';
import { c, heading, kv, relativeTime, STATE_ICON, SEVERITY_COLOR, table, timeOnly, wrapText } from '../ui.js';

/**
 * `cecc status` — the terminal answer to "where am I and what is blocking me?".
 *
 * Everything printed is read from recorded evidence. Where there is no evidence
 * the output says so explicitly rather than showing a reassuring zero: "no test
 * run observed" and "tests passed" are different states and are never collapsed.
 */
export async function statusCommand(root: string, project: ProjectConfig, opts: { json?: boolean } = {}): Promise<number> {
  const paths = ceccPaths(root);
  const store = new Store(paths.db);
  const policies = loadPolicySet(paths.policies, project.environment).set;

  try {
    const session = store.getCurrentSession(project.id);
    const run = session ? store.getWorkflowRunBySession(session.id) : null;
    const events = session ? store.recentSessionEvents(session.id, 500) : [];
    const findings = store.listFindings({ projectId: project.id, status: ['open'] });
    const tests = store.listTestResults(project.id, 20);
    const tasks = store.listTasks(project.id);

    let status: Awaited<ReturnType<typeof git.getStatus>> | null = null;
    try {
      if (await git.isGitRepo(root)) status = await git.getStatus(root);
    } catch {
      // Git unavailable is a reduced-signal state, not a failure.
    }

    const uncommitted = status ? [...status.modified, ...status.staged, ...status.untracked] : [];
    const protectedTouched = uncommitted.filter((f) => isProtectedPath(policies, f));

    const readiness = evaluateGates({
      events,
      findings,
      tests,
      tasks,
      run,
      uncommittedFiles: uncommitted,
      protectedTouched,
    });

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            project: { name: project.name, environment: project.environment, root },
            session: session ? { id: session.id, startedAt: session.startedAt, agent: session.agentId, permissionMode: session.permissionMode } : null,
            workflow: run ? { stage: run.currentStage, pinned: run.pinnedStage } : null,
            git: status,
            findings: summarize(findings),
            readiness,
            eventCount: store.countEvents(project.id),
          },
          null,
          2,
        ),
      );
      return readiness.ready ? 0 : 1;
    }

    // ---- header
    console.log(heading(`CECC — ${project.name}`));
    console.log(kv('Environment', project.environment === 'production' ? c.red(project.environment) : project.environment));
    console.log(kv('Events recorded', String(store.countEvents(project.id))));

    if (session) {
      const age = session.endedAt ? `ended ${relativeTime(session.endedAt)}` : `active, started ${relativeTime(session.startedAt)}`;
      console.log(kv('Session', `${session.id.slice(0, 8)} ${c.gray(`(${session.agentId ?? 'unknown agent'}, ${age})`)}`));
      if (session.permissionMode && /bypass|dangerous/i.test(session.permissionMode)) {
        console.log(kv('Permission mode', c.red(session.permissionMode)));
      }
    } else {
      console.log(kv('Session', c.gray('none recorded yet — run Claude Code in this project')));
    }

    // ---- workflow
    console.log(heading('Workflow'));
    if (!run) {
      console.log(c.gray('  No workflow run yet.'));
    } else {
      const currentIndex = WORKFLOW_STAGES.indexOf(run.currentStage);
      const rendered = WORKFLOW_STAGES.map((stage, i) => {
        if (i < currentIndex) return c.green(stage);
        if (i === currentIndex) return c.bold(c.cyan(`▶ ${stage}`));
        return c.gray(stage);
      });
      console.log(`  ${rendered.join(c.gray(' → '))}`);
      if (run.pinnedStage) console.log(c.gray(`\n  Stage pinned by a human to ${run.pinnedStage} — inference suspended.`));
      const next = WORKFLOW_STAGES[currentIndex + 1];
      if (next) console.log(kv('\n  Next stage', next, 20));
    }

    // ---- git
    console.log(heading('Repository'));
    if (!status) {
      console.log(c.gray('  Not a git repository, or git is unavailable.'));
    } else {
      console.log(kv('Branch', `${status.branch}${status.upstream ? c.gray(` → ${status.upstream}`) : ''}`));
      if (status.ahead || status.behind) console.log(kv('Divergence', `${status.ahead} ahead, ${status.behind} behind`));
      console.log(
        kv(
          'Working tree',
          status.clean
            ? c.green('clean')
            : `${status.modified.length} modified, ${status.staged.length} staged, ${status.untracked.length} untracked`,
        ),
      );
      if (protectedTouched.length > 0) {
        console.log(kv('Protected files', c.yellow(`${protectedTouched.length} touched: ${protectedTouched.slice(0, 3).join(', ')}`)));
      }
    }

    // ---- findings by layer, kept separate on purpose
    console.log(heading('Findings'));
    const byLayer = {
      APPLICATION: findings.filter((f) => f.layer === 'APPLICATION'),
      AGENT: findings.filter((f) => f.layer === 'AGENT'),
      CECC: findings.filter((f) => f.layer === 'CECC'),
    };
    console.log(
      table(
        [
          ['Application security', formatCounts(byLayer.APPLICATION)],
          ['Agent shortcuts', formatCounts(byLayer.AGENT)],
          ['CECC integrity', formatCounts(byLayer.CECC)],
        ],
        ['Layer', 'Open findings'],
      ),
    );

    const top = findings.slice(0, 5);
    if (top.length > 0) {
      console.log('');
      for (const finding of top) {
        const sev = (SEVERITY_COLOR[finding.severity] ?? c.gray)(finding.severity.toUpperCase().padEnd(8));
        console.log(`  ${sev} ${c.gray(finding.ruleId)} ${finding.title}`);
        console.log(
          c.gray(`           ${finding.verification} · confidence ${Math.round(finding.confidence * 100)}% · ${finding.detection.toLowerCase()}`),
        );
      }
      if (findings.length > top.length) console.log(c.gray(`\n  … ${findings.length - top.length} more — run \`cecc findings\``));
    }

    // ---- tests
    console.log(heading('Validation'));
    if (tests.length === 0) {
      console.log(`  ${c.yellow('◦')} ${c.yellow('NOT TESTED')} ${c.gray('— no test, lint or build run has been observed')}`);
    } else {
      for (const test of tests.slice(0, 4)) {
        const icon = test.status === 'passed' ? c.green('✔') : test.status === 'failed' ? c.red('✖') : c.yellow('◦');
        const counts = test.total != null ? c.gray(` (${test.passed ?? 0}/${test.total})`) : '';
        console.log(`  ${icon} ${test.kind.padEnd(10)} ${test.suite.slice(0, 44)}${counts} ${c.gray(relativeTime(test.createdAt))}`);
      }
    }

    // ---- readiness gates
    console.log(heading(readiness.ready ? c.green('READY') : c.red('NOT READY')));
    for (const gate of readiness.gates) {
      const icon = STATE_ICON[gate.state] ?? '?';
      const label = gate.state === 'pass' ? c.gray(gate.label) : gate.label;
      console.log(`  ${icon} ${label}`);
      if (gate.state !== 'pass' && gate.state !== 'not_applicable') {
        console.log(c.gray(wrapText(gate.detail, 76, '      ')));
      }
    }

    if (!readiness.ready) {
      console.log(`\n  ${c.bold(c.red('Blocked by:'))}`);
      for (const blocker of readiness.blockers) console.log(c.red(`    • ${blocker}`));
    }

    // ---- recent activity
    if (events.length > 0) {
      console.log(heading('Recent activity'));
      for (const event of events.slice(-8)) {
        const icon = event.status === 'failed' ? c.red('✖') : event.status === 'blocked' ? c.bgRed(' ! ') : c.gray('·');
        const what = event.command ?? event.filePaths[0] ?? event.tool ?? '';
        console.log(`  ${c.gray(timeOnly(event.timestamp))} ${icon} ${event.type.padEnd(18)} ${c.gray(what.slice(0, 48))}`);
      }
    }

    console.log('');
    return readiness.ready ? 0 : 1;
  } finally {
    store.close();
  }
}

function formatCounts(findings: Array<{ severity: string }>): string {
  if (findings.length === 0) return c.green('none');
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return (['critical', 'high', 'medium', 'low', 'info'] as const)
    .filter((s) => counts[s])
    .map((s) => (SEVERITY_COLOR[s] ?? c.gray)(`${counts[s]} ${s}`))
    .join(c.gray(', '));
}

function summarize(findings: Array<{ severity: string; layer: string }>): Record<string, number> {
  const out: Record<string, number> = { total: findings.length };
  for (const f of findings) {
    out[f.severity] = (out[f.severity] ?? 0) + 1;
    out[`layer_${f.layer}`] = (out[`layer_${f.layer}`] ?? 0) + 1;
  }
  return out;
}
