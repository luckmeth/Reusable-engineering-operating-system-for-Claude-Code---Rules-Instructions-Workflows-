import { desktopShell } from '@/lib/desktop';

/**
 * The first screen most people see.
 *
 * It used to say "run `cecc init`", which is correct for an npm install and
 * useless for the desktop application: that installer puts nothing on PATH, so
 * the one instruction on screen was a command that does not exist. Inside the
 * shell the same action is now a button.
 *
 * The button is an ordinary link to `/__cecc/open-project`. The main process
 * intercepts the navigation and opens a native directory picker; the page
 * never loads, and the renderer keeps its sandbox and its lack of a preload
 * bridge. See apps/desktop/electron/main.cjs.
 */
export function NotInitialized({ root }: { root: string }) {
  const { inShell } = desktopShell();

  return (
    <div className="card mx-auto max-w-2xl p-8">
      <h1 className="text-lg font-semibold">
        {inShell ? 'Choose a project to watch' : 'CECC is not initialized here'}
      </h1>

      {inShell ? (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            CECC watches one repository at a time. Pick the folder you work in and it will record what your coding
            agent does there — nothing leaves this machine.
          </p>

          <a
            href="/__cecc/open-project"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-cecc px-4 py-2.5 text-[14px] font-semibold text-surface transition-colors hover:bg-cecc/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-cecc focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Open a project…
          </a>

          <p className="mt-3 text-xs text-ink-faint">
            If the folder has not been set up yet, CECC offers to do it: it creates <code className="mono">.cecc/</code>{' '}
            and registers Claude Code hooks in <code className="mono">.claude/settings.json</code>, keeping any hooks
            you already have.
          </p>

          <details className="mt-5 text-xs text-ink-faint">
            <summary className="cursor-pointer select-none hover:text-ink-muted">Where it looked</summary>
            <pre className="mono mt-2 overflow-x-auto rounded border border-surface-border bg-surface px-3 py-2 text-[12px]">
              {root}
            </pre>
          </details>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            No <code className="mono">.cecc/config.json</code> was found at or above:
          </p>
          <pre className="mono mt-2 overflow-x-auto rounded border border-surface-border bg-surface px-3 py-2 text-[12px]">
            {root}
          </pre>
          <p className="mt-4 text-sm text-ink-muted">Initialize the project, then reload:</p>
          <pre className="mono mt-2 rounded border border-surface-border bg-surface px-3 py-2 text-[12px]">cecc init</pre>
          <p className="mt-4 text-xs text-ink-faint">
            To point the dashboard at a different project, set <code className="mono">CECC_PROJECT_ROOT</code>.
          </p>
        </>
      )}
    </div>
  );
}
