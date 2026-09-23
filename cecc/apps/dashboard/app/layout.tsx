import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { ViewModeProvider } from '@/components/ViewMode';
import { ToastProvider } from '@/components/Toast';
import { getShellState, resolveRoot } from '@/lib/server';
import { desktopShell } from '@/lib/desktop';

export const metadata: Metadata = {
  title: 'CECC — Engineering Control Center',
  description: 'See what your AI coding assistant actually did, and control what it is allowed to do.',
};

// Every page reflects a live local database, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The shell needs counts and agent state on every page, so it is read here
  // rather than threaded through each one. A project that is not initialized
  // yields a shell with no rail and nothing to count, which is correct: there
  // is nothing to navigate between yet.
  const shell = getShellState(resolveRoot());
  const { inShell, terminal } = desktopShell();

  return (
    <html lang="en">
      <body className="overflow-hidden">
        <ViewModeProvider>
          <ToastProvider>
            <AppShell
              projectName={shell.projectName}
              environment={shell.environment}
              agentStatus={shell.agentStatus}
              counts={shell.counts}
              hasTerminal={terminal !== null}
              inShell={inShell}
              initialized={shell.initialized}
            >
              {children}
            </AppShell>
          </ToastProvider>
        </ViewModeProvider>
      </body>
    </html>
  );
}
