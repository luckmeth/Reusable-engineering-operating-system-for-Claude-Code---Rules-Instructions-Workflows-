'use client';

import { useReducedMotion } from 'framer-motion';
import { STATUS, type StatusKind } from '@/lib/design';

/**
 * The visual status language.
 *
 * One implementation, so a state means the same thing on every screen. The old
 * interface spelled out its own badge markup in six places and they had drifted
 * apart — "blocked" was red in one and amber in another, which quietly taught
 * people that colour here does not mean anything.
 */

export function StatusDot({ status, className = '' }: { status: StatusKind; className?: string }) {
  const reduced = useReducedMotion();
  const style = STATUS[status];
  const alive = style.pulse && !reduced;

  return (
    <span className={`relative flex h-2 w-2 shrink-0 ${className}`}>
      {alive && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${style.dot}`}
          style={{ animationDuration: '2s' }}
          aria-hidden
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
    </span>
  );
}

export function StatusPill({
  status,
  label,
  className = '',
}: {
  status: StatusKind;
  /** Overrides the default word when the context has a better one. */
  label?: string;
  className?: string;
}) {
  const style = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.chip} ${className}`}
    >
      <StatusDot status={status} />
      {label ?? style.label}
    </span>
  );
}

/**
 * The "something is happening right now" indicator.
 *
 * Only ever driven by real connection state. A live dot that pulses while
 * nothing is connected is the single fastest way to stop being believed.
 */
export function LiveIndicator({ live, label }: { live: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
      <StatusDot status={live ? 'active' : 'idle'} />
      {label ?? (live ? 'Live' : 'Not connected')}
    </span>
  );
}
