'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  ChevronsLeft,
  GaugeCircle,
  GitBranch,
  GraduationCap,
  History,
  LayoutGrid,
  ShieldAlert,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { TRANSITION } from '@/lib/design';

/**
 * Primary navigation.
 *
 * A rail rather than a row of tabs. The old top navigation put eleven
 * destinations in a line, which meant every label had to be short enough to
 * fit and none of them could carry a count — so the one thing a person most
 * needs from navigation, "where is the problem", was the one thing it could
 * not show.
 *
 * Collapsed state is remembered per machine. It is a preference about this
 * window, not project state, so localStorage is the right home for it and a
 * failure to read it is not worth handling beyond falling back to expanded.
 */

export interface NavCounts {
  findings: number;
  critical: number;
  sessions: number;
}

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Which count, if any, belongs on this row. */
  badge?: keyof NavCounts;
  /** Only meaningful inside the desktop application. */
  desktopOnly?: boolean;
}

const ITEMS: Item[] = [
  { href: '/control', label: 'Overview', icon: LayoutGrid },
  { href: '/workflow', label: 'Workflow', icon: Workflow },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/findings', label: 'Fixes', icon: ShieldAlert, badge: 'findings' },
  { href: '/sessions', label: 'Sessions', icon: History, badge: 'sessions' },
  { href: '/', label: 'Readiness', icon: GaugeCircle },
  { href: '/controls', label: 'Controls', icon: SlidersHorizontal },
  { href: '/intelligence', label: 'Learning', icon: GraduationCap },
  { href: '/terminal', label: 'Claude Code', icon: Bot, desktopOnly: true },
];

const STORAGE_KEY = 'cecc.sidebar.collapsed';

export function Sidebar({ counts, hasTerminal }: { counts: NavCounts; hasTerminal: boolean }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // A private window or blocked storage just means the default.
    }
    setReady(true);
  }, []);

  const toggle = () => {
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* preference is not worth an error */
      }
      return next;
    });
  };

  const items = ITEMS.filter((i) => !i.desktopOnly || hasTerminal);

  return (
    <motion.nav
      aria-label="Main"
      initial={false}
      animate={{ width: collapsed ? 60 : 208 }}
      transition={reduced ? { duration: 0 } : TRANSITION.spring}
      // Hidden until the stored preference is read, so an expanded rail does
      // not snap shut in front of someone who collapsed it last time.
      style={{ visibility: ready ? 'visible' : 'hidden' }}
      className="flex shrink-0 flex-col border-r border-surface-border bg-surface"
    >
      <ul className="flex-1 space-y-0.5 p-2">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const count = item.badge ? counts[item.badge] : 0;
          const urgent = item.badge === 'findings' && counts.critical > 0;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={`focusable group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                  active ? 'bg-surface-hover text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-cecc"
                    transition={reduced ? { duration: 0 } : TRANSITION.spring}
                    aria-hidden
                  />
                )}
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {count > 0 && (
                  <span
                    className={`num ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      urgent ? 'bg-sev-critical/15 text-sev-critical' : 'bg-surface-hover text-ink-faint'
                    } ${collapsed ? 'absolute right-1 top-1 px-1 py-0' : ''}`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="focusable m-2 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink-muted"
      >
        <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={TRANSITION.normal} aria-hidden>
          <ChevronsLeft className="h-4 w-4" strokeWidth={1.75} />
        </motion.span>
        {!collapsed && <span className="text-[12px]">Collapse</span>}
      </button>

      {!collapsed && (
        <p className="flex items-center gap-1.5 px-4 pb-3 text-[10px] text-ink-faint">
          <GitBranch className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          local only
        </p>
      )}
    </motion.nav>
  );
}
