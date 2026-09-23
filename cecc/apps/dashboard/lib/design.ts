/**
 * Design tokens.
 *
 * Centralised so the visual language can be changed in one place rather than
 * found by grepping for magic numbers. Everything that is purely presentational
 * — duration, easing, elevation, the meaning of a status word — is declared
 * here and consumed by components.
 *
 * What is deliberately *not* here: severity colours. Those live in the Tailwind
 * config because they carry meaning that the rules engine assigns, not meaning
 * the interface chooses, and a designer changing "high" from orange to purple
 * should have to go somewhere that makes them think about it.
 */

// ------------------------------------------------------------------ motion

/**
 * Durations, in seconds, because that is what Framer Motion takes.
 *
 * Three tiers, matched to what is moving. Anything slower than `slow` makes the
 * interface feel like it is deciding whether to obey.
 */
export const DURATION = {
  /** Hover, press, icon swaps, counters. */
  fast: 0.12,
  /** Panels, tabs, tooltips, list items arriving. */
  normal: 0.22,
  /** Drawers, modals, page transitions, layout changes. */
  slow: 0.34,
} as const;

/** A single easing curve everywhere, so nothing feels like a different app. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Spring for anything that changes layout — it absorbs measurement jitter. */
export const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } as const;

export const TRANSITION = {
  fast: { duration: DURATION.fast, ease: EASE },
  normal: { duration: DURATION.normal, ease: EASE },
  slow: { duration: DURATION.slow, ease: EASE },
  spring: SPRING,
} as const;

// ----------------------------------------------------------------- surfaces

/**
 * Surface levels, as class strings.
 *
 * The old interface made everything a card, which flattened the hierarchy it
 * was trying to express. These are the only surfaces; a new one needs a reason.
 */
export const SURFACE = {
  /** The page itself. */
  base: 'bg-surface',
  /** A panel sitting on the page. */
  raised: 'bg-surface-raised border border-surface-border',
  /** A row inside a panel that responds to the pointer. */
  row: 'transition-colors hover:bg-surface-hover',
  /** Floating above everything: palette, drawer, popover. */
  overlay: 'bg-surface-raised/95 border border-surface-border backdrop-blur-xl shadow-2xl shadow-black/60',
  /** An embedded tool, such as the terminal. Recessed, not raised. */
  inset: 'bg-surface border border-surface-border',
} as const;

// ------------------------------------------------------------------ status

/**
 * The status vocabulary, used everywhere a thing has a state.
 *
 * One list, so "running" looks the same in the workflow rail, the session list
 * and the terminal header. `pulse` is reserved for states that are genuinely
 * ongoing — a static thing that pulses is just noise.
 */
export type StatusKind =
  | 'active'
  | 'running'
  | 'analyzing'
  | 'waiting'
  | 'passed'
  | 'warning'
  | 'failed'
  | 'blocked'
  | 'resolved'
  | 'verified'
  | 'idle'
  | 'unknown';

export interface StatusStyle {
  label: string;
  /** Text colour class. */
  fg: string;
  /** Border + tint for a pill. */
  chip: string;
  /** Dot colour. */
  dot: string;
  /** Whether the dot should breathe. Only for states that are in progress. */
  pulse: boolean;
}

export const STATUS: Record<StatusKind, StatusStyle> = {
  active: { label: 'Active', fg: 'text-ok', chip: 'border-ok/35 bg-ok/10 text-ok', dot: 'bg-ok', pulse: true },
  running: { label: 'Running', fg: 'text-cecc', chip: 'border-cecc/35 bg-cecc/10 text-cecc', dot: 'bg-cecc', pulse: true },
  analyzing: { label: 'Analyzing', fg: 'text-cecc', chip: 'border-cecc/35 bg-cecc/10 text-cecc', dot: 'bg-cecc', pulse: true },
  waiting: { label: 'Waiting', fg: 'text-ink-muted', chip: 'border-surface-border text-ink-muted', dot: 'bg-ink-faint', pulse: false },
  passed: { label: 'Passed', fg: 'text-ok', chip: 'border-ok/35 bg-ok/10 text-ok', dot: 'bg-ok', pulse: false },
  warning: { label: 'Warning', fg: 'text-sev-medium', chip: 'border-sev-medium/35 bg-sev-medium/10 text-sev-medium', dot: 'bg-sev-medium', pulse: false },
  failed: { label: 'Failed', fg: 'text-sev-critical', chip: 'border-sev-critical/35 bg-sev-critical/10 text-sev-critical', dot: 'bg-sev-critical', pulse: false },
  blocked: { label: 'Blocked', fg: 'text-sev-critical', chip: 'border-sev-critical/35 bg-sev-critical/10 text-sev-critical', dot: 'bg-sev-critical', pulse: false },
  resolved: { label: 'Resolved', fg: 'text-ok', chip: 'border-ok/35 bg-ok/10 text-ok', dot: 'bg-ok', pulse: false },
  verified: { label: 'Verified', fg: 'text-ok', chip: 'border-ok/35 bg-ok/10 text-ok', dot: 'bg-ok', pulse: false },
  idle: { label: 'Idle', fg: 'text-ink-muted', chip: 'border-surface-border text-ink-muted', dot: 'bg-ink-faint', pulse: false },
  unknown: { label: 'Unknown', fg: 'text-ink-faint', chip: 'border-surface-border text-ink-faint', dot: 'bg-ink-faint', pulse: false },
};

// -------------------------------------------------------------- z-index

/** Named so two overlays can never argue about who is on top. */
export const Z = {
  titlebar: 'z-50',
  sidebar: 'z-30',
  drawer: 'z-40',
  palette: 'z-[60]',
  toast: 'z-[70]',
} as const;
