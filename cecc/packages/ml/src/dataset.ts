import { readFileSync, writeFileSync } from 'node:fs';
import type { Finding, Store } from '@cecc/core';
import { buildHistory, extractFeatures, FEATURE_NAMES, type RuleHistory } from './features.js';
import type { TrainingExample } from './model.js';

/**
 * Training data.
 *
 * Labels come from decisions the developer already makes: resolving a finding
 * means "this mattered", suppressing it means "this was noise". No separate
 * labelling chore — the signal is a by-product of using the tool, which is the
 * only way a dataset like this ever gets built in practice.
 *
 * Datasets can also be imported, so a team can share a starting point or seed a
 * new project from an established one.
 */

export interface LabelledFinding {
  finding: Finding;
  label: 0 | 1;
  /** Where the label came from, so imported and observed data stay distinguishable. */
  origin: 'observed' | 'imported' | 'synthetic';
}

/**
 * Reads the developer's triage history out of the store.
 *
 * Only closed findings carry a label. An open finding is not an unlabelled
 * negative — it is a decision not yet made, and treating it as "dismissed"
 * would teach the model that everything is noise.
 */
export function collectLabels(store: Store, projectId: string): LabelledFinding[] {
  const closed = store.listFindings({
    projectId,
    status: ['resolved', 'suppressed', 'accepted'],
    limit: 5000,
  });

  return closed.map((finding) => ({
    finding,
    // Resolved means acted on. Suppressed or accepted means dismissed as noise.
    label: finding.status === 'resolved' ? (1 as const) : (0 as const),
    origin: 'observed' as const,
  }));
}

export interface DatasetStats {
  total: number;
  positive: number;
  negative: number;
  byOrigin: Record<string, number>;
  byRule: Record<string, { positive: number; negative: number }>;
  /** True when there is enough signal for training to be meaningful. */
  sufficient: boolean;
  /** How many more examples are needed, if not. */
  needed: number;
}

/**
 * Below this, a trained model would be fitting noise.
 *
 * The threshold is enforced rather than advisory: CECC shows "still learning"
 * and leaves the ordering alone instead of presenting a confident-looking
 * ranking derived from a handful of clicks.
 */
export const MIN_TRAINING_EXAMPLES = 30;
/** Both classes must be represented or the model cannot separate anything. */
export const MIN_PER_CLASS = 8;

export function describeDataset(labelled: LabelledFinding[]): DatasetStats {
  const positive = labelled.filter((l) => l.label === 1).length;
  const negative = labelled.length - positive;

  const byOrigin: Record<string, number> = {};
  const byRule: Record<string, { positive: number; negative: number }> = {};
  for (const item of labelled) {
    byOrigin[item.origin] = (byOrigin[item.origin] ?? 0) + 1;
    const rule = (byRule[item.finding.ruleId] ??= { positive: 0, negative: 0 });
    if (item.label === 1) rule.positive += 1;
    else rule.negative += 1;
  }

  const sufficient =
    labelled.length >= MIN_TRAINING_EXAMPLES && positive >= MIN_PER_CLASS && negative >= MIN_PER_CLASS;

  const needed = Math.max(
    MIN_TRAINING_EXAMPLES - labelled.length,
    MIN_PER_CLASS - positive,
    MIN_PER_CLASS - negative,
    0,
  );

  return { total: labelled.length, positive, negative, byOrigin, byRule, sufficient, needed };
}

export function toTrainingExamples(labelled: LabelledFinding[], history?: RuleHistory): TrainingExample[] {
  const ruleHistory =
    history ?? buildHistory(labelled.map((l) => ({ ruleId: l.finding.ruleId, label: l.label })));

  return labelled.map((item) => ({
    features: extractFeatures(item.finding, ruleHistory).values,
    label: item.label,
    findingId: item.finding.id,
    ruleId: item.finding.ruleId,
  }));
}

// ------------------------------------------------------------------ exchange

export interface ExportedRow {
  ruleId: string;
  severity: string;
  layer: string;
  detection: string;
  verification: string;
  confidence: number;
  affectedFiles: string[];
  occurrences: number;
  evidenceCount: number;
  label: 0 | 1;
}

