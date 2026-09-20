import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fingerprintFinding } from '../hash.js';
import type { Evidence, FindingCategory, SecurityLayer, Severity, SourceLocation, VerificationState } from '../types/common.js';
import type { NewFinding } from '../types/finding.js';
import type { ProjectConfig } from '../types/project.js';

const exec = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  /** True when the binary is not on PATH — the difference between "clean" and "absent". */
  missing: boolean;
}

/**
 * Runs a tool and returns its output whatever the exit code.
 *
 * Scanners signal findings with a non-zero exit, so treating exit != 0 as
 * failure would discard exactly the runs that found something. Only a spawn
 * error means the tool is really unusable.
 *
 * Arguments are always an array. A security tool that interpolates project
 * paths into a shell string would trip its own rule AGENT-011.
 */
export async function runTool(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    return { stdout, stderr, code: 0, missing: false };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const missing = e.code === 'ENOENT';
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? (e.message ?? ''),
      code: typeof e.code === 'number' ? e.code : missing ? -1 : 1,
      missing,
    };
  }
}

/** Best-effort version probe. A scanner still runs when this returns null. */
export async function probeVersion(cmd: string, args: string[], cwd: string): Promise<string | null> {
  const result = await runTool(cmd, args, cwd, 10_000);
  if (result.missing) return null;
  const text = `${result.stdout}${result.stderr}`.trim();
  return text.split('\n')[0]?.trim().slice(0, 40) ?? null;
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: 'critical',
  high: 'high',
  error: 'high',
  moderate: 'medium',
  medium: 'medium',
  warning: 'medium',
  low: 'low',
  info: 'info',
  information: 'info',
  none: 'info',
  unknown: 'low',
};

/** Maps a third-party severity word onto CECC's scale, defaulting down, not up. */
export function mapSeverity(raw: string | null | undefined, fallback: Severity = 'low'): Severity {
  if (!raw) return fallback;
  return SEVERITY_ALIASES[raw.trim().toLowerCase()] ?? fallback;
}

export interface ScannerFindingInput {
  ruleId: string;
  project: ProjectConfig;
  sessionId: string | null;
  workflowRunId: string | null;
  title: string;
  category: FindingCategory;
  layer: SecurityLayer;
  severity: Severity;
  confidence: number;
  verification: VerificationState;
  affectedFiles: string[];
  affectedLines?: SourceLocation[];
  evidence: Evidence[];
  impact: string;
  recommendation: string;
  /** Stable identity for this specific issue — advisory id, check id, etc. */
  discriminator: string;
  source: string;
}

/**
 * Builds a CECC finding from a scanner result.
 *
 * The discriminator is the scanner's own stable identifier (a CVE, a Semgrep
 * check id). Using it means re-running the scanner bumps `occurrences` on the
 * same finding rather than creating a new row each time, and a suppression
 * survives the next run.
 */
export function toScannerFinding(input: ScannerFindingInput): NewFinding {
  return {
    ruleId: input.ruleId,
    title: input.title,
    category: input.category,
    layer: input.layer,
    severity: input.severity,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    verification: input.verification,
    detection: input.ruleId === 'SCAN-SEMGREP' ? 'STATIC_ANALYSIS' : 'DEPENDENCY',
    status: 'open',
    source: input.source,
    projectId: input.project.id,
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId,
    affectedFiles: input.affectedFiles,
    affectedLines: input.affectedLines ?? [],
    command: null,
    evidence: input.evidence,
    impact: input.impact,
    recommendation: input.recommendation,
    relatedEvents: [],
    relatedFindings: [],
    relatedTests: [],
    relatedCommits: [],
    fingerprint: fingerprintFinding({
      ruleId: input.ruleId,
      projectId: input.project.id,
      files: input.affectedFiles,
      lines: (input.affectedLines ?? []).map((l) => l.line),
      command: null,
      discriminator: input.discriminator,
    }),
  };
}

/** Parses JSON that a tool may have prefixed with progress output. */
export function parseLooseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some tools print a banner before the document. Fall back to the first
    // balanced object, rather than giving up on an otherwise usable result.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

const LOCKFILE_NAMES = ['package-lock.json', 'npm-shrinkwrap.json'];
const SKIP_DIRS = /^(?:node_modules|dist|build|coverage|vendor|out|target|tmp)$/;

/**
 * Finds npm lockfiles at or below the project root.
 *
 * Looking only at the root is wrong often enough to matter: a repository whose
 * application lives in `app/` or `packages/*` would report "nothing to check",
 * which reads as a clean bill of health for a tree that was never examined. The
 * walk is bounded in depth and count so a large monorepo cannot turn a scan
 * into a filesystem crawl.
 */
export function findLockfiles(root: string, maxDepth = 2, limit = 8): string[] {
  const found: string[] = [];

  const visit = (dir: string, depth: number): void => {
    if (found.length >= limit) return;

    for (const name of LOCKFILE_NAMES) {
      if (existsSync(join(dir, name))) {
        found.push(relative(root, join(dir, name)) || name);
        break; // one lockfile per directory; shrinkwrap and package-lock are the same tree
      }
    }

    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not a reason to abandon the rest
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.test(entry.name)) continue;
      visit(join(dir, entry.name), depth + 1);
    }
  };

  visit(root, 0);
  return found;
}

/** Directory holding a lockfile, relative to the project root ('.' at the root). */
export function lockfileDir(lockfile: string): string {
  const dir = dirname(lockfile);
  return dir === '' ? '.' : dir;
}
