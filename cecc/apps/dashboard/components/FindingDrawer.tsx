'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Finding } from '@cecc/core';
import { TRANSITION, Z } from '@/lib/design';

/**
 * A finding, opened in place.
 *
 * Clicking a finding used to mean leaving the page, which is the wrong trade
 * when the thing you were looking at is the context that made the finding make
 * sense. The drawer keeps the list behind it and can be dismissed without
 * losing your position in it.
 *
 * Focus is trapped while it is open and returned to whatever opened it on
 * close, because a drawer a keyboard user can tab out of but not back into is
 * worse than a page navigation.
 */
export function FindingDrawer({ finding, onClose }: { finding: Finding | null; onClose: () => void }) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!finding) return undefined;

    returnFocusTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusTo.current?.focus?.();
    };
  }, [finding, onClose]);

  return (
    <AnimatePresence>
      {finding && (
        <>
          <motion.div
            className={`fixed inset-0 ${Z.drawer} bg-black/50`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION.fast}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={finding.title}
            tabIndex={-1}
            className={`fixed inset-y-0 right-0 ${Z.drawer} flex w-full max-w-lg flex-col border-l border-surface-border bg-surface-raised shadow-2xl shadow-black/60 outline-none`}
            initial={{ x: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }}
            transition={reduced ? TRANSITION.fast : TRANSITION.slow}
          >
            <header className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
              <span className={`sev-${finding.severity} mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase`}>
                {finding.severity}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="t-title">{finding.title}</h2>
                <p className="t-meta mono mt-1">
                  {finding.ruleId} · {finding.layer} · {Math.round((finding.confidence ?? 0) * 100)}% confidence ·{' '}
                  {finding.verification}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="focusable -mr-1 rounded p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <Section title="Why this matters">
                <p className="t-body text-ink-muted">{finding.impact}</p>
              </Section>

              {finding.affectedFiles.length > 0 && (
                <Section title="Where">
                  <ul className="space-y-1">
                    {finding.affectedFiles.map((file) => (
                      <li key={file} className="mono truncate text-[12px] text-ink-muted" title={file}>
                        {file}
                      </li>
                    ))}
                  </ul>
                  {finding.affectedLines.length > 0 && (
                    <p className="t-meta mono mt-1.5">
                      {finding.affectedLines
                        .slice(0, 8)
                        .map((l) => `${l.file}:${l.line}`)
                        .join('  ')}
                      {finding.affectedLines.length > 8 && `  +${finding.affectedLines.length - 8} more`}
                    </p>
                  )}
                </Section>
              )}

              {finding.evidence.length > 0 && (
                <Section title="Evidence">
                  <ul className="space-y-2">
                    {finding.evidence.map((e, i) => (
                      <li key={i} className="rounded border border-surface-border bg-surface px-3 py-2">
                        <p className="t-micro">{e.label}</p>
                        <p className="mono mt-1 break-words text-[11px] leading-relaxed text-ink-muted">{e.detail}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Recommended fix">
                <p className="t-body text-ink-muted">{finding.recommendation}</p>
              </Section>

              <Section title="History">
                <dl className="space-y-1 text-[12px]">
                  <Row label="Status" value={finding.status} />
                  <Row label="First detected" value={new Date(finding.firstDetectedAt).toLocaleString()} />
                  <Row label="Last detected" value={new Date(finding.lastDetectedAt).toLocaleString()} />
                  <Row label="Occurrences" value={String(finding.occurrences)} />
                  <Row label="Detected by" value={finding.detection} />
                </dl>
              </Section>
            </div>

            <footer className="border-t border-surface-border px-5 py-3">
              <p className="t-meta leading-relaxed">
                CECC found this by matching a rule against observed content. It is evidence that a pattern is present,
                not proof that it is exploitable — and no finding is not proof that nothing is.
              </p>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="t-micro mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate text-ink-muted">{value}</dd>
    </div>
  );
}
