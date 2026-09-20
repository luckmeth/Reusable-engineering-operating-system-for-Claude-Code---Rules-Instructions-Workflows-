import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computePolicyChecksum,
  createWorkflowRun,
  decideEnforcement,
  defaultPolicySet,
  evaluateGates,
  inferStage,
  isProtectedPath,
  pinStage,
  runCorrelations,
  savePolicySet,
  loadPolicySet,
  setRuleMode,
  updateWorkflow,
  type CeccEvent,
} from '../src/index.js';
import { makeEvent, tempStore } from './helpers.js';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../src/index.js';
import type { ProjectConfig } from '../src/types/project.js';

describe('policy engine', () => {
  it('defaults a new project to warn, never block', () => {
    // A tool that blocks on day one gets uninstalled before it proves itself.
    const set = defaultPolicySet('development');
    expect(set.defaultMode).toBe('warn');
    expect(Object.values(set.policies).every((p) => p.mode === 'warn')).toBe(true);
  });

  it('does not block on a low-confidence finding even under a block policy', () => {
    let set = defaultPolicySet('production');
    set = setRuleMode(set, 'AGENT-011', 'block', 'test', 'tester');

    const decision = decideEnforcement(set, [
      { ruleId: 'AGENT-011', severity: 'critical', title: 'maybe injection', confidence: 0.5 },
    ]);
    // Blocking someone's work on a guess is how security tooling gets disabled.
    expect(decision.action).toBe('warn');
  });

  it('blocks when policy, severity and confidence all line up', () => {
    let set = defaultPolicySet('production');
    set = setRuleMode(set, 'AGENT-002', 'block', 'never skip hooks', 'tester');

    const decision = decideEnforcement(set, [
      { ruleId: 'AGENT-002', severity: 'high', title: 'verification bypass', confidence: 0.98 },
    ]);
    expect(decision.action).toBe('block');
    expect(decision.message).toContain('AGENT-002');
  });

  it('records nothing for a rule set to observe', () => {
    let set = defaultPolicySet('development');
    set = setRuleMode(set, 'AGENT-004', 'observe', 'noisy here', 'tester');
    expect(decideEnforcement(set, [{ ruleId: 'AGENT-004', severity: 'high', title: 'x', confidence: 0.99 }]).action).toBe('allow');
  });

  it('detects a policy file edited outside CECC', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cecc-policy-'));
    const file = join(dir, 'policies.json');
    savePolicySet(file, defaultPolicySet('development'));
    expect(loadPolicySet(file).integrityOk).toBe(true);

    // Simulate an agent quietly relaxing enforcement without updating the checksum.
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    (tampered['policies'] as Record<string, { mode: string }>)['AGENT-002'].mode = 'observe';
    writeFileSync(file, JSON.stringify(tampered, null, 2));

    const loaded = loadPolicySet(file);
    expect(loaded.integrityOk).toBe(false);
  });

  it('falls back to safe defaults when the policy file is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cecc-policy2-'));
    const file = join(dir, 'policies.json');
    writeFileSync(file, '{ not json');
    const loaded = loadPolicySet(file);
    // Corruption must not silently disable monitoring.
    expect(loaded.usedDefaults).toBe(true);
    expect(loaded.set.defaultMode).toBe('warn');
  });

  it('recognises protected paths including globs', () => {
    const set = defaultPolicySet('development');
    expect(isProtectedPath(set, '.env')).toBe(true);
    expect(isProtectedPath(set, '.claude/settings.json')).toBe(true);
    expect(isProtectedPath(set, 'supabase/migrations/001_init.sql')).toBe(true);
    expect(isProtectedPath(set, 'src/components/Button.tsx')).toBe(false);
  });

  it('changes the checksum when a policy changes', () => {
    const a = defaultPolicySet('development');
    const b = setRuleMode(a, 'AGENT-002', 'block', 'r', 'o');
    expect(computePolicyChecksum(a)).not.toBe(computePolicyChecksum(b));
  });
});

