import type { CeccEvent } from '../types/event.js';
import type { Finding } from '../types/finding.js';
import type { GateResult, ReadinessReport, WorkflowRun } from '../types/workflow.js';
import type { Task } from '../types/task.js';
import type { TestResultRecord } from '../storage/store.js';

/**
 * Completion gates.
 *
 * The product rule this file exists to enforce: a task is not READY because an
 * agent said so. Every gate is computed from recorded evidence, and a gate with
 * no evidence returns `pending`, not `pass`. "Nothing was checked" and "the
 * check passed" are different answers and must never collapse into one.
 */

export interface GateInput {
  events: CeccEvent[];
  findings: Finding[];
  tests: TestResultRecord[];
  tasks: Task[];
  run: WorkflowRun | null;
  /** Files changed but not committed. */
  uncommittedFiles: string[];
  /** Protected files touched and not yet acknowledged. */
  protectedTouched: string[];
}

function gate(
  id: string,
  label: string,
  state: GateResult['state'],
  detail: string,
  opts: Partial<Pick<GateResult, 'severity' | 'blocking' | 'evidenceEventIds' | 'relatedFindingIds'>> = {},
): GateResult {
  return {
    id,
    label,
    state,
    detail,
    severity: opts.severity ?? 'medium',
    blocking: opts.blocking ?? true,
    evidenceEventIds: opts.evidenceEventIds ?? [],
    relatedFindingIds: opts.relatedFindingIds ?? [],
  };
}

