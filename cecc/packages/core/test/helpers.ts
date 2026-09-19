import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommand } from '../src/analyze/command.js';
import {
  Store,
  createProjectConfig,
  defaultPolicySet,
  newId,
  runRules,
  type CeccEvent,
  type ContentChange,
  type NewFinding,
  type ProjectConfig,
} from '../src/index.js';

/** Isolated store per test — shared state between tests hides ordering bugs. */
export function tempStore(): { store: Store; dir: string; project: ProjectConfig } {
  const dir = mkdtempSync(join(tmpdir(), 'cecc-test-'));
  const store = new Store(join(dir, 'cecc.db'));
  const project = { ...createProjectConfig(dir, { name: 'test' }), id: newId() };
  // Supabase/Postgres on so RLS and tenancy rules are exercised by default.
  project.stack = { ...project.stack, hasSupabase: true, database: 'postgres', typescript: true, hasNextJs: true };
  store.upsertProject(project);
  return { store, dir, project: store.getProjectByRoot(dir) ?? project };
}

export function makeEvent(overrides: Partial<CeccEvent> = {}): CeccEvent {
  return {
    id: newId(),
    seq: 1,
    timestamp: new Date().toISOString(),
    projectId: 'p',
    sessionId: 's',
    workflowRunId: null,
    agentId: 'claude-code',
    source: 'agent',
    type: 'file.modified',
    severity: 'info',
    status: 'success',
    command: null,
    tool: 'Edit',
    filePaths: [],
    metadata: {},
    evidence: [],
    durationMs: null,
    parentEventId: null,
    contentHash: null,
    findingRuleIds: [],
    ...overrides,
  };
}

/** Builds a ContentChange from added/removed line text. */
export function change(file: string, added: string[], removed: string[] = [], opts: Partial<ContentChange> = {}): ContentChange {
  return {
    file,
    added: added.map((text, i) => ({ line: i + 1, text })),
    removed: removed.map((text, i) => ({ line: i + 1, text })),
    isNewFile: false,
    isDeletion: false,
    origin: 'tool',
    ...opts,
  };
}

/**
 * Runs every registered rule over one change and returns the findings.
 *
 * Tests assert on rule ids rather than counts so adding an unrelated rule
 * cannot break an existing test — brittle assertions are how a suite becomes
 * something people delete instead of maintain.
 */
export function detect(
  ctx: { store: Store; project: ProjectConfig },
  changes: ContentChange[],
  eventOverrides: Partial<CeccEvent> = {},
): NewFinding[] {
  const event = makeEvent({
    projectId: ctx.project.id,
    filePaths: changes.map((c) => c.file),
    ...eventOverrides,
  });
  const parsedCommand = event.command ? parseCommand(event.command) : null;
  return runRules(
    { event, project: ctx.project, changes, parsedCommand, store: ctx.store, now: new Date() },
    defaultPolicySet(ctx.project.environment),
  ).findings;
}

/** Detects from a shell command instead of a file change. */
export function detectCommand(ctx: { store: Store; project: ProjectConfig }, command: string, eventOverrides: Partial<CeccEvent> = {}): NewFinding[] {
  return detect(ctx, [], { command, type: 'command.completed', tool: 'Bash', ...eventOverrides });
}

export const ruleIds = (findings: NewFinding[]): string[] => [...new Set(findings.map((f) => f.ruleId))];
export const hasRule = (findings: NewFinding[], id: string): boolean => findings.some((f) => f.ruleId === id);
export const forRule = (findings: NewFinding[], id: string): NewFinding[] => findings.filter((f) => f.ruleId === id);

/** A fabricated Supabase-style JWT. No real credential appears in this repository. */
export function fakeJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role, exp: 9_999_999_999 })).toString('base64url');
  return `${header}.${payload}.c2lnbmF0dXJlLXBsYWNlaG9sZGVy`;
}

/**
 * Credential-shaped test fixtures, assembled at runtime.
 *
 * A security tool must not ship literal token-shaped strings in its own source.
 * GitHub push protection, gitleaks and most CI secret scanners match on the
 * literal, so committing one blocks the push for this repository and for
 * everyone who forks it — as this project found out the first time it tried to
 * push these very tests.
 *
 * Splitting each value means no scanner-matchable literal exists on disk, while
 * the string the detector sees at runtime is byte-identical to the real thing.
 * The values themselves are public documentation examples, not live keys.
 */
export const fixture = {
  stripeLive: (): string => ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_'),
  githubPat: (): string => ['gh', 'p'].join('') + '_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  awsAccessKey: (): string => 'AKIA' + 'IOSFODNN7EXAMPLE',
  npmToken: (): string => ['npm', '_'].join('') + 'q'.repeat(36),
  anthropicKey: (): string => ['sk', 'ant'].join('-') + '-' + 'x'.repeat(24),
};
