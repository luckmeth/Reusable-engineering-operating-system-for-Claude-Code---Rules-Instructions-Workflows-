'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  FileCode2,
  Gauge,
  ShieldAlert,
  Terminal as TerminalIcon,
} from 'lucide-react';
import type { CeccEvent, Finding } from '@cecc/core';
import { FindingDrawer } from '@/components/FindingDrawer';
import { LiveFeed } from '@/app/activity/LiveFeed';
import { StatusPill } from '@/components/Status';
import { WorkflowRail } from '@/components/WorkflowRail';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion';
import type { StatusKind } from '@/lib/design';

/**
 * The command center.
 *
 * Laid out to answer, top to bottom, the questions someone actually arrives
 * with: what is happening, how far through are we, what is it doing right now,
 * and what should I look at. The old page answered them in the order the data
 * happened to load.
 *
 * Client component because the finding drawer, the live feed and the terminal
 * all hold state. The data still comes from the server; nothing here fetches.
 */

export interface CommandCenterProps {
  projectName: string;
  branch: string | null;
  environment: string;
  agentStatus: StatusKind;
  currentTask: string | null;
  stages: readonly string[];
  currentStage: string | null;
  blockedStages: Record<string, string>;
  findings: Finding[];
  events: CeccEvent[];
  /** Already formatted upstream: the client has no business owning units. */
  tokens: { observed: string; avoidable: string; hasAvoidable: boolean };
  policy: { total: number; observe: number; warn: number; block: number; checksum: string };
  readiness: { ready: boolean; blockers: Array<{ id: string; label: string; detail: string }> };
  agentObserved: boolean;
  sessionCount: number;
  eventCount: number;
  filesTouched: string[];
  lastAction: { label: string; detail: string } | null;
  terminal: { port: number; token: string } | null;
  terminalSlot: React.ReactNode;
}

