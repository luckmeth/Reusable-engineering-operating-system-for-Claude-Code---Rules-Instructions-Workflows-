import { FEATURE_NAMES } from './features.js';

/**
 * Two classifiers, both trained locally from the user's own decisions.
 *
 * Logistic regression and naive Bayes are the right tools for this problem, not
 * a compromise. The training set is a developer's triage history — tens to a
 * few hundred labelled examples — where a high-capacity model would memorize
 * rather than generalize. Both of these also expose per-feature weights, which
 * matters more than raw accuracy: the model reorders a list a person reads, and
 * a ranking nobody can interrogate is worse than no ranking at all.
 *
 * No external service is involved. Training and inference are plain arithmetic
 * over a few dozen numbers, fast enough to run on every page load.
 */

export interface TrainingExample {
  features: number[];
  /** 1 = the developer acted on this finding, 0 = they dismissed it. */
  label: 0 | 1;
  /** Kept for reporting; never used as a feature. */
  findingId?: string;
  ruleId?: string;
}

export interface LogisticModelData {
  kind: 'logistic';
  weights: number[];
  featureNames: string[];
  /** Feature-wise mean and standard deviation used to standardize inputs. */
  mean: number[];
  std: number[];
  epochs: number;
  learningRate: number;
  l2: number;
  trainedAt: string;
  sampleCount: number;
}

const sigmoid = (z: number): number => {
  // Clamped to avoid overflow producing NaN on extreme scores.
  if (z >= 0) return 1 / (1 + Math.exp(-Math.min(z, 40)));
  const e = Math.exp(Math.max(z, -40));
  return e / (1 + e);
};

/**
 * Logistic regression trained with mini-batch gradient descent and L2
 * regularization.
 *
 * Standardization matters here because the features mix natural scales —
 * confidence sits in 0..1 while squashed counts cluster near 0. Without it the
 * gradient is dominated by whichever feature happens to have the widest range.
 */
export class LogisticRegression {
  private weights: number[];
  private mean: number[];
  private std: number[];

  constructor(
    private readonly featureCount: number = FEATURE_NAMES.length,
    private readonly learningRate = 0.1,
    private readonly l2 = 0.01,
  ) {
    this.weights = new Array<number>(featureCount).fill(0);
    this.mean = new Array<number>(featureCount).fill(0);
    this.std = new Array<number>(featureCount).fill(1);
  }

  private fitScaler(examples: TrainingExample[]): void {
    const n = examples.length;
    if (n === 0) return;

    for (let f = 0; f < this.featureCount; f += 1) {
      let sum = 0;
      for (const ex of examples) sum += ex.features[f] ?? 0;
      const mean = sum / n;

      let variance = 0;
      for (const ex of examples) {
        const d = (ex.features[f] ?? 0) - mean;
        variance += d * d;
      }
      // A constant feature has zero variance; dividing by it would produce NaN.
      const std = Math.sqrt(variance / n) || 1;

      this.mean[f] = mean;
      this.std[f] = std;
    }
    // The bias term must stay 1 after scaling, so it is never standardized.
    this.mean[0] = 0;
    this.std[0] = 1;
  }

  private scale(features: number[]): number[] {
    const out = new Array<number>(this.featureCount);
    for (let f = 0; f < this.featureCount; f += 1) {
      out[f] = ((features[f] ?? 0) - (this.mean[f] ?? 0)) / (this.std[f] ?? 1);
    }
    return out;
  }

