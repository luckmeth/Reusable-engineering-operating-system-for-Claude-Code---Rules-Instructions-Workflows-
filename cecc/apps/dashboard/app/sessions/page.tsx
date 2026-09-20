import Link from 'next/link';
import { Card, Empty } from '@/components/ui';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function SessionsPage() {
  let rows;
  try {
    rows = withStore(({ store, project }) =>
      store.listSessions(project.id, 40).map((session) => {
        const events = store.queryEvents({ projectId: project.id, sessionId: session.id, limit: 2000 });
        const findings = store.listFindings({ projectId: project.id, sessionId: session.id, status: ['open'] });
        return {
          session,
          eventCount: events.length,
          failures: events.filter((e) => e.status === 'failed').length,
          findings: findings.length,
          critical: findings.filter((f) => f.severity === 'critical').length,
        };
      }),
    );
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Sessions</h1>
        <p className="text-sm text-ink-faint">Each development session, replayable as a chronological record.</p>
      </div>

      {rows.length === 0 ? (
        <Card><Empty>No sessions recorded yet.</Empty></Card>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-surface-border text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Session</th>
                <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                <th scope="col" className="px-4 py-2 font-medium">Started</th>
                <th scope="col" className="px-4 py-2 font-medium">State</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Events</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Failures</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Findings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map(({ session, eventCount, failures, findings, critical }) => (
                <tr key={session.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2">
                    <Link href={`/sessions/${session.id}`} className="mono text-cecc underline-offset-2 hover:underline">
                      {session.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink-muted">
                    {session.agentId ?? '—'}
                    {session.permissionMode && /bypass|dangerous/i.test(session.permissionMode) && (
                      <span className="ml-2 rounded border border-sev-critical/40 bg-sev-critical/10 px-1 text-[10px] text-sev-critical">
                        {session.permissionMode}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-faint">{relativeTime(session.startedAt)}</td>
                  <td className="px-4 py-2">
                    {session.endedAt ? <span className="text-ink-faint">ended</span> : <span className="text-ok">active</span>}
                  </td>
                  <td className="mono px-4 py-2 text-right text-ink-muted">{eventCount}</td>
                  <td className={`mono px-4 py-2 text-right ${failures > 0 ? 'text-sev-critical' : 'text-ink-faint'}`}>{failures}</td>
                  <td className={`mono px-4 py-2 text-right ${critical > 0 ? 'text-sev-critical' : findings > 0 ? 'text-sev-medium' : 'text-ink-faint'}`}>
                    {findings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
