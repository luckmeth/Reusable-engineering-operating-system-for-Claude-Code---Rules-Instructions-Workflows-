import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, Empty, SeverityBadge, StatRow } from '@/components/ui';
import { FindingCard } from '@/components/FindingCard';
import { NotInitialized } from '../../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import { clockTime, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Session replay.
 *
 * The answer to "what actually happened during that session?" — the whole
 * chronological record, with the findings each event produced attached inline
 * so cause and consequence read together rather than in two separate lists.
 */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let data;
  try {
    data = withStore(({ store, project }) => {
      const session = store.getSession(id) ?? store.listSessions(project.id, 200).find((s) => s.id.startsWith(id));
      if (!session) return null;
      return {
        session,
        events: store.queryEvents({ projectId: project.id, sessionId: session.id, limit: 2000 }).reverse(),
        findings: store.listFindings({ projectId: project.id, sessionId: session.id, status: ['open'], limit: 100 }),
        run: store.getWorkflowRunBySession(session.id),
        tests: store.listTestResults(project.id, 50).filter((t) => t.sessionId === session.id),
      };
    });
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  if (!data) notFound();
  const { session, events, findings, run, tests } = data;

  const findingsByEvent = new Map<string, typeof findings>();
  for (const finding of findings) {
    for (const eventId of finding.relatedEvents) {
      const existing = findingsByEvent.get(eventId) ?? [];
      existing.push(finding);
      findingsByEvent.set(eventId, existing);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/sessions" className="text-xs text-ink-faint underline hover:text-ink">← Sessions</Link>
          <h1 className="mono mt-1 text-lg font-semibold">{session.id.slice(0, 8)}</h1>
          <p className="text-sm text-ink-faint">
            {session.agentId ?? 'unknown agent'} · {relativeTime(session.startedAt)} ·{' '}
            {session.endedAt ? 'ended' : <span className="text-ok">active</span>}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <Card title="Summary" className="lg:col-span-1">
          <dl>
            <StatRow label="Events" value={events.length} />
            <StatRow label="Failures" value={events.filter((e) => e.status === 'failed').length} tone={events.some((e) => e.status === 'failed') ? 'bad' : 'default'} />
            <StatRow label="Findings" value={findings.length} tone={findings.length > 0 ? 'warn' : 'good'} />
            <StatRow label="Workflow stage" value={run?.currentStage ?? '—'} />
            <StatRow label="Test runs" value={tests.length} tone={tests.length === 0 ? 'warn' : 'default'} />
            {session.permissionMode && (
              <StatRow label="Permission mode" value={session.permissionMode} tone={/bypass|dangerous/i.test(session.permissionMode) ? 'bad' : 'default'} />
            )}
            {session.startReason && <StatRow label="Started by" value={session.startReason} />}
            {session.endReason && <StatRow label="Ended by" value={session.endReason} />}
          </dl>
        </Card>

        <Card title="Timeline" subtitle="Findings appear inline against the event that produced them" className="lg:col-span-3">
          {events.length === 0 ? (
            <Empty>No events in this session.</Empty>
          ) : (
            <ol className="space-y-0.5">
              {events.map((event) => {
                const attached = findingsByEvent.get(event.id) ?? [];
                const failed = event.status === 'failed';
                return (
                  <li key={event.id}>
                    <div className={`mono flex flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-[12px] ${failed ? 'bg-sev-critical/5' : ''}`}>
                      <span className="text-ink-faint">{clockTime(event.timestamp)}</span>
                      <span className={failed ? 'text-sev-critical' : 'text-ink-faint'}>{failed ? '✕' : '·'}</span>
                      <span className={`w-12 shrink-0 ${event.source === 'agent' ? 'text-agent' : event.source === 'user' ? 'text-cecc' : 'text-ink-faint'}`}>
                        {event.source}
                      </span>
                      <span className="w-36 shrink-0 truncate text-ink-muted">{event.type}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-faint" title={event.command ?? event.filePaths.join(', ')}>
                        {event.command ?? event.filePaths.join(', ')}
                      </span>
                    </div>
                    {attached.length > 0 && (
                      <ul className="ml-[3.5rem] space-y-0.5 border-l border-sev-critical/30 pl-3">
                        {attached.map((finding) => (
                          <li key={`${event.id}-${finding.id}`} className="flex items-baseline gap-2 py-0.5 text-[12px]">
                            <SeverityBadge severity={finding.severity} />
                            <span className="mono text-ink-faint">{finding.ruleId}</span>
                            <span className="min-w-0 truncate text-ink-muted">{finding.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      {findings.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Findings from this session</h2>
          {findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </section>
      )}
    </div>
  );
}