  /**
   * Trains, optionally stopping early when a validation set stops improving.
   *
   * Early stopping is the main defence against overfitting on a small set: with
   * a hundred examples and forty features, running to convergence reliably
   * memorizes the training data.
   */
  train(
    examples: TrainingExample[],
    opts: { epochs?: number; batchSize?: number; validation?: TrainingExample[]; patience?: number } = {},
  ): { epochs: number; finalLoss: number; history: number[] } {
    const epochs = opts.epochs ?? 300;
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 16, examples.length));
    const patience = opts.patience ?? 25;

    this.fitScaler(examples);
    const scaled = examples.map((ex) => ({ x: this.scale(ex.features), y: ex.label }));

    // Class imbalance is the norm here: most findings get dismissed. Weighting
    // the minority class stops the model from predicting "dismiss" for
    // everything and calling that 85% accuracy.
    const positives = scaled.filter((s) => s.y === 1).length;
    const negatives = scaled.length - positives;
    const posWeight = positives > 0 ? Math.min(5, negatives / positives || 1) : 1;

    const history: number[] = [];
    let bestValidationLoss = Infinity;
    let bestWeights = [...this.weights];
    let sinceImprovement = 0;
    let ranEpochs = 0;

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      ranEpochs = epoch + 1;

      // Deterministic shuffle so a training run is reproducible.
      const order = shuffledIndices(scaled.length, epoch);

      for (let start = 0; start < order.length; start += batchSize) {
        const batch = order.slice(start, start + batchSize);
        const gradient = new Array<number>(this.featureCount).fill(0);

        for (const index of batch) {
          const sample = scaled[index];
          if (!sample) continue;
          const prediction = sigmoid(dot(this.weights, sample.x));
          const weight = sample.y === 1 ? posWeight : 1;
          const error = (prediction - sample.y) * weight;
          for (let f = 0; f < this.featureCount; f += 1) {
            gradient[f] = (gradient[f] ?? 0) + error * (sample.x[f] ?? 0);
          }
        }

        for (let f = 0; f < this.featureCount; f += 1) {
          // The bias is excluded from L2: shrinking it biases predictions
          // toward 0.5 rather than toward the true base rate.
          const penalty = f === 0 ? 0 : this.l2 * (this.weights[f] ?? 0);
          this.weights[f] = (this.weights[f] ?? 0) - this.learningRate * ((gradient[f] ?? 0) / batch.length + penalty);
        }
      }

      const loss = this.loss(opts.validation ?? examples);
      history.push(loss);

      if (opts.validation && opts.validation.length > 0) {
        if (loss < bestValidationLoss - 1e-5) {
          bestValidationLoss = loss;
          bestWeights = [...this.weights];
          sinceImprovement = 0;
        } else {
          sinceImprovement += 1;
          if (sinceImprovement >= patience) {
            this.weights = bestWeights;
            break;
          }
        }
      }
    }

    return { epochs: ranEpochs, finalLoss: history[history.length - 1] ?? 0, history };
  }

  /** Mean binary cross-entropy. */
  loss(examples: TrainingExample[]): number {
    if (examples.length === 0) return 0;
    let total = 0;
    for (const ex of examples) {
      const p = this.predict(ex.features);
      const clamped = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
      total += ex.label === 1 ? -Math.log(clamped) : -Math.log(1 - clamped);
    }
    return total / examples.length;
  }

  /** Probability that the developer would act on this finding. */
  predict(features: number[]): number {
    return sigmoid(dot(this.weights, this.scale(features)));
  }

  /**
   * Per-feature contribution to one prediction.
   *
   * This is what makes the ranking answerable: the UI can name the three
   * features that pushed a finding up, and the user can disagree with them.
   */
  explain(features: number[], topN = 5): Array<{ name: string; contribution: number; valueIsHigh: boolean }> {
    const scaled = this.scale(features);
    return this.weights
      .map((w, i) => ({
        name: FEATURE_NAMES[i] ?? `f${i}`,
        contribution: w * (scaled[i] ?? 0),
        // Whether this finding sits above or below average on the feature.
        // Without it the explanation cannot say "you rarely dismiss this rule"
        // as distinct from "you often dismiss this rule" — and those produce
        // the same contribution sign with opposite meanings.
        valueIsHigh: (scaled[i] ?? 0) >= 0,
      }))
      .filter((c) => c.name !== 'bias' && Math.abs(c.contribution) > 1e-6)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, topN);
  }

  /** Learned weights, largest magnitude first — the model's overall view. */
  featureWeights(topN = 12): Array<{ name: string; weight: number }> {
    return this.weights
      .map((weight, i) => ({ name: FEATURE_NAMES[i] ?? `f${i}`, weight }))
      .filter((w) => w.name !== 'bias')
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, topN);
  }

  toJSON(sampleCount: number, epochs: number): LogisticModelData {
    return {
      kind: 'logistic',
      weights: [...this.weights],
      featureNames: [...FEATURE_NAMES],
      mean: [...this.mean],
      std: [...this.std],
      epochs,
      learningRate: this.learningRate,
      l2: this.l2,
      trainedAt: new Date().toISOString(),
      sampleCount,
    };
  }

  static fromJSON(data: LogisticModelData): LogisticRegression {
    const model = new LogisticRegression(data.weights.length, data.learningRate, data.l2);
    model.weights = [...data.weights];
    model.mean = [...data.mean];
    model.std = [...data.std];
    return model;
  }
}

