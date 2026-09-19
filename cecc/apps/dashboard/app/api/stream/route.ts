import { ceccPaths, Store, loadProjectConfig } from '@cecc/core';
import { resolveRoot } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Poll interval while events are arriving. */
const ACTIVE_MS = 700;
/** Ceiling the interval backs off to when nothing is happening. */
const IDLE_MAX_MS = 6000;

/**
 * Server-sent events for the live activity view.
 *
 * Polling the local database on an interval rather than pushing from the
 * writer: hook processes are short-lived and independent, so there is nothing
 * for them to push to. Querying by `seq > lastSeen` against an indexed column
 * makes each poll cheap enough that the simplicity is worth it.
 *
 * SSE rather than WebSockets because the traffic is one-directional and SSE
 * reconnects on its own.
 */
export async function GET(request: Request): Promise<Response> {
  const root = resolveRoot();
  const project = loadProjectConfig(root);
  if (!project) {
    return new Response('CECC not initialized', { status: 404 });
  }

  const url = new URL(request.url);
  const startSeq = Number(url.searchParams.get('since') ?? 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastSeq = Number.isFinite(startSeq) ? startSeq : 0;
      let closed = false;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const poll = (): boolean => {
        if (closed) return false;
        // A fresh handle per poll keeps this from holding a stale snapshot
        // while hook processes append.
        let store: Store | null = null;
        try {
          store = new Store(ceccPaths(root).db);
          const events = store.queryEvents({ projectId: project.id, sinceSeq: lastSeq, limit: 100 }).reverse();
          if (events.length > 0) {
            lastSeq = Math.max(...events.map((e) => e.seq));
            send('events', events);
            return true;
          }
          return false;
        } catch (err) {
          send('error', { message: err instanceof Error ? err.message : 'poll failed' });
          return false;
        } finally {
          store?.close();
        }
      };

      send('ready', { projectId: project.id, since: lastSeq });

      // Adaptive interval. A fixed one-second poll opened and closed a SQLite
      // handle 3,600 times an hour on an idle project, which is most hours.
      // Activity pulls the interval back down to ACTIVE_MS on the first event,
      // so the live feed still feels immediate while work is happening.
      let timer: ReturnType<typeof setTimeout> | null = null;
      let delay = ACTIVE_MS;

      const tick = (): void => {
        if (closed) return;
        const sawEvents = poll();
        delay = sawEvents ? ACTIVE_MS : Math.min(IDLE_MAX_MS, Math.round(delay * 1.6));
        timer = setTimeout(tick, delay);
      };
      timer = setTimeout(tick, delay);
      // A comment frame keeps proxies from closing an idle connection.
      const keepalive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            closed = true;
          }
        }
      }, 25_000);

      const stop = (): void => {
        closed = true;
        if (timer) clearTimeout(timer);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      };

      request.signal.addEventListener('abort', stop);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
