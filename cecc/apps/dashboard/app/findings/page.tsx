import { Card, Empty, LayerBadge } from '@/components/ui';
import { FindingCard } from '@/components/FindingCard';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import { LAYER_DESCRIPTION, SEVERITY_ORDER, countBySeverity } from '@/lib/format';
import type { Finding } from '@cecc/core';

export const dynamic = 'force-dynamic';

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ layer?: string; severity?: string; status?: string }>;
}) {
  const params = await searchParams;

  let findings: Finding[];
  try {
    findings = withStore(({ store, project }) => {
      // Expired suppressions reopen on read: silence should not be permanent
      // by default, and this is the moment someone is looking.
      store.expireSuppressions(project.id);
      return store.listFindings({
        projectId: project.id,
        status: params.status === 'all' ? ['open', 'resolved', 'suppressed', 'accepted'] : ['open'],
        layer: params.layer ? [params.layer.toUpperCase() as Finding['layer']] : undefined,
        limit: 500,
      });
    });
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const filtered = params.severity ? findings.filter((f) => f.severity === params.severity) : findings;
  const counts = countBySeverity(findings);

  const layers = (['APPLICATION', 'AGENT', 'CECC'] as const).map((layer) => ({
    layer,
    findings: filtered.filter((f) => f.layer === layer),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Findings</h1>
          <p className="text-sm text-ink-faint">
            {filtered.length} shown of {findings.length}
            {params.status === 'all' ? ' (including resolved and suppressed)' : ' open'}
          </p>
        </div>

        <nav className="flex flex-wrap gap-1.5 text-xs" aria-label="Filters">
          <FilterLink href="/findings" active={!params.layer && !params.severity}>All</FilterLink>
          {(['APPLICATION', 'AGENT', 'CECC'] as const).map((layer) => (
            <FilterLink key={layer} href={`/findings?layer=${layer.toLowerCase()}`} active={params.layer?.toUpperCase() === layer}>
              {layer}
            </FilterLink>
          ))}
          <span className="mx-1 text-ink-faint">|</span>
          {SEVERITY_ORDER.filter((s) => counts[s]).map((s) => (
            <FilterLink key={s} href={`/findings?severity=${s}`} active={params.severity === s}>
              {s} ({counts[s]})
            </FilterLink>
          ))}
          <span className="mx-1 text-ink-faint">|</span>
          <FilterLink href="/findings?status=all" active={params.status === 'all'}>Include closed</FilterLink>
        </nav>
      </div>

      {filtered.length === 0 && (
        <Card>
          <Empty reassuring>Nothing matches this filter.</Empty>
          <p className="mt-1 text-xs text-ink-faint">
            No active rule produced a finding here. Absence of findings is not evidence of security.
          </p>
        </Card>
      )}

      {layers.map(({ layer, findings: group }) =>
        group.length === 0 ? null : (
          <section key={layer} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <LayerBadge layer={layer} />
              <p className="text-xs text-ink-faint">{LAYER_DESCRIPTION[layer]}</p>
            </div>
            {group.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </section>
        ),
      )}
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`rounded border px-2 py-1 transition-colors ${
        active ? 'border-cecc/40 bg-cecc/10 text-cecc' : 'border-surface-border text-ink-muted hover:bg-surface-hover hover:text-ink'
      }`}
    >
      {children}
    </a>
  );
}
