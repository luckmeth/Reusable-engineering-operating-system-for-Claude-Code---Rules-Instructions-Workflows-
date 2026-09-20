import type { Severity } from '@cecc/core';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function severityClass(severity: string): string {
  return `sev-${severity}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return iso;
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toISOString().slice(11, 19);
}

/** Counts findings by severity for the summary strips. */
export function countBySeverity(findings: Array<{ severity: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

export const LAYER_LABEL: Record<string, string> = {
  APPLICATION: 'Application security',
  AGENT: 'Agent shortcuts',
  CECC: 'CECC integrity',
};

export const LAYER_DESCRIPTION: Record<string, string> = {
  APPLICATION: 'Vulnerabilities in the software being built',
  AGENT: 'Dangerous shortcuts taken by the coding agent',
  CECC: 'Attacks on the monitoring system itself',
};

/** Event types grouped for the activity filter. */
export const EVENT_GROUPS: Record<string, string[]> = {
  All: [],
  Files: ['file.read', 'file.created', 'file.modified', 'file.deleted'],
  Commands: ['command.started', 'command.completed', 'command.failed'],
  Tests: ['test.run', 'lint.run', 'typecheck.run', 'build.run'],
  Git: ['git.status', 'git.commit', 'git.branch', 'git.push'],
  Security: ['security.scan', 'dependency.scan', 'finding.opened'],
  Workflow: ['workflow.stage.entered', 'workflow.stage.completed', 'workflow.gate.evaluated'],
};
