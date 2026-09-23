'use client';

import { FolderOpen, Search } from 'lucide-react';
import { StatusPill } from '@/components/Status';
import { ViewModeToggle } from '@/components/ViewMode';
import type { StatusKind } from '@/lib/design';

/**
 * The application title bar.
 *
 * The window is frameless, so this is the drag surface. The OS still draws
 * minimise, maximise and close over the right-hand side through Electron's
 * `titleBarOverlay`, which is why the bar reserves space there and why every
 * control inside it has to opt out of dragging explicitly — a button in a drag
 * region is decoration, not a button.
 *
 * What it carries is what someone needs to know without reading: which project
 * is being watched, and whether an agent is working in it right now.
 */
export function TitleBar({
  projectName,
  environment,
  agentStatus,
  inShell,
  onOpenPalette,
}: {
  projectName: string;
  environment: string;
  agentStatus: StatusKind;
  inShell: boolean;
  onOpenPalette: () => void;
}) {
  return (
    <header
      className={`drag-region flex h-11 shrink-0 items-center gap-3 border-b border-surface-border bg-surface px-3 ${
        // Space for the native window buttons, which the OS paints on top.
        inShell ? 'pr-[140px]' : ''
      }`}
    >
      <span className="flex items-center gap-2 pl-1">
        <span className="text-[13px] font-bold tracking-[-0.02em]">CECC</span>
      </span>

      <span className="h-4 w-px bg-surface-border" aria-hidden />

      <span className="flex min-w-0 items-center gap-2">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
        <span className="truncate text-[12px] text-ink-muted">{projectName}</span>
        {environment === 'production' && (
          <span className="shrink-0 rounded border border-sev-critical/40 bg-sev-critical/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sev-critical">
            production
          </span>
        )}
      </span>

      <StatusPill
        status={agentStatus}
        label={agentStatus === 'active' ? 'Claude active' : agentStatus === 'idle' ? 'Idle' : undefined}
        className="shrink-0"
      />

      <div className="no-drag ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="focusable flex items-center gap-2 rounded-md border border-surface-border bg-surface-raised px-2.5 py-1 text-[11px] text-ink-faint transition-colors hover:border-surface-hover hover:text-ink-muted"
        >
          <Search className="h-3 w-3" strokeWidth={2} aria-hidden />
          <span>Search</span>
          <kbd className="rounded border border-surface-border px-1 font-mono text-[9px]">Ctrl K</kbd>
        </button>
        <ViewModeToggle />
      </div>
    </header>
  );
}