export function CommandCenter(props: CommandCenterProps) {
  const [openFinding, setOpenFinding] = useState<Finding | null>(null);

  const { critical, high, rest } = useMemo(() => {
    const c = props.findings.filter((f) => f.severity === 'critical');
    const h = props.findings.filter((f) => f.severity === 'high');
    return { critical: c, high: h, rest: props.findings.filter((f) => !c.includes(f) && !h.includes(f)) };
  }, [props.findings]);

  const attention = [...critical, ...high, ...rest].slice(0, 5);

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------- header */}
      <FadeIn>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="t-display truncate">{props.projectName}</h1>
              <StatusPill
                status={props.agentStatus}
                label={props.agentStatus === 'active' ? 'Claude active' : 'Idle'}
              />
              {props.branch && (
                <span className="mono rounded border border-surface-border px-1.5 py-0.5 text-[11px] text-ink-faint">
                  {props.branch}
                </span>
              )}
            </div>
            <p className="t-body mt-1 text-ink-muted">
              {props.currentTask ?? (props.agentObserved ? 'No task stated for this session.' : 'Nothing watched here yet.')}
            </p>
          </div>

          <Verdict
            ready={props.readiness.ready}
            critical={critical.length}
            blockers={props.readiness.blockers.length}
            observed={props.agentObserved}
          />
        </div>
      </FadeIn>

      {/* -------------------------------------------------------- workflow */}
      <FadeIn delay={0.04}>
        <section className="rounded-xl border border-surface-border bg-surface-raised px-5 py-4">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="t-section">Workflow</h2>
            <Link href="/workflow" className="t-meta transition-colors hover:text-cecc">
              Detail <ArrowRight className="inline h-3 w-3" aria-hidden />
            </Link>
          </div>
          <WorkflowRail
            stages={props.stages}
            currentStage={props.currentStage}
            blocked={props.blockedStages}
          />
        </section>
      </FadeIn>

      {/* ------------------------------------------------------ live region */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <FadeIn delay={0.08} className="min-w-0">
          <section className="flex h-full flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
            <header className="flex items-center gap-2 border-b border-surface-border px-4 py-2.5">
              <TerminalIcon className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
              <h2 className="t-panel">Claude Code</h2>
              <span className="t-meta ml-auto">runs in this project, with its hooks</span>
            </header>
            <div className="min-h-0 flex-1 p-3">{props.terminalSlot}</div>
          </section>
        </FadeIn>

        <FadeIn delay={0.12} className="min-w-0">
          <div className="flex h-full flex-col gap-4">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
              <header className="flex items-center gap-2 border-b border-surface-border px-4 py-2.5">
                <Bot className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
                <h2 className="t-panel">Live activity</h2>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <LiveFeed initial={props.events} />
              </div>
            </section>

            <CurrentState
              filesTouched={props.filesTouched}
              lastAction={props.lastAction}
              contextLabel={props.tokens.observed}
              critical={critical.length}
              high={high.length}
              blockers={props.readiness.blockers}
            />
          </div>
        </FadeIn>
      </div>

      {/* --------------------------------------------------- what to fix */}
      <FadeIn delay={0.16}>
        <section className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          <header className="flex items-center gap-2 border-b border-surface-border px-4 py-2.5">
            <ShieldAlert className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
            <h2 className="t-panel">What needs attention</h2>
            {props.findings.length > 0 && (
              <Link href="/findings" className="t-meta ml-auto transition-colors hover:text-cecc">
                All {props.findings.length} <ArrowRight className="inline h-3 w-3" aria-hidden />
              </Link>
            )}
          </header>

          {attention.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="t-body text-ink-muted">No rule matched the observed changes.</p>
              <p className="t-meta mx-auto mt-1 max-w-md leading-relaxed">
                That is not a clean bill of health. It means nothing fired — including the rules that never ran because
                the code they cover was never touched.
              </p>
            </div>
          ) : (
            <Stagger className="divide-y divide-surface-border">
              {attention.map((finding) => (
                <StaggerItem key={finding.id}>
                  <button
                    type="button"
                    onClick={() => setOpenFinding(finding)}
                    className="focusable flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                  >
                    <span
                      className={`sev-${finding.severity} mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase`}
                    >
                      {finding.severity}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{finding.title}</span>
                      <span className="mono mt-0.5 block truncate text-[11px] text-ink-faint">
                        {finding.affectedLines[0]
                          ? `${finding.affectedLines[0].file}:${finding.affectedLines[0].line}`
                          : (finding.affectedFiles[0] ?? 'no file')}{' '}
                        · {finding.ruleId}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
                  </button>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </section>
      </FadeIn>

      {/* ------------------------------------------------------- footer row */}
      <FadeIn delay={0.2}>
        <div className="grid gap-4 md:grid-cols-2">
          <SmallPanel
            icon={Gauge}
            title="Context spend"
            href="/sessions"
            footnote="Estimated from observed content at ~4 characters per token. Claude Code reports no usage figures, so this is not a billed number. “Avoidable” is content that entered context twice with nothing changing in between — it is not a saving, because nothing was prevented."
          >
            <div className="flex gap-6">
              <Figure value={props.tokens.observed} label="observed" />
              <Figure
                value={props.tokens.avoidable}
                label="avoidable"
                tone={props.tokens.hasAvoidable ? 'text-sev-medium' : undefined}
              />
              <Figure value={props.eventCount.toLocaleString()} label="events" />
              <Figure value={String(props.sessionCount)} label="sessions" />
            </div>
          </SmallPanel>

          <SmallPanel
            icon={ShieldAlert}
            title="Rules and enforcement"
            href="/controls"
            footnote={`Policy checksum ${props.policy.checksum} — a change CECC did not make shows up here.`}
          >
            <div className="flex gap-6">
              <Figure value={String(props.policy.total)} label="rules" />
              <Figure
                value={String(props.policy.block)}
                label="blocking"
                tone={props.policy.block > 0 ? 'text-sev-critical' : undefined}
              />
              <Figure value={String(props.policy.warn)} label="warning" />
              <Figure value={String(props.policy.observe)} label="recording" />
            </div>
          </SmallPanel>
        </div>
      </FadeIn>

      <FindingDrawer finding={openFinding} onClose={() => setOpenFinding(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Verdict({
  ready,
  critical,
  blockers,
  observed,
}: {
  ready: boolean;
  critical: number;
  blockers: number;
  observed: boolean;
}) {
  // A verdict built on no agent evidence is the one claim this tool must never
  // make, so "nothing watched" is its own state rather than a quiet pass.
  const state = !observed
    ? { label: 'Not watched yet', detail: 'No agent session recorded', tone: 'border-surface-border text-ink-muted' }
    : critical > 0
      ? { label: 'Do not ship', detail: `${critical} serious ${critical === 1 ? 'problem' : 'problems'}`, tone: 'border-sev-critical/40 bg-sev-critical/10 text-sev-critical' }
      : ready
        ? { label: 'Looks ready', detail: 'Every check CECC can make has passed', tone: 'border-ok/40 bg-ok/10 text-ok' }
        : { label: 'Not ready', detail: `${blockers} ${blockers === 1 ? 'check' : 'checks'} outstanding`, tone: 'border-sev-medium/40 bg-sev-medium/10 text-sev-medium' };

  return (
    <div className={`shrink-0 rounded-lg border px-4 py-2.5 ${state.tone}`}>
      <p className="text-[15px] font-semibold leading-tight">{state.label}</p>
      <p className="mt-0.5 text-[11px] opacity-80">{state.detail}</p>
    </div>
  );
}

function CurrentState({
  filesTouched,
  lastAction,
  contextLabel,
  critical,
  high,
  blockers,
}: {
  filesTouched: string[];
  lastAction: { label: string; detail: string } | null;
  contextLabel: string;
  critical: number;
  high: number;
  blockers: Array<{ id: string; label: string; detail: string }>;
}) {
  return (
    <section className="shrink-0 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
      <h2 className="t-section mb-3">Current state</h2>

      <dl className="space-y-2.5">
        {lastAction && (
          <div>
            <dt className="t-micro">Last action</dt>
            <dd className="mono mt-0.5 truncate text-[12px] text-ink-muted" title={lastAction.detail}>
              {lastAction.label} <span className="text-ink-faint">{lastAction.detail}</span>
            </dd>
          </div>
        )}

        {filesTouched.length > 0 && (
          <div>
            <dt className="t-micro">Files touched</dt>
            <dd className="mt-1 space-y-0.5">
              {filesTouched.slice(0, 4).map((f) => (
                <p key={f} className="mono flex items-center gap-1.5 truncate text-[11px] text-ink-muted" title={f}>
                  <FileCode2 className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                  {f}
                </p>
              ))}
              {filesTouched.length > 4 && (
                <p className="t-meta">and {filesTouched.length - 4} more</p>
              )}
            </dd>
          </div>
        )}

        <div className="flex gap-5 border-t border-surface-border pt-2.5">
          <Figure value={String(critical)} label="critical" tone={critical > 0 ? 'text-sev-critical' : undefined} />
          <Figure value={String(high)} label="high" tone={high > 0 ? 'text-sev-high' : undefined} />
          <Figure value={String(blockers.length)} label="blocking" tone={blockers.length > 0 ? 'text-sev-medium' : undefined} />
          <Figure value={contextLabel} label="context" />
        </div>

        {blockers.length > 0 && (
          <ul className="space-y-1 border-t border-surface-border pt-2.5">
            {blockers.slice(0, 3).map((b) => (
              <li key={b.id} className="text-[11px] leading-relaxed text-ink-muted">
                <span className="text-sev-medium">•</span> {b.detail || b.label}
              </li>
            ))}
          </ul>
        )}
      </dl>
    </section>
  );
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div>
      <p className={`num text-[17px] font-semibold leading-none ${tone ?? 'text-ink'}`}>{value}</p>
      <p className="t-meta mt-1">{label}</p>
    </div>
  );
}

function SmallPanel({
  icon: Icon,
  title,
  href,
  footnote,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  href: string;
  footnote: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
        <h2 className="t-panel">{title}</h2>
        <Link href={href} className="t-meta ml-auto transition-colors hover:text-cecc">
          Detail <ArrowRight className="inline h-3 w-3" aria-hidden />
        </Link>
      </div>
      {children}
      <p className="t-meta mt-3 leading-relaxed">{footnote}</p>
    </section>
  );
}
