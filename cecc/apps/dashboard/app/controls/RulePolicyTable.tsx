'use client';

import { useState } from 'react';
import { Action, type ActionOutcome } from '@/components/Action';
import { SeverityBadge } from '@/components/ui';

interface RuleRow {
  id: string;
  name: string;
  layer: string;
  severity: string;
  why: string;
  mode: string;
}

const MODE_LABEL: Record<string, string> = {
  observe: 'Silent',
  warn: 'Warn me',
  block: 'Stop it',
};

/**
 * Per-rule control.
 *
 * Search and filtering matter here because there are enough rules that a plain
 * list is unusable when you are hunting the one that just fired at you.
 */
export function RulePolicyTable({
  rules,
  setMode,
}: {
  rules: RuleRow[];
  setMode: (ruleId: string, mode: string, reason: string) => Promise<ActionOutcome>;
}) {
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<string>('all');

  const filtered = rules.filter((rule) => {
    if (layer !== 'all' && rule.layer !== layer) return false;
    if (!query.trim()) return true;
    const needle = query.toLowerCase();
    return rule.id.toLowerCase().includes(needle) || rule.name.toLowerCase().includes(needle) || rule.why.toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">Search checks</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search checks — try 'password', 'test' or 'database'"
            className="w-full rounded border border-surface-border bg-surface px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-cecc/50 focus:outline-none"
          />
        </label>
        {[
          { id: 'all', label: 'All' },
          { id: 'APPLICATION', label: 'Your software' },
          { id: 'AGENT', label: 'AI behaviour' },
          { id: 'CECC', label: 'This tool' },
        ].map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setLayer(option.id)}
            aria-pressed={layer === option.id}
            className={`press rounded border px-2 py-1 text-[12px] transition-colors ${
              layer === option.id ? 'border-cecc/40 bg-cecc/10 text-cecc' : 'border-surface-border text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="divide-y divide-surface-border rounded border border-surface-border">
        {filtered.length === 0 && <p className="p-4 text-sm text-ink-faint">No checks match that.</p>}
        {filtered.map((rule) => (
          <details key={rule.id} className="group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 hover:bg-surface-hover">
              <SeverityBadge severity={rule.severity} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{rule.name}</span>
              <span className="mono text-[11px] text-ink-faint">{rule.id}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  rule.mode === 'block'
                    ? 'border-sev-critical/40 bg-sev-critical/10 text-sev-critical'
                    : rule.mode === 'warn'
                      ? 'border-sev-medium/40 bg-sev-medium/10 text-sev-medium'
                      : 'border-surface-border text-ink-faint'
                }`}
              >
                {MODE_LABEL[rule.mode] ?? rule.mode}
              </span>
            </summary>

            <div className="reveal space-y-3 border-t border-surface-border bg-surface px-3 py-3">
              <p className="text-[12px] leading-relaxed text-ink-muted">{rule.why}</p>
              <div className="flex flex-wrap gap-2">
                {(['observe', 'warn', 'block'] as const).map((mode) => (
                  <Action
                    key={mode}
                    run={() => setMode(rule.id, mode, 'changed from the controls page')}
                    variant={rule.mode === mode ? 'primary' : 'ghost'}
                  >
                    {MODE_LABEL[mode]}
                  </Action>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
