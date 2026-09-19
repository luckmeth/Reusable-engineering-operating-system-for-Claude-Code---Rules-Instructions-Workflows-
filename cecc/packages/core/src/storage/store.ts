import { openDb, type Db } from './db.js';
import { fingerprintFinding, newId, sha256 } from '../hash.js';
import { redact, redactDeep } from '../secrets.js';
import type { CeccEvent, NewEvent } from '../types/event.js';
import type { Finding, NewFinding } from '../types/finding.js';
import type { NewTask, Task } from '../types/task.js';
import type { ProjectConfig, SessionRecord } from '../types/project.js';
import type { WorkflowRun } from '../types/workflow.js';
import type { Severity } from '../types/common.js';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const nnum = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Canonical serialization for the integrity hash.
 *
 * Field order is fixed and fields are joined with a unit separator, so a value
 * containing the delimiter cannot be crafted to collide with a different set of
 * field values.
 */
function canonicalPayload(parts: {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  status: string;
  command: string | null;
  tool: string | null;
  filePathsJson: string;
  metadataJson: string;
}): string {
  return [
    parts.id,
    parts.timestamp,
    parts.type,
    parts.source,
    parts.status,
    parts.command ?? '',
    parts.tool ?? '',
    parts.filePathsJson,
    parts.metadataJson,
  ].join('\u001f');
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface EventQuery {
  projectId: string;
  sessionId?: string;
  types?: string[];
  sources?: string[];
  sinceSeq?: number;
  minSeverity?: Severity;
  limit?: number;
  search?: string;
}

export interface TestResultRecord {
  id: string;
  projectId: string;
  sessionId: string | null;
  eventId: string | null;
  suite: string;
  name: string | null;
  kind: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  total: number | null;
  output: string | null;
  createdAt: string;
}

/**
 * Typed access to the local store.
 *
 * Two invariants are enforced here rather than at call sites, because a single
 * missed call site defeats both:
 *   - everything written is redacted first (evidence comes from source code and
 *     shell commands, so it routinely carries credentials);
 *   - every event extends a per-project hash chain, so later tampering with the
 *     record is detectable.
 */
export class Store {
  readonly db: Db;

  constructor(dbPath: string) {
    this.db = openDb(dbPath);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- projects

  upsertProject(project: ProjectConfig): ProjectConfig {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root, environment, adapters, stack, cloud_sync, retention_days, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(root) DO UPDATE SET
           name = excluded.name,
           environment = excluded.environment,
           adapters = excluded.adapters,
           stack = excluded.stack,
           cloud_sync = excluded.cloud_sync,
           retention_days = excluded.retention_days`,
      )
      .run(
        project.id,
        project.name,
        project.root,
        project.environment,
        JSON.stringify(project.adapters),
        JSON.stringify(project.stack),
        JSON.stringify(project.cloudSync),
        project.retentionDays,
        project.createdAt,
      );
    return this.getProjectByRoot(project.root) ?? project;
  }

  getProjectByRoot(root: string): ProjectConfig | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE root = ?').get(root) as Row | undefined;
    return row ? this.rowToProject(row) : null;
  }

  getProject(id: string): ProjectConfig | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return row ? this.rowToProject(row) : null;
  }

  listProjects(): ProjectConfig[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Row[];
    return rows.map((r) => this.rowToProject(r));
  }

  private rowToProject(row: Row): ProjectConfig {
    return {
      id: str(row['id']),
      name: str(row['name']),
      root: str(row['root']),
      environment: str(row['environment']) as ProjectConfig['environment'],
      adapters: parseJson<string[]>(row['adapters'], []),
      stack: parseJson<ProjectConfig['stack']>(row['stack'], {
        framework: null,
        database: null,
        packageManager: null,
        testRunner: null,
        hasSupabase: false,
        hasNextJs: false,
        typescript: false,
      }),
      cloudSync: parseJson<ProjectConfig['cloudSync']>(row['cloud_sync'], {
        enabled: false,
        includeSourceExcerpts: false,
        endpoint: null,
      }),
      retentionDays: num(row['retention_days']),
      createdAt: str(row['created_at']),
    };
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Resolves the CECC session for an adapter-native session id, creating one on
   * first sight. Hooks fire many times per session and must converge on one row.
   */
  ensureSession(input: {
    projectId: string;
    externalId: string | null;
    agentId: string | null;
    agentVersion?: string | null;
    startReason?: string | null;
    cwd?: string | null;
    permissionMode?: string | null;
  }): SessionRecord {
    if (input.externalId) {
      const existing = this.db
        .prepare('SELECT * FROM sessions WHERE project_id = ? AND external_id = ?')
        .get(input.projectId, input.externalId) as Row | undefined;
      if (existing) {
        // Permission mode can change mid-session and is material to AGENT-001.
        if (input.permissionMode && input.permissionMode !== existing['permission_mode']) {
          this.db
            .prepare('UPDATE sessions SET permission_mode = ? WHERE id = ?')
            .run(input.permissionMode, str(existing['id']));
          existing['permission_mode'] = input.permissionMode;
        }
        return this.rowToSession(existing);
      }
    }

    const session: SessionRecord = {
      id: newId(),
      projectId: input.projectId,
      externalId: input.externalId,
      agentId: input.agentId,
      agentVersion: input.agentVersion ?? null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      startReason: input.startReason ?? null,
      endReason: null,
      cwd: input.cwd ?? null,
      permissionMode: input.permissionMode ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, external_id, agent_id, agent_version, started_at, ended_at, start_reason, end_reason, cwd, permission_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.projectId,
        session.externalId,
        session.agentId,
        session.agentVersion,
        session.startedAt,
        session.endedAt,
        session.startReason,
        session.endReason,
        session.cwd,
        session.permissionMode,
      );
    return session;
  }

  endSession(sessionId: string, reason: string | null): void {
    this.db
      .prepare('UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL')
      .run(new Date().toISOString(), reason, sessionId);
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /** Most recent session, preferring one that has not ended. */
  getCurrentSession(projectId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions WHERE project_id = ?
         ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1`,
      )
      .get(projectId) as Row | undefined;
    return row ? this.rowToSession(row) : null;
  }

  listSessions(projectId: string, limit = 50): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(projectId, limit) as Row[];
    return rows.map((r) => this.rowToSession(r));
  }

  private rowToSession(row: Row): SessionRecord {
    return {
      id: str(row['id']),
      projectId: str(row['project_id']),
      externalId: nstr(row['external_id']),
      agentId: nstr(row['agent_id']),
      agentVersion: nstr(row['agent_version']),
      startedAt: str(row['started_at']),
      endedAt: nstr(row['ended_at']),
      startReason: nstr(row['start_reason']),
      endReason: nstr(row['end_reason']),
      cwd: nstr(row['cwd']),
      permissionMode: nstr(row['permission_mode']),
    };
  }

  // ------------------------------------------------------------------ events

  /**
   * Appends an event, redacting it and extending the project's hash chain.
   *
   * The chain is computed inside the same transaction as the insert so two
   * concurrent hook processes cannot interleave and produce a chain that fails
   * its own verification.
   */
  appendEvent(input: NewEvent): CeccEvent {
    const id = input.id ?? newId();
    const timestamp = input.timestamp ?? new Date().toISOString();

    const command = input.command ? redact(input.command) : null;
    const filePaths = [...new Set(input.filePaths ?? [])];
    const metadata = redactDeep(input.metadata ?? {});
    const evidence = redactDeep(input.evidence ?? []);

    // Hash the exact strings that get written, not the in-memory objects. A
    // parse/re-serialize round trip could reorder keys and make an untampered
    // row fail its own verification.
    const filePathsJson = JSON.stringify(filePaths);
    const metadataJson = JSON.stringify(metadata);
    const contentHash =
      input.contentHash ??
      sha256(
        canonicalPayload({
          id,
          timestamp,
          type: input.type,
          source: input.source,
          status: input.status,
          command,
          tool: input.tool,
          filePathsJson,
          metadataJson,
        }),
      );

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prev = this.db
        .prepare('SELECT chain_hash FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1')
        .get(input.projectId) as Row | undefined;
      const prevHash = prev ? nstr(prev['chain_hash']) : null;
      const chainHash = sha256(`${prevHash ?? 'genesis'}:${contentHash}`);

      this.db
        .prepare(
          `INSERT INTO events (id, timestamp, project_id, session_id, workflow_run_id, agent_id, source, type,
                               severity, status, command, tool, file_paths, metadata, evidence, duration_ms,
                               parent_event_id, content_hash, prev_hash, chain_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          timestamp,
          input.projectId,
          input.sessionId,
          input.workflowRunId,
          input.agentId,
          input.source,
          input.type,
          input.severity,
          input.status,
          command,
          input.tool,
          filePathsJson,
          metadataJson,
          JSON.stringify(evidence),
          input.durationMs,
          input.parentEventId,
          contentHash,
          prevHash,
          chainHash,
        );
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const stored = this.getEvent(id);
    if (!stored) throw new Error('CECC: event insert did not persist');
    return stored;
  }

  getEvent(id: string): CeccEvent | null {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row | undefined;
    return row ? this.rowToEvent(row) : null;
  }

  queryEvents(q: EventQuery): CeccEvent[] {
    const where: string[] = ['project_id = ?'];
    const params: Array<string | number> = [q.projectId];

    if (q.sessionId) {
      where.push('session_id = ?');
      params.push(q.sessionId);
    }
    if (q.types?.length) {
      where.push(`type IN (${q.types.map(() => '?').join(',')})`);
      params.push(...q.types);
    }
    if (q.sources?.length) {
      where.push(`source IN (${q.sources.map(() => '?').join(',')})`);
      params.push(...q.sources);
    }
    if (typeof q.sinceSeq === 'number') {
      where.push('seq > ?');
      params.push(q.sinceSeq);
    }
    if (q.search) {
      where.push('(command LIKE ? OR tool LIKE ? OR file_paths LIKE ? OR type LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like, like);
    }

    const limit = Math.min(Math.max(q.limit ?? 200, 1), 2000);
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ?`)
      .all(...params, limit) as Row[];
    return rows.map((r) => this.rowToEvent(r));
  }

  /** Recent events for a session in chronological order — the correlation window. */
  recentSessionEvents(sessionId: string, limit = 200): CeccEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT ?')
      .all(sessionId, limit) as Row[];
    return rows.map((r) => this.rowToEvent(r)).reverse();
  }

  countEvents(projectId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE project_id = ?').get(projectId) as Row;
    return num(row['n']);
  }

  private rowToEvent(row: Row): CeccEvent {
    return {
      id: str(row['id']),
      seq: num(row['seq']),
      timestamp: str(row['timestamp']),
      projectId: str(row['project_id']),
      sessionId: str(row['session_id']),
      workflowRunId: nstr(row['workflow_run_id']),
      agentId: nstr(row['agent_id']),
      source: str(row['source']) as CeccEvent['source'],
      type: str(row['type']) as CeccEvent['type'],
      severity: str(row['severity']) as CeccEvent['severity'],
      status: str(row['status']) as CeccEvent['status'],
      command: nstr(row['command']),
      tool: nstr(row['tool']),
      filePaths: parseJson<string[]>(row['file_paths'], []),
      metadata: parseJson<Record<string, unknown>>(row['metadata'], {}),
      evidence: parseJson<CeccEvent['evidence']>(row['evidence'], []),
      durationMs: nnum(row['duration_ms']),
      parentEventId: nstr(row['parent_event_id']),
      contentHash: nstr(row['content_hash']),
      findingRuleIds: parseJson<string[]>(row['finding_rule_ids'], []),
    };
  }

  /**
   * Recomputes the chain and reports the first break.
   *
   * Honest framing: this proves the log has not been edited by something that
   * did not also recompute the chain. It is tamper-evident, not tamper-proof —
   * anything with write access to the database file can rebuild the chain.
   */
  verifyEventChain(projectId: string): { ok: boolean; checked: number; brokenAtSeq: number | null; reason: string | null } {
    const rows = this.db
      .prepare(
        `SELECT seq, id, timestamp, type, source, status, command, tool, file_paths, metadata,
                content_hash, prev_hash, chain_hash
         FROM events WHERE project_id = ? ORDER BY seq ASC`,
      )
      .all(projectId) as Row[];

    let expectedPrev: string | null = null;
    let checked = 0;

    for (const row of rows) {
      const seq = num(row['seq']);
      const storedContentHash = nstr(row['content_hash']);

      // Recompute each event's content hash from the row as it now stands.
      // Verifying only the linkage would prove that events were not removed or
      // reordered while leaving an edit to a recorded command undetectable —
      // which is the single most likely thing anyone would want to tamper with.
      const recomputedContent = sha256(
        canonicalPayload({
          id: str(row['id']),
          timestamp: str(row['timestamp']),
          type: str(row['type']),
          source: str(row['source']),
          status: str(row['status']),
          command: nstr(row['command']),
          tool: nstr(row['tool']),
          filePathsJson: str(row['file_paths']),
          metadataJson: str(row['metadata']),
        }),
      );

      if (storedContentHash !== recomputedContent) {
        return { ok: false, checked, brokenAtSeq: seq, reason: 'event content does not match its recorded hash' };
      }

      const recomputedChain = sha256(`${expectedPrev ?? 'genesis'}:${storedContentHash ?? ''}`);
      if (nstr(row['prev_hash']) !== expectedPrev || nstr(row['chain_hash']) !== recomputedChain) {
        return { ok: false, checked, brokenAtSeq: seq, reason: 'chain linkage broken — an event was removed or reordered' };
      }

      expectedPrev = recomputedChain;
      checked += 1;
    }

    return { ok: true, checked, brokenAtSeq: null, reason: null };
  }

  /**
   * Records which rules fired on an event.
   *
   * Written to a dedicated column rather than into metadata, so this legitimate
   * post-insert annotation by CECC cannot invalidate the integrity hash.
   */
  stampFindingRules(eventId: string, ruleIds: string[]): void {
    this.db
      .prepare('UPDATE events SET finding_rule_ids = ? WHERE id = ?')
      .run(JSON.stringify([...new Set(ruleIds)]), eventId);
  }

  // ---------------------------------------------------------------- findings

  /**
   * Inserts a finding, or updates the existing one with the same fingerprint.
   *
   * Re-detection must not multiply rows: a scan run ten times should leave one
   * finding with occurrences=10, not ten findings. A resolved finding that
   * reappears is reopened, because the underlying problem is back.
   */
  upsertFinding(input: NewFinding): Finding {
    const now = new Date().toISOString();
    const fingerprint =
      input.fingerprint ??
      fingerprintFinding({
        ruleId: input.ruleId,
        projectId: input.projectId,
        files: input.affectedFiles,
        lines: input.affectedLines.map((l) => l.line),
        command: input.command,
      });

    const existing = this.db
      .prepare('SELECT * FROM findings WHERE project_id = ? AND fingerprint = ?')
      .get(input.projectId, fingerprint) as Row | undefined;

    if (existing) {
      const wasResolved = str(existing['status']) === 'resolved';
      this.db
        .prepare(
          `UPDATE findings SET
             occurrences = occurrences + 1,
             last_detected_at = ?,
             severity = ?,
             confidence = ?,
             verification = ?,
             evidence = ?,
             related_events = ?,
             status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
             resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END
           WHERE id = ?`,
        )
        .run(
          now,
          input.severity,
          input.confidence,
          input.verification,
          JSON.stringify(redactDeep(input.evidence)),
          JSON.stringify(input.relatedEvents),
          str(existing['id']),
        );
      if (wasResolved) {
        this.audit(input.projectId, 'cecc', 'finding.reopened', { fingerprint, ruleId: input.ruleId });
      }
      const updated = this.getFinding(str(existing['id']));
      if (!updated) throw new Error('CECC: finding update did not persist');
      return updated;
    }

    const finding: Finding = {
      id: input.id ?? newId(),
      fingerprint,
      ruleId: input.ruleId,
      title: redact(input.title),
      category: input.category,
      layer: input.layer,
      severity: input.severity,
      confidence: input.confidence,
      verification: input.verification,
      detection: input.detection,
      status: input.status ?? 'open',
      source: input.source,
      projectId: input.projectId,
      sessionId: input.sessionId,
      workflowRunId: input.workflowRunId,
      affectedFiles: input.affectedFiles,
      affectedLines: input.affectedLines,
      command: input.command ? redact(input.command) : null,
      evidence: redactDeep(input.evidence),
      impact: input.impact,
      recommendation: input.recommendation,
      relatedEvents: input.relatedEvents,
      relatedFindings: input.relatedFindings,
      relatedTests: input.relatedTests,
      relatedCommits: input.relatedCommits,
      occurrences: 1,
      firstDetectedAt: input.firstDetectedAt ?? now,
      lastDetectedAt: now,
      resolvedAt: null,
      suppression: null,
    };

    this.db
      .prepare(
        `INSERT INTO findings (id, fingerprint, rule_id, title, category, layer, severity, confidence, verification,
                               detection, status, source, project_id, session_id, workflow_run_id, affected_files,
                               affected_lines, command, evidence, impact, recommendation, related_events,
                               related_findings, related_tests, related_commits, occurrences, first_detected_at,
                               last_detected_at, resolved_at, suppression)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        finding.id,
        finding.fingerprint,
        finding.ruleId,
        finding.title,
        finding.category,
        finding.layer,
        finding.severity,
        finding.confidence,
        finding.verification,
        finding.detection,
        finding.status,
        finding.source,
        finding.projectId,
        finding.sessionId,
        finding.workflowRunId,
        JSON.stringify(finding.affectedFiles),
        JSON.stringify(finding.affectedLines),
        finding.command,
        JSON.stringify(finding.evidence),
        finding.impact,
        finding.recommendation,
        JSON.stringify(finding.relatedEvents),
        JSON.stringify(finding.relatedFindings),
        JSON.stringify(finding.relatedTests),
        JSON.stringify(finding.relatedCommits),
        finding.occurrences,
        finding.firstDetectedAt,
        finding.lastDetectedAt,
        finding.resolvedAt,
        null,
      );
    return finding;
  }

  getFinding(id: string): Finding | null {
    const row = this.db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Row | undefined;
    return row ? this.rowToFinding(row) : null;
  }

  listFindings(opts: {
    projectId: string;
    status?: Finding['status'][];
    layer?: Finding['layer'][];
    minSeverity?: Severity;
    sessionId?: string;
    limit?: number;
  }): Finding[] {
    const where = ['project_id = ?'];
    const params: Array<string | number> = [opts.projectId];
    if (opts.status?.length) {
      where.push(`status IN (${opts.status.map(() => '?').join(',')})`);
      params.push(...opts.status);
    }
    if (opts.layer?.length) {
      where.push(`layer IN (${opts.layer.map(() => '?').join(',')})`);
      params.push(...opts.layer);
    }
    if (opts.sessionId) {
      where.push('session_id = ?');
      params.push(opts.sessionId);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM findings WHERE ${where.join(' AND ')}
         ORDER BY CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
                  last_detected_at DESC
         LIMIT ?`,
      )
      .all(...params, Math.min(opts.limit ?? 200, 1000)) as Row[];

    let findings = rows.map((r) => this.rowToFinding(r));
    if (opts.minSeverity) {
      const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
      const floor = rank[opts.minSeverity];
      findings = findings.filter((f) => rank[f.severity] >= floor);
    }
    return findings;
  }

  resolveFinding(id: string, note?: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE findings SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now, id);
    const finding = this.getFinding(id);
    this.audit(finding?.projectId ?? null, 'user', 'finding.resolved', { id, note: note ?? null });
  }

  /**
   * Suppression always records who, why, and (optionally) until when. A finding
   * that disappears without a trace is indistinguishable from one never raised.
   */
  suppressFinding(id: string, reason: string, by: string, expiresAt: string | null): void {
    const suppression = { reason: redact(reason), by, createdAt: new Date().toISOString(), expiresAt };
    this.db
      .prepare("UPDATE findings SET status = 'suppressed', suppression = ? WHERE id = ?")
      .run(JSON.stringify(suppression), id);
    const finding = this.getFinding(id);
    this.audit(finding?.projectId ?? null, by, 'finding.suppressed', { id, reason: suppression.reason, expiresAt });
  }

  /** Re-opens suppressions whose expiry has passed. Silence should not be permanent by default. */
  expireSuppressions(projectId: string, now = new Date()): number {
    const rows = this.db
      .prepare("SELECT id, suppression FROM findings WHERE project_id = ? AND status = 'suppressed'")
      .all(projectId) as Row[];
    let reopened = 0;
    for (const row of rows) {
      const suppression = parseJson<{ expiresAt: string | null } | null>(row['suppression'], null);
      if (!suppression?.expiresAt) continue;
      if (new Date(suppression.expiresAt).getTime() > now.getTime()) continue;
      this.db.prepare("UPDATE findings SET status = 'open', suppression = NULL WHERE id = ?").run(str(row['id']));
      this.audit(projectId, 'cecc', 'finding.suppression_expired', { id: str(row['id']) });
      reopened += 1;
    }
    return reopened;
  }

  private rowToFinding(row: Row): Finding {
    return {
      id: str(row['id']),
      fingerprint: str(row['fingerprint']),
      ruleId: str(row['rule_id']),
      title: str(row['title']),
      category: str(row['category']) as Finding['category'],
      layer: str(row['layer']) as Finding['layer'],
      severity: str(row['severity']) as Severity,
      confidence: Number(row['confidence'] ?? 0),
      verification: str(row['verification']) as Finding['verification'],
      detection: str(row['detection']) as Finding['detection'],
      status: str(row['status']) as Finding['status'],
      source: str(row['source']),
      projectId: str(row['project_id']),
      sessionId: nstr(row['session_id']),
      workflowRunId: nstr(row['workflow_run_id']),
      affectedFiles: parseJson<string[]>(row['affected_files'], []),
      affectedLines: parseJson<Finding['affectedLines']>(row['affected_lines'], []),
      command: nstr(row['command']),
      evidence: parseJson<Finding['evidence']>(row['evidence'], []),
      impact: str(row['impact']),
      recommendation: str(row['recommendation']),
      relatedEvents: parseJson<string[]>(row['related_events'], []),
      relatedFindings: parseJson<string[]>(row['related_findings'], []),
      relatedTests: parseJson<string[]>(row['related_tests'], []),
      relatedCommits: parseJson<string[]>(row['related_commits'], []),
      occurrences: num(row['occurrences']),
      firstDetectedAt: str(row['first_detected_at']),
      lastDetectedAt: str(row['last_detected_at']),
      resolvedAt: nstr(row['resolved_at']),
      suppression: parseJson<Finding['suppression']>(row['suppression'], null),
    };
  }

  // ------------------------------------------------------------------- tasks

  upsertTask(input: NewTask): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: input.id ?? newId(),
      projectId: input.projectId,
      title: redact(input.title),
      description: redact(input.description ?? ''),
      priority: input.priority ?? 'medium',
      status: input.status ?? 'TODO',
      stage: input.stage ?? null,
      dependencies: input.dependencies ?? [],
      affectedFiles: input.affectedFiles ?? [],
      tests: input.tests ?? [],
      securityChecks: input.securityChecks ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      evidenceEventIds: input.evidenceEventIds ?? [],
      origin: input.origin ?? 'user',
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, description, priority, status, stage, dependencies, affected_files,
                            tests, security_checks, acceptance_criteria, evidence_event_ids, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description, priority = excluded.priority,
           status = excluded.status, stage = excluded.stage, dependencies = excluded.dependencies,
           affected_files = excluded.affected_files, tests = excluded.tests,
           security_checks = excluded.security_checks, acceptance_criteria = excluded.acceptance_criteria,
           evidence_event_ids = excluded.evidence_event_ids, updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.description,
        task.priority,
        task.status,
        task.stage,
        JSON.stringify(task.dependencies),
        JSON.stringify(task.affectedFiles),
        JSON.stringify(task.tests),
        JSON.stringify(task.securityChecks),
        JSON.stringify(task.acceptanceCriteria),
        JSON.stringify(task.evidenceEventIds),
        task.origin,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  listTasks(projectId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      projectId: str(row['project_id']),
      title: str(row['title']),
      description: str(row['description']),
      priority: str(row['priority']) as Task['priority'],
      status: str(row['status']) as Task['status'],
      stage: nstr(row['stage']) as Task['stage'],
      dependencies: parseJson<string[]>(row['dependencies'], []),
      affectedFiles: parseJson<string[]>(row['affected_files'], []),
      tests: parseJson<string[]>(row['tests'], []),
      securityChecks: parseJson<string[]>(row['security_checks'], []),
      acceptanceCriteria: parseJson<string[]>(row['acceptance_criteria'], []),
      evidenceEventIds: parseJson<string[]>(row['evidence_event_ids'], []),
      origin: str(row['origin']),
      createdAt: str(row['created_at']),
      updatedAt: str(row['updated_at']),
    }));
  }

  // --------------------------------------------------------------- workflow

  saveWorkflowRun(run: WorkflowRun): void {
    this.db
      .prepare(
        `INSERT INTO workflow_runs (id, project_id, session_id, current_stage, pinned_stage, stages, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           current_stage = excluded.current_stage, pinned_stage = excluded.pinned_stage,
           stages = excluded.stages, ended_at = excluded.ended_at`,
      )
      .run(
        run.id,
        run.projectId,
        run.sessionId,
        run.currentStage,
        run.pinnedStage,
        JSON.stringify(run.stages),
        run.startedAt,
        run.endedAt,
      );
  }

  getWorkflowRunBySession(sessionId: string): WorkflowRun | null {
    const row = this.db
      .prepare('SELECT * FROM workflow_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(sessionId) as Row | undefined;
    if (!row) return null;
    return {
      id: str(row['id']),
      projectId: str(row['project_id']),
      sessionId: str(row['session_id']),
      currentStage: str(row['current_stage']) as WorkflowRun['currentStage'],
      pinnedStage: nstr(row['pinned_stage']) as WorkflowRun['pinnedStage'],
      stages: parseJson<WorkflowRun['stages']>(row['stages'], []),
      startedAt: str(row['started_at']),
      endedAt: nstr(row['ended_at']),
    };
  }

  // ----------------------------------------------------------------- tests

  recordTestResult(result: Omit<TestResultRecord, 'id' | 'createdAt'> & Partial<Pick<TestResultRecord, 'id' | 'createdAt'>>): TestResultRecord {
    const record: TestResultRecord = {
      ...result,
      id: result.id ?? newId(),
      createdAt: result.createdAt ?? new Date().toISOString(),
      output: result.output ? redact(result.output).slice(0, 20_000) : null,
    };
    this.db
      .prepare(
        `INSERT INTO test_results (id, project_id, session_id, event_id, suite, name, kind, status, duration_ms,
                                   passed, failed, skipped, total, output, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.sessionId,
        record.eventId,
        record.suite,
        record.name,
        record.kind,
        record.status,
        record.durationMs,
        record.passed,
        record.failed,
        record.skipped,
        record.total,
        record.output,
        record.createdAt,
      );
    return record;
  }

  listTestResults(projectId: string, limit = 50): TestResultRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM test_results WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      projectId: str(row['project_id']),
      sessionId: nstr(row['session_id']),
      eventId: nstr(row['event_id']),
      suite: str(row['suite']),
      name: nstr(row['name']),
      kind: str(row['kind']),
      status: str(row['status']) as TestResultRecord['status'],
      durationMs: nnum(row['duration_ms']),
      passed: nnum(row['passed']),
      failed: nnum(row['failed']),
      skipped: nnum(row['skipped']),
      total: nnum(row['total']),
      output: nstr(row['output']),
      createdAt: str(row['created_at']),
    }));
  }

  // ------------------------------------------------------------------ links

  linkEvents(projectId: string, fromId: string, toId: string, relation: string, weight = 1): void {
    this.db
      .prepare(
        `INSERT INTO event_links (id, project_id, from_id, to_id, relation, weight, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(from_id, to_id, relation) DO UPDATE SET weight = excluded.weight`,
      )
      .run(newId(), projectId, fromId, toId, relation, weight, new Date().toISOString());
  }

  linksFor(eventId: string): Array<{ fromId: string; toId: string; relation: string; weight: number }> {
    const rows = this.db
      .prepare('SELECT from_id, to_id, relation, weight FROM event_links WHERE from_id = ? OR to_id = ?')
      .all(eventId, eventId) as Row[];
    return rows.map((r) => ({
      fromId: str(r['from_id']),
      toId: str(r['to_id']),
      relation: str(r['relation']),
      weight: Number(r['weight'] ?? 1),
    }));
  }

  // ------------------------------------------------------------------ audit

  /** CECC's own actions, kept separate so silencing events cannot hide enforcement. */
  audit(projectId: string | null, actor: string, action: string, detail: Record<string, unknown> = {}): void {
    this.db
      .prepare('INSERT INTO audit_log (id, project_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), projectId, actor, action, JSON.stringify(redactDeep(detail)), new Date().toISOString());
  }

  listAudit(projectId: string, limit = 100): Array<{ actor: string; action: string; detail: unknown; createdAt: string }> {
    const rows = this.db
      .prepare('SELECT actor, action, detail, created_at FROM audit_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as Row[];
    return rows.map((r) => ({
      actor: str(r['actor']),
      action: str(r['action']),
      detail: parseJson<unknown>(r['detail'], {}),
      createdAt: str(r['created_at']),
    }));
  }

  /** Deletes events past the retention window. Findings are kept — they are the durable record. */
  pruneOldEvents(projectId: string, retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const result = this.db
      .prepare('DELETE FROM events WHERE project_id = ? AND timestamp < ?')
      .run(projectId, cutoff);
    return Number(result.changes ?? 0);
  }
}
