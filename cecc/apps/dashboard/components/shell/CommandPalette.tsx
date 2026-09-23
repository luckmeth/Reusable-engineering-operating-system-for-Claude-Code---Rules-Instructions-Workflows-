'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  Bot,
  CornerDownLeft,
  GaugeCircle,
  GraduationCap,
  History,
  LayoutGrid,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { TRANSITION, Z } from '@/lib/design';

/**
 * The command palette.
 *
 * Eleven destinations in a rail is fine for browsing and slow for someone who
 * already knows where they are going. This is the keyboard path to everything,
 * and the place actions live so they do not each need a button somewhere.
 *
 * Only actions CECC can actually perform appear here. An entry that opens a
 * dialog it cannot fulfil is worse than no entry, because it is discovered at
 * the moment someone is in a hurry.
 */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: 'Go to' | 'Run';
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onScan,
  hasTerminal,
}: {
  open: boolean;
  onClose: () => void;
  /** Runs a scan; undefined when the action is unavailable here. */
  onScan?: () => void;
  hasTerminal: boolean;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };
    const items: Command[] = [
      { id: 'overview', label: 'Overview', hint: 'Control panel', icon: LayoutGrid, group: 'Go to', run: go('/control') },
      { id: 'workflow', label: 'Workflow', icon: Workflow, group: 'Go to', run: go('/workflow') },
      { id: 'activity', label: 'Activity', hint: 'Live event stream', icon: Activity, group: 'Go to', run: go('/activity') },
      { id: 'fixes', label: 'Fixes', hint: 'What needs fixing', icon: ShieldAlert, group: 'Go to', run: go('/findings') },
      { id: 'sessions', label: 'Sessions', hint: 'History and replay', icon: History, group: 'Go to', run: go('/sessions') },
      { id: 'readiness', label: 'Readiness', hint: 'Gates and blockers', icon: GaugeCircle, group: 'Go to', run: go('/') },
      { id: 'controls', label: 'Controls', hint: 'Rules and enforcement', icon: SlidersHorizontal, group: 'Go to', run: go('/controls') },
      { id: 'learning', label: 'Learning', icon: GraduationCap, group: 'Go to', run: go('/intelligence') },
    ];
    if (hasTerminal) {
      items.push({ id: 'claude', label: 'Claude Code', hint: 'Agent terminal', icon: Bot, group: 'Go to', run: go('/terminal') });
    }
    if (onScan) {
      items.push({
        id: 'scan',
        label: 'Run a scan',
        hint: 'Detection rules over the working tree',
        icon: RefreshCw,
        group: 'Run',
        run: () => {
          onScan();
          onClose();
        },
      });
    }
    return items;
  }, [router, onClose, onScan, hasTerminal]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(q));
  }, [commands, query]);

  // A stale cursor after filtering would run the wrong command on Enter.
  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // The input mounts with the dialog, so focus waits a frame.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (matches.length === 0 ? 0 : (c + 1) % matches.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (matches.length === 0 ? 0 : (c - 1 + matches.length) % matches.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      matches[cursor]?.run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let lastGroup = '';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 ${Z.palette} flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={TRANSITION.fast}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-xl border border-surface-border bg-surface-raised/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
            initial={{ opacity: 0, y: reduced ? 0 : -12, scale: reduced ? 1 : 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -8, scale: reduced ? 1 : 0.99 }}
            transition={TRANSITION.normal}
            onKeyDown={onKeyDown}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages and actions…"
              aria-label="Search pages and actions"
              className="w-full border-b border-surface-border bg-transparent px-4 py-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint"
            />

            <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {matches.length === 0 && (
                <li className="px-3 py-6 text-center text-[12px] text-ink-faint">
                  Nothing matches “{query}”.
                </li>
              )}
              {matches.map((command, index) => {
                const header = command.group !== lastGroup ? command.group : null;
                lastGroup = command.group;
                const active = index === cursor;

                return (
                  <li key={command.id}>
                    {header && <p className="t-micro px-3 pb-1 pt-3">{header}</p>}
                    <button
                      type="button"
                      data-active={active}
                      onMouseMove={() => setCursor(index)}
                      onClick={command.run}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                        active ? 'bg-surface-hover text-ink' : 'text-ink-muted'
                      }`}
                    >
                      <command.icon className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                      <span className="truncate">{command.label}</span>
                      {command.hint && <span className="truncate text-[11px] text-ink-faint">{command.hint}</span>}
                      {active && (
                        <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
