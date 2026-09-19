import { describe, expect, it } from 'vitest';
import { buildSyncPayload, preflight, syncNow } from '../src/sync/client.js';
import type { ProjectConfig } from '../src/types/project.js';
import { tempStore } from './helpers.js';

function withSync(project: ProjectConfig, patch: Partial<ProjectConfig['cloudSync']>): ProjectConfig {
  return { ...project, cloudSync: { ...project.cloudSync, ...patch } };
}

function seedFinding(store: ReturnType<typeof tempStore>['store'], project: ProjectConfig): void {
  store.upsertFinding({
    ruleId: 'AGENT-007',
    title: 'Service role key in NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    category: 'SECRETS',
    layer: 'AGENT',
    severity: 'critical',
    confidence: 0.95,
    verification: 'LIKELY',
    detection: 'RULE_BASED',
    status: 'open',
    source: 'test',
    projectId: project.id,
    sessionId: null,
    workflowRunId: null,
    affectedFiles: ['src/app/dashboard/page.tsx'],
    affectedLines: [{ file: 'src/app/dashboard/page.tsx', line: 12 }],
    command: 'git commit --no-verify -m wip',
    evidence: [{ kind: 'line', label: 'Line', detail: 'const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY' }],
    impact: 'x',
    recommendation: 'y',
    relatedEvents: [],
    relatedFindings: [],
    relatedTests: [],
    relatedCommits: [],
    fingerprint: 'fp-1',
  });
}

describe('sync preflight', () => {
  it('refuses while sync is disabled, which is the default', () => {
    const { project } = tempStore();
    const check = preflight(project, { token: 'tok' });

    expect(project.cloudSync.enabled).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.refusal).toBe('disabled');
  });

  it('refuses a plaintext endpoint and says why', () => {
    const { project } = tempStore();
    const check = preflight(withSync(project, { enabled: true, endpoint: 'http://example.com/ingest' }), { token: 'tok' });

    expect(check.refusal).toBe('insecure-endpoint');
    expect(check.message).toContain('clear text');
  });

  it('refuses a loopback endpoint unless it is asked for explicitly', () => {
    const { project } = tempStore();
    const configured = withSync(project, { enabled: true, endpoint: 'https://127.0.0.1:9000/ingest' });

    expect(preflight(configured, { token: 'tok' }).refusal).toBe('private-endpoint');
    expect(preflight(configured, { token: 'tok', allowPrivateEndpoint: true }).ok).toBe(true);
  });

  it('requires the token to come from the environment, not the config', () => {
    const { project } = tempStore();
    const check = preflight(withSync(project, { enabled: true, endpoint: 'https://example.com/ingest' }), { token: undefined });

    expect(check.refusal).toBe('no-token');
    expect(JSON.stringify(project)).not.toContain('CECC_SYNC_TOKEN');
  });
});

describe('sync payload', () => {
  it('sends judgements without material by default', () => {
    const { store, project } = tempStore();
    seedFinding(store, project);

    const payload = buildSyncPayload({ project, store, includeEvidence: false });
    const serialized = JSON.stringify(payload);

    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]?.ruleId).toBe('AGENT-007');
    expect(payload.findings[0]?.severity).toBe('critical');
    // None of the material may travel.
    expect(serialized).not.toContain('src/app/dashboard/page.tsx');
    expect(serialized).not.toContain('git commit --no-verify');
    expect(serialized).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
    expect(payload.includesEvidence).toBe(false);
    expect(payload.excluded).toContain('file paths');
  });

  it('hashes the project name unless evidence is enabled', () => {
    const { store, project } = tempStore();
    const quiet = buildSyncPayload({ project, store, includeEvidence: false });
    const loud = buildSyncPayload({ project, store, includeEvidence: true });

    expect(quiet.project.name).toBeUndefined();
    expect(quiet.project.nameHash).toHaveLength(16);
    expect(loud.project.name).toBe(project.name);
  });

  it('still redacts secrets when evidence is included', () => {
    const { store, project } = tempStore();
    store.upsertFinding({
      ruleId: 'AGENT-006',
      title: 'Hardcoded key',
      category: 'SECRETS',
      layer: 'AGENT',
      severity: 'high',
      confidence: 0.9,
      verification: 'LIKELY',
      detection: 'RULE_BASED',
      status: 'open',
      source: 'test',
      projectId: project.id,
      sessionId: null,
      workflowRunId: null,
      affectedFiles: ['a.ts'],
      affectedLines: [],
      command: null,
      evidence: [{ kind: 'line', label: 'Line', detail: ['const k = "sk_live', '_', '4eC39HqLyjWDarjtT1zdp7dc"'].join('') }],
      impact: 'x',
      recommendation: 'y',
      relatedEvents: [],
      relatedFindings: [],
      relatedTests: [],
      relatedCommits: [],
      fingerprint: 'fp-2',
    });

    const payload = buildSyncPayload({ project, store, includeEvidence: true });

    expect(JSON.stringify(payload)).not.toContain('4eC39HqLyjWDarjtT1zdp7dc');
  });

  it('reports the integrity state alongside the counts', () => {
    const { store, project } = tempStore();
    seedFinding(store, project);
    const payload = buildSyncPayload({ project, store, includeEvidence: false });

    expect(payload.integrity.chainOk).toBe(true);
    expect(payload.counts.findingsBySeverity['critical']).toBe(1);
  });
});

describe('syncNow', () => {
  it('builds the real payload on a dry run and sends nothing', async () => {
    const { store, project } = tempStore();
    seedFinding(store, project);
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await syncNow({
      project: withSync(project, { enabled: true, endpoint: 'https://example.com/ingest' }),
      store,
      dryRun: true,
      token: 'tok',
      fetchImpl: spy,
    });

    expect(called).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.payload.findings).toHaveLength(1);
  });

  it('posts with a bearer token and records the digest, not the payload', async () => {
    const { store, project } = tempStore();
    seedFinding(store, project);
    const seen: { url?: string; init?: RequestInit } = {};
    const spy = (async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response('{"ok":true}', { status: 202 });
    }) as unknown as typeof fetch;

    const result = await syncNow({
      project: withSync(project, { enabled: true, endpoint: 'https://example.com/ingest' }),
      store,
      token: 'secret-token',
      fetchImpl: spy,
    });

    expect(result.sent).toBe(true);
    expect(result.status).toBe(202);
    expect(seen.url).toBe('https://example.com/ingest');
    expect((seen.init?.headers as Record<string, string>)['authorization']).toBe('Bearer secret-token');

    const audit = store.listAudit(project.id, 20).find((a) => a.action === 'sync.pushed');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).toContain(result.digest);
    // The audit trail records that a push happened, never a copy of it.
    expect(JSON.stringify(audit)).not.toContain('cecc.sync.v1');
  });

  it('does not send when preflight refuses, even if a token is present', async () => {
    const { store, project } = tempStore();
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await syncNow({ project, store, token: 'tok', fetchImpl: spy });

    expect(called).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.message).toContain('disabled');
  });
});
