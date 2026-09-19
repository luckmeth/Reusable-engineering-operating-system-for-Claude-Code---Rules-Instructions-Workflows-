/**
 * @cecc/ml — local machine learning for finding triage.
 *
 * Scope is deliberately narrow. Detection stays deterministic: rules produce
 * findings with exact evidence and a stated reason, and no model is allowed to
 * create, close or re-grade one. Learning is confined to ranking — deciding
 * what a given developer should read first — because that is the one question
 * where their own history is genuinely the best available signal.
 *
 * Everything runs locally. No external service, no API key, no network call.
 */
export { extractFeatures, buildHistory, emptyHistory, FEATURE_NAMES, type FeatureVector, type RuleHistory } from './features.js';
export { LogisticRegression, NaiveBayes, type TrainingExample, type LogisticModelData, type NaiveBayesData } from './model.js';
export { evaluate, rocAuc, describeMetrics, type Metrics } from './metrics.js';
export {
  collectLabels,
  describeDataset,
  toTrainingExamples,
  exportDataset,
  importDataset,
  MIN_TRAINING_EXAMPLES,
  MIN_PER_CLASS,
  type LabelledFinding,
  type DatasetStats,
  type ImportResult,
  type ExportedRow,
} from './dataset.js';
export { trainModel, saveModel, loadModel, modelPath, deleteModelFile, type TrainedModel, type TrainResult } from './train.js';
export { scoreFindings, rankFindings, type TriageScore } from './triage.js';
