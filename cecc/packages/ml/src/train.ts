import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildHistory, type RuleHistory } from './features.js';
import { describeDataset, toTrainingExamples, type DatasetStats, type LabelledFinding } from './dataset.js';
import { describeMetrics, evaluate, type Metrics } from './metrics.js';
import { LogisticRegression, NaiveBayes, type LogisticModelData, type NaiveBayesData, type TrainingExample } from './model.js';

/**
 * Training, evaluation and persistence.
 *
 * Two commitments shape this file. Every trained model is evaluated on data it
 * never saw, and both the metrics and the sample count travel with the model so
 * the UI can never present a ranking without saying how well it actually
 * performs. Training below the sample threshold is refused outright rather than
 * producing an impressive-looking model fitted to a dozen clicks.
 */

export interface TrainedModel {
  logistic: LogisticModelData;
  naiveBayes: NaiveBayesData;
  ruleHistory: RuleHistory;
  metrics: { logistic: Metrics; naiveBayes: Metrics };
  /** Which model the triage ranking should use, chosen by held-out AUC. */
  preferred: 'logistic' | 'naive-bayes';
  dataset: DatasetStats;
  trainedAt: string;
  /** Plain-language summary shown to non-specialist readers. */
  summary: string;
  version: number;
}

export interface TrainResult {
  ok: boolean;
  model: TrainedModel | null;
  /** Why training was refused, when it was. */
  reason: string | null;
  dataset: DatasetStats;
}

const MODEL_VERSION = 1;

/**
 * Splits stratified by class so both sides of a small, imbalanced set keep
 * examples of each label. A random split of 40 examples routinely lands every
 * positive on one side, which makes the metrics meaningless.
 */
function stratifiedSplit(
  examples: TrainingExample[],
  validationRatio: number,
  seed = 7,
): { train: TrainingExample[]; validation: TrainingExample[] } {
  const positives = examples.filter((e) => e.label === 1);
  const negatives = examples.filter((e) => e.label === 0);

  const take = (list: TrainingExample[]): { train: TrainingExample[]; validation: TrainingExample[] } => {
    const shuffled = deterministicShuffle(list, seed);
    const holdout = Math.max(1, Math.round(shuffled.length * validationRatio));
    return { validation: shuffled.slice(0, holdout), train: shuffled.slice(holdout) };
  };

  const p = take(positives);
  const n = take(negatives);
  return {
    train: [...p.train, ...n.train],
    validation: [...p.validation, ...n.validation],
  };
}

function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = (seed + 1) * 2654435761;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function trainModel(labelled: LabelledFinding[], opts: { validationRatio?: number } = {}): TrainResult {
  const dataset = describeDataset(labelled);

  if (!dataset.sufficient) {
    return {
      ok: false,
      model: null,
      reason:
        `Not enough labelled examples yet. ${dataset.total} recorded; ` +
        `${dataset.needed} more needed, with at least 8 of each outcome. ` +
        `Resolve or dismiss findings as you work and the model will train itself.`,
      dataset,
    };
  }

  const ruleHistory = buildHistory(labelled.map((l) => ({ ruleId: l.finding.ruleId, label: l.label })));
  const examples = toTrainingExamples(labelled, ruleHistory);
  const { train, validation } = stratifiedSplit(examples, opts.validationRatio ?? 0.25);

  const logistic = new LogisticRegression();
  const run = logistic.train(train, { epochs: 400, batchSize: 16, validation, patience: 30 });

  const bayes = new NaiveBayes();
  bayes.train(train);

  // Evaluated only on held-out data. Reporting training accuracy would be
  // flattering and meaningless.
  const logisticMetrics = evaluate(validation.map((ex) => ({ score: logistic.predict(ex.features), label: ex.label })));
  const bayesMetrics = evaluate(validation.map((ex) => ({ score: bayes.predict(ex.features), label: ex.label })));

  const preferred = logisticMetrics.auc >= bayesMetrics.auc ? 'logistic' : 'naive-bayes';
  const best = preferred === 'logistic' ? logisticMetrics : bayesMetrics;

  return {
    ok: true,
    dataset,
    reason: null,
    model: {
      logistic: logistic.toJSON(train.length, run.epochs),
      naiveBayes: bayes.toJSON(train.length),
      ruleHistory,
      metrics: { logistic: logisticMetrics, naiveBayes: bayesMetrics },
      preferred,
      // Carried with the model so the UI can always state how much data it
      // learned from, alongside how well it performed.
      dataset,
      trainedAt: new Date().toISOString(),
      summary: describeMetrics(best),
      version: MODEL_VERSION,
    },
  };
}

// --------------------------------------------------------------- persistence

export const modelPath = (ceccDir: string): string => join(ceccDir, 'models', 'triage.json');

export function saveModel(ceccDir: string, model: TrainedModel): string {
  const path = modelPath(ceccDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  return path;
}

export function loadModel(ceccDir: string): TrainedModel | null {
  const path = modelPath(ceccDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TrainedModel;
    // A model from an older feature layout would silently mis-score. Refusing
    // to load it shows "not trained" rather than a confident wrong ranking.
    if (parsed.version !== MODEL_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteModelFile(ceccDir: string): boolean {
  const path = modelPath(ceccDir);
  if (!existsSync(path)) return false;
  writeFileSync(path, '', 'utf8');
  return true;
}

export { LogisticRegression, NaiveBayes };
