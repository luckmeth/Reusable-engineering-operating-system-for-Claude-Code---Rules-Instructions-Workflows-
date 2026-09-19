'use client';

import type { Finding } from '@cecc/core';
import type { TriageScore } from '@cecc/ml';
import { Action, ActionWithReason } from './Action';
import { useViewMode } from './ViewMode';
import { LayerBadge, SeverityBadge, VerificationBadge } from './ui';
import { confidenceWord, plainFor, themeLabel, URGENCY } from '@/lib/plain';
import { relativeTime } from '@/lib/format';
import { resolveFindingAction, suppressFindingAction } from '@/app/actions';

const THEME_ICON: Record<string, string> = {
  data: '🗄️',
  access: '🔑',
  money: '💳',
  quality: '🧪',
  process: '⚙️',
  secrets: '🔐',
  trust: '🛡️',
};

/**
 * One finding, readable two ways.
 *
 * Plain mode leads with the consequence and the two buttons that resolve it,
 * because that is the whole decision for most readers. Technical mode leads
 * with evidence and exact locations. Neither is a reduced version of the other
 * — they answer different questions.
 */
export function FindingItem({
  finding,
  triage,
  defaultOpen = false,
}: {
  finding: Finding;
  triage?: TriageScore;
  defaultOpen?: boolean;
}) {
  const { mode } = useViewMode();
  const plain = plainFor(finding.ruleId, finding.title);
  // Two findings from the same check share a headline, which makes a list read
  // as if it is repeating itself. The file, and the line where one is known,
  // separate them without losing the plain-language framing — and a line number
  // is more useful than an arbitrary tiebreaker because it is where you go.
  const primaryFile = finding.affectedFiles[0]?.split('/').pop();
  const primaryLine = finding.affectedLines[0]?.line;
  const locationLabel = primaryFile
    ? primaryLine !== undefined
      ? `${primaryFile}:${primaryLine}`
      : primaryFile
    : null;
  const headline = locationLabel ? `${plain.headline} — ${locationLabel}` : plain.headline;
  const urgency = URGENCY[finding.severity] ?? URGENCY['medium']!;

  return (
    <details open={defaultOpen} className="card lift group overflow-hidden">
      <summary className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-hover">
        {mode === 'plain' ? (
          <span className="mt-0.5 text-lg leading-none" aria-hidden>{THEME_ICON[plain.theme] ?? '•'}</span>
        ) : (
          <SeverityBadge severity={finding.severity} />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-ink">
            {mode === 'plain' ? headline : finding.title}
          </p>

          {/* Two findings can share a plain headline and a location — one line
              can hold two different problems. The specific title is what tells
              them apart, so it is kept as quiet context rather than omitted. */}
          {mode === 'plain' && (
            <p className="mt-0.5 truncate text-[11px] text-ink-faint">{finding.title}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
            {mode === 'plain' ? (
              <>
                <span className={`${finding.severity === 'critical' ? 'text-sev-critical' : finding.severity === 'high' ? 'text-sev-high' : 'text-ink-muted'} font-medium`}>
                  {urgency.word}
                </span>
                <span>·</span>
                <span>{themeLabel(plain.theme)}</span>
                <span>·</span>
                <span>{confidenceWord(finding.verification, finding.confidence)}</span>
                {triage && <><span>·</span><span className="text-cecc">#{triage.rank} to look at</span></>}
              </>
            ) : (
              <>
                <span className="mono">{finding.ruleId}</span>
                <LayerBadge layer={finding.layer} />
                <VerificationBadge state={finding.verification} confidence={finding.confidence} />
                <span>{finding.detection.toLowerCase().replace(/_/g, ' ')}</span>
                {finding.occurrences > 1 && <span>seen {finding.occurrences}×</span>}
                <span>{relativeTime(finding.lastDetectedAt)}</span>
              </>
            )}
          </div>
        </div>

        <span className="mt-1 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-90" aria-hidden>›</span>
      </summary>

      <div className="reveal space-y-4 border-t border-surface-border px-4 py-4 text-sm">
        {mode === 'plain' ? (
          <>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">What could happen</h3>
              <p className="leading-relaxed text-ink-muted">{plain.consequence}</p>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">What to do</h3>
              <p className="leading-relaxed text-ink-muted">{plain.action}</p>
            </div>
            {finding.affectedFiles.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Where</h3>
                <ul className="mono space-y-0.5 text-[12px] text-ink-muted">
                  {(finding.affectedLines.length > 0
                    ? finding.affectedLines.slice(0, 5).map((l) => `${l.file}, line ${l.line}`)
                    : finding.affectedFiles.slice(0, 5)
                  ).map((where, i) => (
                    <li key={i}>{where}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-ink-faint">
              {urgency.sentence} CECC is {Math.round(finding.confidence * 100)}% confident about this one.
            </p>
          </>
        ) : (
          <>
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
                        {ev.file && <span className="mono text-[11px] text-ink-faint">{ev.file}{ev.line ? `:${ev.line}` : ''}</span>}
                      </div>
                      <pre className="mono mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-muted">{ev.detail}</pre>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Fix</h3>
              <p className="leading-relaxed text-ink-muted">{finding.recommendation}</p>
            </div>
          </>
        )}

        {triage && (
          <p className="rounded border border-cecc/25 bg-cecc/5 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
            <span className="font-medium text-cecc">Ranked #{triage.rank} by your own history.</span> {triage.explanation}
          </p>
        )}

        {/* The two buttons that resolve this. Present in both modes — the
            whole point of the redesign is that the interface acts, not just reports. */}
        <div className="flex flex-wrap items-start gap-2 border-t border-surface-border pt-3">
          <Action run={() => resolveFindingAction(finding.id)} variant="primary">
            {mode === 'plain' ? 'I fixed this' : 'Mark resolved'}
          </Action>

          <ActionWithReason
            run={(reason, days) => suppressFindingAction(finding.id, reason, days)}
            label={mode === 'plain' ? 'Not a problem here' : 'Suppress'}
            prompt="Why is this not a problem? Your answer is recorded."
            placeholder="e.g. this file never handles customer data"
          />

          {finding.sessionId && (
            <a
              href={`/sessions/${finding.sessionId}`}
              className="press lift rounded border border-transparent px-2.5 py-1.5 text-[12px] text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              See what led to this
            </a>
          )}
        </div>
      </div>
    </details>
  );
}
