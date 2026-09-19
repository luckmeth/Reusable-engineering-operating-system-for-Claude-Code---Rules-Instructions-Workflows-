import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { loadProjectConfig } from '@cecc/core';
import { resolveRoot } from '@/lib/server';

export const metadata: Metadata = {
  title: 'CECC — Engineering Control Center',
  description: 'Local-first engineering observability and security control for AI-assisted development.',
};

// Every page reflects a live local database, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const root = resolveRoot();
  const project = loadProjectConfig(root);

  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav projectName={project?.name ?? 'not initialized'} environment={project?.environment ?? 'development'} />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-[11px] leading-relaxed text-ink-faint">
          CECC reports only what it observed. Work done outside a monitored session does not appear here, and an
          absence of findings means no active rule matched — not that the project is secure.
        </footer>
      </body>
    </html>
  );
}
