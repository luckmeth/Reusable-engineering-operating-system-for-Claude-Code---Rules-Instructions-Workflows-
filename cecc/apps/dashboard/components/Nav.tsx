'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ViewModeToggle } from './ViewMode';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/findings', label: 'What needs fixing' },
  { href: '/activity', label: 'Live activity' },
  { href: '/workflow', label: 'Progress' },
  { href: '/sessions', label: 'History' },
  { href: '/controls', label: 'Controls' },
  { href: '/intelligence', label: 'Learning' },
];

export function Nav({ projectName, environment }: { projectName: string; environment: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-tight">CECC</span>
          <span className="text-xs text-ink-faint">{projectName}</span>
          {environment === 'production' && (
            <span className="rounded border border-sev-critical/40 bg-sev-critical/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-sev-critical">
              production
            </span>
          )}
        </div>

        <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded px-2.5 py-1 text-[13px] transition-colors ${
                  active ? 'bg-surface-hover text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto">
          <ViewModeToggle />
        </div>
      </div>
    </header>
  );
}
