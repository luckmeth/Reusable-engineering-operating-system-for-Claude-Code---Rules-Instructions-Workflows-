import { allRules, loadPolicySet, loadProjectConfig, ceccPaths, WORKFLOW_STAGES } from '@cecc/core';
import { Card } from '@/components/ui';
import { Action } from '@/components/Action';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import {
  pinStageAction,
  pruneEventsAction,
  runScanAction,
  setGlobalModeAction,
  setRuleModeAction,
  verifyIntegrityAction,
} from '../actions';
import { RulePolicyTable } from './RulePolicyTable';

export const dynamic = 'force-dynamic';

/**
 * The control panel.
 *
 * This page exists because a dashboard that only reports is half a product.
 * Everything CECC can be told to do is here, described by its effect rather
 * than its mechanism — "watch and warn, never interrupt" rather than "set
 * defaultMode to warn".
 */
export default function ControlsPage() {
  let data;
  try {
    const root = resolveRoot();
    const project = loadProjectConfig(root);
    if (!project) throw new NotInitializedError(root);
    const policy = loadPolicySet(ceccPaths(root).policies, project.environment);
    const session = withStore(({ store, projectId }) => {
      const current = store.getCurrentSession(projectId);
      return current ? { session: current, run: store.getWorkflowRunBySession(current.id) } : null;
    });
    data = { root, project, policy, session };
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { project, policy, session } = data;
  const modeCounts = Object.values(policy.set.policies).reduce<Record<string, number>>((acc, p) => {
    acc[p.mode] = (acc[p.mode] ?? 0) + 1;
    return acc;
  }, {});
  const dominantMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'warn';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Controls</h1>
        <p className="text-sm text-ink-faint">Decide what CECC watches, what it warns about, and what it stops outright.</p>
      </div>

      <Card title="How strict should CECC be?" subtitle="This applies to every check at once. You can fine-tune individual checks below.">
        <div className="stagger grid gap-3 sm:grid-cols-3">
          {[
            {
              mode: 'observe',
              title: 'Just watch',
              body: 'Records everything silently. You will never be interrupted, and nothing appears as a warning while you work.',
              best: 'Best when you are still getting a feel for it.',
            },
            {
              mode: 'warn',
              title: 'Watch and warn',
              body: 'Records everything and tells you when something looks wrong, but never stops the AI from doing it.',
              best: 'The sensible default, and where new projects start.',
            },
            {
              mode: 'block',
              title: 'Stop problems',
              body: 'Prevents the AI from doing certain things outright — only when CECC is both confident and the problem is serious.',
              best: 'Best once you trust the warnings you have been seeing.',
            },
          ].map((option) => {
            const active = dominantMode === option.mode;
            return (
              <div
                key={option.mode}
                className={`lift rounded-lg border p-4 ${active ? 'border-cecc/50 bg-cecc/5' : 'border-surface-border bg-surface'}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">{option.title}</h3>
                  {active && <span className="rounded bg-cecc/15 px-1.5 py-0.5 text-[10px] font-medium text-cecc">current</span>}
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">{option.body}</p>
                <p className="mt-1.5 text-[11px] text-ink-faint">{option.best}</p>
                {!active && (
                  <div className="mt-3">
                    <Action
                      run={setGlobalModeAction.bind(null, option.mode)}
                      variant={option.mode === 'block' ? 'danger' : 'primary'}
                      confirm={option.mode === 'block' ? 'This will let CECC stop the AI mid-task. Continue?' : undefined}
                    >
                      Switch to this
                    </Action>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="Run a check now" subtitle="CECC watches continuously, but you can also ask it to look right now.">
          <div className="flex flex-wrap gap-2">
            <Action run={runScanAction.bind(null, 'changes')} variant="primary">Check what changed</Action>
            <Action run={runScanAction.bind(null, 'all')} title="Slower — reads every tracked file">Check everything</Action>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Checking what changed is fast and is what you want most of the time. Checking everything reads the whole
            project and is worth doing occasionally, or the first time you set CECC up.
          </p>
        </Card>

        <Card title="The record" subtitle="CECC keeps a tamper-evident log of everything it saw.">
          <div className="flex flex-wrap gap-2">
            <Action run={verifyIntegrityAction} variant="primary">Verify nothing was altered</Action>
            <Action
              run={pruneEventsAction}
              confirm={`Delete activity older than ${project.retentionDays} days? Findings are kept.`}
            >
              Clear old activity
            </Action>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Each recorded action is linked to the one before it, so an edit or deletion shows up. This detects
            tampering and corruption — it cannot stop someone who already controls this machine.
          </p>
        </Card>
      </div>

      {session?.run && (
        <Card title="Where the work is" subtitle="CECC works this out from what happened. Correct it if it has guessed wrong.">
          <div className="flex flex-wrap items-center gap-2">
            {WORKFLOW_STAGES.map((stage) => (
              <Action
                key={stage}
                run={pinStageAction.bind(null, stage)}
                variant={session.run?.currentStage === stage ? 'primary' : 'ghost'}
              >
                {stage.replace(/_/g, ' ').toLowerCase()}
              </Action>
            ))}
          </div>
          {session.run.pinnedStage && (
            <div className="mt-3">
              <Action run={pinStageAction.bind(null, null)}>Let CECC work it out again</Action>
            </div>
          )}
        </Card>
      )}

      <Card
        title="Individual checks"
        subtitle={`${allRules().length} checks. Turn any of them down if it is noisy for your project, or up if it matters more to you.`}
      >
        <RulePolicyTable
          rules={allRules().map((rule) => ({
            id: rule.id,
            name: rule.name,
            layer: rule.layer,
            severity: rule.severity,
            why: rule.why,
            mode: policy.set.policies[rule.id]?.mode ?? policy.set.defaultMode,
          }))}
          setMode={setRuleModeAction}
        />
      </Card>

      {!policy.integrityOk && (
        <Card title="Warning">
          <p className="text-sm text-sev-critical">
            The settings file has been edited outside CECC. Something changed what CECC enforces without going through
            this page — review it before trusting anything reported since.
          </p>
        </Card>
      )}
    </div>
  );
}
