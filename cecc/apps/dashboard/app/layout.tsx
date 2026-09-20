import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { ViewModeProvider } from '@/components/ViewMode';
import { ToastProvider } from '@/components/Toast';
import { loadProjectConfig } from '@cecc/core';
import { resolveRoot } from '@/lib/server';

export const metadata: Metadata = {
  title: 'CECC — Engineering Control Center',
  description: 'See what your AI coding assistant actually did, and control what it is allowed to do.',
};

// Every page reflects a live local database, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const root = resolveRoot();
  const project = loadProjectConfig(root);

  return (
    <html lang="en">
      <body className="min-h-screen">
        <ViewModeProvider>
          <ToastProvider>
          <Nav projectName={project?.name ?? 'not set up yet'} environment={project?.environment ?? 'development'} />
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-[11px] leading-relaxed text-ink-faint">
            CECC only reports what it actually saw. Work done outside a monitored session will not appear here, and
            finding nothing means no check matched — not that everything is safe.
          </footer>
          </ToastProvider>
        </ViewModeProvider>
      </body>
    </html>
  );
}
