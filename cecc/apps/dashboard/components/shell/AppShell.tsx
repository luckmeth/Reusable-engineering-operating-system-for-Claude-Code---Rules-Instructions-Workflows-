'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { runScanAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import type { StatusKind } from '@/lib/design';
import { CommandPalette } from './CommandPalette';
import { Sidebar, type NavCounts } from './Sidebar';
import { TitleBar } from './TitleBar';

/**
 * The application shell.
 *
 * Title bar across the top, navigation rail down the left, page in the middle.
 * It owns two things no page should own: the keyboard layer, and the palette
 * those shortcuts open.
 *
 * The shortcut set is deliberately small and avoids anything the OS or the
 * browser already means. Ctrl+K is the palette; Ctrl+1…4 are the four screens
 * people move between while an agent is working; `/` focuses search the way it
 * does everywhere else. Nothing here shadows copy, paste, reload or close.
 */
export function AppShell({
  children,
  projectName,
  environment,
  agentStatus,
  counts,
  hasTerminal,
  inShell,
  initialized,
}: {
  children: ReactNode;
  projectName: string;
  environment: string;
  agentStatus: StatusKind;
  counts: NavCounts;
  hasTerminal: boolean;
  inShell: boolean;
  /** Without a project there is nothing to navigate, so the rail stays away. */
  initialized: boolean;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const scan = useCallback(() => {
    void runScanAction('changes').then((result) => {
      toast.push({ ok: result.ok, message: result.message, detail: result.detail });
      router.refresh();
    });
  }, [router, toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      // Typing in a field is not navigating.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if (!typing && event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (mod && !event.shiftKey && !event.altKey) {
        const page = { '1': '/control', '2': '/workflow', '3': '/activity', '4': '/findings' }[event.key];
        if (page) {
          event.preventDefault();
          router.push(page);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TitleBar
        projectName={projectName}
        environment={environment}
        agentStatus={agentStatus}
        inShell={inShell}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        {initialized && <Sidebar counts={counts} hasTerminal={hasTerminal} />}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-6 py-5">{children}</div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onScan={initialized ? scan : undefined}
        hasTerminal={hasTerminal}
      />
    </div>
  );
}