/**
 * Exports a shareable dataset.
 *
 * Only the structural attributes that feed the model are written. Titles,
 * evidence text and file contents are deliberately excluded: a dataset is the
 * one artefact here designed to leave the machine, and it must not carry source
 * code or anything redaction would have caught.
 */
export function exportDataset(labelled: LabelledFinding[], path: string): number {
  const rows: ExportedRow[] = labelled.map(({ finding, label }) => ({
    ruleId: finding.ruleId,
    severity: finding.severity,
    layer: finding.layer,
    detection: finding.detection,
    verification: finding.verification,
    confidence: finding.confidence,
    // Extensions and directory shape only — never full paths, which leak structure.
    affectedFiles: finding.affectedFiles.map(shapeOfPath),
    occurrences: finding.occurrences,
    evidenceCount: finding.evidence.length,
    label,
  }));

  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return rows.length;
}

// Reduces a path to its shape, so a dataset carries directory and file kind
// without carrying the paths themselves: 'src/api/users.ts' becomes 'src/ts'.
function shapeOfPath(path: string): string {
  const parts = path.split(/[/\\]/);
  const file = parts[parts.length - 1] ?? '';
  const extension = /\.([a-z0-9]+)$/i.exec(file)?.[1] ?? '';
  const top = parts.length > 1 ? parts[0] : '';
  const isTest = /(^|[/\\])(?:tests?|__tests__|spec)[/\\]|\.(?:test|spec)\./i.test(path);
  return [top, isTest ? 'test' : '', extension ? `*.${extension}` : ''].filter(Boolean).join('/');
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Imports a dataset produced by `exportDataset`, or hand-written in the same
 * shape. Rows are validated individually so one malformed line does not
 * discard a usable file.
 */
export function importDataset(path: string): { examples: LabelledFinding[]; result: ImportResult } {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
  const examples: LabelledFinding[] = [];

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    result.errors.push(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return { examples, result };
  }

  const lines = text.split('\n').filter((l) => l.trim());
  for (const [index, line] of lines.entries()) {
    try {
      const row = JSON.parse(line) as Partial<ExportedRow>;
      if (!row.ruleId || (row.label !== 0 && row.label !== 1)) {
        result.skipped += 1;
        if (result.errors.length < 5) result.errors.push(`line ${index + 1}: missing ruleId or label`);
        continue;
      }

      // Rebuilt as a minimal Finding so feature extraction is identical for
      // imported and observed data — two code paths would drift.
      examples.push({
        label: row.label,
        origin: 'imported',
        finding: {
          id: `imported-${index}`,
          fingerprint: `imported-${index}`,
          ruleId: row.ruleId,
          title: row.ruleId,
          category: 'QUALITY',
          layer: (row.layer as Finding['layer']) ?? 'APPLICATION',
          severity: (row.severity as Finding['severity']) ?? 'medium',
          confidence: typeof row.confidence === 'number' ? row.confidence : 0.5,
          verification: (row.verification as Finding['verification']) ?? 'POTENTIAL',
          detection: (row.detection as Finding['detection']) ?? 'STATIC_ANALYSIS',
          status: row.label === 1 ? 'resolved' : 'suppressed',
          source: 'imported-dataset',
          projectId: 'imported',
          sessionId: null,
          workflowRunId: null,
          affectedFiles: row.affectedFiles ?? [],
          affectedLines: [],
          command: null,
          evidence: Array.from({ length: row.evidenceCount ?? 0 }, () => ({
            kind: 'file' as const,
            label: 'imported',
            detail: '',
          })),
          impact: '',
          recommendation: '',
          relatedEvents: [],
          relatedFindings: [],
          relatedTests: [],
          relatedCommits: [],
          occurrences: row.occurrences ?? 1,
          firstDetectedAt: new Date().toISOString(),
          lastDetectedAt: new Date().toISOString(),
          resolvedAt: null,
          suppression: null,
        },
      });
      result.imported += 1;
    } catch {
      result.skipped += 1;
      if (result.errors.length < 5) result.errors.push(`line ${index + 1}: not valid JSON`);
    }
  }

  return { examples, result };
}

export { FEATURE_NAMES };
