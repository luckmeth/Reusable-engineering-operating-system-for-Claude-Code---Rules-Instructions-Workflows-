import type { Finding } from '@cecc/core';

/**
 * Feature extraction for finding triage.
 *
 * Every feature here is named, human-readable and derived from data CECC
 * already records. That is a deliberate constraint: the model's whole job is to
 * order a list a person will read, and a ranking nobody can interrogate is
 * worse than no ranking. Named features mean the UI can say "ranked high
 * because AGENT-005 findings in src/ are usually fixed here", which is a claim
 * the user can agree or disagree with.
 *
 * No text embeddings, no opaque vectors. The feature space is small on purpose:
 * a developer produces tens to low hundreds of triage decisions, and a model
 * with thousands of parameters would memorize that rather than learn from it.
 */

export interface FeatureVector {
  /** Dense numeric values, aligned with FEATURE_NAMES. */
  values: number[];
  /** Human-readable description of the non-zero features, for explanation. */
  active: Array<{ name: string; value: number }>;
}

const SEVERITY_SCORE: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  info: 0.0,
};

const VERIFICATION_SCORE: Record<string, number> = {
  VERIFIED: 1.0,
  LIKELY: 0.75,
  POTENTIAL: 0.4,
  INFORMATIONAL: 0.2,
  NOT_TESTED: 0.1,
  BLOCKED: 0.1,
  UNKNOWN: 0.0,
};

/**
 * Rule identity is hashed into a fixed number of buckets rather than one-hot
 * encoded. New rules then need no retraining and no schema change, at the cost
 * of occasional collisions — an acceptable trade when the alternative is a
 * model that breaks every time a rule is added.
 */
const RULE_BUCKETS = 16;

function hashBucket(text: string, buckets: number): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % buckets;
}

/** Stable, ordered feature names. Index in this array is the index in `values`. */
export const FEATURE_NAMES: string[] = [
  'bias',
  'severity',
  'confidence',
  'verification_strength',
  'layer_application',
  'layer_agent',
  'layer_cecc',
  'detection_correlated',
  'detection_rule_based',
  'detection_static',
  'in_test_file',
  'in_config_file',
  'in_migration_file',
  'in_vendor_path',
  'has_line_numbers',
  'affected_file_count',
  'evidence_count',
  'occurrence_count',
  'related_event_count',
  'has_command',
  'title_length',
  'rule_suppression_history',
  'rule_resolution_history',
  ...Array.from({ length: RULE_BUCKETS }, (_, i) => `rule_bucket_${i}`),
];

/** Running per-rule statistics, so the model can learn "this rule is noise here". */
export interface RuleHistory {
  /** ruleId → times the user suppressed a finding from it. */
  suppressed: Record<string, number>;
  /** ruleId → times the user resolved (acted on) a finding from it. */
  resolved: Record<string, number>;
}

export const emptyHistory = (): RuleHistory => ({ suppressed: {}, resolved: {} });

/** Squashes an unbounded count into 0..1 so one outlier cannot dominate. */
const squash = (n: number, scale: number): number => Math.min(1, n / scale);

export function extractFeatures(finding: Finding, history: RuleHistory = emptyHistory()): FeatureVector {
  const values = new Array<number>(FEATURE_NAMES.length).fill(0);
  const set = (name: string, value: number): void => {
    const index = FEATURE_NAMES.indexOf(name);
    if (index >= 0) values[index] = value;
  };

  const paths = finding.affectedFiles.join(' ');

  set('bias', 1);
  set('severity', SEVERITY_SCORE[finding.severity] ?? 0);
  set('confidence', finding.confidence);
  set('verification_strength', VERIFICATION_SCORE[finding.verification] ?? 0);

  set('layer_application', finding.layer === 'APPLICATION' ? 1 : 0);
  set('layer_agent', finding.layer === 'AGENT' ? 1 : 0);
  set('layer_cecc', finding.layer === 'CECC' ? 1 : 0);

  set('detection_correlated', finding.detection === 'CORRELATED' ? 1 : 0);
  set('detection_rule_based', finding.detection === 'RULE_BASED' ? 1 : 0);
  set('detection_static', finding.detection === 'STATIC_ANALYSIS' ? 1 : 0);

  set('in_test_file', /(^|[/\\])(?:tests?|__tests__|spec)[/\\]|\.(?:test|spec)\./i.test(paths) ? 1 : 0);
  set('in_config_file', /\.(?:json|ya?ml|toml|config\.[jt]s)$/i.test(paths) ? 1 : 0);
  set('in_migration_file', /migrations?[/\\]|\.sql$/i.test(paths) ? 1 : 0);
  set('in_vendor_path', /node_modules|vendor|dist|build|\.next/i.test(paths) ? 1 : 0);

  set('has_line_numbers', finding.affectedLines.length > 0 ? 1 : 0);
  set('affected_file_count', squash(finding.affectedFiles.length, 10));
  set('evidence_count', squash(finding.evidence.length, 8));
  set('occurrence_count', squash(finding.occurrences, 20));
  set('related_event_count', squash(finding.relatedEvents.length, 10));
  set('has_command', finding.command ? 1 : 0);
  set('title_length', squash(finding.title.length, 120));

  // How this developer has treated this rule before. The single most
  // informative signal once any history exists.
  const suppressed = history.suppressed[finding.ruleId] ?? 0;
  const resolved = history.resolved[finding.ruleId] ?? 0;
  const total = suppressed + resolved;
  set('rule_suppression_history', total > 0 ? suppressed / total : 0);
  set('rule_resolution_history', total > 0 ? resolved / total : 0);

  set(`rule_bucket_${hashBucket(finding.ruleId, RULE_BUCKETS)}`, 1);

  const active = values
    .map((value, i) => ({ name: FEATURE_NAMES[i] ?? `f${i}`, value }))
    .filter((f) => f.value !== 0);

  return { values, active };
}

/** Builds rule history from already-triaged findings. */
export function buildHistory(triaged: Array<{ ruleId: string; label: number }>): RuleHistory {
  const history = emptyHistory();
  for (const item of triaged) {
    const bucket = item.label === 1 ? history.resolved : history.suppressed;
    bucket[item.ruleId] = (bucket[item.ruleId] ?? 0) + 1;
  }
  return history;
}