/**
 * Bernoulli naive Bayes over binarized features.
 *
 * Kept as a second model because it behaves very differently on tiny datasets:
 * it needs far fewer examples to produce something sensible, and comparing the
 * two is a cheap check on whether the logistic model has actually learned
 * anything or is just fitting noise.
 */
export interface NaiveBayesData {
  kind: 'naive-bayes';
  featureNames: string[];
  /** P(feature active | acted on), Laplace-smoothed. */
  positiveProbs: number[];
  negativeProbs: number[];
  priorPositive: number;
  trainedAt: string;
  sampleCount: number;
}

export class NaiveBayes {
  private positiveProbs: number[] = [];
  private negativeProbs: number[] = [];
  private priorPositive = 0.5;

  constructor(private readonly featureCount: number = FEATURE_NAMES.length) {
    this.positiveProbs = new Array<number>(featureCount).fill(0.5);
    this.negativeProbs = new Array<number>(featureCount).fill(0.5);
  }

  train(examples: TrainingExample[]): void {
    const positives = examples.filter((e) => e.label === 1);
    const negatives = examples.filter((e) => e.label === 0);
    // Laplace smoothing: without it a feature never seen with a class gives
    // probability zero, and one zero annihilates the whole product.
    const alpha = 1;

    for (let f = 0; f < this.featureCount; f += 1) {
      const posActive = positives.filter((e) => (e.features[f] ?? 0) > 0.5).length;
      const negActive = negatives.filter((e) => (e.features[f] ?? 0) > 0.5).length;
      this.positiveProbs[f] = (posActive + alpha) / (positives.length + 2 * alpha);
      this.negativeProbs[f] = (negActive + alpha) / (negatives.length + 2 * alpha);
    }

    this.priorPositive = (positives.length + alpha) / (examples.length + 2 * alpha);
  }

  predict(features: number[]): number {
    // Summed in log space; multiplying dozens of small probabilities underflows.
    let logPos = Math.log(this.priorPositive);
    let logNeg = Math.log(1 - this.priorPositive);

    for (let f = 0; f < this.featureCount; f += 1) {
      const active = (features[f] ?? 0) > 0.5;
      const p = this.positiveProbs[f] ?? 0.5;
      const n = this.negativeProbs[f] ?? 0.5;
      logPos += Math.log(active ? p : 1 - p);
      logNeg += Math.log(active ? n : 1 - n);
    }

    const max = Math.max(logPos, logNeg);
    const pos = Math.exp(logPos - max);
    const neg = Math.exp(logNeg - max);
    return pos / (pos + neg);
  }

  toJSON(sampleCount: number): NaiveBayesData {
    return {
      kind: 'naive-bayes',
      featureNames: [...FEATURE_NAMES],
      positiveProbs: [...this.positiveProbs],
      negativeProbs: [...this.negativeProbs],
      priorPositive: this.priorPositive,
      trainedAt: new Date().toISOString(),
      sampleCount,
    };
  }

  static fromJSON(data: NaiveBayesData): NaiveBayes {
    const model = new NaiveBayes(data.positiveProbs.length);
    model.positiveProbs = [...data.positiveProbs];
    model.negativeProbs = [...data.negativeProbs];
    model.priorPositive = data.priorPositive;
    return model;
  }
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** Deterministic shuffle — a seeded LCG keeps training runs reproducible. */
function shuffledIndices(length: number, seed: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  let state = (seed + 1) * 2654435761;
  for (let i = length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    const a = indices[i]!;
    const b = indices[j]!;
    indices[i] = b;
    indices[j] = a;
  }
  return indices;
}
