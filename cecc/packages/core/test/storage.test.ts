import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture, makeEvent, tempStore } from './helpers.js';
import type { Store } from '../src/index.js';
import type { ProjectConfig } from '../src/types/project.js';

describe('event store', () => {
  let ctx: { store: Store; project: ProjectConfig };
  beforeEach(() => {
    ctx = tempStore();
  });
  afterEach(() => {
    ctx.store.close();
  });

  const append = (overrides = {}) =>
    ctx.store.appendEvent({
      ...makeEvent({ projectId: ctx.project.id, sessionId: 'sess-1', ...overrides }),
      id: undefined as unknown as string,
    } as never);

  it('assigns monotonic sequence numbers', () => {
    const a = append();
    const b = append();
    const c = append();
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  it('redacts credentials before they reach storage', () => {
    const secret = fixture.githubPat();
    const event = append({ command: `git push https://${secret}@github.com/x/y` });

    expect(event.command).not.toContain(secret);
    // Confirm at the database level, not just the returned object.
    const row = ctx.store.db.prepare('SELECT command FROM events WHERE id = ?').get(event.id) as { command: string };
    expect(row.command).not.toContain(secret);
  });

  it('redacts credentials nested inside metadata', () => {
    const secret = fixture.stripeLive();
    const event = append({ metadata: { output: `Using key ${secret}`, nested: { deep: secret } } });
    expect(JSON.stringify(event.metadata)).not.toContain(secret);
  });

  it('builds a verifiable hash chain', () => {
    for (let i = 0; i < 5; i += 1) append({ command: `step ${i}` });
    const result = ctx.store.verifyEventChain(ctx.project.id);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(5);
  });

  it('detects tampering with a recorded event', () => {
    append({ command: 'first' });
    const target = append({ command: 'git commit --no-verify' });
    append({ command: 'third' });

    // Simulate someone editing the log to hide a bypass.
    ctx.store.db.prepare('UPDATE events SET command = ? WHERE id = ?').run('git commit -m ok', target.id);

    const result = ctx.store.verifyEventChain(ctx.project.id);
    // The row's own content hash no longer matches, breaking the chain from there.
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(target.seq);
  });

  it('detects a deleted event', () => {
    append({ command: 'a' });
    const target = append({ command: 'b' });
    append({ command: 'c' });
    ctx.store.db.prepare('DELETE FROM events WHERE id = ?').run(target.id);

    expect(ctx.store.verifyEventChain(ctx.project.id).ok).toBe(false);
  });
});

describe('findings', () => {
  let ctx: { store: Store; project: ProjectConfig };
  beforeEach(() => {
    ctx = tempStore();
  });
  afterEach(() => {
    ctx.store.close();
  });

  const base = () => ({
    ruleId: 'AGENT-002',
    title: 'Verification bypass',
    category: 'CI_CD' as const,
    layer: 'AGENT' as const,
    severity: 'high' as const,
    confidence: 0.95,
    verification: 'VERIFIED' as const,
    detection: 'RULE_BASED' as const,
    status: 'open' as const,
    source: 'test',
    projectId: ctx.project.id,
    sessionId: 's',
    workflowRunId: null,
    affectedFiles: ['src/a.ts'],
    affectedLines: [{ file: 'src/a.ts', line: 10 }],
    command: 'git commit --no-verify',
    evidence: [],
    impact: 'x',
    recommendation: 'y',
    relatedEvents: [],
    relatedFindings: [],
    relatedTests: [],
    relatedCommits: [],
  });

  it('deduplicates by fingerprint instead of accumulating rows', () => {
    // Scanning ten times must leave one finding with occurrences=10.
    for (let i = 0; i < 10; i += 1) ctx.store.upsertFinding(base());
    const all = ctx.store.listFindings({ projectId: ctx.project.id });
    expect(all).toHaveLength(1);
    expect(all[0]?.occurrences).toBe(10);
  });

  it('treats a different location as a different finding', () => {
    ctx.store.upsertFinding(base());
    ctx.store.upsertFinding({ ...base(), affectedFiles: ['src/b.ts'], affectedLines: [{ file: 'src/b.ts', line: 3 }] });
    expect(ctx.store.listFindings({ projectId: ctx.project.id })).toHaveLength(2);
  });

  it('reopens a resolved finding when the problem returns', () => {
    const created = ctx.store.upsertFinding(base());
    ctx.store.resolveFinding(created.id);
    expect(ctx.store.getFinding(created.id)?.status).toBe('resolved');

    ctx.store.upsertFinding(base());
    expect(ctx.store.getFinding(created.id)?.status).toBe('open');
    expect(ctx.store.getFinding(created.id)?.resolvedAt).toBeNull();
  });

  it('records who suppressed a finding and why', () => {
    const created = ctx.store.upsertFinding(base());
    ctx.store.suppressFinding(created.id, 'accepted risk for the pilot', 'alex', null);

    const stored = ctx.store.getFinding(created.id);
    expect(stored?.status).toBe('suppressed');
    expect(stored?.suppression?.reason).toBe('accepted risk for the pilot');
    expect(stored?.suppression?.by).toBe('alex');
  });

  it('reopens a suppression once it expires', () => {
    const created = ctx.store.upsertFinding(base());
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    ctx.store.suppressFinding(created.id, 'temporary', 'alex', yesterday);

    const reopened = ctx.store.expireSuppressions(ctx.project.id);
    expect(reopened).toBe(1);
    expect(ctx.store.getFinding(created.id)?.status).toBe('open');
  });

  it('keeps an unexpired suppression in place', () => {
    const created = ctx.store.upsertFinding(base());
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    ctx.store.suppressFinding(created.id, 'scheduled for next sprint', 'alex', tomorrow);

    expect(ctx.store.expireSuppressions(ctx.project.id)).toBe(0);
    expect(ctx.store.getFinding(created.id)?.status).toBe('suppressed');
  });

  it('sorts by severity so the worst finding is read first', () => {
    ctx.store.upsertFinding({ ...base(), severity: 'low', affectedFiles: ['l.ts'] });
    ctx.store.upsertFinding({ ...base(), severity: 'critical', affectedFiles: ['c.ts'] });
    ctx.store.upsertFinding({ ...base(), severity: 'medium', affectedFiles: ['m.ts'] });

    const listed = ctx.store.listFindings({ projectId: ctx.project.id });
    expect(listed[0]?.severity).toBe('critical');
  });
});

describe('sessions', () => {
  let ctx: { store: Store; project: ProjectConfig };
  beforeEach(() => {
    ctx = tempStore();
  });
  afterEach(() => {
    ctx.store.close();
  });

  it('converges repeated hook calls onto one session', () => {
    const a = ctx.store.ensureSession({ projectId: ctx.project.id, externalId: 'cc-1', agentId: 'claude-code' });
    const b = ctx.store.ensureSession({ projectId: ctx.project.id, externalId: 'cc-1', agentId: 'claude-code' });
    expect(b.id).toBe(a.id);
  });

  it('updates the permission mode when it changes mid-session', () => {
    ctx.store.ensureSession({ projectId: ctx.project.id, externalId: 'cc-2', agentId: 'claude-code', permissionMode: 'default' });
    const updated = ctx.store.ensureSession({
      projectId: ctx.project.id,
      externalId: 'cc-2',
      agentId: 'claude-code',
      permissionMode: 'bypassPermissions',
    });
    expect(updated.permissionMode).toBe('bypassPermissions');
  });

  it('prefers an active session over a newer ended one', () => {
    const active = ctx.store.ensureSession({ projectId: ctx.project.id, externalId: 'a', agentId: 'x' });
    const other = ctx.store.ensureSession({ projectId: ctx.project.id, externalId: 'b', agentId: 'x' });
    ctx.store.endSession(other.id, 'clear');
    expect(ctx.store.getCurrentSession(ctx.project.id)?.id).toBe(active.id);
  });
});
