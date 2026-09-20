import type { ReactNode } from 'react';
import { LAYER_DESCRIPTION, LAYER_LABEL, severityClass } from '@/lib/format';

export function SeverityBadge({ severity, children }: { severity: string; children?: ReactNode }) {
  return (
    <span className={`${severityClass(severity)} inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide`}>
      {children ?? severity}
    </span>
  );
}

/**
 * Verification state is shown next to every claim.
 *
 * This is the product's central honesty mechanism made visible: a POTENTIAL
 * pattern match must never look like a VERIFIED observation, however alarming
 * its title.
 */
export function VerificationBadge({ state, confidence }: { state: string; confidence?: number }) {
  const tone =
    state === 'VERIFIED' ? 'text-ok border-ok/40' :
    state === 'LIKELY' ? 'text-sev-medium border-sev-medium/40' :
    state === 'BLOCKED' ? 'text-sev-critical border-sev-critical/40' :
    'text-ink-muted border-surface-border';

  return (
    <span className={`${tone} inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-medium`}>
      {state}
      {confidence !== undefined && <span className="text-ink-faint">{Math.round(confidence * 100)}%</span>}
    </span>
  );
}

export function LayerBadge({ layer }: { layer: string }) {
  const tone =
    layer === 'AGENT' ? 'text-agent border-agent/40 bg-agent/10' :
    layer === 'CECC' ? 'text-cecc border-cecc/40 bg-cecc/10' :
    'text-ink-muted border-surface-border bg-surface-hover';
  return (
    <span className={`${tone} inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium`} title={LAYER_DESCRIPTION[layer]}>
      {LAYER_LABEL[layer] ?? layer}
    </span>
  );
}

export function Card({ title, subtitle, action, children, className = '' }: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-surface-border px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Empty state.
 *
 * The `reassuring` flag exists because of a distinction that matters
 * everywhere in this product: "nothing matched" is not "nothing is wrong", and
 * an empty list must not be styled to imply safety it cannot demonstrate.
 */
export function Empty({ children, reassuring = false }: { children: ReactNode; reassuring?: boolean }) {
  return <p className={`text-sm ${reassuring ? 'text-ok' : 'text-ink-faint'}`}>{children}</p>;
}

export function StatRow({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' }) {
  const toneClass = { default: 'text-ink', warn: 'text-sev-medium', bad: 'text-sev-critical', good: 'text-ok' }[tone];
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={`mono ${toneClass} text-right`}>{value}</dd>
    </div>
  );
}

export function GateIcon({ state }: { state: string }) {
  if (state === 'pass') return <span className="text-ok">✓</span>;
  if (state === 'fail') return <span className="text-sev-critical">✕</span>;
  if (state === 'pending') return <span className="text-sev-medium">◦</span>;
  return <span className="text-ink-faint">–</span>;
}
