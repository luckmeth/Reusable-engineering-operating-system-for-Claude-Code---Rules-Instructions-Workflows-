'use client';

import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';
import { DURATION, EASE, TRANSITION } from '@/lib/design';

/**
 * Shared motion primitives.
 *
 * Every component that moves uses one of these rather than declaring its own
 * timing, because the moment two panels open at different speeds the interface
 * stops feeling like one piece of software.
 *
 * All of them respect `prefers-reduced-motion`. Reduced motion does not mean no
 * feedback: the state change still happens and opacity still changes, but
 * nothing travels across the screen. A user who asked for less movement still
 * needs to see that something arrived.
 */

export { AnimatePresence, motion };

/** Distance things travel when they arrive. Small on purpose. */
const TRAVEL = 8;

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : TRAVEL }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...TRANSITION.normal, delay }}
    >
      {children}
    </motion.div>
  );
}

export function SlideIn({
  children,
  from = 'bottom',
  className,
}: {
  children: ReactNode;
  from?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
}) {
  const reduced = useReducedMotion();
  const axis = from === 'left' || from === 'right' ? 'x' : 'y';
  const sign = from === 'left' || from === 'top' ? -1 : 1;
  const offset = reduced ? 0 : TRAVEL * sign;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, [axis]: offset }}
      animate={{ opacity: 1, [axis]: 0 }}
      exit={{ opacity: 0, [axis]: offset }}
      transition={TRANSITION.normal}
    >
      {children}
    </motion.div>
  );
}

/**
 * Children arrive one after another.
 *
 * Capped rather than uncapped: a fiftieth row appearing a full second after the
 * first reads as the page being slow, not as an effect.
 */
export function Stagger({
  children,
  className,
  step = 0.03,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: reduced ? 0 : step, delayChildren: 0 } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduced ? 0 : TRAVEL },
        shown: { opacity: 1, y: 0, transition: TRANSITION.normal },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that counts to its new value instead of jumping.
 *
 * Only worth it for counters that change while someone is looking at them —
 * event totals, finding counts. A static figure should just be rendered.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={className}>{value.toLocaleString()}</span>;

  return (
    <motion.span
      key={value}
      className={className}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.fast, ease: EASE }}
    >
      {value.toLocaleString()}
    </motion.span>
  );
}

/** A pressable surface with real hover, press and focus feedback. */
export function Pressable({
  children,
  className = '',
  ...rest
}: HTMLMotionProps<'button'> & { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      className={className}
      whileHover={reduced ? undefined : { y: -1 }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
      transition={TRANSITION.fast}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
