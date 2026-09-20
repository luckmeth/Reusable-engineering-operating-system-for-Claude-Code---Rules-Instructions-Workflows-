export function NotInitialized({ root }: { root: string }) {
  return (
    <div className="card mx-auto max-w-2xl p-8">
      <h1 className="text-lg font-semibold">CECC is not initialized here</h1>
      <p className="mt-2 text-sm text-ink-muted">
        No <code className="mono">.cecc/config.json</code> was found at or above:
      </p>
      <pre className="mono mt-2 overflow-x-auto rounded border border-surface-border bg-surface px-3 py-2 text-[12px]">{root}</pre>
      <p className="mt-4 text-sm text-ink-muted">Initialize the project, then reload:</p>
      <pre className="mono mt-2 rounded border border-surface-border bg-surface px-3 py-2 text-[12px]">cecc init</pre>
      <p className="mt-4 text-xs text-ink-faint">
        To point the dashboard at a different project, set <code className="mono">CECC_PROJECT_ROOT</code>.
      </p>
    </div>
  );
}
