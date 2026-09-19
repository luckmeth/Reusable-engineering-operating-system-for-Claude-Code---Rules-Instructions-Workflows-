import { ceccPaths, Store, loadProjectConfig } from '@cecc/core';
import { resolveRoot } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

      const poll = (): void => {
        if (closed) return;
        // A fresh handle per poll keeps this from holding a stale snapshot
        // while hook processes append.
        let store: Store | null = null;
        try {
          store = new Store(ceccPaths(root).db);
          const events = store.queryEvents({ projectId: project.id, sinceSeq: lastSeq, limit: 100 }).reverse();
          if (events.length > 0) {
            lastSeq = Math.max(...events.map((e) => e.seq));
            send('events', events);
          }
        } catch (err) {
          send('error', { message: err instanceof Error ? err.message : 'poll failed' });
        } finally {
          store?.close();
        }
      };

      send('ready', { projectId: project.id, since: lastSeq });
      const interval = setInterval(poll, 1000);
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
        clearInterval(interval);
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
