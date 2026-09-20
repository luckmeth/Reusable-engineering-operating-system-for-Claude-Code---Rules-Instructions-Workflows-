import './suppress-sqlite-warning.js';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * `node:sqlite` is loaded through createRequire rather than a static import.
 *
 * It is a real Node builtin from 22.5 onward, but bundlers that predate it —
 * including the Vite version inside Vitest 2.x — try to resolve it from disk
 * and fail. createRequire is opaque to static analysis, so the module is
 * resolved by Node at runtime where it genuinely exists. This keeps CECC
 * bundleable by consumers without requiring every one of them to configure an
 * externals list.
 *
 * The `import type` above is erased at compile time, so full typing is retained
 * with no runtime import for a bundler to trip over. The side-effect import on
 * the first line installs the experimental-warning filter before this runs.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export type Db = InstanceType<typeof DatabaseSync>;

export const SCHEMA_VERSION = 1;

/**
 * Migrations are append-only and applied in order. Editing an applied migration
 * would leave existing installs on a schema that no longer matches the code, so
 * corrections go in a new entry.
 */
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      root            TEXT NOT NULL UNIQUE,
      environment     TEXT NOT NULL DEFAULT 'development',
      adapters        TEXT NOT NULL DEFAULT '[]',
      stack           TEXT NOT NULL DEFAULT '{}',
      cloud_sync      TEXT NOT NULL DEFAULT '{}',
      retention_days  INTEGER NOT NULL DEFAULT 90,
      created_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      external_id     TEXT,
      agent_id        TEXT,
      agent_version   TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      start_reason    TEXT,
      end_reason      TEXT,
      cwd             TEXT,
      permission_mode TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id, started_at DESC);
    -- One CECC session per adapter session, so repeated hook calls reuse it.
    CREATE UNIQUE INDEX IF NOT EXISTS sessions_external_idx
      ON sessions(project_id, external_id) WHERE external_id IS NOT NULL;

    -- seq is the ordering of record. Wall-clock timestamps from concurrent hook
    -- processes are not reliably ordered, and order is evidence.
    CREATE TABLE IF NOT EXISTS events (
      seq             INTEGER PRIMARY KEY AUTOINCREMENT,
      id              TEXT NOT NULL UNIQUE,
      timestamp       TEXT NOT NULL,
      project_id      TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      workflow_run_id TEXT,
      agent_id        TEXT,
      source          TEXT NOT NULL,
      type            TEXT NOT NULL,
      severity        TEXT NOT NULL,
      status          TEXT NOT NULL,
      command         TEXT,
      tool            TEXT,
      file_paths      TEXT NOT NULL DEFAULT '[]',
      metadata        TEXT NOT NULL DEFAULT '{}',
      evidence        TEXT NOT NULL DEFAULT '[]',
      duration_ms     INTEGER,
      parent_event_id TEXT,
      content_hash    TEXT,
      -- CECC's own annotation: which rules fired on this event. Written after
      -- insert, so it is deliberately excluded from the integrity hash.
      finding_rule_ids TEXT NOT NULL DEFAULT '[]',
      -- Hash of the previous event in this project, forming a chain. A deleted
      -- or edited row breaks verification downstream: tamper-evident, not
      -- tamper-proof (a writer with file access can rebuild the chain).
      prev_hash       TEXT,
      chain_hash      TEXT
    );
    CREATE INDEX IF NOT EXISTS events_project_idx  ON events(project_id, seq DESC);
    CREATE INDEX IF NOT EXISTS events_session_idx  ON events(session_id, seq DESC);
    CREATE INDEX IF NOT EXISTS events_type_idx     ON events(project_id, type, seq DESC);
    CREATE INDEX IF NOT EXISTS events_workflow_idx ON events(workflow_run_id, seq DESC);

    CREATE TABLE IF NOT EXISTS findings (
      id                TEXT PRIMARY KEY,
      fingerprint       TEXT NOT NULL,
      rule_id           TEXT NOT NULL,
      title             TEXT NOT NULL,
      category          TEXT NOT NULL,
      layer             TEXT NOT NULL,
      severity          TEXT NOT NULL,
      confidence        REAL NOT NULL,
      verification      TEXT NOT NULL,
      detection         TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open',
      source            TEXT NOT NULL,
      project_id        TEXT NOT NULL,
      session_id        TEXT,
      workflow_run_id   TEXT,
      affected_files    TEXT NOT NULL DEFAULT '[]',
      affected_lines    TEXT NOT NULL DEFAULT '[]',
      command           TEXT,
      evidence          TEXT NOT NULL DEFAULT '[]',
      impact            TEXT NOT NULL DEFAULT '',
      recommendation    TEXT NOT NULL DEFAULT '',
      related_events    TEXT NOT NULL DEFAULT '[]',
      related_findings  TEXT NOT NULL DEFAULT '[]',
      related_tests     TEXT NOT NULL DEFAULT '[]',
      related_commits   TEXT NOT NULL DEFAULT '[]',
      occurrences       INTEGER NOT NULL DEFAULT 1,
      first_detected_at TEXT NOT NULL,
      last_detected_at  TEXT NOT NULL,
      resolved_at       TEXT,
      suppression       TEXT
    );
    -- Re-detection updates the existing row instead of piling up duplicates.
    CREATE UNIQUE INDEX IF NOT EXISTS findings_fingerprint_idx ON findings(project_id, fingerprint);
    CREATE INDEX IF NOT EXISTS findings_status_idx ON findings(project_id, status, severity);
    CREATE INDEX IF NOT EXISTS findings_layer_idx  ON findings(project_id, layer, status);
    CREATE INDEX IF NOT EXISTS findings_session_idx ON findings(session_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      priority            TEXT NOT NULL DEFAULT 'medium',
      status              TEXT NOT NULL DEFAULT 'TODO',
      stage               TEXT,
      dependencies        TEXT NOT NULL DEFAULT '[]',
      affected_files      TEXT NOT NULL DEFAULT '[]',
      tests               TEXT NOT NULL DEFAULT '[]',
      security_checks     TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      evidence_event_ids  TEXT NOT NULL DEFAULT '[]',
      origin              TEXT NOT NULL DEFAULT 'user',
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id, status);

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      session_id    TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      pinned_stage  TEXT,
      stages        TEXT NOT NULL DEFAULT '[]',
      started_at    TEXT NOT NULL,
      ended_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS workflow_session_idx ON workflow_runs(session_id);
    CREATE INDEX IF NOT EXISTS workflow_project_idx ON workflow_runs(project_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS test_results (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      session_id  TEXT,
      event_id    TEXT,
      suite       TEXT NOT NULL,
      name        TEXT,
      kind        TEXT NOT NULL DEFAULT 'unit',
      status      TEXT NOT NULL,
      duration_ms INTEGER,
      passed      INTEGER,
      failed      INTEGER,
      skipped     INTEGER,
      total       INTEGER,
      output      TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS test_project_idx ON test_results(project_id, created_at DESC);

    -- The correlation graph. Relationships between events are what turn a log
    -- into an explanation, so they are stored rather than recomputed.
    CREATE TABLE IF NOT EXISTS event_links (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_id    TEXT NOT NULL,
      to_id      TEXT NOT NULL,
      relation   TEXT NOT NULL,
      weight     REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS links_from_idx ON event_links(from_id);
    CREATE INDEX IF NOT EXISTS links_to_idx   ON event_links(to_id);
    CREATE UNIQUE INDEX IF NOT EXISTS links_unique_idx ON event_links(from_id, to_id, relation);

    -- CECC's own actions. Separate from events so that disabling event
    -- collection cannot also hide enforcement and policy history.
    CREATE TABLE IF NOT EXISTS audit_log (
      id         TEXT PRIMARY KEY,
      project_id TEXT,
      actor      TEXT NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_project_idx ON audit_log(project_id, created_at DESC);
  `,
  },
];

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  // WAL lets the dashboard read while hook processes write. Without it,
  // a read would block a hook, and a blocked hook stalls the agent.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `CECC migration ${migration.version} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
