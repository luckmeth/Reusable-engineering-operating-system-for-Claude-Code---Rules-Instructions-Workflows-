import { WORKFLOW_STAGES } from '@cecc/core';
import { Card, Empty, GateIcon, LayerBadge, SeverityBadge, StatRow, VerificationBadge } from '@/components/ui';
import { FindingCard } from '@/components/FindingCard';
import { NotInitialized } from './not-initialized';
import { getOverview, NotInitializedError, resolveRoot } from '@/lib/server';
import { clockTime, countBySeverity, relativeTime, SEVERITY_ORDER } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function OverviewPage() {
  let data;
  try {
    data = getOverview();
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { project, session, run, findings, events, tests, readiness, eventCount, chain, protectedTouched } = data;

  const byLayer = {
    APPLICATION: findings.filter((f) => f.layer === 'APPLICATION'),
    AGENT: findings.filter((f) => f.layer === 'AGENT'),
    CECC: findings.filter((f) => f.layer === 'CECC'),
  };
  const topFindings = findings.slice(0, 6);
  const currentIndex = run ? WORKFLOW_STAGES.indexOf(run.currentStage) : -1;
  const latestTest = tests[0];

  return (
    <div className="space-y-6">
      {/* Readiness is the answer to the first question anyone opens this for. */}
      <section
        className={`card flex flex-wrap items-center justify-between gap-4 border-l-4 px-5 py-4 ${
          readiness.ready ? 'border-l-ok' : 'border-l-sev-critical'
        }`}
      >
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">Release readiness</p>
          <p className={`text-2xl font-bold ${readiness.ready ? 'text-ok' : 'text-sev-critical'}`}>
            {readiness.ready ? 'READY' : 'NOT READY'}
          </p>
        </div>
        <div className="flex-1 text-sm text-ink-muted">
          {readiness.blockers.length === 0 ? (
            <span>All blocking gates pass on the evidence recorded so far.</span>
          ) : (
            <ul className="space-y-0.5">
              {readiness.blockers.slice(0, 3).map((blocker, i) => (
                <li key={i} className="text-sev-critical">• {blocker}</li>
              ))}
              {readiness.blockers.length > 3 && (
                <li className="text-ink-faint">+{readiness.blockers.length - 3} more</li>
              )}
            </ul>
          )}
        </div>
      </section>

      {/* Workflow rail */}
      <Card title="Workflow" subtitle={run ? `Stage inferred from recorded evidence${run.pinnedStage ? ' — currently pinned by a human' : ''}` : undefined}>
        {!run ? (
          <Empty>No workflow run yet. Start a Claude Code session in this project.</Empty>
        ) : (
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {WORKFLOW_STAGES.map((stage, i) => {
              const done = i < currentIndex;
              const active = i === currentIndex;
              return (
                <li key={stage} className="flex items-center gap-1">
                  <span
                    className={`rounded px-2 py-1 text-[11px] font-medium ${
                      active
                        ? 'bg-cecc/15 text-cecc ring-1 ring-cecc/40'
                        : done
                          ? 'text-ok'
                          : 'text-ink-faint'
                    }`}
                  >
                    {stage}
                  </span>
                  {i < WORKFLOW_STAGES.length - 1 && <span className="text-ink-faint" aria-hidden>→</span>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* Three security layers, kept visually separate on purpose. */}
        <Card title="Findings by layer" subtitle="Three distinct problems with three distinct audiences" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            {(['APPLICATION', 'AGENT', 'CECC'] as const).map((layer) => {
              const group = byLayer[layer];
              const counts = countBySeverity(group);
              return (
                <div key={layer} className="rounded border border-surface-border bg-surface p-3">
                  <LayerBadge layer={layer} />
                  <p className="mt-2 text-2xl font-bold tabular-nums">
                    {group.length === 0 ? <span className="text-ok">0</span> : group.length}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {SEVERITY_ORDER.filter((s) => counts[s]).map((s) => (
                      <SeverityBadge key={s} severity={s}>
                        {counts[s]} {s}
                      </SeverityBadge>
                    ))}
                    {group.length === 0 && <span className="text-[11px] text-ink-faint">no rule matched</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Session">
          <dl>
            <StatRow label="Events recorded" value={eventCount.toLocaleString()} />
            <StatRow
              label="Event chain"
              value={chain.ok ? `verified ×${chain.checked}` : `BROKEN at #${chain.brokenAtSeq}`}
              tone={chain.ok ? 'good' : 'bad'}
            />
            <StatRow label="Agent" value={session?.agentId ?? '—'} />
            <StatRow
              label="State"
              value={session ? (session.endedAt ? `ended ${relativeTime(session.endedAt)}` : 'active') : 'none'}
              tone={session && !session.endedAt ? 'good' : 'default'}
            />
            {session?.permissionMode && (
              <StatRow
                label="Permission mode"
                value={session.permissionMode}
                tone={/bypass|dangerous/i.test(session.permissionMode) ? 'bad' : 'default'}
              />
            )}
            <StatRow
              label="Protected files touched"
              value={protectedTouched.length}
              tone={protectedTouched.length > 0 ? 'warn' : 'default'}
            />
            <StatRow
              label="Latest validation"
              value={
                latestTest
                  ? `${latestTest.kind} ${latestTest.status}`
                  : 'not tested'
              }
              tone={!latestTest ? 'warn' : latestTest.status === 'passed' ? 'good' : 'bad'}
            />
            <StatRow label="Cloud sync" value={project.cloudSync.enabled ? 'enabled' : 'off — local only'} tone={project.cloudSync.enabled ? 'warn' : 'good'} />
          </dl>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Open findings</h2>
          {topFindings.length === 0 ? (
            <Card>
              <Empty reassuring>No open findings.</Empty>
              <p className="mt-1 text-xs text-ink-faint">
                No active rule matched the observed activity. That is not the same as a clean bill of health.
              </p>
            </Card>
          ) : (
            <>
              {topFindings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} defaultOpen={finding.severity === 'critical'} />
              ))}
              {findings.length > topFindings.length && (
                <a href="/findings" className="block text-sm text-ink-muted underline hover:text-ink">
                  View all {findings.length} findings →
                </a>
              )}
            </>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Completion gates" subtitle="Computed from evidence, never from a claim">
            <ul className="space-y-2">
              {readiness.gates.map((gate) => (
                <li key={gate.id} className="flex items-start gap-2 text-[13px]">
                  <GateIcon state={gate.state} />
                  <div className="min-w-0">
                    <p className={gate.state === 'pass' ? 'text-ink-muted' : 'text-ink'}>{gate.label}</p>
                    {gate.state !== 'pass' && gate.state !== 'not_applicable' && (
                      <p className="text-[11px] leading-snug text-ink-faint">{gate.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Recent activity" action={<a href="/activity" className="text-xs text-ink-muted underline hover:text-ink">Live →</a>}>
            {events.length === 0 ? (
              <Empty>Nothing recorded yet.</Empty>
            ) : (
              <ul className="space-y-1">
                {events.slice(-10).reverse().map((event) => (
                  <li key={event.id} className="mono flex items-baseline gap-2 text-[12px]">
                    <span className="text-ink-faint">{clockTime(event.timestamp)}</span>
                    <span className={event.status === 'failed' ? 'text-sev-critical' : 'text-ink-faint'}>
                      {event.status === 'failed' ? '✕' : '·'}
                    </span>
                    <span className="truncate text-ink-muted">{event.type}</span>
                    <span className="truncate text-ink-faint">{event.command ?? event.filePaths[0] ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
