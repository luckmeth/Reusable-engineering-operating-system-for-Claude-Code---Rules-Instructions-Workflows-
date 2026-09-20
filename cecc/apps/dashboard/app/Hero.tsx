import type { ReactNode } from 'react';

/**
 * The headline answer.
 *
 * Replaces a red "NOT READY" label and a list of rule identifiers with a
 * sentence a founder or designer can act on. The status is still exact — it is
 * computed from the same gates — but it is stated as a conclusion rather than
 * as a category.
 */
export function StatusHero({
  ready,
  criticalCount,
  highCount,
  blockerCount,
  projectName,
  environment,
}: {
  ready: boolean;
  criticalCount: number;
  highCount: number;
  blockerCount: number;
  projectName: string;
  environment: string;
}) {
  const headline = ready
    ? 'This looks ready to ship'
    : criticalCount > 0
      ? 'Do not ship this yet'
      : 'Not ready yet, but nothing alarming';

  const sub = ready
    ? 'Every check CECC can make has passed on the evidence it recorded.'
    : criticalCount > 0
      ? `${criticalCount} serious problem${criticalCount === 1 ? '' : 's'} could affect customers or their data.`
      : `${blockerCount} thing${blockerCount === 1 ? '' : 's'} still need${blockerCount === 1 ? 's' : ''} doing before this is safe to release.`;

  // Written out rather than interpolated: Tailwind only emits classes it can
  // see in the source, so a constructed class name silently produces no style.
  const toneClasses = ready
    ? { border: 'border-l-ok', text: 'text-ok' }
    : criticalCount > 0
      ? { border: 'border-l-sev-critical', text: 'text-sev-critical' }
      : { border: 'border-l-sev-medium', text: 'text-sev-medium' };

  return (
    <section className={`card animate-rise relative overflow-hidden border-l-4 px-6 py-5 ${toneClasses.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-ink-faint">
            {projectName}
            {environment === 'production' && <span className="ml-2 text-sev-critical">· production</span>}
          </p>
          <h1 className={`mt-1 text-2xl font-bold tracking-tight ${toneClasses.text}`}>{headline}</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-muted">{sub}</p>
        </div>

        <div className="flex gap-3">
          <Stat label="Serious" value={criticalCount} tone={criticalCount > 0 ? 'text-sev-critical' : 'text-ink-faint'} />
          <Stat label="Worth fixing" value={highCount} tone={highCount > 0 ? 'text-sev-high' : 'text-ink-faint'} />
          <Stat label="Blocking release" value={blockerCount} tone={blockerCount > 0 ? 'text-sev-medium' : 'text-ok'} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="text-right">
      <p className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

/**
 * A short narrative of the current state.
 *
 * Written as sentences rather than a table because the audience for this block
 * is the person who does not yet know which numbers matter.
 */
export function PlainSummary({
  criticalCount,
  highCount,
  topHeadline,
  gateQuestions,
  testsRun,
  chainOk,
}: {
  criticalCount: number;
  highCount: number;
  topHeadline: string | null;
  gateQuestions: Array<{ question: string; answer: string; state: string }>;
  testsRun: boolean;
  chainOk: boolean;
}) {
  const lines: ReactNode[] = [];

  if (topHeadline) {
    lines.push(
      <>The most important thing right now: <strong className="text-ink">{topHeadline.toLowerCase()}</strong>.</>,
    );
  }
  if (criticalCount + highCount === 0) {
    lines.push(<>Nothing serious is currently flagged.</>);
  }
  if (!testsRun) {
    lines.push(
      <>No tests have been run, so nobody has confirmed this works. That is different from tests failing — it means nothing has checked.</>,
    );
  }
  if (!chainOk) {
    lines.push(
      <span className="text-sev-critical">The activity record has been altered since it was written, so anything reported after that point may be incomplete.</span>,
    );
  }

  if (lines.length === 0) return null;

  return (
    <section className="card animate-rise px-5 py-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">In plain terms</h2>
      <div className="space-y-1.5 text-sm leading-relaxed text-ink-muted">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      {gateQuestions.length > 0 && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-surface-border pt-3 sm:grid-cols-2">
          {gateQuestions.map((gate, i) => (
            <div key={i}>
              <dt className="text-[12px] font-medium text-ink">{gate.question}</dt>
              <dd className={`text-[12px] ${gate.state === 'fail' ? 'text-sev-critical' : 'text-sev-medium'}`}>{gate.answer}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
