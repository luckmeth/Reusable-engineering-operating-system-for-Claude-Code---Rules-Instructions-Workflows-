import { Card } from '@/components/ui';
import { NotInitialized } from '../not-initialized';
import { NotInitializedError, resolveRoot, withStore } from '@/lib/server';
import { desktopShell } from '@/lib/desktop';
import { TerminalView } from './TerminalView';

export const dynamic = 'force-dynamic';

/**
 * Claude Code, in the window.
 *
 * The point is not convenience for its own sake: a session started here runs
 * in the project CECC is watching, with its hooks registered, so what the
 * agent does shows up on the other tabs. A session started in some other
 * directory does not, and that gap is the most common reason the dashboard
 * looks empty to someone who has been working all day.
 */
export default function TerminalPage() {
  let project: { name: string; root: string };
  try {
    project = withStore((ctx) => ({ name: ctx.project.name, root: ctx.root }));
  } catch (err) {
    if (err instanceof NotInitializedError) return <NotInitialized root={resolveRoot()} />;
    throw err;
  }

  const { inShell, terminal } = desktopShell();

  if (!terminal) {
    return (
      <Card title="Claude Code terminal">
        <p className="text-sm text-ink-muted">
          {inShell
            ? 'The terminal backend did not start in this build. The rest of the dashboard is unaffected — CECC still records sessions you run in your own terminal.'
            : 'The embedded terminal is part of the desktop application. In a browser, run Claude Code in your own terminal instead: the hooks record it either way.'}
        </p>
        <pre className="mono mt-3 rounded border border-surface-border bg-surface px-3 py-2 text-[12px]">
          cd {project.root}
          {'\n'}claude
        </pre>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Claude Code</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Running in <span className="mono text-ink">{project.name}</span>. Everything it does is recorded on the other
          tabs as it happens.
        </p>
      </div>
      <TerminalView port={terminal.port} token={terminal.token} />
    </div>
  );
}
