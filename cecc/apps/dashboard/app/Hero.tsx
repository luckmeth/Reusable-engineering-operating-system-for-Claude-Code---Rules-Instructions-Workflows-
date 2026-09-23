import type { ReactNode } from 'react';

/**
 * The headline answer.
 *
 * Replaces a red "NOT READY" label and a list of rule identifiers with a
 * sentence a founder or designer can act on. The status is still exact — it is
 * computed from the same gates — but it is stated as a conclusion rather than
 * as a category.
 */
/**
 * What the dashboard shows before it has watched anything.
 *
 * Every panel here is evidence-driven, so on a fresh project they are all
 * correctly empty — and a screen of empty panels reads as "this software does
 * nothing" rather than "this software has not been given anything yet". The
 * first run is the moment the tool is judged, and it was the moment with the
 * least information on screen.
 *
 * Deliberately not styled as a warning. Nothing is wrong; the work simply has
 * not happened yet.
 */
export function FirstRun({
  projectName,
  hasTerminal,
  scanned,
}: {
  projectName: string;
  /** The embedded terminal exists only in the desktop application. */
  hasTerminal: boolean;
  /** Whether a scan has produced findings, which needs no agent session. */
  scanned: boolean;
}) {
  return (
    <section className="card animate-rise border-l-4 border-l-cecc px-6 py-5">
      <p className="text-[11px] uppercase tracking-wider text-ink-faint">{projectName}</p>
      <h1 className="mt-1 text-xl font-semibold">Nothing has been watched here yet</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        CECC reports what it actually saw. It has not seen a coding session in this project, so the panels below are
        empty — that is an absence of evidence, not a clean bill of health.
      </p>

      <ol className="mt-5 space-y-3">
        <Step
          n={1}
          done={scanned}
          title="Scan the code as it stands"
          body="Runs the detection rules over every tracked file. No agent session needed — this works right now."
        />
        <Step
          n={2}
          done={false}
          title={hasTerminal ? 'Open the Claude Code tab and work normally' : 'Run Claude Code in this project'}
          body={
            hasTerminal
              ? 'A session started there runs inside this project with its hooks registered, so everything it does lands on these pages as it happens.'
              : 'Hooks are registered in .claude/settings.json. Any session you start in this folder is recorded; a session started elsewhere is not.'
          }
        />
        <Step
          n={3}
          done={false}
          title="Come back and read what it did"
          body="Live activity shows it as it happens. History replays a finished session step by step. What needs fixing collects the problems worth acting on."
        />
      </ol>

      <p className="mt-5 text-xs text-ink-faint">
        The scan is the ordinary half — plenty of tools do that. Watching the session is the half that catches a test
        being weakened until it passes.
      </p>
    </section>
  );
}

function Step({ n, done, title, body }: { n: number; done: boolean; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold ${
          done ? 'border-ok/40 bg-ok/10 text-ok' : 'border-surface-border text-ink-faint'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{body}</p>
      </div>
    </li>
  );
}

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
