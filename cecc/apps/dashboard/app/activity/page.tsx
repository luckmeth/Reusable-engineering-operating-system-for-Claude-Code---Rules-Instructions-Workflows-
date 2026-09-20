import { LiveFeed } from './LiveFeed';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import type { CeccEvent } from '@cecc/core';

export const dynamic = 'force-dynamic';

export default function ActivityPage() {
  let initial: CeccEvent[];
  try {
    // Seeded from history so the feed is useful immediately rather than blank.
    initial = withStore(({ store, project }) =>
      store.queryEvents({ projectId: project.id, limit: 200 }).reverse(),
    );
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Live activity</h1>
        <p className="text-sm text-ink-faint">Every observed engineering event, as it happens.</p>
      </div>
      <LiveFeed initial={initial} />
    </div>
  );
}
