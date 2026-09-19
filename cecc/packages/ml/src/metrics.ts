/**
 * Evaluation metrics.
 *
 * Accuracy alone is misleading here and the product cannot afford a misleading
 * number. Most findings get dismissed, so a model that predicts "dismiss" for
 * everything scores well on accuracy while being useless. Precision, recall and
 * the confusion matrix are reported together, and the UI shows the baseline a
 * trivial model would achieve so the learned number has something to beat.
 */

export interface Metrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  /** Area under the ROC curve — ranking quality, which is what we actually use. */
  auc: number;
  confusion: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
  /** What "always predict the majority class" would score. The bar to beat. */
  baselineAccuracy: number;
  sampleCount: number;
  positiveCount: number;
}

export function evaluate(
  predictions: Array<{ score: number; label: 0 | 1 }>,
  threshold = 0.5,
): Metrics {
  const n = predictions.length;
  if (n === 0) {
    return {
      accuracy: 0, precision: 0, recall: 0, f1: 0, auc: 0.5,
      confusion: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 },
      baselineAccuracy: 0, sampleCount: 0, positiveCount: 0,
    };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const { score, label } of predictions) {
    const predicted = score >= threshold ? 1 : 0;
    if (predicted === 1 && label === 1) tp += 1;
    else if (predicted === 1 && label === 0) fp += 1;
    else if (predicted === 0 && label === 0) tn += 1;
    else fn += 1;
  }

  const positives = tp + fn;
  const negatives = tn + fp;
  const accuracy = (tp + tn) / n;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = positives > 0 ? tp / positives : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    accuracy,
    precision,
    recall,
    f1,
    auc: rocAuc(predictions),
    confusion: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn },
    baselineAccuracy: Math.max(positives, negatives) / n,
    sampleCount: n,
    positiveCount: positives,
  };
}

/**
 * ROC-AUC via the rank-sum identity.
 *
 * The most honest single number for this use: it measures whether the model
 * orders a positive above a negative, which is exactly what ranking a findings
 * list requires, and it is insensitive to the class imbalance that makes
 * accuracy flattering.
 */
export function rocAuc(predictions: Array<{ score: number; label: 0 | 1 }>): number {
  const positives = predictions.filter((p) => p.label === 1);
  const negatives = predictions.filter((p) => p.label === 0);
  // With only one class present, ranking is undefined. 0.5 is the honest answer.
  if (positives.length === 0 || negatives.length === 0) return 0.5;

  const sorted = [...predictions].sort((a, b) => a.score - b.score);
  const ranks = new Map<number, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length - 1 && sorted[j + 1]!.score === sorted[i]!.score) j += 1;
    // Ties share the average rank, otherwise identical scores would be ordered
    // by array position and inflate the result.
    const averageRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) ranks.set(k, averageRank);
    i = j + 1;
  }

  let rankSum = 0;
  sorted.forEach((item, index) => {
    if (item.label === 1) rankSum += ranks.get(index) ?? index + 1;
  });

  return (rankSum - (positives.length * (positives.length + 1)) / 2) / (positives.length * negatives.length);
}

/** Plain-language summary of what the numbers mean, for non-specialist readers. */
export function describeMetrics(metrics: Metrics): string {
  if (metrics.sampleCount === 0) return 'No evaluation data yet.';

  const lift = metrics.accuracy - metrics.baselineAccuracy;
  const quality =
    metrics.auc >= 0.8 ? 'ranks findings well'
    : metrics.auc >= 0.65 ? 'ranks findings better than chance'
    : metrics.auc >= 0.55 ? 'is only slightly better than chance'
    : 'is not yet learning anything useful';

  const caveat =
    lift <= 0.02
      ? ' It is not beating the simple rule of "assume everything gets dismissed", so treat its ordering with caution.'
      : '';

  return `On ${metrics.sampleCount} examples it never trained on, the model ${quality} (AUC ${metrics.auc.toFixed(2)}).${caveat}`;
}
