/**
 * Test output parsing.
 *
 * Runners are detected from their output rather than configuration, because the
 * output is what CECC actually has when a Bash tool call completes. Parsing is
 * strictly best-effort: when the format is unrecognised, the result is
 * 'unknown' with the exit code preserved. Guessing a pass from an unparsed
 * summary would produce exactly the false confidence the product exists to
 * prevent.
 */

export interface TestSummary {
  runner: string;
  status: 'passed' | 'failed' | 'unknown';
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  total: number | null;
  durationMs: number | null;
  /** Names of failing tests, when the output identifies them. */
  failingTests: string[];
  /** True when the parse succeeded; false means only the exit code is meaningful. */
  parsed: boolean;
}

interface RunnerParser {
  name: string;
  detect: RegExp;
  parse(output: string): Partial<TestSummary>;
}

const PARSERS: RunnerParser[] = [
  {
    name: 'vitest',
    detect: /(?:^|\n)\s*(?:RUN|DEV)\s+v\d|Test Files\s+\d|vitest/i,
    parse(output) {
      const files = /Test Files\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/.exec(output);
      const tests = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/.exec(output);
      const duration = /Duration\s+([\d.]+)(m?s)/.exec(output);
      const failed = Number(tests?.[1] ?? files?.[1] ?? 0);
      const passed = Number(tests?.[2] ?? 0);
      const skipped = Number(tests?.[3] ?? 0);
      return {
        passed,
        failed,
        skipped,
        total: passed + failed + skipped,
        durationMs: duration ? Math.round(Number(duration[1]) * (duration[2] === 's' ? 1000 : 1)) : null,
        failingTests: [...output.matchAll(/(?:FAIL|×)\s+(\S+(?:\s>\s.+)?)/g)].map((m) => m[1] ?? '').filter(Boolean).slice(0, 25),
      };
    },
  },
  {
    name: 'jest',
    detect: /Tests:\s+\d+\s+(?:passed|failed|total)|jest/i,
    parse(output) {
      const tests = /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/.exec(output);
      const time = /Time:\s+([\d.]+)\s*s/.exec(output);
      return {
        failed: Number(tests?.[1] ?? 0),
        skipped: Number(tests?.[2] ?? 0),
        passed: Number(tests?.[3] ?? 0),
        total: Number(tests?.[4] ?? 0),
        durationMs: time ? Math.round(Number(time[1]) * 1000) : null,
        failingTests: [...output.matchAll(/●\s+(.+?)(?:\n|$)/g)].map((m) => m[1]?.trim() ?? '').filter(Boolean).slice(0, 25),
      };
    },
  },
  {
    name: 'pytest',
    detect: /=+\s*(?:test session starts|FAILURES|\d+ (?:passed|failed))/i,
    parse(output) {
      const summary = /(?:(\d+) failed)?,?\s*(?:(\d+) passed)?,?\s*(?:(\d+) skipped)?.*?in ([\d.]+)s/.exec(output);
      const failed = Number(summary?.[1] ?? 0);
      const passed = Number(summary?.[2] ?? 0);
      const skipped = Number(summary?.[3] ?? 0);
      return {
        failed,
        passed,
        skipped,
        total: failed + passed + skipped,
        durationMs: summary?.[4] ? Math.round(Number(summary[4]) * 1000) : null,
        failingTests: [...output.matchAll(/FAILED\s+(\S+)/g)].map((m) => m[1] ?? '').filter(Boolean).slice(0, 25),
      };
    },
  },
  {
    name: 'go',
    detect: /^(?:ok|FAIL|---\s+(?:PASS|FAIL))\s/m,
    parse(output) {
      const failures = [...output.matchAll(/---\s+FAIL:\s+(\S+)/g)].map((m) => m[1] ?? '');
      const passes = [...output.matchAll(/---\s+PASS:\s+(\S+)/g)].length;
      return {
        failed: failures.length,
        passed: passes,
        skipped: [...output.matchAll(/---\s+SKIP:/g)].length,
        total: failures.length + passes,
        failingTests: failures.filter(Boolean).slice(0, 25),
      };
    },
  },
];

export function parseTestOutput(output: string, exitCode: number | null): TestSummary {
  const base: TestSummary = {
    runner: 'unknown',
    // Exit code is the one signal available for every runner. Non-zero is a
    // failure even when nothing else could be parsed.
    status: exitCode === null ? 'unknown' : exitCode === 0 ? 'passed' : 'failed',
    passed: null,
    failed: null,
    skipped: null,
    total: null,
    durationMs: null,
    failingTests: [],
    parsed: false,
  };

  if (!output) return base;

  for (const parser of PARSERS) {
    if (!parser.detect.test(output)) continue;
    try {
      const parsed = parser.parse(output);
      const merged: TestSummary = { ...base, ...parsed, runner: parser.name, parsed: true };
      // Parsed counts override the exit code only when they are self-consistent.
      if (typeof merged.failed === 'number' && merged.failed > 0) merged.status = 'failed';
      else if (exitCode === 0 && (merged.passed ?? 0) > 0) merged.status = 'passed';
      return merged;
    } catch {
      // A parser that throws falls back to exit-code-only reporting.
      return { ...base, runner: parser.name };
    }
  }

  return base;
}

/** Recognises lint/typecheck/build output well enough to classify success. */
export function parseValidationOutput(
  output: string,
  exitCode: number | null,
): { status: 'passed' | 'failed' | 'unknown'; errorCount: number | null; warningCount: number | null } {
  const errors = /(\d+)\s+errors?/i.exec(output);
  const warnings = /(\d+)\s+warnings?/i.exec(output);
  const tsErrors = [...output.matchAll(/error TS\d+/g)].length;

  const errorCount = tsErrors > 0 ? tsErrors : errors?.[1] ? Number(errors[1]) : null;

  return {
    status: exitCode === null ? 'unknown' : exitCode === 0 && (errorCount ?? 0) === 0 ? 'passed' : 'failed',
    errorCount,
    warningCount: warnings?.[1] ? Number(warnings[1]) : null,
  };
}