export function evaluateGates(input: GateInput): ReadinessReport {
  const gates: GateResult[] = [];
  const open = input.findings.filter((f) => f.status === 'open');

  // ---- security: unresolved critical and high findings
  const critical = open.filter((f) => f.severity === 'critical');
  const high = open.filter((f) => f.severity === 'high');
  gates.push(
    critical.length + high.length === 0
      ? gate('security.findings', 'No unresolved critical or high findings', 'pass', 'No open findings at critical or high severity.', {
          severity: 'critical',
        })
      : gate(
          'security.findings',
          'No unresolved critical or high findings',
          'fail',
          `${critical.length} critical and ${high.length} high findings are open.`,
          { severity: 'critical', relatedFindingIds: [...critical, ...high].slice(0, 20).map((f) => f.id) },
        ),
  );

  // ---- agent-layer findings surfaced separately: a shortcut is not an app bug
  const agentFindings = open.filter((f) => f.layer === 'AGENT' && (f.severity === 'critical' || f.severity === 'high'));
  gates.push(
    agentFindings.length === 0
      ? gate('agent.shortcuts', 'No unresolved agent shortcuts', 'pass', 'No high-severity agent shortcuts are open.', { severity: 'high' })
      : gate(
          'agent.shortcuts',
          'No unresolved agent shortcuts',
          'fail',
          `${agentFindings.length} agent shortcut${agentFindings.length === 1 ? '' : 's'} open: ${[...new Set(agentFindings.map((f) => f.ruleId))].join(', ')}.`,
          { severity: 'high', relatedFindingIds: agentFindings.slice(0, 20).map((f) => f.id) },
        ),
  );

  // ---- tests: pending when never run, which is not the same as passing
  const testRuns = input.events.filter((e) => e.type === 'test.run');
  const latestTest = input.tests[0];
  if (testRuns.length === 0 && !latestTest) {
    gates.push(
      gate('tests.run', 'Test suite executed', 'pending', 'No test run has been observed for this project. Not tested is not the same as passing.', {
        severity: 'high',
      }),
    );
  } else if (latestTest && latestTest.status === 'failed') {
    gates.push(
      gate('tests.run', 'Test suite passing', 'fail', `Most recent run of '${latestTest.suite}' failed (${latestTest.failed ?? '?'} failing).`, {
        severity: 'high',
      }),
    );
  } else {
    const failing = testRuns.filter((e) => e.status === 'failed');
    const passing = testRuns.filter((e) => e.status === 'success');
    gates.push(
      failing.length > 0 && failing[failing.length - 1]!.seq > (passing[passing.length - 1]?.seq ?? -1)
        ? gate('tests.run', 'Test suite passing', 'fail', 'The most recent observed test run failed.', {
            severity: 'high',
            evidenceEventIds: failing.slice(-3).map((e) => e.id),
          })
        : gate('tests.run', 'Test suite passing', 'pass', `Most recent observed test run passed.`, {
            severity: 'high',
            evidenceEventIds: passing.slice(-1).map((e) => e.id),
          }),
    );
  }

  // ---- static validation
  for (const [id, label, noun, types] of [
    ['validation.typecheck', 'Type check passing', 'type check', ['typecheck.run']],
    ['validation.lint', 'Lint passing', 'lint run', ['lint.run']],
    ['validation.build', 'Build succeeding', 'build', ['build.run']],
  ] as const) {
    const watched: readonly string[] = types;
    const runs = input.events.filter((e) => watched.includes(e.type));
    if (runs.length === 0) {
      gates.push(
        gate(id, label, 'pending', `No ${noun} has been observed for this work.`, {
          severity: 'medium',
          // A missing build is informational; a missing typecheck or lint is not.
          blocking: id !== 'validation.build',
        }),
      );
      continue;
    }
    const last = runs[runs.length - 1]!;
    gates.push(
      last.status === 'failed'
        ? gate(id, label, 'fail', `The most recent ${noun} failed.`, { severity: 'medium', evidenceEventIds: [last.id] })
        : gate(id, label, 'pass', `The most recent ${noun} succeeded.`, { severity: 'medium', evidenceEventIds: [last.id] }),
    );
  }

  // ---- security review actually happened
  const scans = input.events.filter((e) => e.type === 'security.scan');
  gates.push(
    scans.length > 0
      ? gate('security.reviewed', 'Security analysis performed', 'pass', `${scans.length} security scan(s) recorded.`, {
          severity: 'high',
          evidenceEventIds: scans.slice(-3).map((e) => e.id),
        })
      : gate('security.reviewed', 'Security analysis performed', 'pending', 'No security scan recorded for this work.', { severity: 'high' }),
  );

  // ---- protected files reviewed
  gates.push(
    input.protectedTouched.length === 0
      ? gate('protected.reviewed', 'Protected files unchanged or reviewed', 'pass', 'No protected paths were modified.', { severity: 'high' })
      : gate(
          'protected.reviewed',
          'Protected files unchanged or reviewed',
          'fail',
          `Protected paths modified and not acknowledged: ${input.protectedTouched.slice(0, 5).join(', ')}.`,
          { severity: 'high' },
        ),
  );

  // ---- uncommitted work
  gates.push(
    input.uncommittedFiles.length === 0
      ? gate('git.clean', 'Working tree committed', 'pass', 'No uncommitted changes.', { severity: 'low', blocking: false })
      : gate('git.clean', 'Working tree committed', 'pending', `${input.uncommittedFiles.length} file(s) changed and not committed.`, {
          severity: 'low',
          blocking: false,
        }),
  );

  // ---- task completion, requiring evidence rather than a status field
  const incomplete = input.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'VERIFIED');
  const doneWithoutEvidence = input.tasks.filter((t) => t.status === 'DONE' && t.evidenceEventIds.length === 0);
  if (input.tasks.length === 0) {
    gates.push(gate('tasks.complete', 'Tasks complete', 'not_applicable', 'No tasks are being tracked for this project.', { blocking: false }));
  } else if (incomplete.length > 0) {
    gates.push(
      gate('tasks.complete', 'Tasks complete', 'pending', `${incomplete.length} task(s) still open: ${incomplete.slice(0, 3).map((t) => t.title).join('; ')}.`, {
        severity: 'medium',
      }),
    );
  } else if (doneWithoutEvidence.length > 0) {
    gates.push(
      gate(
        'tasks.complete',
        'Tasks complete',
        'fail',
        `${doneWithoutEvidence.length} task(s) marked DONE with no recorded evidence. Implementation existing is not the same as it working.`,
        { severity: 'medium' },
      ),
    );
  } else {
    gates.push(gate('tasks.complete', 'Tasks complete', 'pass', 'All tracked tasks are done with recorded evidence.', { severity: 'medium' }));
  }

  const blockers = gates
    .filter((g) => g.blocking && (g.state === 'fail' || g.state === 'pending'))
    .map((g) => `${g.label}: ${g.detail}`);

  return {
    // Pending blocks readiness as firmly as failure. An unrun check is not a pass.
    ready: blockers.length === 0,
    gates,
    blockers,
    evaluatedAt: new Date().toISOString(),
  };
}
