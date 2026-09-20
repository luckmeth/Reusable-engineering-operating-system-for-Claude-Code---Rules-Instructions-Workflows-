import type { Finding } from '@cecc/core';
import { extractFeatures } from './features.js';
import { LogisticRegression, NaiveBayes } from './model.js';
import type { TrainedModel } from './train.js';

/**
 * Applying the model.
 *
 * The model reorders a list. It never creates a finding, never closes one, and
 * never changes a severity. That boundary is the point: detection stays
 * deterministic and explainable, and learning is confined to the one question
 * where a person's own history genuinely helps — what to read first.
 */

export interface TriageScore {
  findingId: string;
  /** 0..1 — learned likelihood this developer acts on it. */
  score: number;
  /** Rank within the scored set, 1 = read first. */
  rank: number;
  /** Named features that moved this finding, for the UI to show. */
  reasons: Array<{ name: string; contribution: number; direction: 'up' | 'down'; valueIsHigh: boolean }>;
  /** Plain-language version of the same thing. */
  explanation: string;
}

/** Feature names rendered as phrases a non-specialist can read. */
/**
 * Each feature reads differently depending on whether this finding is above or
 * below average on it. Storing both spellings is what lets the explanation say
 * "you rarely dismiss this check" rather than the meaningless inverse.
 */
const FEATURE_PHRASES: Record<string, { high: string; low: string }> = {
  severity: { high: 'how severe it is', low: 'it being less severe than most' },
  confidence: { high: 'how confident the check is', low: 'the check being less certain than usual' },
  verification_strength: { high: 'it having been directly verified', low: 'it not having been directly verified' },
  layer_application: { high: 'it being a problem in your software', low: 'it not being a software vulnerability' },
  layer_agent: { high: 'it being something the AI did', low: 'it not being an AI shortcut' },
  layer_cecc: { high: 'it affecting this monitoring tool', low: 'it not affecting this tool' },
  detection_correlated: { high: 'it coming from a sequence of events', low: 'it coming from a single event' },
  detection_rule_based: { high: 'it coming from a definite rule', low: 'it not coming from a definite rule' },
  detection_static: { high: 'it coming from reading the code', low: 'it not coming from reading the code' },
  in_test_file: { high: 'it being in a test file', low: 'it not being in a test file' },
  in_config_file: { high: 'it being in a settings file', low: 'it not being in a settings file' },
  in_migration_file: { high: 'it being in a database change', low: 'it not being in a database change' },
  in_vendor_path: { high: 'it being in generated code', low: 'it being in code you wrote' },
  has_line_numbers: { high: 'it pointing at exact lines', low: 'it not pointing at exact lines' },
  affected_file_count: { high: 'how many files it touches', low: 'it touching few files' },
  evidence_count: { high: 'how much evidence it carries', low: 'it carrying little evidence' },
  occurrence_count: { high: 'how often it has come back', low: 'it being a one-off' },
  related_event_count: { high: 'how many events it links together', low: 'it linking few events' },
  has_command: { high: 'it involving a command', low: 'it not involving a command' },
  title_length: { high: 'the length of its description', low: 'its short description' },
  rule_suppression_history: { high: 'you usually dismissing this check', low: 'you rarely dismissing this check' },
  rule_resolution_history: { high: 'you usually fixing this check', low: 'you rarely fixing this check' },
};

const phrase = (name: string, valueIsHigh: boolean): string => {
  const entry = FEATURE_PHRASES[name];
  if (entry) return valueIsHigh ? entry.high : entry.low;
  return name.startsWith('rule_bucket') ? 'which check produced it' : name.replace(/_/g, ' ');
};

export function scoreFindings(findings: Finding[], model: TrainedModel): TriageScore[] {
  const logistic = LogisticRegression.fromJSON(model.logistic);
  const bayes = NaiveBayes.fromJSON(model.naiveBayes);

  const scored = findings.map((finding) => {
    const features = extractFeatures(finding, model.ruleHistory);
    const score =
      model.preferred === 'logistic' ? logistic.predict(features.values) : bayes.predict(features.values);

    // Explanations always come from the logistic model: naive Bayes has no
    // per-feature contribution that reads sensibly, and an unexplained ranking
    // is not one this product is willing to show.
    const contributions = logistic.explain(features.values, 3);

    const reasons = contributions.map((c) => ({
      name: c.name,
      contribution: c.contribution,
      direction: (c.contribution > 0 ? 'up' : 'down') as 'up' | 'down',
      valueIsHigh: c.valueIsHigh,
    }));

    return { findingId: finding.id, score, reasons, rank: 0, explanation: buildExplanation(reasons) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildExplanation(reasons: TriageScore['reasons']): string {
  if (reasons.length === 0) return 'No strong signal either way — ordered by severity.';

  const up = reasons.filter((r) => r.direction === 'up').map((r) => phrase(r.name, r.valueIsHigh));
  const down = reasons.filter((r) => r.direction === 'down').map((r) => phrase(r.name, r.valueIsHigh));

  const parts: string[] = [];
  if (up.length > 0) parts.push(`Prioritised because of ${joinPhrases(up)}`);
  if (down.length > 0) parts.push(`${parts.length ? 'lowered' : 'Lowered'} by ${joinPhrases(down)}`);
  return `${parts.join(', ')}.`;
}

function joinPhrases(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Orders findings for display.
 *
 * Without a usable model this falls back to severity ordering and says so.
 * Silently using a weak model would be the worst option: the list would look
 * intelligently ordered while being close to random.
 */
export function rankFindings(
  findings: Finding[],
  model: TrainedModel | null,
  opts: { minAuc?: number } = {},
): { ordered: Finding[]; scores: Map<string, TriageScore>; applied: boolean; reason: string } {
  const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const bySeverity = [...findings].sort(
    (a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0),
  );

  if (!model) {
    return { ordered: bySeverity, scores: new Map(), applied: false, reason: 'No model trained yet — ordered by severity.' };
  }

  const best = model.preferred === 'logistic' ? model.metrics.logistic : model.metrics.naiveBayes;
  const minAuc = opts.minAuc ?? 0.6;

  if (best.auc < minAuc) {
    return {
      ordered: bySeverity,
      scores: new Map(),
      applied: false,
      reason: `Model is not yet better than chance (AUC ${best.auc.toFixed(2)}) — ordered by severity instead.`,
    };
  }

  const scores = scoreFindings(findings, model);
  const scoreMap = new Map(scores.map((s) => [s.findingId, s]));
  const scoreOf = (id: string): number => scoreMap.get(id)?.score ?? 0;

  // Severity first, learned score second. The model reorders within a band and
  // is never allowed to move a finding across one: severity is a deterministic
  // statement about consequence, and no amount of personal history should be
  // able to bury a critical problem beneath a minor one.
  const ordered = [...findings].sort((a, b) => {
    const bySeverity = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
    if (bySeverity !== 0) return bySeverity;
    return scoreOf(b.id) - scoreOf(a.id);
  });

  // Ranks are renumbered against the final order so "#1 to look at" always
  // matches the position on screen.
  const reranked = new Map(
    ordered.map((finding, index) => {
      const existing = scoreMap.get(finding.id);
      return [finding.id, existing ? { ...existing, rank: index + 1 } : existing] as const;
    }),
  );

  return {
    ordered,
    scores: new Map([...reranked].filter((entry): entry is [string, TriageScore] => entry[1] !== undefined)),
    applied: true,
    reason: `Most serious first, then ordered by what you have acted on before (AUC ${best.auc.toFixed(2)} on held-out data).`,
  };
}
