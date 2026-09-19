'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useToast } from './Toast';

export interface ActionOutcome {
  ok: boolean;
  message: string;
  detail?: string;
}

/**
 * A button that performs a real action and reports what happened.
 *
 * Three behaviours this interface depends on:
 *  - it shows that the work is in progress, so nobody clicks twice;
 *  - it reports the outcome in place rather than in a toast that vanishes,
 *    because these actions change security posture and the confirmation is
 *    worth keeping on screen;
 *  - destructive or irreversible actions ask first.
 */
export function Action({
  run,
  children,
  variant = 'default',
  confirm,
  className = '',
  title,
}: {
  /**
   * The work to perform. From a server component this must be a server
   * action, optionally bound with `.bind(null, arg)` — an inline arrow
   * cannot cross the server/client boundary.
   */
  run: () => Promise<ActionOutcome>;
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  /** When set, the user must confirm with this question before it runs. */
  confirm?: string;
  className?: string;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { push } = useToast();

  const execute = (): void => {
    setConfirming(false);
    startTransition(async () => {
      try {
        const result = await run();
        setOutcome(result);
        // Also raised globally: resolving a finding removes it from the list,
        // which unmounts this button before the inline message can be read.
        push(result);
      } catch (err) {
        const failure = { ok: false, message: err instanceof Error ? err.message : 'Something went wrong.' };
        setOutcome(failure);
        push(failure);
      }
    });
  };

  const styles = {
    default: 'border-surface-border bg-surface-hover text-ink hover:border-ink-faint',
    primary: 'border-cecc/50 bg-cecc/15 text-cecc hover:bg-cecc/25',
    danger: 'border-sev-critical/50 bg-sev-critical/10 text-sev-critical hover:bg-sev-critical/20',
    ghost: 'border-transparent text-ink-muted hover:bg-surface-hover hover:text-ink',
  }[variant];

  if (confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 animate-rise">
        <span className="text-[12px] text-ink-muted">{confirm}</span>
        <button type="button" onClick={execute} className="press rounded border border-sev-critical/50 bg-sev-critical/15 px-2 py-1 text-[12px] font-medium text-sev-critical">
          Yes, do it
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="press rounded border border-surface-border px-2 py-1 text-[12px] text-ink-muted">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        title={title}
        disabled={pending}
        onClick={() => (confirm ? setConfirming(true) : execute())}
        className={`press lift relative overflow-hidden rounded border px-2.5 py-1.5 text-[12px] font-medium disabled:cursor-wait disabled:opacity-70 ${styles} ${className}`}
      >
        {pending && <span className="shimmer absolute inset-0" aria-hidden />}
        <span className="relative">{pending ? 'Working…' : children}</span>
      </button>

      {outcome && (
        <span
          role="status"
          className={`animate-rise max-w-md rounded border px-2 py-1.5 text-[12px] leading-snug ${
            outcome.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-sev-critical/40 bg-sev-critical/10 text-sev-critical'
          }`}
        >
          <span className="font-medium">{outcome.message}</span>
          {outcome.detail && <span className="mt-0.5 block opacity-80">{outcome.detail}</span>}
        </span>
      )}
    </span>
  );
}

/** An action that needs a short written reason before it can run. */
export function ActionWithReason({
  run,
  label,
  prompt,
  placeholder,
}: {
  run: (reason: string, days?: number) => Promise<ActionOutcome>;
  label: string;
  prompt: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<string>('');
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const { push } = useToast();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press lift rounded border border-surface-border bg-surface-hover px-2.5 py-1.5 text-[12px] font-medium text-ink hover:border-ink-faint"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="animate-rise w-full max-w-md space-y-2 rounded border border-surface-border bg-surface p-3">
      <label className="block text-[12px] text-ink-muted">
        {prompt}
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full rounded border border-surface-border bg-surface-raised px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-cecc/50 focus:outline-none"
        />
      </label>

      <label className="block text-[12px] text-ink-faint">
        Bring it back after (days, optional)
        <input
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
          placeholder="e.g. 30 — leave blank to dismiss indefinitely"
          className="mt-1 w-full rounded border border-surface-border bg-surface-raised px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-cecc/50 focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || reason.trim().length < 3}
          onClick={() =>
            startTransition(async () => {
              const result = await run(reason.trim(), days ? Number(days) : undefined);
              setOutcome(result);
              push(result);
              if (result.ok) setOpen(false);
            })
          }
          className="press rounded border border-cecc/50 bg-cecc/15 px-2.5 py-1.5 text-[12px] font-medium text-cecc disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Confirm'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="press rounded border border-surface-border px-2.5 py-1.5 text-[12px] text-ink-muted">
          Cancel
        </button>
      </div>

      {outcome && !outcome.ok && (
        <p className="animate-rise text-[12px] text-sev-critical">{outcome.message}</p>
      )}
    </div>
  );
}
