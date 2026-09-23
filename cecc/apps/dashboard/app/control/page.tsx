import { formatTokens, WORKFLOW_STAGES } from '@cecc/core';
import { NotInitialized } from '../not-initialized';
import { getControlPanel, NotInitializedError, resolveRoot } from '@/lib/server';
import { desktopShell } from '@/lib/desktop';
import { TerminalView } from '../terminal/TerminalView';
import { CommandCenter } from './CommandCenter';

export const dynamic = 'force-dynamic';

/**
 * The page the application opens on.
 *
 * Server component: it reads the store once and hands a plain object to the
 * client shell. The terminal is passed down as a slot rather than a flag so
 * this file stays the only place that knows whether a terminal exists at all.
 */
export default function ControlPage() {
  let data;
  try {
    data = getControlPanel();
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { project, findings, events, readiness, tokens, policy, run, agentObserved, sessionCount, eventCount, session } =
    data;
  const { terminal } = desktopShell();

  const blockers = readiness.gates
    .filter((g) => g.blocking && g.state !== 'pass' && g.state !== 'not_applicable')
    .map((g) => ({ id: g.id, label: g.label, detail: g.detail }));

  // A gate that names a stage tells the rail why that stage cannot be entered.
  const blockedStages: Record<string, string> = {};
  for (const gate of readiness.gates) {
    const stage = WORKFLOW_STAGES.find((s) => gate.id.toUpperCase().includes(s));
    if (stage && gate.blocking && gate.state === 'fail') blockedStages[stage] = gate.detail || gate.label;
  }

  // Most recent first, so "what is it touching" reflects now rather than the
  // start of the session.
  const filesTouched = [...new Set(events.flatMap((e) => e.filePaths))].slice(0, 8);

  const latest = events.find((e) => e.source === 'agent' && (e.command || e.filePaths.length > 0));
  const lastAction = latest
    ? {
        label: latest.type.replace(/\./g, ' '),
        detail: latest.command ?? latest.filePaths[0] ?? '',
      }
    : null;

  return (
    <CommandCenter
      projectName={project.name}
      branch={null}
      environment={project.environment}
      agentStatus={session !== null && session.endedAt === null && session.agentId !== null ? 'active' : 'idle'}
      currentTask={null}
      stages={WORKFLOW_STAGES}
      currentStage={run?.currentStage ?? null}
      blockedStages={blockedStages}
      findings={findings}
      events={events}
      tokens={{
        observed: formatTokens(tokens.estimatedTotal),
        avoidable: formatTokens(tokens.avoidable),
        hasAvoidable: tokens.avoidable > 0,
      }}
      policy={policy}
      readiness={{ ready: readiness.ready, blockers }}
      agentObserved={agentObserved}
      sessionCount={sessionCount}
      eventCount={eventCount}
      filesTouched={filesTouched}
      lastAction={lastAction}
      terminal={terminal}
      terminalSlot={
        terminal ? (
          <TerminalView port={terminal.port} token={terminal.token} />
        ) : (
          <div className="flex h-[400px] items-center justify-center px-6 text-center">
            <p className="t-body max-w-sm text-ink-muted">
              The embedded terminal is part of the desktop application. In a browser, run{' '}
              <code className="mono">claude</code> in this project yourself — the hooks record it either way.
            </p>
          </div>
        )
      }
    />
  );
}
