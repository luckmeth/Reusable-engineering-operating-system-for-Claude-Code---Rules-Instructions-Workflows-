import { describe, expect, it } from 'vitest';
import {
  describeDataset,
  evaluate,
  extractFeatures,
  LogisticRegression,
  MIN_TRAINING_EXAMPLES,
  NaiveBayes,
  rankFindings,
  rocAuc,
  scoreFindings,
  toTrainingExamples,
  trainModel,
  type LabelledFinding,
} from '../src/index.js';
import type { Finding } from '@cecc/core';

/**
 * These tests exist to prove the model actually learns.
 *
 * A classifier that compiles and returns plausible numbers is easy to ship and
 * worthless. Each test below constructs data with a pattern that is known in
 * advance, then asserts the model recovers it — and, just as importantly, that
 * it reports honest metrics and declines to act when the data cannot support a
 * conclusion.
 */

let counter = 0;
function makeFinding(over: Partial<Finding> = {}): Finding {
  counter += 1;
  return {
    id: `f${counter}`,
    fingerprint: `fp${counter}`,
    ruleId: 'AGENT-005',
    title: 'Authorization check removed',
    category: 'ACCESS_CONTROL',
    layer: 'APPLICATION',
    severity: 'high',
    confidence: 0.8,
    verification: 'LIKELY',
    detection: 'STATIC_ANALYSIS',
    status: 'open',
    source: 'test',
    projectId: 'p',
    sessionId: 's',
    workflowRunId: null,
    affectedFiles: ['src/api/orders.ts'],
    affectedLines: [{ file: 'src/api/orders.ts', line: 10 }],
    command: null,
    evidence: [{ kind: 'line', label: 'x', detail: 'y' }],
    impact: 'i',
    recommendation: 'r',
    relatedEvents: [],
    relatedFindings: [],
    relatedTests: [],
    relatedCommits: [],
    occurrences: 1,
    firstDetectedAt: new Date().toISOString(),
    lastDetectedAt: new Date().toISOString(),
    resolvedAt: null,
    suppression: null,
    ...over,
  };
}

/**
 * A dataset with a rule the developer always acts on and one they always
 * dismiss, plus a genuinely ambiguous third. A useful model must separate the
 * first two.
 */
function syntheticDataset(size = 80): LabelledFinding[] {
  const out: LabelledFinding[] = [];
  for (let i = 0; i < size; i += 1) {
    const kind = i % 4;
    if (kind === 0 || kind === 1) {
      // Real problems in source: acted on.
      out.push({
        label: 1,
        origin: 'synthetic',
        finding: makeFinding({ ruleId: 'AGENT-005', severity: 'critical', affectedFiles: [`src/api/r${i}.ts`], confidence: 0.9 }),
      });
    } else if (kind === 2) {
      // Noise in test fixtures: dismissed.
      out.push({
        label: 0,
        origin: 'synthetic',
        finding: makeFinding({ ruleId: 'AGENT-004', severity: 'low', affectedFiles: [`tests/t${i}.test.ts`], confidence: 0.4 }),
      });
    } else {
      out.push({
        label: 0,
        origin: 'synthetic',
        finding: makeFinding({ ruleId: 'AGENT-016', severity: 'low', affectedFiles: [`node_modules/x${i}.js`], confidence: 0.3 }),
      });
    }
  }
  return out;
}

