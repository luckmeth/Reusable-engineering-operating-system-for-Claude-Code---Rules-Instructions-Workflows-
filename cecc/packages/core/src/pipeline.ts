import { parseCommand } from './analyze/command.js';
import { claudeCodeAdapter, safeReadFile } from './adapters/claude-code.js';
import type { AgentAdapter } from './adapters/types.js';
import { runCorrelations } from './correlate/engine.js';
import { parseTestOutput, parseValidationOutput } from './monitors/test.js';
import { ceccPaths } from './paths.js';
import { decideEnforcement, isProtectedPath, loadPolicySet, type EnforcementDecision } from './policy.js';
import { runRules } from './rules/engine.js';
import './rules/index.js';
import { Store } from './storage/store.js';
import type { CeccEvent, ContentChange, NewEvent } from './types/event.js';
import type { Finding } from './types/finding.js';
import type { ProjectConfig } from './types/project.js';
import { createWorkflowRun, updateWorkflow } from './workflow/engine.js';

/**
 * The ingest pipeline.
 *
 * One path in: a raw agent payload. One path out: stored evidence plus an
 * enforcement decision. Everything the hook needs happens here so the hook
 * itself stays a thin, fast wrapper.
 *
 * Two constraints shape this code. It runs inside a Claude Code hook, so it is
 * on the agent's critical path — slow means a sluggish session, and throwing
 * means a broken one. And it is the only writer of evidence, so partial failure
 * must still record what it managed to observe rather than discarding the lot.
 */

export interface IngestOptions {
  projectRoot: string;
  project: ProjectConfig;
  store: Store;
  adapter?: AgentAdapter;
  /** Skips correlation — used by bulk scans where the window is meaningless. */
  skipCorrelation?: boolean;
}

export interface IngestResult {
  events: CeccEvent[];
  findings: Finding[];
  decision: EnforcementDecision;
  /** Rules or patterns that threw. Surfaced by `cecc doctor`. */
  errors: Array<{ source: string; message: string }>;
  blockable: boolean;
  durationMs: number;
  unmapped: Record<string, unknown>;
}