describe('workflow inference', () => {
  const ev = (type: CeccEvent['type'], over: Partial<CeccEvent> = {}, seq = 1): CeccEvent =>
    makeEvent({ type, seq, ...over });

  it('infers IMPLEMENT from source file changes', () => {
    const events = [ev('file.modified', { filePaths: ['src/api/x.ts'] }, 1), ev('file.modified', { filePaths: ['src/lib/y.ts'] }, 2)];
    expect(inferStage(events).stage).toBe('IMPLEMENT');
  });

  it('infers TEST once a suite runs', () => {
    const events = [
      ev('file.modified', { filePaths: ['src/a.ts'] }, 1),
      ev('test.run', { status: 'success' }, 2),
      ev('test.run', { status: 'success' }, 3),
    ];
    expect(inferStage(events).stage).toBe('TEST');
  });

  it('infers SECURITY_REVIEW when a scan runs', () => {
    const events = [ev('file.modified', { filePaths: ['src/a.ts'] }, 1), ev('security.scan', {}, 2)];
    expect(inferStage(events).stage).toBe('SECURITY_REVIEW');
  });

  it('treats documentation-only writes as PLAN, not IMPLEMENT', () => {
    expect(inferStage([ev('file.modified', { filePaths: ['docs/PLAN.md'] }, 1)]).stage).toBe('PLAN');
  });

  it('never moves the stage backwards on its own', () => {
    let run = createWorkflowRun('p', 's');
    run = updateWorkflow(run, [ev('test.run', {}, 1), ev('test.run', {}, 2)]);
    expect(run.currentStage).toBe('TEST');

    // Reading a file mid-implementation must not drag the indicator back.
    run = updateWorkflow(run, [ev('file.read', { filePaths: ['README.md'] }, 3)]);
    expect(run.currentStage).toBe('TEST');
  });

  it('lets a human pin the stage and suspends inference', () => {
    let run = createWorkflowRun('p', 's');
    run = pinStage(run, 'CODE_REVIEW');
    run = updateWorkflow(run, [ev('file.modified', { filePaths: ['src/a.ts'] }, 1)]);
    expect(run.currentStage).toBe('CODE_REVIEW');
    expect(run.pinnedStage).toBe('CODE_REVIEW');
  });

  it('resumes inference once unpinned', () => {
    let run = createWorkflowRun('p', 's');
    run = pinStage(run, 'DISCOVER');
    run = pinStage(run, null);
    run = updateWorkflow(run, [ev('security.scan', {}, 1)]);
    expect(run.currentStage).toBe('SECURITY_REVIEW');
  });
});

describe('completion gates', () => {
  const emptyInput = {
    events: [] as CeccEvent[],
    findings: [],
    tests: [],
    tasks: [],
    run: null,
    uncommittedFiles: [],
    protectedTouched: [],
  };

  it('reports NOT READY when nothing has been verified', () => {
    // Absence of evidence must never read as a pass.
    const report = evaluateGates(emptyInput);
    expect(report.ready).toBe(false);
    expect(report.gates.find((g) => g.id === 'tests.run')?.state).toBe('pending');
  });

  it('distinguishes "not tested" from "passing"', () => {
    const untested = evaluateGates(emptyInput).gates.find((g) => g.id === 'tests.run');
    expect(untested?.state).toBe('pending');
    expect(untested?.detail).toContain('Not tested is not the same as passing');
  });

  it('fails the security gate on an open critical finding', () => {
    const report = evaluateGates({
      ...emptyInput,
      findings: [{ severity: 'critical', status: 'open', layer: 'APPLICATION', id: 'f1', ruleId: 'AGENT-005' } as never],
    });
    expect(report.gates.find((g) => g.id === 'security.findings')?.state).toBe('fail');
    expect(report.ready).toBe(false);
  });

  it('surfaces agent shortcuts as their own gate, separate from app security', () => {
    const report = evaluateGates({
      ...emptyInput,
      findings: [{ severity: 'high', status: 'open', layer: 'AGENT', id: 'f2', ruleId: 'AGENT-002' } as never],
    });
    expect(report.gates.find((g) => g.id === 'agent.shortcuts')?.state).toBe('fail');
  });

  it('fails when a task is marked DONE with no supporting evidence', () => {
    const report = evaluateGates({
      ...emptyInput,
      tasks: [{ status: 'DONE', evidenceEventIds: [], title: 'ship it' } as never],
    });
    const gate = report.gates.find((g) => g.id === 'tasks.complete');
    expect(gate?.state).toBe('fail');
    expect(gate?.detail).toContain('no recorded evidence');
  });

  it('blocks on unreviewed protected files', () => {
    const report = evaluateGates({ ...emptyInput, protectedTouched: ['.env'] });
    expect(report.gates.find((g) => g.id === 'protected.reviewed')?.state).toBe('fail');
  });
});

