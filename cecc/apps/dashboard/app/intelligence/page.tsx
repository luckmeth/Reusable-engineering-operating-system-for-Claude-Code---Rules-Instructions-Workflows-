import { ceccPaths } from '@cecc/core';
import { collectLabels, describeDataset, loadModel, MIN_TRAINING_EXAMPLES } from '@cecc/ml';
import { Card, Empty } from '@/components/ui';
import { Action } from '@/components/Action';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import { trainModelAction } from '../actions';
import { DatasetImport } from './DatasetImport';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The model card.
 *
 * Everything about the model is on this page, including the parts that make it
 * look weak. A tool that shows a confident ranking without showing how well it
 * actually performs is doing the same thing this product exists to prevent, so
 * held-out accuracy, the baseline it must beat, the sample count and the
 * learned weights are all visible.
 */
export default function IntelligencePage() {
  let data;
  try {
    const root = resolveRoot();
    const labels = withStore(({ store, projectId }) => collectLabels(store, projectId));
    data = { root, labels, dataset: describeDataset(labels), model: loadModel(ceccPaths(root).dir) };
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { labels, dataset, model } = data;
  const metrics = model ? (model.preferred === 'logistic' ? model.metrics.logistic : model.metrics.naiveBayes) : null;
  const progress = Math.min(100, (dataset.total / MIN_TRAINING_EXAMPLES) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Learning from your decisions</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-faint">
          CECC learns which findings you actually act on, and uses that to decide what to show you first. It runs
          entirely on this machine — no external service, no account, nothing sent anywhere. It never creates, closes
          or re-grades a finding; it only changes the order you see them in.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card title="Teaching progress" className="lg:col-span-2" subtitle="Every finding you fix or dismiss is one example.">
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
            <div
              className="animate-grow-bar h-full rounded-full bg-gradient-to-r from-cecc to-ok transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Decisions recorded" value={dataset.total} />
            <Metric label="You fixed" value={dataset.positive} tone="text-ok" />
            <Metric label="You dismissed" value={dataset.negative} tone="text-ink-muted" />
          </div>

          {!dataset.sufficient ? (
            <div className="mt-4 rounded border border-sev-medium/30 bg-sev-medium/5 px-3 py-2.5">
              <p className="text-[13px] font-medium text-sev-medium">Still learning — {dataset.needed} more decisions needed</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                Below {MIN_TRAINING_EXAMPLES} examples, with at least 8 of each outcome, any model would just be
                memorising a handful of clicks. Until then findings stay ordered by severity, which is honest rather
                than clever. Keep using the fix and dismiss buttons and this fills up on its own.
              </p>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-start gap-3">
              <Action run={trainModelAction} variant="primary">
                {model ? 'Train again on the latest decisions' : 'Train the model now'}
              </Action>
              <p className="max-w-sm text-[11px] leading-relaxed text-ink-faint">
                Training takes a moment. A quarter of your decisions are held back and used to measure the result, so
                the score you see is on data the model never learned from.
              </p>
            </div>
          )}
        </Card>

        <Card title="How good is it?" subtitle={model ? `Trained ${relativeTime(model.trainedAt)}` : 'Not trained yet'}>
          {!model || !metrics ? (
            <Empty>No model yet. Findings are ordered by severity.</Empty>
          ) : (
            <>
              <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">{model.summary}</p>
              <dl className="space-y-2">
                <MetricRow
                  label="Ranking quality"
                  value={metrics.auc.toFixed(2)}
                  hint="1.00 is perfect, 0.50 is guessing"
                  good={metrics.auc >= 0.7}
                />
                <MetricRow
                  label="Correct predictions"
                  value={`${Math.round(metrics.accuracy * 100)}%`}
                  hint={`Guessing the most common answer gets ${Math.round(metrics.baselineAccuracy * 100)}%`}
                  good={metrics.accuracy > metrics.baselineAccuracy + 0.05}
                />
                <MetricRow
                  label="Of the ones it flagged"
                  value={`${Math.round(metrics.precision * 100)}% were right`}
                  hint="Higher means fewer wasted looks"
                  good={metrics.precision >= 0.6}
                />
                <MetricRow
                  label="Of the ones that mattered"
                  value={`${Math.round(metrics.recall * 100)}% were caught`}
                  hint="Higher means fewer missed"
                  good={metrics.recall >= 0.6}
                />
                <MetricRow label="Measured on" value={`${metrics.sampleCount} held-out examples`} hint="Data it never trained on" good />
              </dl>

              {metrics.auc < 0.6 && (
                <p className="mt-3 rounded border border-sev-medium/30 bg-sev-medium/5 px-2.5 py-2 text-[11px] leading-relaxed text-sev-medium">
                  This is not beating chance yet, so CECC is ignoring it and ordering by severity instead. More
                  decisions will help.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {model && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card title="What it learned" subtitle="The signals that move a finding up or down your list">
            <FeatureWeights weights={model.logistic.weights} names={model.logistic.featureNames} />
          </Card>

          <Card title="Where it was right and wrong" subtitle="On the held-out examples">
            <ConfusionMatrix confusion={metrics!.confusion} />
          </Card>
        </div>
      )}

      <Card
        title="Start from an existing dataset"
        subtitle="Import decisions from another project, or from a teammate, so a new project does not start from zero."
      >
        <DatasetImport />
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Exported datasets contain only the shape of each finding — which check fired, how severe, what kind of file.
          No code, no file paths, no evidence text. One line of JSON per decision.
        </p>
      </Card>

      {labels.length > 0 && (
        <Card title="Which checks you trust" subtitle="Built from your own fix and dismiss decisions">
          <div className="divide-y divide-surface-border">
            {Object.entries(dataset.byRule)
              .sort((a, b) => b[1].positive + b[1].negative - (a[1].positive + a[1].negative))
              .slice(0, 12)
              .map(([ruleId, counts]) => {
                const total = counts.positive + counts.negative;
                const actedOn = total > 0 ? counts.positive / total : 0;
                return (
                  <div key={ruleId} className="flex items-center gap-3 py-2">
                    <span className="mono w-24 shrink-0 text-[12px] text-ink-faint">{ruleId}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div className="animate-grow-bar h-full rounded-full bg-ok" style={{ width: `${actedOn * 100}%` }} />
                    </div>
                    <span className="w-40 shrink-0 text-right text-[11px] text-ink-faint">
                      you fixed {counts.positive} of {total}
                    </span>
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, tone = 'text-ink' }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

function MetricRow({ label, value, hint, good }: { label: string; value: string; hint: string; good: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-surface-border pb-1.5 last:border-0">
      <div className="min-w-0">
        <dt className="text-[12px] text-ink">{label}</dt>
        <dd className="text-[11px] text-ink-faint">{hint}</dd>
      </div>
      <span className={`mono shrink-0 ${good ? 'text-ok' : 'text-sev-medium'}`}>{value}</span>
    </div>
  );
}

/** Feature weights as a diverging bar chart — the model's overall view. */
function FeatureWeights({ weights, names }: { weights: number[]; names: string[] }) {
  // Rule identity is hashed across several buckets, so showing them
  // individually produces a row of identical, uninterpretable entries. They are
  // summarised as one line instead — still disclosed, but not pretending each
  // bucket means something on its own.
  const named = weights
    .map((weight, i) => ({ name: names[i] ?? `f${i}`, weight }))
    .filter((w) => w.name !== 'bias' && !w.name.startsWith('rule_bucket'));

  const ruleBucketStrength = weights
    .filter((_, i) => (names[i] ?? '').startsWith('rule_bucket'))
    .reduce((max, w) => Math.max(max, Math.abs(w)), 0);

  const top = named
    .filter((w) => Math.abs(w.weight) > 0.01)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 8);

  if (top.length === 0) return <Empty>The model has not found any strong signals yet.</Empty>;

  const max = Math.max(...top.map((w) => Math.abs(w.weight)));

  return (
    <>
    <ul className="space-y-2">
      {top.map((item) => {
        const pct = (Math.abs(item.weight) / max) * 50;
        const positive = item.weight > 0;
        return (
          <li key={item.name} className="text-[12px]">
            <div className="mb-0.5 flex justify-between">
              <span className="text-ink-muted">{humanize(item.name)}</span>
              <span className={positive ? 'text-ok' : 'text-sev-high'}>
                {positive ? 'more likely to matter' : 'less likely to matter'}
              </span>
            </div>
            <div className="relative h-1.5 w-full rounded-full bg-surface-hover">
              <span className="absolute left-1/2 top-0 h-full w-px bg-surface-border" />
              <span
                className={`animate-grow-bar absolute top-0 h-full rounded-full ${positive ? 'bg-ok' : 'bg-sev-high'}`}
                style={positive ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
    {ruleBucketStrength > 0.05 && (
      <p className="mt-3 border-t border-surface-border pt-2 text-[11px] leading-relaxed text-ink-faint">
        Which specific check produced a finding also carries weight. That signal is spread across several internal
        slots, so it is summarised here rather than listed as separate lines that would each mean nothing on their own.
      </p>
    )}
    </>
  );
}

function ConfusionMatrix({ confusion }: { confusion: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number } }) {
  const cells = [
    { label: 'Said "matters", and it did', value: confusion.truePositive, tone: 'text-ok border-ok/30 bg-ok/5' },
    { label: 'Said "matters", but you dismissed it', value: confusion.falsePositive, tone: 'text-sev-medium border-sev-medium/30 bg-sev-medium/5' },
    { label: 'Said "ignore", and you did', value: confusion.trueNegative, tone: 'text-ok border-ok/30 bg-ok/5' },
    { label: 'Said "ignore", but you fixed it', value: confusion.falseNegative, tone: 'text-sev-critical border-sev-critical/30 bg-sev-critical/5' },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {cells.map((cell) => (
          <div key={cell.label} className={`rounded border p-3 ${cell.tone}`}>
            <p className="text-2xl font-bold tabular-nums">{cell.value}</p>
            <p className="mt-0.5 text-[11px] leading-snug opacity-80">{cell.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        The bottom-right box is the one that costs you something: findings the model would have pushed down that you
        turned out to care about. Because the model only reorders and never hides anything, they were still on your
        list — just further down.
      </p>
    </>
  );
}

function humanize(name: string): string {
  const map: Record<string, string> = {
    severity: 'How severe it is',
    confidence: 'How confident the check is',
    verification_strength: 'How directly it was verified',
    layer_application: 'It is a software vulnerability',
    layer_agent: 'It is an AI shortcut',
    layer_cecc: 'It affects this tool',
    detection_correlated: 'It came from a sequence of events',
    detection_rule_based: 'It came from a definite rule',
    detection_static: 'It came from reading the code',
    in_test_file: 'It is in a test file',
    in_config_file: 'It is in a settings file',
    in_migration_file: 'It is in a database change',
    in_vendor_path: 'It is in generated code',
    has_line_numbers: 'It points at exact lines',
    affected_file_count: 'How many files it touches',
    evidence_count: 'How much evidence it has',
    occurrence_count: 'How often it recurs',
    related_event_count: 'How many events it links',
    has_command: 'It involves a command',
    title_length: 'Length of the description',
    rule_suppression_history: 'You usually dismiss this check',
    rule_resolution_history: 'You usually fix this check',
  };
  return map[name] ?? (name.startsWith('rule_bucket') ? 'Which check produced it' : name.replace(/_/g, ' '));
}
