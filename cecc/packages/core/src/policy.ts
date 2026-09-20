import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { allRules } from './rules/registry.js';
import type { Environment, PolicyMode, Severity } from './types/common.js';
import type { Policy, PolicySet } from './types/policy.js';

/**
 * Policy resolution and persistence.
 *
 * The default posture for a new project is WARN, not BLOCK. A tool that starts
 * by blocking work gets uninstalled on the first false positive, before it has
 * shown anyone a true one. Observing first, then tightening the rules that
 * prove themselves, is the sequence that survives contact with a real project.
 */

/** Paths whose modification always warrants elevated review. */
export const DEFAULT_PROTECTED_PATHS = [
  '.env',
  '.env.*',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/hooks/*',
  '.cecc/*',
  'cecc.config.json',
  'supabase/migrations/*',
  '.github/workflows/*',
  'vercel.json',
  'middleware.ts',
  'middleware.js',
];

/**
 * Rules that block by default once the project opts into ENFORCE.
 *
 * Kept deliberately short. Each one is unambiguous, has essentially no benign
 * reading, and is cheap to undo if wrong — which is the bar a rule has to clear
 * before it gets to stop someone's work.
 */
const DEFAULT_BLOCKING_RULES = new Set(['AGENT-002', 'AGENT-006', 'AGENT-007', 'AGENT-028']);

export function defaultPolicySet(environment: Environment = 'development'): PolicySet {
  const policies: Record<string, Policy> = {};
  const now = new Date().toISOString();

  for (const rule of allRules()) {
    policies[rule.id] = {
      ruleId: rule.id,
      enabled: true,
      // Everything starts at warn. ENFORCE is an explicit, later decision.
      mode: 'warn',
      environments: [],
      severityThreshold: 'info',
      exclusions: ['node_modules/*', 'dist/*', 'build/*', '.next/*', 'coverage/*', 'vendor/*'],
      rationale: '',
      owner: 'cecc-default',
      updatedAt: now,
    };
  }

  return {
    version: 1,
    defaultMode: 'warn',
    environment,
    policies,
    protectedPaths: [...DEFAULT_PROTECTED_PATHS],
    protectedPathMode: 'warn',
    checksum: null,
    updatedAt: now,
  };
}

/** Falls back to a synthesized default so an unknown rule id is never silently skipped. */
export function resolvePolicy(set: PolicySet, ruleId: string): Policy {
  const existing = set.policies[ruleId];
  if (existing) return existing;
  return {
    ruleId,
    enabled: true,
    mode: set.defaultMode,
    environments: [],
    severityThreshold: 'info',
    exclusions: [],
    rationale: 'synthesized default — rule has no explicit policy',
    owner: 'cecc-default',
    updatedAt: new Date().toISOString(),
  };
}

export type EnforcementAction = 'allow' | 'warn' | 'block';

export interface EnforcementDecision {
  action: EnforcementAction;
  /** Rule ids that drove the decision. */
  reasons: Array<{ ruleId: string; severity: Severity; title: string; mode: PolicyMode }>;
  message: string;
}

/**
 * Decides what to do about findings produced for a single action.
 *
 * Blocking requires three things to line up: the policy says block, the finding
 * is severe, and CECC is confident. A low-confidence heuristic must never stop
 * someone's work — that is the failure mode that gets security tooling disabled
 * wholesale, taking the high-confidence detections with it.
 */
export function decideEnforcement(
  set: PolicySet,
  findings: Array<{ ruleId: string; severity: Severity; title: string; confidence: number }>,
  opts: { minBlockConfidence?: number } = {},
): EnforcementDecision {
  const minConfidence = opts.minBlockConfidence ?? 0.85;
  const reasons: EnforcementDecision['reasons'] = [];
  let action: EnforcementAction = 'allow';

  for (const finding of findings) {
    const policy = resolvePolicy(set, finding.ruleId);
    if (!policy.enabled) continue;

    const mode = policy.mode;
    if (mode === 'observe') continue;

    reasons.push({ ruleId: finding.ruleId, severity: finding.severity, title: finding.title, mode });

    if (
      mode === 'block' &&
      (finding.severity === 'critical' || finding.severity === 'high') &&
      finding.confidence >= minConfidence
    ) {
      action = 'block';
    } else if (action !== 'block') {
      action = 'warn';
    }
  }

  const blocking = reasons.filter((r) => r.mode === 'block');
  const message =
    action === 'block'
      ? `CECC blocked this action: ${blocking.map((r) => `${r.ruleId} ${r.title}`).join('; ')}`
      : action === 'warn'
        ? `CECC warning: ${reasons.map((r) => `${r.ruleId} ${r.title}`).join('; ')}`
        : '';

  return { action, reasons, message };
}

export function isProtectedPath(set: PolicySet, file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return set.protectedPaths.some((pattern) => {
    const p = pattern.replace(/\\/g, '/');
    if (!p.includes('*')) return normalized === p || normalized.endsWith(`/${p}`);
    const regex = new RegExp(`(^|/)${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    return regex.test(normalized);
  });
}

// ------------------------------------------------------------------ storage

/**
 * The policy file is integrity-checked.
 *
 * Its checksum covers the policy content, so a later edit that does not go
 * through `savePolicySet` is detectable. This is what makes rule AGENT-028
 * meaningful: without it, the first thing a bypass would do is quietly relax
 * the policy that would have caught it.
 */
export function computePolicyChecksum(set: PolicySet): string {
  const { checksum: _ignored, updatedAt: _also, ...rest } = set;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

export function savePolicySet(path: string, set: PolicySet): PolicySet {
  const stamped: PolicySet = { ...set, updatedAt: new Date().toISOString() };
  stamped.checksum = computePolicyChecksum(stamped);
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`, 'utf8');
  return stamped;
}

export interface PolicyLoadResult {
  set: PolicySet;
  /** False when the on-disk checksum does not match the content. */
  integrityOk: boolean;
  /** True when no policy file existed and defaults were synthesized. */
  usedDefaults: boolean;
}

export function loadPolicySet(path: string, environment: Environment = 'development'): PolicyLoadResult {
  if (!existsSync(path)) {
    return { set: defaultPolicySet(environment), integrityOk: true, usedDefaults: true };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PolicySet;
    const expected = computePolicyChecksum(parsed);
    const integrityOk = parsed.checksum === null || parsed.checksum === expected;

    // Merge over defaults so a rule added in a later CECC version still has a
    // policy rather than silently falling through to "no opinion".
    const base = defaultPolicySet(parsed.environment ?? environment);
    return {
      set: { ...base, ...parsed, policies: { ...base.policies, ...parsed.policies } },
      integrityOk,
      usedDefaults: false,
    };
  } catch {
    // A corrupt policy file must fail loud but must not stop monitoring: fall
    // back to defaults, which are the safe (warn-everything) posture.
    return { set: defaultPolicySet(environment), integrityOk: false, usedDefaults: true };
  }
}

export function setRuleMode(set: PolicySet, ruleId: string, mode: PolicyMode, rationale: string, owner: string): PolicySet {
  const existing = resolvePolicy(set, ruleId);
  return {
    ...set,
    policies: {
      ...set.policies,
      [ruleId]: { ...existing, mode, rationale, owner, updatedAt: new Date().toISOString() },
    },
  };
}

export { DEFAULT_BLOCKING_RULES };
