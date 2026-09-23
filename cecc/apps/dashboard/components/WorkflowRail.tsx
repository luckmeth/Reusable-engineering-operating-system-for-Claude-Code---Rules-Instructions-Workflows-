'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Check, Lock } from 'lucide-react';
import { TRANSITION } from '@/lib/design';

/**
 * The workflow, as a state machine rather than a list.
 *
 * Eleven stages read as a wall of words when stacked vertically, and the one
 * thing worth knowing — where we are — had the same weight as the ten places we
 * are not. Laid out along a rail, position carries that meaning on its own and
 * the labels stop competing.
 *
 * The moving parts are tied to real state: the connector fills to the stage the
 * engine actually inferred, and the current node carries the only sustained
 * animation on the page. Nothing here animates on a timer.
 */

const SHORT: Record<string, string> = {
  DISCOVER: 'Discover',
  UNDERSTAND: 'Understand',
  INSPECT: 'Inspect',
  PLAN: 'Plan',
  IMPLEMENT: 'Implement',
  TEST: 'Test',
  SECURITY_REVIEW: 'Security',
  CODE_REVIEW: 'Review',
  READY: 'Ready',
  DEPLOY: 'Deploy',
  VERIFY: 'Verify',
};

export type StageState = 'done' | 'current' | 'upcoming' | 'blocked';

export function WorkflowRail({
  stages,
  currentStage,
  /** Stages that cannot be entered yet, with the reason to show on hover. */
  blocked = {},
}: {
  stages: readonly string[];
  currentStage: string | null;
  blocked?: Record<string, string>;
}) {
  const reduced = useReducedMotion();
  const index = currentStage ? stages.indexOf(currentStage) : -1;
  // Fill stops at the current node rather than running past it: the rail shows
  // ground covered, and a bar reaching a stage nobody has entered would claim
  // progress the evidence does not support.
  const progress = index <= 0 ? 0 : index / (stages.length - 1);

  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-[11px] h-px bg-surface-border" aria-hidden />
      <motion.div
        className="absolute left-0 top-[11px] h-px origin-left bg-cecc/50"
        style={{ right: 0 }}
        initial={false}
        animate={{ scaleX: progress }}
        transition={reduced ? { duration: 0 } : TRANSITION.slow}
        aria-hidden
      />

      <ol className="relative flex justify-between gap-1">
        {stages.map((stage, i) => {
          const reason = blocked[stage];
          const state: StageState = reason
            ? 'blocked'
            : index >= 0 && i < index
              ? 'done'
              : i === index
                ? 'current'
                : 'upcoming';

          return (
            <li key={stage} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <Node state={state} />
              <span
                title={reason}
                className={`truncate text-[10px] tracking-tight ${
                  state === 'current'
                    ? 'font-semibold text-ink'
                    : state === 'blocked'
                      ? 'text-sev-critical'
                      : state === 'done'
                        ? 'text-ink-muted'
                        : 'text-ink-faint'
                }`}
              >
                {SHORT[stage] ?? stage}
              </span>
            </li>
          );
        })}
      </ol>

      {index < 0 && (
        <p className="mt-3 text-[11px] text-ink-faint">
          The stage is inferred from what the agent does. Nothing has been observed here yet.
        </p>
      )}
    </div>
  );
}

function Node({ state }: { state: StageState }) {
  const reduced = useReducedMotion();

  if (state === 'done') {
    return (
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-ok/40 bg-ok/10 text-ok">
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      </span>
    );
  }

  if (state === 'blocked') {
    return (
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-sev-critical/50 bg-sev-critical/10 text-sev-critical">
        <Lock className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }

  if (state === 'current') {
    return (
      <span className="relative flex h-[22px] w-[22px] items-center justify-center">
        {!reduced && (
          <motion.span
            className="absolute inset-0 rounded-full border border-cecc/40"
            animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            aria-hidden
          />
        )}
        <span className="relative flex h-[22px] w-[22px] items-center justify-center rounded-full border border-cecc bg-cecc/15">
          <span className="h-1.5 w-1.5 rounded-full bg-cecc" aria-hidden />
        </span>
      </span>
    );
  }

  return (
    <span className="flex h-[22px] w-[22px] items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-surface-border" aria-hidden />
    </span>
  );
}
