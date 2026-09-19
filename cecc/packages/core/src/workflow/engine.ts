import { newId } from '../hash.js';
import { isMigrationFile, isTestFile } from '../analyze/content.js';
import type { CeccEvent } from '../types/event.js';
import type { StageRecord, WorkflowRun, WorkflowStage } from '../types/workflow.js';
import { WORKFLOW_STAGES } from '../types/workflow.js';

/**
 * Workflow inference.
 *
 * Stages are inferred from what was observed, never from an agent announcing
 * progress. "Done" in a transcript is a claim; a passing test run is evidence.
 * CECC only advances a stage when the events that define it actually occurred.
 *
 * Inference is always reversible. A human can pin the stage at any time, and
 * pinning suppresses inference until it is cleared — being confidently wrong
 * about where someone is in their own work is worse than being unsure.
 */

const STAGE_ORDER: Record<WorkflowStage, number> = Object.fromEntries(
  WORKFLOW_STAGES.map((stage, index) => [stage, index]),
) as Record<WorkflowStage, number>;

export function createWorkflowRun(projectId: string, sessionId: string): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: newId(),
    projectId,
    sessionId,
    currentStage: 'DISCOVER',
    pinnedStage: null,
    stages: WORKFLOW_STAGES.map((stage) => ({
      stage,
      state: stage === 'DISCOVER' ? 'active' : 'pending',
      startedAt: stage === 'DISCOVER' ? now : null,
      endedAt: null,
      actor: null,
      evidenceEventIds: [],
      completedChecks: [],
      failedChecks: [],
      pendingChecks: [],
      blockers: [],
      warnings: [],
      inferred: true,
      durationMs: null,
    })),
    startedAt: now,
    endedAt: null,
  };
}

interface StageSignal {
  stage: WorkflowStage;
  /** Evidence strength, summed across events. Highest total wins. */
  weight: number;
  eventIds: string[];
  reason: string;
}

/**
 * Scores each stage from the observed events.
 *
 * Weights are tuned so that a strong, unambiguous signal (a security scanner
 * ran) outranks a weak, ambiguous one (a file was read). Reading files happens
 * in every stage; running a scanner happens in one.
 */
export function inferStage(events: CeccEvent[]): { stage: WorkflowStage; signals: StageSignal[] } {
  const signals = new Map<WorkflowStage, StageSignal>();

  const add = (stage: WorkflowStage, weight: number, event: CeccEvent, reason: string): void => {
    const existing = signals.get(stage);
    if (existing) {
      existing.weight += weight;
      if (existing.eventIds.length < 10) existing.eventIds.push(event.id);
    } else {
      signals.set(stage, { stage, weight, eventIds: [event.id], reason });
    }
  };

  for (const event of events) {
    switch (event.type) {
      case 'session.started':
      case 'prompt.submitted':
        add('DISCOVER', 1, event, 'Session or task started');
        break;

      case 'file.read':
        add('INSPECT', 1, event, 'Files were read');
        if (event.filePaths.some((p) => /README|ARCHITECTURE|CLAUDE\.md|docs\//i.test(p))) {
          add('UNDERSTAND', 2, event, 'Project documentation was read');
        }
        break;

      case 'file.created':
      case 'file.modified': {
        const onlyDocs = event.filePaths.length > 0 && event.filePaths.every((p) => /\.mdx?$|docs\//i.test(p));
        if (onlyDocs) {
          // Writing a plan document is planning, not implementing.
          add('PLAN', 3, event, 'Planning or documentation written');
        } else if (event.filePaths.some(isTestFile)) {
          add('TEST', 3, event, 'Test files written');
          add('IMPLEMENT', 1, event, 'Code written');
        } else if (event.filePaths.some(isMigrationFile)) {
          add('IMPLEMENT', 4, event, 'Migration written');
        } else {
          add('IMPLEMENT', 4, event, 'Source files changed');
        }
        break;
      }

      case 'test.run':
        add('TEST', 6, event, 'Test suite executed');
        break;

      case 'lint.run':
      case 'typecheck.run':
      case 'build.run':
        add('TEST', 3, event, 'Validation command executed');
        break;

      case 'security.scan':
      case 'dependency.scan':
        add('SECURITY_REVIEW', 7, event, 'Security analysis executed');
        break;

      case 'git.status':
        add('INSPECT', 2, event, 'Repository state inspected');
        break;

      case 'git.commit':
        add('CODE_REVIEW', 5, event, 'Work committed');
        break;

      case 'git.push':
        add('READY', 5, event, 'Branch pushed');
        break;

      default:
        if (event.type === 'command.completed' && event.command) {
          if (/deploy|vercel\s|--prod/.test(event.command)) add('DEPLOY', 7, event, 'Deployment command executed');
          if (/\bdiff\b|\bshow\b|\blog\b/.test(event.command)) add('CODE_REVIEW', 2, event, 'Changes reviewed');
        }
        break;
    }
  }

  const ranked = [...signals.values()].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    // Ties break toward the later stage: reaching a stage implies passing through earlier ones.
    return STAGE_ORDER[b.stage] - STAGE_ORDER[a.stage];
  });

  return { stage: ranked[0]?.stage ?? 'DISCOVER', signals: ranked };
}

