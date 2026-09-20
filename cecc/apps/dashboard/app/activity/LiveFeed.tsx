'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CeccEvent } from '@cecc/core';
import { EVENT_GROUPS, clockTime } from '@/lib/format';

/**
 * Live activity feed.
 *
 * Seeded server-side with recent history and extended over SSE, so the view is
 * useful the instant it loads rather than empty until something happens.
 */
export function LiveFeed({ initial }: { initial: CeccEvent[] }) {
  const [events, setEvents] = useState<CeccEvent[]>(initial);
  const [connected, setConnected] = useState(false);
  const [group, setGroup] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const since = initial.length > 0 ? Math.max(...initial.map((e) => e.seq)) : 0;
    const source = new EventSource(`/api/stream?since=${since}`);

    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('events', (message) => {
      // Pausing freezes the view for reading; the stream keeps running so
      // nothing is missed, it simply arrives when the reader resumes.
      if (pausedRef.current) return;
      try {
        const incoming = JSON.parse((message as MessageEvent).data) as CeccEvent[];
        setEvents((current) => [...current, ...incoming].slice(-800));
      } catch {
        // A malformed frame should not take down the feed.
      }
    });
    source.onerror = () => setConnected(false);

    return () => source.close();
  }, [initial]);

  const filtered = useMemo(() => {
    const types = EVENT_GROUPS[group] ?? [];
    const needle = query.trim().toLowerCase();
    return events
      .filter((e) => types.length === 0 || types.includes(e.type))
      .filter((e) => {
        if (!needle) return true;
        if (needle === 'error' || needle === 'failed') return e.status === 'failed';
        return (
          e.type.toLowerCase().includes(needle) ||
          (e.command ?? '').toLowerCase().includes(needle) ||
          e.filePaths.some((p) => p.toLowerCase().includes(needle)) ||
          e.findingRuleIds.some((r) => r.toLowerCase().includes(needle))
        );
      })
      .slice()
      .reverse();
  }, [events, group, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
            connected ? 'border-ok/40 bg-ok/10 text-ok' : 'border-sev-medium/40 bg-sev-medium/10 text-sev-medium'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-ok' : 'bg-sev-medium'}`} />
          {connected ? 'live' : 'reconnecting'}
        </span>

        <div className="flex flex-wrap gap-1">
          {Object.keys(EVENT_GROUPS).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setGroup(name)}
              aria-pressed={group === name}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                group === name
                  ? 'border-cecc/40 bg-cecc/10 text-cecc'
                  : 'border-surface-border text-ink-muted hover:bg-surface-hover hover:text-ink'
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        <label className="flex-1 min-w-[180px]">
          <span className="sr-only">Filter events</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by file, command, rule, or 'error'"
            className="mono w-full rounded border border-surface-border bg-surface px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-cecc/50 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="rounded border border-surface-border px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="card divide-y divide-surface-border">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint">No events match this filter.</p>
        ) : (
          filtered.map((event) => <EventRow key={event.id} event={event} />)
        )}
      </div>

      <p className="text-[11px] text-ink-faint">
        Showing {filtered.length} of {events.length} buffered events. CECC observes tool activity, commands, file
        changes and validation results — never the agent&apos;s private reasoning.
      </p>
    </div>
  );
}

function EventRow({ event }: { event: CeccEvent }) {
  const failed = event.status === 'failed';
  const blocked = event.status === 'blocked';
  const detail = event.command ?? event.filePaths.join(', ') ?? event.tool ?? '';

  return (
    <div className={`px-3 py-1.5 ${failed ? 'bg-sev-critical/5' : blocked ? 'bg-sev-critical/10' : ''}`}>
      <div className="mono flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
        <span className="text-ink-faint">{clockTime(event.timestamp)}</span>
        <span className={failed ? 'text-sev-critical' : blocked ? 'text-sev-critical' : 'text-ink-faint'}>
          {failed ? '✕' : blocked ? '⊘' : '·'}
        </span>
        <span className={`w-14 shrink-0 ${event.source === 'agent' ? 'text-agent' : event.source === 'user' ? 'text-cecc' : 'text-ink-faint'}`}>
          {event.source}
        </span>
        <span className="w-40 shrink-0 truncate text-ink-muted">{event.type}</span>
        <span className="min-w-0 flex-1 truncate text-ink-faint" title={detail}>{detail}</span>
      </div>
      {event.findingRuleIds.length > 0 && (
        <div className="mono mt-0.5 pl-[3.2rem] text-[11px] text-sev-critical">
          └─ {event.findingRuleIds.join(', ')}
        </div>
      )}
    </div>
  );
}
