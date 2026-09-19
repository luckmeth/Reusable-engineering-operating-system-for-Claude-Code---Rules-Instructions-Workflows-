import type { Finding } from '@cecc/core';
import { LayerBadge, SeverityBadge, VerificationBadge } from './ui';
import { relativeTime } from '@/lib/format';

/**
 * The finding is the unit of the product.
 *
 * Everything a reader needs to judge it is present without a second click:
 * what was detected, how strongly CECC stands behind it, the evidence, the
 * concrete consequence, and the fix. A finding without evidence is an opinion,
 * so the evidence block is not collapsible.
 */
export function FindingCard({ finding, defaultOpen = false }: { finding: Finding; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="card group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-surface-hover">
        <SeverityBadge severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-ink">{finding.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
            <span className="mono">{finding.ruleId}</span>
            <LayerBadge layer={finding.layer} />
            <VerificationBadge state={finding.verification} confidence={finding.confidence} />
            <span>{finding.detection.toLowerCase().replace(/_/g, ' ')}</span>
            {finding.occurrences > 1 && <span>seen {finding.occurrences}×</span>}
            <span>{relativeTime(finding.lastDetectedAt)}</span>
          </div>
        </div>
        <span className="mt-1 shrink-0 text-ink-faint transition-transform group-open:rotate-90" aria-hidden>›</span>
      </summary>

      <div className="space-y-4 border-t border-surface-border px-4 py-4 text-sm">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Why it matters</h3>
          <p className="leading-relaxed text-ink-muted">{finding.impact}</p>
        </div>

        {finding.evidence.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Evidence</h3>
            <ul className="space-y-1.5">
              {finding.evidence.map((ev, i) => (
                <li key={i} className="rounded border border-surface-border bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[11px] font-medium text-ink-muted">{ev.label}</span>
                    {ev.file && (
                      <span className="mono text-[11px] text-ink-faint">
                        {ev.file}
                        {ev.line ? `:${ev.line}` : ''}
                      </span>
                    )}
                  </div>
                  <pre className="mono mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-muted">
                    {ev.detail}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        )}

        {finding.affectedFiles.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Affected</h3>
            <ul className="mono space-y-0.5 text-[12px] text-ink-muted">
              {finding.affectedLines.length > 0
                ? finding.affectedLines.slice(0, 8).map((loc, i) => <li key={i}>{loc.file}:{loc.line}</li>)
                : finding.affectedFiles.slice(0, 8).map((file, i) => <li key={i}>{file}</li>)}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Fix</h3>
          <p className="leading-relaxed text-ink-muted">{finding.recommendation}</p>
        </div>

        {finding.relatedEvents.length > 1 && (
          <p className="text-[11px] text-ink-faint">
            Correlated across {finding.relatedEvents.length} events.{' '}
            {finding.sessionId && (
              <a className="underline hover:text-ink" href={`/sessions/${finding.sessionId}`}>
                Replay the session
              </a>
            )}
          </p>
        )}
      </div>
    </details>
  );
}
