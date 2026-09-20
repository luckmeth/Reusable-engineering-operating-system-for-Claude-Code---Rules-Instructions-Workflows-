import { WORKFLOW_STAGES } from '@cecc/core';
import { Card, Empty, GateIcon } from '@/components/ui';
import { FindingItem } from '@/components/Finding';
import { Action } from '@/components/Action';
import { NotInitialized } from './not-initialized';
import { getOverview, NotInitializedError, resolveRoot } from '@/lib/server';
import { runScanAction } from './actions';
import { clockTime, relativeTime } from '@/lib/format';
import { GATE_PLAIN, plainFor } from '@/lib/plain';
import { PlainSummary, StatusHero } from './Hero';

export const dynamic = 'force-dynamic';

/**
 * The overview.
 *
 * Restructured around one question: what should this person do next? The
 * previous version answered "what does CECC know", which is a different
 * question and only useful to someone who already speaks the vocabulary.
 */
export default function OverviewPage() {
  let data;
  try {
    data = getOverview();
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { project, session, run, findings, events, tests, readiness, eventCount, chain, triage } = data;

  const critical = findings.filter((f) => f.severity === 'critical');
  const high = findings.filter((f) => f.severity === 'high');
  const blockingGates = readiness.gates.filter((g) => g.blocking && g.state !== 'pass' && g.state !== 'not_applicable');
  const topFindings = findings.slice(0, 5);
  const currentIndex = run ? WORKFLOW_STAGES.indexOf(run.currentStage) : -1;

  return (
    <div className="space-y-6">
      <StatusHero
        ready={readiness.ready}
        criticalCount={critical.length}
        highCount={high.length}
        blockerCount={blockingGates.length}
        projectName={project.name}
        environment={project.environment}
      />

      <PlainSummary
        criticalCount={critical.length}
        highCount={high.length}
        topHeadline={topFindings[0] ? plainFor(topFindings[0].ruleId, topFindings[0].title).headline : null}
        gateQuestions={blockingGates.slice(0, 4).map((g) => ({
          question: GATE_PLAIN[g.id]?.question ?? g.label,
          answer: GATE_PLAIN[g.id]?.failText ?? g.detail,
          state: g.state,
        }))}
        testsRun={tests.length > 0}
        chainOk={chain.ok}
      />

      {/* Progress rail — animated so the current stage is unmissable. */}
      <Card title="Where this work has got to" subtitle="Worked out from what actually happened, not from anyone saying so">
        {!run ? (
          <Empty>Nothing yet. Start your AI assistant in this project and this will fill in.</Empty>
        ) : (
          <>
            <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className="animate-grow-bar h-full rounded-full bg-gradient-to-r from-cecc to-ok"
                style={{ width: `${((currentIndex + 1) / WORKFLOW_STAGES.length) * 100}%` }}
              />
            </div>
            <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
              {WORKFLOW_STAGES.map((stage, i) => (
                <li key={stage} className="flex items-center gap-1">
                  <span
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                      i === currentIndex
                        ? 'bg-cecc/15 text-cecc ring-1 ring-cecc/40'
                        : i < currentIndex
                          ? 'text-ok'
                          : 'text-ink-faint'
                    }`}
                  >
                    {stage.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {i < WORKFLOW_STAGES.length - 1 && <span className="text-ink-faint" aria-hidden>›</span>}
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {findings.length === 0 ? 'Nothing needs your attention' : 'Deal with these, in this order'}
            </h2>
            <Action run={runScanAction.bind(null, 'changes')} variant="default" title="Check the files that changed">
              Check for problems now
            </Action>
          </div>

          {triage.applied && (
            <p className="animate-rise rounded border border-cecc/25 bg-cecc/5 px-3 py-2 text-[11px] text-ink-muted">
              <span className="font-medium text-cecc">Ordered by what you usually act on.</span> {triage.reason}
            </p>
          )}

          {topFindings.length === 0 ? (
            <Card>
              <Empty reassuring>Nothing is flagged right now.</Empty>
              <p className="mt-1 text-xs text-ink-faint">
                No check found a problem. That is not a guarantee everything is safe — it means nothing CECC knows how
                to look for turned up.
              </p>
            </Card>
          ) : (
            <div className="stagger space-y-3">
              {topFindings.map((finding, i) => (
                <FindingItem
                  key={finding.id}
                  finding={finding}
                  triage={triage.scores[finding.id]}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          )}

          {findings.length > topFindings.length && (
            <a href="/findings" className="lift inline-block rounded border border-surface-border px-3 py-1.5 text-[13px] text-ink-muted hover:text-ink">
              See all {findings.length} →
            </a>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Is this ready to ship?" subtitle="Each of these is checked against real evidence">
            <ul className="space-y-2">
              {readiness.gates.map((gate) => {
                const plain = GATE_PLAIN[gate.id];
                return (
                  <li key={gate.id} className="flex items-start gap-2 text-[13px]">
                    <GateIcon state={gate.state} />
                    <div className="min-w-0">
                      <p className={gate.state === 'pass' ? 'text-ink-muted' : 'text-ink'}>
                        {plain?.question ?? gate.label}
                      </p>
                      <p className="text-[11px] leading-snug text-ink-faint">
                        {gate.state === 'pass'
                          ? (plain?.passText ?? 'Passed.')
                          : (plain?.failText ?? gate.detail)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card
            title="What the AI is doing"
            action={<a href="/activity" className="text-xs text-ink-muted underline hover:text-ink">Watch live →</a>}
          >
            {events.length === 0 ? (
              <Empty>Nothing recorded yet.</Empty>
            ) : (
              <ul className="space-y-1">
                {events.slice(-8).reverse().map((event) => (
                  <li key={event.id} className="animate-slide-in mono flex items-baseline gap-2 text-[12px]">
                    <span className="text-ink-faint">{clockTime(event.timestamp)}</span>
                    <span className={event.status === 'failed' ? 'text-sev-critical' : 'text-ink-faint'}>
                      {event.status === 'failed' ? '✕' : '·'}
                    </span>
                    <span className="truncate text-ink-muted">{describeEvent(event.type)}</span>
                    <span className="truncate text-ink-faint">{event.command ?? event.filePaths[0] ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {session && (
              <p className="mt-3 border-t border-surface-border pt-2 text-[11px] text-ink-faint">
                {session.endedAt ? `Last active ${relativeTime(session.endedAt)}.` : 'Session is active right now.'}{' '}
                {eventCount.toLocaleString()} actions recorded in total.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Event types as a person would describe them. */
function describeEvent(type: string): string {
  const map: Record<string, string> = {
    'file.modified': 'changed a file',
    'file.created': 'created a file',
    'file.read': 'read a file',
    'file.deleted': 'deleted a file',
    'test.run': 'ran tests',
    'lint.run': 'checked code style',
    'typecheck.run': 'checked types',
    'build.run': 'built the project',
    'git.commit': 'saved work',
    'git.push': 'pushed work',
    'git.status': 'checked repository',
    'command.completed': 'ran a command',
    'command.failed': 'a command failed',
    'security.scan': 'ran a security scan',
    'session.started': 'session started',
    'session.ended': 'session ended',
    'prompt.submitted': 'you gave an instruction',
    'workflow.stage.entered': 'moved to a new stage',
    'agent.stopped': 'assistant finished',
  };
  return map[type] ?? type.replace(/[._]/g, ' ');
}
