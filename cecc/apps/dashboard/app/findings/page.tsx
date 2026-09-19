import { ceccPaths } from '@cecc/core';
import { loadModel, rankFindings } from '@cecc/ml';
import { Card, Empty, LayerBadge } from '@/components/ui';
import { FindingItem } from '@/components/Finding';
import { Action } from '@/components/Action';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import { runScanAction } from '../actions';
import { LAYER_DESCRIPTION, SEVERITY_ORDER, countBySeverity } from '@/lib/format';
import { themeLabel, plainFor } from '@/lib/plain';
import type { Finding } from '@cecc/core';

export const dynamic = 'force-dynamic';

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ layer?: string; severity?: string; status?: string; group?: string }>;
}) {
  const params = await searchParams;

  let findings: Finding[];
  let triage: ReturnType<typeof rankFindings>;
  try {
    const root = resolveRoot();
    findings = withStore(({ store, projectId }) => {
      // Expired suppressions reopen on read — this is the moment someone looks.
      store.expireSuppressions(projectId);
      return store.listFindings({
        projectId,
        status: params.status === 'all' ? ['open', 'resolved', 'suppressed', 'accepted'] : ['open'],
        layer: params.layer ? [params.layer.toUpperCase() as Finding['layer']] : undefined,
        limit: 500,
      });
    });
    triage = rankFindings(findings, loadModel(ceccPaths(root).dir));
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const ordered = triage.applied ? triage.ordered : findings;
  const filtered = params.severity ? ordered.filter((f) => f.severity === params.severity) : ordered;
  const counts = countBySeverity(findings);

  // Grouping by real-world theme rather than by security taxonomy: "customer
  // data" and "keys and passwords" mean something to everyone, while
  // "ACCESS_CONTROL" and "SUPPLY_CHAIN" do not.
  const byTheme = new Map<string, Finding[]>();
  for (const finding of filtered) {
    const theme = plainFor(finding.ruleId, finding.title).theme;
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), finding]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">What needs fixing</h1>
          <p className="text-sm text-ink-faint">
            {filtered.length} of {findings.length}
            {params.status === 'all' ? ' (including closed)' : ' still open'}
            {triage.applied && ' · ordered by what you usually act on'}
          </p>
        </div>
        <Action run={runScanAction.bind(null, 'changes')} variant="primary">Check for problems now</Action>
      </div>

      <nav className="flex flex-wrap gap-1.5 text-xs" aria-label="Filters">
        <FilterLink href="/findings" active={!params.layer && !params.severity}>Everything</FilterLink>
        {(['APPLICATION', 'AGENT', 'CECC'] as const).map((layer) => (
          <FilterLink key={layer} href={`/findings?layer=${layer.toLowerCase()}`} active={params.layer?.toUpperCase() === layer}>
            {layer === 'APPLICATION' ? 'Your software' : layer === 'AGENT' ? 'AI behaviour' : 'This tool'}
          </FilterLink>
        ))}
        <span className="mx-1 self-center text-ink-faint">|</span>
        {SEVERITY_ORDER.filter((s) => counts[s]).map((s) => (
          <FilterLink key={s} href={`/findings?severity=${s}`} active={params.severity === s}>
            {s} ({counts[s]})
          </FilterLink>
        ))}
        <span className="mx-1 self-center text-ink-faint">|</span>
        <FilterLink href="/findings?status=all" active={params.status === 'all'}>Include closed</FilterLink>
      </nav>

      {triage.applied && (
        <p className="animate-rise rounded border border-cecc/25 bg-cecc/5 px-3 py-2 text-[11px] text-ink-muted">
          <span className="font-medium text-cecc">Ordered for you.</span> {triage.reason}{' '}
          <a href="/intelligence" className="underline hover:text-ink">See how this was worked out</a>
        </p>
      )}

      {filtered.length === 0 && (
        <Card>
          <Empty reassuring>Nothing matches this filter.</Empty>
          <p className="mt-1 text-xs text-ink-faint">
            No check found a problem here. That is not the same as everything being safe — it means nothing CECC knows
            how to look for turned up.
          </p>
        </Card>
      )}

      {[...byTheme.entries()].map(([theme, group]) => (
        <section key={theme} className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-ink">{themeLabel(theme as never)}</h2>
            <span className="text-xs text-ink-faint">{group.length}</span>
          </div>
          <div className="stagger space-y-3">
            {group.map((finding) => (
              <FindingItem key={finding.id} finding={finding} triage={triage.scores.get(finding.id)} />
            ))}
          </div>
        </section>
      ))}

      {params.layer && (
        <p className="text-[11px] text-ink-faint">
          <LayerBadge layer={params.layer.toUpperCase()} /> {LAYER_DESCRIPTION[params.layer.toUpperCase()]}
        </p>
      )}
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`press lift rounded border px-2 py-1 transition-colors ${
        active ? 'border-cecc/40 bg-cecc/10 text-cecc' : 'border-surface-border text-ink-muted hover:bg-surface-hover hover:text-ink'
      }`}
    >
      {children}
    </a>
  );
}