export function ingest(payload: unknown, opts: IngestOptions): IngestResult {
  const started = Date.now();
  const adapter = opts.adapter ?? claudeCodeAdapter;
  const { store, project } = opts;
  const errors: IngestResult['errors'] = [];

  const paths = ceccPaths(opts.projectRoot);
  const policyLoad = loadPolicySet(paths.policies, project.environment);

  // A tampered policy file is itself a finding, and it must not be trusted to
  // decide enforcement for the very event that may have tampered with it.
  if (!policyLoad.integrityOk) {
    store.audit(project.id, 'cecc', 'policy.integrity_failed', { file: paths.policies });
  }
  const policies = policyLoad.set;

  // --- normalize
  let activity;
  try {
    activity = adapter.normalize(payload, {
      projectId: project.id,
      // Placeholder: the real session id is resolved from the payload below.
      sessionId: '',
      workflowRunId: null,
      projectRoot: opts.projectRoot,
      readFile: safeReadFile,
    });
  } catch (err) {
    return {
      events: [],
      findings: [],
      decision: { action: 'allow', reasons: [], message: '' },
      errors: [{ source: `adapter:${adapter.id}`, message: describe(err) }],
      blockable: false,
      durationMs: Date.now() - started,
      unmapped: {},
    };
  }

  // --- session
  const session = store.ensureSession({
    projectId: project.id,
    externalId: activity.externalSessionId,
    agentId: adapter.id,
    permissionMode: activity.permissionMode,
  });

  // --- workflow run
  let run = store.getWorkflowRunBySession(session.id);
  if (!run) {
    run = createWorkflowRun(project.id, session.id);
    store.saveWorkflowRun(run);
  }

  // --- store events
  const stored: CeccEvent[] = [];
  for (const event of activity.events) {
    try {
      stored.push(
        store.appendEvent({
          ...event,
          sessionId: session.id,
          workflowRunId: run.id,
          metadata: { ...event.metadata, permissionMode: activity.permissionMode ?? event.metadata['permissionMode'] ?? null },
        } as NewEvent),
      );
    } catch (err) {
      errors.push({ source: 'store.appendEvent', message: describe(err) });
    }
  }

  // --- derive test and validation results from command output
  for (const event of stored) {
    try {
      recordValidationOutcome(store, project, session.id, event);
    } catch (err) {
      errors.push({ source: 'test-monitor', message: describe(err) });
    }
  }

  // --- rules
  const findings: Finding[] = [];
  const findingRuleIdsByEvent = new Map<string, string[]>();

  for (const event of stored) {
    // Changes belong to whichever event carries file paths; a command event has none.
    const changes = event.filePaths.length > 0 ? activity.changes.filter((c) => event.filePaths.includes(c.file)) : [];

    const ruleResult = runRules(
      {
        event,
        project,
        changes,
        parsedCommand: event.command ? parseCommand(event.command) : null,
        store,
        now: new Date(),
      },
      policies,
    );

    for (const error of ruleResult.errors) {
      errors.push({ source: `rule:${error.ruleId}`, message: error.message });
    }

    for (const newFinding of ruleResult.findings) {
      try {
        findings.push(store.upsertFinding(newFinding));
      } catch (err) {
        errors.push({ source: 'store.upsertFinding', message: describe(err) });
      }
    }

    if (ruleResult.findings.length > 0) {
      findingRuleIdsByEvent.set(event.id, [...new Set(ruleResult.findings.map((f) => f.ruleId))]);
    }
  }

  // Record which rules fired, so correlation patterns can match on them without
  // re-running the rule engine across the whole window.
  for (const [eventId, ruleIds] of findingRuleIdsByEvent) {
    try {
      store.stampFindingRules(eventId, ruleIds);
    } catch (err) {
      errors.push({ source: 'store.stampFindingRules', message: describe(err) });
    }
  }

  // --- protected paths
  const touchedProtected = stored.flatMap((e) => e.filePaths).filter((f) => isProtectedPath(policies, f));
  if (touchedProtected.length > 0) {
    store.audit(project.id, 'agent', 'protected_path.touched', { files: [...new Set(touchedProtected)] });
  }

  // --- correlation
  if (!opts.skipCorrelation && stored.length > 0) {
    const trigger = stored[stored.length - 1]!;
    // Re-read the window so the rule-id stamps above are visible to patterns.
    const window = store.recentSessionEvents(session.id, 300);
    const correlation = runCorrelations({ project, store, window, trigger });

    for (const error of correlation.errors) {
      errors.push({ source: `correlation:${error.patternId}`, message: error.message });
    }
    for (const newFinding of correlation.findings) {
      try {
        findings.push(store.upsertFinding(newFinding));
      } catch (err) {
        errors.push({ source: 'store.upsertFinding(correlation)', message: describe(err) });
      }
    }
  }

  // --- workflow
  try {
    const window = store.recentSessionEvents(session.id, 300);
    const updated = updateWorkflow(run, window);
    if (updated.currentStage !== run.currentStage) {
      store.appendEvent({
        projectId: project.id,
        sessionId: session.id,
        workflowRunId: updated.id,
        agentId: null,
        source: 'cecc',
        type: 'workflow.stage.entered',
        severity: 'info',
        status: 'success',
        command: null,
        tool: null,
        filePaths: [],
        metadata: { from: run.currentStage, to: updated.currentStage, inferred: true },
        evidence: [],
        durationMs: null,
        parentEventId: null,
      });
    }
    store.saveWorkflowRun(updated);
  } catch (err) {
    errors.push({ source: 'workflow', message: describe(err) });
  }

  // --- enforcement
  const decision = decideEnforcement(
    policies,
    findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, title: f.title, confidence: f.confidence })),
  );

  if (decision.action === 'block') {
    // Enforcement goes to the audit log, which is separate from the event stream
    // so that silencing events cannot also hide what CECC blocked.
    store.audit(project.id, 'cecc', 'enforcement.block', {
      reasons: decision.reasons.map((r) => r.ruleId),
      sessionId: session.id,
    });
  }

  // Rule failures are a coverage gap, not a detail. Record them where they show up.
  if (errors.length > 0) {
    store.audit(project.id, 'cecc', 'pipeline.errors', { errors: errors.slice(0, 10) });
  }

  return {
    events: stored,
    findings,
    decision,
    errors,
    blockable: activity.blockable,
    durationMs: Date.now() - started,
    unmapped: activity.unmapped,
  };
}

/**
 * Turns a completed validation command into a structured result.
 *
 * Exit code is always authoritative for pass/fail; the parsed counts only add
 * detail. When the output format is unrecognised the result is still recorded,
 * marked as unparsed, rather than dropped — a test run that happened is
 * evidence even when its summary could not be read.
 */
function recordValidationOutcome(store: Store, project: ProjectConfig, sessionId: string, event: CeccEvent): void {
  const output = typeof event.metadata['output'] === 'string' ? (event.metadata['output'] as string) : '';
  const exitCode = typeof event.metadata['exitCode'] === 'number' ? (event.metadata['exitCode'] as number) : null;

  if (event.type === 'test.run') {
    const summary = parseTestOutput(output, exitCode);
    store.recordTestResult({
      projectId: project.id,
      sessionId,
      eventId: event.id,
      suite: event.command ?? 'tests',
      name: null,
      kind: 'unit',
      status: summary.status === 'unknown' ? 'error' : summary.status === 'passed' ? 'passed' : 'failed',
      durationMs: summary.durationMs,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      total: summary.total,
      output: summary.failingTests.length > 0 ? `Failing: ${summary.failingTests.join(', ')}` : null,
    });
    return;
  }

  if (event.type === 'lint.run' || event.type === 'typecheck.run' || event.type === 'build.run') {
    const result = parseValidationOutput(output, exitCode);
    store.recordTestResult({
      projectId: project.id,
      sessionId,
      eventId: event.id,
      suite: event.command ?? event.type,
      name: null,
      kind: event.type.replace('.run', ''),
      status: result.status === 'unknown' ? 'error' : result.status === 'passed' ? 'passed' : 'failed',
      durationMs: null,
      passed: null,
      failed: result.errorCount,
      skipped: null,
      total: null,
      output: null,
    });
  }
}

const describe = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

export type { ContentChange };
