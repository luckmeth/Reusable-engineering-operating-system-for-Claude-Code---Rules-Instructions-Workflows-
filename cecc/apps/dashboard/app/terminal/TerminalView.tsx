'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon as XFitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type Status = 'connecting' | 'idle' | 'running' | 'exited' | 'error';

interface Incoming {
  t: 'o' | 'x' | 'e' | 'running' | 'idle' | 'reset';
  d?: string;
  m?: string;
  code?: number;
}

/** Matches the dashboard palette so the terminal reads as part of the app. */
const THEME = {
  background: '#0b0d10',
  foreground: '#e8eaed',
  cursor: '#4dd0e1',
  cursorAccent: '#0b0d10',
  selectionBackground: '#4dd0e155',
  black: '#13161b',
  red: '#f4436c',
  green: '#3ecf8e',
  yellow: '#f5c451',
  blue: '#5aa9e6',
  magenta: '#c07cf0',
  cyan: '#4dd0e1',
  white: '#e8eaed',
  brightBlack: '#6b7280',
  brightRed: '#ff6b8b',
  brightGreen: '#5fe0a8',
  brightYellow: '#ffd77a',
  brightBlue: '#7cc0f0',
  brightMagenta: '#d49bf7',
  brightCyan: '#7fe3ee',
  brightWhite: '#ffffff',
};

/**
 * Claude Code, attached to a pseudo-terminal in the Electron main process.
 *
 * The socket carries keystrokes and a terminal size in one direction and
 * output in the other. It cannot name a program to run: what starts is decided
 * by the main process from the project the user opened. See
 * apps/desktop/electron/terminal.cjs for why that boundary is where it is.
 *
 * The session outlives this component. Reloading the page reattaches and
 * replays the scrollback rather than killing a running agent.
 */
export function TerminalView({ port, token }: { port: number; token: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);

  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState<string | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const start = useCallback(() => {
    const term = termRef.current;
    send({ t: 'start', cols: term?.cols ?? 100, rows: term?.rows ?? 30 });
  }, [send]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;

    // xterm reaches for `document` as it initialises, so it is loaded here
    // rather than imported at module scope where Next would evaluate it on
    // the server.
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        theme: THEME,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.25,
        cursorBlink: true,
        scrollback: 10_000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
      socketRef.current = ws;

      ws.onopen = () => send({ t: 'r', c: term.cols, r: term.rows });

      ws.onmessage = (event) => {
        let msg: Incoming;
        try {
          msg = JSON.parse(String(event.data)) as Incoming;
        } catch {
          return;
        }

        switch (msg.t) {
          case 'o':
            if (msg.d) term.write(msg.d);
            break;
          case 'running':
            setStatus('running');
            setMessage(null);
            break;
          case 'idle':
            setStatus('idle');
            // Reaching this tab is the request; making the person press a
            // second button to get a prompt would be ceremony.
            send({ t: 'start', cols: term.cols, rows: term.rows });
            break;
          case 'reset':
            term.clear();
            setStatus('idle');
            setMessage(null);
            break;
          case 'x':
            setStatus('exited');
            setMessage(msg.code === 0 ? 'Claude Code exited.' : `Claude Code exited with code ${msg.code}.`);
            break;
          case 'e':
            setStatus('error');
            setMessage(msg.m ?? 'The terminal reported an error.');
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('error');
        setMessage('Lost the connection to the terminal. Reopen this tab to reconnect.');
      };

      term.onData((data) => send({ t: 'i', d: data }));

      observer = new ResizeObserver(() => {
        try {
          fit.fit();
          send({ t: 'r', c: term.cols, r: term.rows });
        } catch {
          // A fit during teardown is not worth reporting.
        }
      });
      observer.observe(hostRef.current);
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      socketRef.current?.close();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [port, token, send]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={status} />
        {message && (
          <p role="status" className="text-[13px] text-ink-muted">
            {message}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(status === 'exited' || status === 'error') && (
            <button
              type="button"
              onClick={start}
              className="rounded-md border border-surface-border bg-surface-raised px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-surface-hover"
            >
              Start again
            </button>
          )}
          {status === 'running' && (
            <button
              type="button"
              onClick={() => send({ t: 'stop' })}
              className="rounded-md border border-surface-border px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              End session
            </button>
          )}
        </div>
      </div>

      <div
        ref={hostRef}
        aria-label="Claude Code terminal"
        className="h-[calc(100vh-17rem)] min-h-[320px] overflow-hidden rounded-lg border border-surface-border bg-surface p-2"
      />

      <p className="text-[11px] leading-relaxed text-ink-faint">
        This session runs in the project CECC is watching, so its hooks record it exactly like a session started from
        your own terminal. Closing this tab does not end it — the session keeps running until it exits or you end it.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const style: Record<Status, { label: string; className: string }> = {
    connecting: { label: 'Connecting', className: 'border-surface-border text-ink-faint' },
    idle: { label: 'Starting', className: 'border-surface-border text-ink-muted' },
    running: { label: 'Running', className: 'border-ok/40 bg-ok/10 text-ok' },
    exited: { label: 'Exited', className: 'border-surface-border text-ink-muted' },
    error: { label: 'Problem', className: 'border-sev-high/40 bg-sev-high/10 text-sev-high' },
  };
  const { label, className } = style[status];

  return (
    <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}
