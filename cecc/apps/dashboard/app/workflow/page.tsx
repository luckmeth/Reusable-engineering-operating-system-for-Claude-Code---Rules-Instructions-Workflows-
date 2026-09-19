import { WORKFLOW_STAGES } from '@cecc/core';
import { Card, Empty, GateIcon, StatRow } from '@/components/ui';
import { NotInitialized } from '../not-initialized';
import { getOverview, NotInitializedError, resolveRoot } from '@/lib/server';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function WorkflowPage() {
  let data;
  try {
    data = getOverview();
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { run, readiness, events } = data;
  const currentIndex = run ? WORKFLOW_STAGES.indexOf(run.currentStage) : -1;
  const nextStage = currentIndex >= 0 ? WORKFLOW_STAGES[currentIndex + 1] : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Workflow</h1>
        <p className="text-sm text-ink-faint">
          Stage is inferred from recorded evidence, never from an agent reporting progress.
        </p>
      </div>

      {!run ? (
        <Card><Empty>No workflow run yet.</Empty></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Stages" className="lg:col-span-2">
            <ol className="space-y-1">
              {run.stages.map((record, i) => {
                const active = record.stage === run.currentStage;
                const complete = record.state === 'complete';
                return (
                  <li
                    key={record.stage}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-3 py-2 ${
                      active ? 'bg-cecc/10 ring-1 ring-cecc/30' : ''
                    }`}
                  >
                    <span className={`w-5 text-center ${complete ? 'text-ok' : active ? 'text-cecc' : 'text-ink-faint'}`}>
                      {complete ? '✓' : active ? '▶' : '·'}
                    </span>
                    <span className={`w-40 text-sm ${active ? 'font-semibold text-ink' : complete ? 'text-ink-muted' : 'text-ink-faint'}`}>
                      {record.stage}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {record.durationMs ? `${Math.round(record.durationMs / 1000)}s` : ''}
                    </span>
                    {record.evidenceEventIds.length > 0 && (
                      <span className="text-[11px] text-ink-faint">{record.evidenceEventIds.length} evidence events</span>
                    )}
                    {!record.inferred && (
                      <span className="rounded border border-sev-medium/40 bg-sev-medium/10 px-1.5 py-0.5 text-[10px] text-sev-medium">
                        set by human
                      </span>
                    )}
                    {i === currentIndex && nextStage && (
                      <span className="ml-auto text-[11px] text-ink-faint">next: {nextStage}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>

          <div className="space-y-6">
            <Card title="Run">
              <dl>
                <StatRow label="Current stage" value={run.currentStage} />
                <StatRow label="Next stage" value={nextStage ?? 'none'} />
                <StatRow label="Started" value={relativeTime(run.startedAt)} />
                <StatRow
                  label="Inference"
                  value={run.pinnedStage ? `pinned to ${run.pinnedStage}` : 'active'}
                  tone={run.pinnedStage ? 'warn' : 'default'}
                />
                <StatRow label="Events in window" value={events.length} />
              </dl>
              {run.pinnedStage && (
                <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                  A human pinned the stage, so inference is suspended. Run <code className="mono">cecc workflow --unpin</code> to resume it.
                </p>
              )}
            </Card>

            <Card title="Gates" subtitle="What still blocks READY">
              <ul className="space-y-2">
                {readiness.gates.map((gate) => (
                  <li key={gate.id} className="flex items-start gap-2 text-[13px]">
                    <GateIcon state={gate.state} />
                    <div>
                      <p className={gate.state === 'pass' ? 'text-ink-muted' : 'text-ink'}>{gate.label}</p>
                      {gate.state !== 'pass' && gate.state !== 'not_applicable' && (
                        <p className="text-[11px] leading-snug text-ink-faint">{gate.detail}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