describe('correlation engine', () => {
  let ctx: { store: Store; project: ProjectConfig };
  beforeEach(() => {
    ctx = tempStore();
  });
  afterEach(() => {
    ctx.store.close();
  });

  const push = (over: Partial<CeccEvent>, seq: number): CeccEvent =>
    makeEvent({ projectId: ctx.project.id, sessionId: 'sess', seq, ...over });

  it('CORR-001: reports a security test weakened after a failure', () => {
    const window = [
      push({ type: 'file.modified', filePaths: ['src/api/orders.ts'], findingRuleIds: ['AGENT-005'] }, 1),
      push({ type: 'test.run', status: 'failed' }, 2),
      push({ type: 'file.modified', filePaths: ['tests/orders.test.ts'], findingRuleIds: ['AGENT-003'] }, 3),
      push({ type: 'test.run', status: 'success' }, 4),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[3]! });

    const match = result.findings.find((f) => f.ruleId === 'CORR-001');
    expect(match).toBeDefined();
    expect(match?.severity).toBe('critical');
    expect(match?.relatedEvents.length).toBeGreaterThanOrEqual(4);
  });

  it('CORR-001: stays quiet when production code was fixed instead', () => {
    // Editing the code between failure and pass is ordinary iteration.
    const window = [
      push({ type: 'file.modified', filePaths: ['src/api/orders.ts'] }, 1),
      push({ type: 'test.run', status: 'failed' }, 2),
      push({ type: 'file.modified', filePaths: ['src/api/orders.ts'] }, 3),
      push({ type: 'file.modified', filePaths: ['tests/orders.test.ts'] }, 4),
      push({ type: 'test.run', status: 'success' }, 5),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[4]! });
    expect(result.findings.find((f) => f.ruleId === 'CORR-001')).toBeUndefined();
  });

  it('CORR-004: reports a control removal committed past the hooks', () => {
    const window = [
      push({ type: 'file.modified', filePaths: ['src/mw.ts'], findingRuleIds: ['AGENT-005'] }, 1),
      push({ type: 'git.commit', command: 'git commit --no-verify -m x', findingRuleIds: ['AGENT-002'] }, 2),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[1]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-004')).toBe(true);
  });

  it('CORR-005: reports an identical command repeated with no changes between', () => {
    const window = [1, 2, 3].map((n) => push({ type: 'command.failed', status: 'failed', command: 'npm run build' }, n));
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[2]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-005')).toBe(true);
  });

  it('CORR-005: stays quiet when files changed between attempts', () => {
    const window = [
      push({ type: 'command.failed', status: 'failed', command: 'npm run build' }, 1),
      push({ type: 'file.modified', filePaths: ['src/a.ts'] }, 2),
      push({ type: 'command.failed', status: 'failed', command: 'npm run build' }, 3),
      push({ type: 'command.failed', status: 'failed', command: 'npm run build' }, 4),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[3]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-005')).toBe(false);
  });

  it('CORR-007: reports the same unchanged file read three times', () => {
    const window = [1, 2, 3].map((n) => push({ type: 'file.read', tool: 'Read', filePaths: ['src/lib/auth.ts'] }, n));
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[2]! });

    const match = result.findings.find((f) => f.ruleId === 'CORR-007');
    expect(match).toBeDefined();
    // Cost, not a defect. Grading it higher would teach people to skim findings.
    expect(match?.severity).toBe('info');
    expect(match?.title).toContain('src/lib/auth.ts');
  });

  it('CORR-007: stays quiet when the file was written between reads', () => {
    const window = [
      push({ type: 'file.read', tool: 'Read', filePaths: ['src/lib/auth.ts'] }, 1),
      push({ type: 'file.modified', filePaths: ['src/lib/auth.ts'] }, 2),
      push({ type: 'file.read', tool: 'Read', filePaths: ['src/lib/auth.ts'] }, 3),
      push({ type: 'file.read', tool: 'Read', filePaths: ['src/lib/auth.ts'] }, 4),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[3]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-007')).toBe(false);
  });

  it('CORR-007: does not confuse reads of different files', () => {
    const window = [
      push({ type: 'file.read', tool: 'Read', filePaths: ['a.ts'] }, 1),
      push({ type: 'file.read', tool: 'Read', filePaths: ['b.ts'] }, 2),
      push({ type: 'file.read', tool: 'Read', filePaths: ['c.ts'] }, 3),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[2]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-007')).toBe(false);
  });

  it('CORR-008: reports an identical search repeated over an unchanged tree', () => {
    const window = [1, 2, 3].map((n) =>
      push({ type: 'command.completed', tool: 'Grep', command: 'grep createInvoice', metadata: { intent: 'search' } }, n),
    );
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[2]! });

    const match = result.findings.find((f) => f.ruleId === 'CORR-008');
    expect(match).toBeDefined();
    expect(match?.severity).toBe('info');
  });

  it('CORR-008: stays quiet once a file changed between searches', () => {
    const window = [
      push({ type: 'command.completed', tool: 'Grep', command: 'grep createInvoice', metadata: { intent: 'search' } }, 1),
      push({ type: 'command.completed', tool: 'Grep', command: 'grep createInvoice', metadata: { intent: 'search' } }, 2),
      push({ type: 'file.modified', filePaths: ['src/invoice.ts'] }, 3),
      push({ type: 'command.completed', tool: 'Grep', command: 'grep createInvoice', metadata: { intent: 'search' } }, 4),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[3]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-008')).toBe(false);
  });

  it('CORR-008: ignores a repeated command that is not a search', () => {
    const window = [1, 2, 3].map((n) => push({ type: 'command.completed', command: 'npm run build' }, n));
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[2]! });
    expect(result.findings.some((f) => f.ruleId === 'CORR-008')).toBe(false);
  });

  it('CORR-006: escalates a secret that reached a commit', () => {
    const window = [
      push({ type: 'file.modified', filePaths: ['src/config.ts'], findingRuleIds: ['AGENT-006'] }, 1),
      push({ type: 'git.commit', command: 'git commit -m "config"' }, 2),
    ];
    const result = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[1]! });
    const match = result.findings.find((f) => f.ruleId === 'CORR-006');
    expect(match?.severity).toBe('critical');
    expect(match?.recommendation).toContain('Rotate');
  });

  it('produces one finding per story, not one per event', () => {
    const window = [
      push({ type: 'file.modified', filePaths: ['src/api/orders.ts'], findingRuleIds: ['AGENT-005'] }, 1),
      push({ type: 'test.run', status: 'failed' }, 2),
      push({ type: 'file.modified', filePaths: ['tests/o.test.ts'], findingRuleIds: ['AGENT-003'] }, 3),
      push({ type: 'test.run', status: 'success' }, 4),
    ];
    const a = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[3]! });
    const b = runCorrelations({ project: ctx.project, store: ctx.store, window, trigger: window[3]! });
    // Same session, same pattern: the fingerprint must match so the store dedupes.
    expect(a.findings[0]?.fingerprint).toBe(b.findings[0]?.fingerprint);
  });
});