describe('feature extraction', () => {
  it('produces a stable-length vector', () => {
    const a = extractFeatures(makeFinding());
    const b = extractFeatures(makeFinding({ severity: 'low', layer: 'AGENT' }));
    expect(a.values.length).toBe(b.values.length);
    expect(a.values.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('separates severity levels', () => {
    const critical = extractFeatures(makeFinding({ severity: 'critical' }));
    const info = extractFeatures(makeFinding({ severity: 'info' }));
    const index = 1; // 'severity'
    expect(critical.values[index]).toBeGreaterThan(info.values[index]!);
  });

  it('recognises a test-file path', () => {
    const inTest = extractFeatures(makeFinding({ affectedFiles: ['tests/a.test.ts'] }));
    expect(inTest.active.some((f) => f.name === 'in_test_file')).toBe(true);
  });

  it('encodes the developer\'s history with a rule', () => {
    const history = { suppressed: { 'AGENT-004': 9 }, resolved: { 'AGENT-004': 1 } };
    const features = extractFeatures(makeFinding({ ruleId: 'AGENT-004' }), history);
    const suppressionIndex = features.active.find((f) => f.name === 'rule_suppression_history');
    expect(suppressionIndex?.value).toBeCloseTo(0.9, 5);
  });
});

describe('metrics', () => {
  it('computes AUC of 1 for a perfect ranking', () => {
    const perfect = [
      { score: 0.9, label: 1 as const },
      { score: 0.8, label: 1 as const },
      { score: 0.2, label: 0 as const },
      { score: 0.1, label: 0 as const },
    ];
    expect(rocAuc(perfect)).toBe(1);
  });

  it('computes AUC of 0.5 when every score is identical', () => {
    const tied = [
      { score: 0.5, label: 1 as const },
      { score: 0.5, label: 0 as const },
      { score: 0.5, label: 1 as const },
      { score: 0.5, label: 0 as const },
    ];
    // Tied scores carry no ranking information; anything above 0.5 here would
    // be an artefact of array order.
    expect(rocAuc(tied)).toBe(0.5);
  });

  it('computes AUC of 0 for a perfectly inverted ranking', () => {
    const inverted = [
      { score: 0.1, label: 1 as const },
      { score: 0.2, label: 1 as const },
      { score: 0.8, label: 0 as const },
      { score: 0.9, label: 0 as const },
    ];
    expect(rocAuc(inverted)).toBe(0);
  });

  it('reports the majority-class baseline so accuracy can be judged', () => {
    // 9 negatives, 1 positive: predicting "negative" always scores 0.9.
    const skewed = [
      ...Array.from({ length: 9 }, () => ({ score: 0.1, label: 0 as const })),
      { score: 0.1, label: 1 as const },
    ];
    const metrics = evaluate(skewed);
    expect(metrics.accuracy).toBeCloseTo(0.9, 5);
    expect(metrics.baselineAccuracy).toBeCloseTo(0.9, 5);
    // Accuracy equal to the baseline means the model learned nothing.
    expect(metrics.recall).toBe(0);
  });
});

describe('logistic regression', () => {
  it('learns a linearly separable pattern', () => {
    const examples = toTrainingExamples(syntheticDataset(120));
    const model = new LogisticRegression();
    model.train(examples, { epochs: 300 });

    const predictions = examples.map((ex) => ({ score: model.predict(ex.features), label: ex.label }));
    const metrics = evaluate(predictions);

    expect(metrics.auc).toBeGreaterThan(0.9);
    expect(metrics.accuracy).toBeGreaterThan(metrics.baselineAccuracy);
  });

  it('reduces loss over training', () => {
    const examples = toTrainingExamples(syntheticDataset(80));
    const model = new LogisticRegression();
    const before = model.loss(examples);
    model.train(examples, { epochs: 200 });
    expect(model.loss(examples)).toBeLessThan(before);
  });

  it('produces named per-feature explanations', () => {
    const data = syntheticDataset(120);
    const examples = toTrainingExamples(data);
    const model = new LogisticRegression();
    model.train(examples, { epochs: 300 });

    const explanation = model.explain(examples[0]!.features, 3);
    expect(explanation.length).toBeGreaterThan(0);
    // Every contribution must map to a readable feature name, not an index.
    expect(explanation.every((e) => e.name.length > 0 && !/^f\d+$/.test(e.name))).toBe(true);
  });

  it('survives a round trip through JSON unchanged', () => {
    const examples = toTrainingExamples(syntheticDataset(80));
    const model = new LogisticRegression();
    model.train(examples, { epochs: 100 });

    const restored = LogisticRegression.fromJSON(model.toJSON(examples.length, 100));
    const sample = examples[5]!.features;
    expect(restored.predict(sample)).toBeCloseTo(model.predict(sample), 10);
  });

  it('does not produce NaN on extreme inputs', () => {
    const model = new LogisticRegression();
    model.train(toTrainingExamples(syntheticDataset(60)), { epochs: 50 });
    const extreme = new Array(40).fill(1e9);
    const prediction = model.predict(extreme);
    expect(Number.isFinite(prediction)).toBe(true);
    expect(prediction).toBeGreaterThanOrEqual(0);
    expect(prediction).toBeLessThanOrEqual(1);
  });
});

describe('naive bayes', () => {
  it('learns the same pattern with far less data', () => {
    const examples = toTrainingExamples(syntheticDataset(40));
    const model = new NaiveBayes();
    model.train(examples);

    const metrics = evaluate(examples.map((ex) => ({ score: model.predict(ex.features), label: ex.label })));
    expect(metrics.auc).toBeGreaterThan(0.8);
  });
});

describe('training pipeline', () => {
  it('refuses to train below the sample threshold', () => {
    const result = trainModel(syntheticDataset(12));
    expect(result.ok).toBe(false);
    expect(result.model).toBeNull();
    // The refusal must be actionable, not a bare error.
    expect(result.reason).toContain('more needed');
    expect(result.dataset.needed).toBeGreaterThan(0);
  });

  it('refuses when one outcome is missing entirely', () => {
    const allPositive: LabelledFinding[] = Array.from({ length: 50 }, () => ({
      label: 1 as const,
      origin: 'synthetic' as const,
      finding: makeFinding(),
    }));
    expect(trainModel(allPositive).ok).toBe(false);
  });

  it('trains and reports held-out metrics', () => {
    const result = trainModel(syntheticDataset(120));
    expect(result.ok).toBe(true);

    const model = result.model!;
    expect(model.metrics.logistic.sampleCount).toBeGreaterThan(0);
    expect(model.metrics.logistic.auc).toBeGreaterThan(0.8);
    // Metrics must come from data the model never saw.
    expect(model.metrics.logistic.sampleCount).toBeLessThan(model.dataset.total);
    expect(model.summary).toContain('never trained on');
  });

  it('picks whichever model ranks better on held-out data', () => {
    const model = trainModel(syntheticDataset(120)).model!;
    const chosen = model.preferred === 'logistic' ? model.metrics.logistic : model.metrics.naiveBayes;
    const other = model.preferred === 'logistic' ? model.metrics.naiveBayes : model.metrics.logistic;
    expect(chosen.auc).toBeGreaterThanOrEqual(other.auc);
  });

  it('is reproducible — the same data trains the same model', () => {
    const data = syntheticDataset(120);
    const a = trainModel(data).model!;
    const b = trainModel(data).model!;
    expect(a.logistic.weights).toEqual(b.logistic.weights);
  });
});

describe('triage ranking', () => {
  it('orders by severity when no model exists', () => {
    const findings = [makeFinding({ severity: 'low' }), makeFinding({ severity: 'critical' })];
    const result = rankFindings(findings, null);
    expect(result.applied).toBe(false);
    expect(result.ordered[0]?.severity).toBe('critical');
    expect(result.reason).toContain('No model trained');
  });

  it('refuses to reorder using a model no better than chance', () => {
    const model = trainModel(syntheticDataset(120)).model!;
    // Force the recorded quality down; ranking must decline rather than
    // present a confident-looking but meaningless order.
    const weak = { ...model, metrics: { ...model.metrics, logistic: { ...model.metrics.logistic, auc: 0.51 } } };
    const result = rankFindings([makeFinding()], weak);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('not yet better than chance');
  });

  it('applies the learned order once the model is good enough', () => {
    const model = trainModel(syntheticDataset(160)).model!;
    const findings = [
      makeFinding({ ruleId: 'AGENT-004', severity: 'low', affectedFiles: ['tests/a.test.ts'], confidence: 0.4 }),
      makeFinding({ ruleId: 'AGENT-005', severity: 'critical', affectedFiles: ['src/api/x.ts'], confidence: 0.9 }),
    ];
    const result = rankFindings(findings, model);

    expect(result.applied).toBe(true);
    // The pattern the model was taught: source findings outrank test-file noise.
    expect(result.ordered[0]?.ruleId).toBe('AGENT-005');
    expect(result.scores.get(result.ordered[0]!.id)?.rank).toBe(1);
  });

  it('never lets the model move a finding across a severity band', () => {
    // Learning from habit is useful for ordering equals. It must not be able
    // to bury a critical problem under a minor one because the developer
    // happens to dismiss that check often.
    const model = trainModel(syntheticDataset(160)).model!;
    const findings = [
      // Exactly the shape the model learned to rank highly, but only low severity.
      makeFinding({ ruleId: 'AGENT-005', severity: 'low', affectedFiles: ['src/api/a.ts'], confidence: 0.95 }),
      // Exactly the shape it learned to rank low, but critical.
      makeFinding({ ruleId: 'AGENT-004', severity: 'critical', affectedFiles: ['tests/b.test.ts'], confidence: 0.3 }),
    ];

    const result = rankFindings(findings, model);
    expect(result.applied).toBe(true);
    expect(result.ordered[0]?.severity).toBe('critical');
  });

  it('orders within a severity band by what the developer acts on', () => {
    const model = trainModel(syntheticDataset(160)).model!;
    const findings = [
      makeFinding({ ruleId: 'AGENT-004', severity: 'high', affectedFiles: ['tests/n.test.ts'], confidence: 0.3 }),
      makeFinding({ ruleId: 'AGENT-005', severity: 'high', affectedFiles: ['src/api/n.ts'], confidence: 0.95 }),
    ];

    const result = rankFindings(findings, model);
    expect(result.ordered[0]?.ruleId).toBe('AGENT-005');
    expect(result.scores.get(result.ordered[0]!.id)?.rank).toBe(1);
  });

  it('describes a feature differently depending on which side of average it is', () => {
    // The bug this guards: a negative weight on "you usually dismiss this" times
    // a below-average value gives a positive contribution, which previously
    // rendered as "prioritised because you usually dismiss this" — the opposite
    // of what the model actually concluded.
    const data = syntheticDataset(160);
    const model = new LogisticRegression();
    model.train(toTrainingExamples(data), { epochs: 300 });

    const high = extractFeatures(
      makeFinding({ ruleId: 'AGENT-004' }),
      { suppressed: { 'AGENT-004': 20 }, resolved: {} },
    );
    const low = extractFeatures(
      makeFinding({ ruleId: 'AGENT-004' }),
      { suppressed: {}, resolved: { 'AGENT-004': 20 } },
    );

    const highSide = model.explain(high.values, 25).find((c) => c.name === 'rule_suppression_history');
    const lowSide = model.explain(low.values, 25).find((c) => c.name === 'rule_suppression_history');

    expect(highSide?.valueIsHigh).toBe(true);
    expect(lowSide?.valueIsHigh).toBe(false);
  });

  it('explains every score in plain language', () => {
    const model = trainModel(syntheticDataset(120)).model!;
    const scores = scoreFindings([makeFinding()], model);
    expect(scores[0]?.explanation.length).toBeGreaterThan(10);
    // No raw feature identifiers should reach the user.
    expect(scores[0]?.explanation).not.toMatch(/rule_bucket_\d/);
  });
});

describe('dataset', () => {
  it('reports how many more examples are needed', () => {
    const stats = describeDataset(syntheticDataset(10));
    expect(stats.sufficient).toBe(false);
    expect(stats.needed).toBe(MIN_TRAINING_EXAMPLES - 10);
  });

  it('counts both outcomes per rule', () => {
    const stats = describeDataset(syntheticDataset(80));
    expect(stats.byRule['AGENT-005']?.positive).toBeGreaterThan(0);
    expect(stats.byRule['AGENT-004']?.negative).toBeGreaterThan(0);
  });
});
