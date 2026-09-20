import { allRules, getRule } from './registry.js';
import type { Rule, RuleContext, RuleResult } from './types.js';
import { fingerprintFinding } from '../hash.js';
import { SEVERITY_RANK, type Severity } from '../types/common.js';
import type { NewFinding } from '../types/finding.js';
import type { PolicySet } from '../types/policy.js';
import { resolvePolicy } from '../policy.js';

export interface RuleRunResult {
  findings: NewFinding[];
  /** Rules that threw. Recorded rather than swallowed — a broken rule is a coverage gap. */
  errors: Array<{ ruleId: string; message: string }>;
  /** Rules whose findings policy suppressed, and why. */
  suppressed: Array<{ ruleId: string; reason: string }>;
  rulesEvaluated: number;
  durationMs: number;
}

/**
 * Runs every applicable rule against one event.
 *
 * Isolation is the point of the try/catch around each rule: this runs inside a
 * Claude Code hook, and an exception escaping here would fail the hook and stall
 * the agent mid-task. A rule that throws is a bug in CECC, and CECC breaking
 * the developer's session is a far worse outcome than one missed detection —
 * so the error is recorded as a finding of its own and the run continues.
 */
export function runRules(ctx: RuleContext, policies: PolicySet): RuleRunResult {
  const started = Date.now();
  const findings: NewFinding[] = [];
  const errors: RuleRunResult['errors'] = [];
  const suppressed: RuleRunResult['suppressed'] = [];
  let rulesEvaluated = 0;

  for (const rule of allRules()) {
    const policy = resolvePolicy(policies, rule.id);

    if (!policy.enabled) {
      continue;
    }
    if (policy.environments.length > 0 && !policy.environments.includes(policies.environment)) {
      continue;
    }

    let matched = false;
    try {
      matched = rule.matches(ctx);
    } catch (err) {
      errors.push({ ruleId: rule.id, message: `matches() threw: ${describe(err)}` });
      continue;
    }
    if (!matched) continue;

    rulesEvaluated += 1;

    let results: RuleResult[] = [];
    try {
      results = rule.evaluate(ctx);
    } catch (err) {
      errors.push({ ruleId: rule.id, message: `evaluate() threw: ${describe(err)}` });
      continue;
    }

    for (const result of results) {
      const severity = result.severity ?? rule.severity;

      // Path exclusions are per-rule, so a rule can be muted for generated
      // directories without switching it off everywhere.
      const excluded = result.affectedFiles.length > 0 &&
        result.affectedFiles.every((file) => policy.exclusions.some((prefix) => matchesExclusion(file, prefix)));
      if (excluded) {
        suppressed.push({ ruleId: rule.id, reason: `all affected paths excluded by policy` });
        continue;
      }

      if (SEVERITY_RANK[severity] < SEVERITY_RANK[policy.severityThreshold]) {
        suppressed.push({ ruleId: rule.id, reason: `severity ${severity} below threshold ${policy.severityThreshold}` });
        continue;
      }

      findings.push(toFinding(rule, result, ctx, severity));
    }
  }

  return { findings, errors, suppressed, rulesEvaluated, durationMs: Date.now() - started };
}

function toFinding(rule: Rule, result: RuleResult, ctx: RuleContext, severity: Severity): NewFinding {
  return {
    ruleId: rule.id,
    title: result.title,
    category: rule.category,
    layer: rule.layer,
    severity,
    confidence: clamp01(result.confidence),
    verification: result.verification,
    detection: rule.detection,
    status: 'open',
    source: `rule-engine:${rule.id}`,
    projectId: ctx.project.id,
    sessionId: ctx.event.sessionId,
    workflowRunId: ctx.event.workflowRunId,
    affectedFiles: result.affectedFiles,
    affectedLines: result.affectedLines,
    command: result.command ?? ctx.event.command,
    evidence: result.evidence,
    impact: result.impact,
    recommendation: result.recommendation,
    relatedEvents: [ctx.event.id, ...(result.relatedEvents ?? [])],
    relatedFindings: [],
    relatedTests: [],
    relatedCommits: [],
    fingerprint: fingerprintFinding({
      ruleId: rule.id,
      projectId: ctx.project.id,
      files: result.affectedFiles,
      lines: result.affectedLines.map((l) => l.line),
      command: result.command ?? null,
      discriminator: result.discriminator ?? '',
    }),
  };
}

/** Simple prefix / `*` glob matching — enough for path exclusions, no dependency. */
function matchesExclusion(file: string, pattern: string): boolean {
  if (!pattern) return false;
  const normalized = file.replace(/\\/g, '/');
  const prefix = pattern.replace(/\\/g, '/');
  if (!prefix.includes('*')) return normalized === prefix || normalized.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
  const regex = new RegExp(`^${prefix.split('*').map(escapeRegex).join('.*')}$`);
  return regex.test(normalized);
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const describe = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

export { getRule };