/**
 * Advances the run to the inferred stage.
 *
 * Deliberately never moves backwards on its own. Reading a file during
 * implementation would otherwise drag the run back to INSPECT and make the
 * indicator flicker; going back is a decision a human makes explicitly.
 */
export function updateWorkflow(run: WorkflowRun, events: CeccEvent[]): WorkflowRun {
  if (run.pinnedStage) {
    return { ...run, currentStage: run.pinnedStage };
  }

  const { stage: inferred, signals } = inferStage(events);
  const currentIndex = STAGE_ORDER[run.currentStage];
  const inferredIndex = STAGE_ORDER[inferred];
  const target = inferredIndex > currentIndex ? inferred : run.currentStage;
  if (target === run.currentStage) {
    return { ...run, stages: attachEvidence(run.stages, signals) };
  }

  const now = new Date().toISOString();
  const stages = run.stages.map((record): StageRecord => {
    const index = STAGE_ORDER[record.stage];
    const targetIndex = STAGE_ORDER[target];

    if (index < targetIndex && record.state !== 'complete') {
      const startedAt = record.startedAt ?? now;
      return {
        ...record,
        state: 'complete',
        startedAt,
        endedAt: record.endedAt ?? now,
        durationMs: record.endedAt ? record.durationMs : Date.parse(now) - Date.parse(startedAt),
      };
    }
    if (index === targetIndex) {
      return { ...record, state: 'active', startedAt: record.startedAt ?? now, inferred: true };
    }
    return record;
  });

  return { ...run, currentStage: target, stages: attachEvidence(stages, signals) };
}

function attachEvidence(stages: StageRecord[], signals: StageSignal[]): StageRecord[] {
  const bySignal = new Map(signals.map((s) => [s.stage, s]));
  return stages.map((record) => {
    const signal = bySignal.get(record.stage);
    if (!signal) return record;
    return { ...record, evidenceEventIds: [...new Set([...record.evidenceEventIds, ...signal.eventIds])].slice(0, 25) };
  });
}

/** Human override. Recorded as `inferred: false` so the UI can show it was set deliberately. */
export function pinStage(run: WorkflowRun, stage: WorkflowStage | null, actor = 'user'): WorkflowRun {
  const stages = run.stages.map((record) =>
    record.stage === stage ? { ...record, state: 'active' as const, inferred: false, actor } : record,
  );
  return { ...run, pinnedStage: stage, currentStage: stage ?? run.currentStage, stages };
}

export function nextStage(current: WorkflowStage): WorkflowStage | null {
  const index = STAGE_ORDER[current];
  return (WORKFLOW_STAGES[index + 1] as WorkflowStage | undefined) ?? null;
}

export { STAGE_ORDER, WORKFLOW_STAGES };
