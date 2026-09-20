import { isNonExecutable, isPatternDefinition, isProseString, isTestFile, trulyRemoved } from '../../analyze/content.js';
import { lineEvidence, locations, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';
import type { ChangedLine, ContentChange } from '../../types/event.js';

/**
 * Detections for the shortcut of making a signal go away instead of fixing what
 * it reported.
 *
 * These rules are context-sensitive by necessity. `@ts-expect-error` with an
 * explanation is responsible engineering; the same directive bare, added in the
 * same edit as the code it silences, is a defect being papered over. Flagging
 * both identically would make the rule noise, and noisy rules get switched off.
 */

// ---------------------------------------------------------------- AGENT-003

const SKIP_ADDED = /\b(?:it|test|describe|context)\.(?:skip|todo)\s*\(|\bx(?:it|test|describe)\s*\(|\.skip\s*\(/;
const ONLY_ADDED = /\b(?:it|test|describe)\.only\s*\(/;
const ASSERTION = /\b(?:expect|assert|should|t\.(?:is|deepEqual|truthy))\s*\(/;
const COVERAGE_EXCLUDE = /(?:exclude|ignore|coveragePathIgnorePatterns|collectCoverageFrom)\s*[:=]/;
const TIMEOUT = /\b(?:timeout|setTimeout|jest\.setTimeout|testTimeout)\s*[(:=]\s*(\d{3,})/;

/** Assertions ordered weakest first — a move down this list loosens the check. */
const ASSERTION_STRENGTH: Array<{ pattern: RegExp; strength: number; name: string }> = [
  { pattern: /\.toBeDefined\s*\(\s*\)/, strength: 1, name: 'toBeDefined' },
  { pattern: /\.toBeTruthy\s*\(\s*\)/, strength: 1, name: 'toBeTruthy' },
  { pattern: /\.toBeFalsy\s*\(\s*\)/, strength: 1, name: 'toBeFalsy' },
  { pattern: /\.not\.toThrow\s*\(\s*\)/, strength: 1, name: 'not.toThrow' },
  { pattern: /\.toBeGreaterThan\s*\(/, strength: 2, name: 'toBeGreaterThan' },
  { pattern: /\.toContain\s*\(/, strength: 2, name: 'toContain' },
  { pattern: /\.toMatch\s*\(/, strength: 2, name: 'toMatch' },
  { pattern: /\.toHaveLength\s*\(/, strength: 3, name: 'toHaveLength' },
  { pattern: /\.toBe\s*\(/, strength: 4, name: 'toBe' },
  { pattern: /\.toEqual\s*\(/, strength: 4, name: 'toEqual' },
  { pattern: /\.toStrictEqual\s*\(/, strength: 5, name: 'toStrictEqual' },
];

function assertionStrength(text: string): { strength: number; name: string } | null {
  for (const entry of [...ASSERTION_STRENGTH].reverse()) {
    if (entry.pattern.test(text)) return { strength: entry.strength, name: entry.name };
  }
  return null;
}

/** Extracts the value inside the first `toBe(...)`/`toEqual(...)` for comparison. */
function expectedValue(text: string): string | null {
  const match = /\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*([^)]{1,80})\)/.exec(text);
  return match?.[1]?.trim() ?? null;
}

/**
 * Reduces an assertion to the expression under test.
 *
 * Every trailing matcher is stripped, not just the equality ones: comparing
 * `toBe(404)` against `toBeDefined()` is the whole point, and leaving either
 * matcher in the subject means the pair never matches and the downgrade goes
 * unreported. Negation is stripped too so `.not.toThrow()` reduces to the same
 * subject as `.toThrow()`.
 */
const assertionSubject = (text: string): string =>
  text
    .replace(/\.(?:not\.)?to[A-Za-z]*\s*\([^)]*\)/g, '')
    .replace(/\.(?:not\.)?to[A-Za-z]*\s*\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const AGENT_003: Rule = {
  id: 'AGENT-003',
  name: 'Test manipulation',
  category: 'TESTING',
  layer: 'AGENT',
  severity: 'high',
  detection: 'STATIC_ANALYSIS',
  description: 'A test was disabled, deleted, or weakened rather than made to pass.',
  why:
    'A test encodes a decision about how the system must behave. Changing the test to match broken behaviour deletes that ' +
    'decision and leaves a green suite that proves nothing. This is the single most effective way for a regression to ship ' +
    'while every dashboard stays green.',
  remediation:
    'Fix the code the test is describing. If the test itself encodes the wrong expectation, change it in a separate commit that states why the expected behaviour changed.',

  matches(ctx) {
    return ctx.changes.some((c) => isTestFile(c.file) && !isNonExecutable(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (!isTestFile(change.file) || isNonExecutable(change.file)) continue;

      // --- whole test file deleted
      if (change.isDeletion) {
        results.push({
          title: `Test file deleted: ${change.file}`,
          severity: 'critical',
          confidence: 0.9,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'Deleted test file', detail: change.file, file: change.file }],
          impact: 'Every behaviour this file asserted is now unverified, and nothing in CI will report its absence.',
          recommendation: this.remediation,
          discriminator: 'deleted',
        });
        continue;
      }

      // --- tests disabled
      const skipped = change.added.filter((l) => SKIP_ADDED.test(l.text));
      const previouslyActive = skipped.filter((l) => {
        const active = l.text.replace(/\.(?:skip|todo)/, '').replace(/\bx(it|test|describe)\b/, '$1');
        return change.removed.some((r) => r.text.replace(/\s+/g, ' ').trim() === active.replace(/\s+/g, ' ').trim());
      });
      if (skipped.length > 0) {
        results.push({
          title: `${skipped.length} test${skipped.length === 1 ? '' : 's'} disabled in ${change.file}`,
          severity: previouslyActive.length > 0 ? 'high' : 'medium',
          confidence: previouslyActive.length > 0 ? 0.93 : 0.75,
          verification: previouslyActive.length > 0 ? 'VERIFIED' : 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, skipped),
          evidence: skipped.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Test disabled')),
          impact:
            previouslyActive.length > 0
              ? 'These tests were running before this edit and are now skipped. The suite still reports success without executing them.'
              : 'Skipped tests report as passing in most runners, so their absence is invisible in CI summaries.',
          recommendation: this.remediation,
          discriminator: 'skipped',
        });
      }

      // --- .only silently drops every other test in the file
      const only = change.added.filter((l) => ONLY_ADDED.test(l.text));
      if (only.length > 0) {
        results.push({
          title: `.only() left in ${change.file} — other tests in this file will not run`,
          severity: 'high',
          confidence: 0.95,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, only),
          evidence: only.slice(0, 3).map((l) => lineEvidence(change.file, l.line, l.text, 'Focused test')),
          impact:
            'Most runners execute only the focused test and report the run as a pass. Every other test in the file is silently skipped, in CI as well as locally.',
          recommendation: 'Remove .only before committing. A lint rule or pre-commit hook can catch this automatically.',
          discriminator: 'only',
        });
      }

      // --- assertions removed outright
      const assertionsGone = trulyRemoved(change, ASSERTION);
      if (assertionsGone.length > 0 && !change.isNewFile) {
        results.push({
          title: `${assertionsGone.length} assertion${assertionsGone.length === 1 ? '' : 's'} removed from ${change.file}`,
          severity: 'high',
          confidence: 0.82,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, assertionsGone),
          evidence: assertionsGone.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Assertion removed')),
          impact:
            'A test that runs without asserting anything passes unconditionally. It still appears in the pass count, which makes the coverage look real.',
          recommendation: this.remediation,
          discriminator: 'assertions-removed',
        });
      }

      // --- assertions weakened in place
      const weakened = findWeakenedAssertions(change);
      if (weakened.length > 0) {
        results.push({
          title: `Assertions weakened in ${change.file}`,
          severity: 'high',
          confidence: 0.85,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, weakened.map((w) => w.after)),
          evidence: weakened.slice(0, 5).flatMap((w) => [
            lineEvidence(change.file, w.before.line, w.before.text, `Was: ${w.fromName}`),
            lineEvidence(change.file, w.after.line, w.after.text, `Now: ${w.toName}`),
          ]),
          impact:
            'The test still runs and still passes, but it now accepts a wider range of behaviour than it did before — including, potentially, the behaviour that was failing.',
          recommendation: this.remediation,
          discriminator: 'assertion-weakened',
        });
      }

      // --- expected values changed
      const changedExpectations = findChangedExpectations(change);
      if (changedExpectations.length > 0) {
        results.push({
          title: `Expected values changed in ${change.file}`,
          severity: 'medium',
          confidence: 0.7,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, changedExpectations.map((c) => c.after)),
          evidence: changedExpectations.slice(0, 5).flatMap((c) => [
            lineEvidence(change.file, c.before.line, c.before.text, `Expected ${c.fromValue}`),
            lineEvidence(change.file, c.after.line, c.after.text, `Now expects ${c.toValue}`),
          ]),
          impact:
            'The assertion now expects a different result. This is legitimate when the requirement changed and a defect being ' +
            'accepted when it did not — the diff alone cannot distinguish them, so a human needs to confirm which happened.',
          recommendation: 'Confirm the new expected value matches the intended requirement, not merely the current output.',
          discriminator: 'expectation-changed',
        });
      }

      // --- timeouts inflated to hide slowness or a hang
      for (const line of change.added) {
        const match = TIMEOUT.exec(line.text);
        if (!match?.[1]) continue;
        const value = Number(match[1]);
        const prior = change.removed.map((r) => TIMEOUT.exec(r.text)?.[1]).filter(Boolean).map(Number);
        const previous = prior.length > 0 ? Math.max(...prior) : 0;
        if (value >= 30_000 && value > previous * 2) {
          results.push({
            title: `Test timeout raised to ${value}ms in ${change.file}`,
            severity: 'medium',
            confidence: 0.7,
            verification: 'POTENTIAL',
            affectedFiles: [change.file],
            affectedLines: locations(change.file, [line]),
            evidence: [lineEvidence(change.file, line.line, line.text, `Timeout ${previous || 'default'} -> ${value}ms`)],
            impact:
              'A large timeout increase often accommodates a hang or a real performance regression rather than fixing it. The test then passes slowly instead of failing quickly.',
            recommendation: 'Establish why the operation became slow. Raise the timeout only once the duration is understood and intended.',
            discriminator: 'timeout-raised',
          });
        }
      }

      // --- files excluded from coverage
      const excluded = change.added.filter((l) => COVERAGE_EXCLUDE.test(l.text));
      if (excluded.length > 0) {
        results.push({
          title: 'Coverage exclusions added',
          severity: 'medium',
          confidence: 0.65,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, excluded),
          evidence: excluded.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Coverage exclusion')),
          impact: 'Excluded paths stop counting against the coverage threshold, so the reported number can rise while real coverage falls.',
          recommendation: 'Exclude only genuinely untestable code (generated files, type declarations) and state the reason inline.',
          discriminator: 'coverage-exclusion',
        });
      }
    }

    return results;
  },
};

interface WeakenedAssertion {
  before: ChangedLine;
  after: ChangedLine;
  fromName: string;
  toName: string;
}

/**
 * Pairs removed and added assertions that test the same subject, and reports
 * the pairs where the matcher got weaker.
 *
 * Matching on subject rather than position is what keeps this quiet during
 * reformatting and reordering: only a genuine matcher downgrade on the same
 * expression is reported.
 */
function findWeakenedAssertions(change: ContentChange): WeakenedAssertion[] {
  const out: WeakenedAssertion[] = [];
  const removedAssertions = change.removed.filter((l) => ASSERTION.test(l.text));
  const addedAssertions = change.added.filter((l) => ASSERTION.test(l.text));

  for (const before of removedAssertions) {
    const beforeStrength = assertionStrength(before.text);
    if (!beforeStrength) continue;
    const subject = assertionSubject(before.text);
    if (!subject) continue;

    const after = addedAssertions.find((a) => assertionSubject(a.text) === subject);
    if (!after) continue;

    const afterStrength = assertionStrength(after.text);
    if (!afterStrength) continue;
    if (afterStrength.strength >= beforeStrength.strength) continue;

    out.push({ before, after, fromName: beforeStrength.name, toName: afterStrength.name });
  }
  return out;
}

interface ChangedExpectation {
  before: ChangedLine;
  after: ChangedLine;
  fromValue: string;
  toValue: string;
}

function findChangedExpectations(change: ContentChange): ChangedExpectation[] {
  const out: ChangedExpectation[] = [];
  for (const before of change.removed) {
    const fromValue = expectedValue(before.text);
    if (!fromValue) continue;
    const subject = assertionSubject(before.text);
    if (!subject) continue;

    for (const after of change.added) {
      if (assertionSubject(after.text) !== subject) continue;
      const toValue = expectedValue(after.text);
      if (!toValue || toValue === fromValue) continue;
      out.push({ before, after, fromValue, toValue });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- AGENT-004

const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const CATCH_SWALLOW = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*\}/;
const PROMISE_SWALLOW = /\.catch\s*\(\s*(?:\(\s*\)|\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{?\s*\}?\s*\)/;
// Anchored to the start of a comment: `// @ts-ignore` is a directive, while
// a sentence mentioning @ts-ignore is documentation about one.
const TS_IGNORE = /(?:^|\s)(?:\/\/|\/\*|\*)\s*@ts-ignore\b/;
const TS_EXPECT_ERROR = /(?:^|\s)(?:\/\/|\/\*|\*)\s*@ts-expect-error\b/;
const ESLINT_DISABLE = /(?:^|\s)(?:\/\/|\/\*|\*)\s*eslint-disable(?:-next-line|-line)?\b(?<rules>[^\n*]*)/;
const UNSAFE_CAST = /\bas\s+any\b|\bas\s+unknown\s+as\b|<any>/;
const STRICT_OFF = /"(?:strict|strictNullChecks|noImplicitAny|strictFunctionTypes)"\s*:\s*false/;

/** Security lint rules whose suppression is materially worse than a style rule's. */
const SECURITY_LINT_RULE = /security|no-eval|no-implied-eval|detect-|no-unsanitized|xss|csrf|injection/i;

const AGENT_004: Rule = {
  id: 'AGENT-004',
  name: 'Error suppression',
  category: 'QUALITY',
  layer: 'AGENT',
  severity: 'medium',
  detection: 'STATIC_ANALYSIS',
  description: 'An error, type error or lint finding was silenced rather than resolved.',
  why:
    'A swallowed error turns a loud failure into a silent wrong answer. The request still returns 200, the data is still ' +
    'wrong, and there is nothing in the logs to explain it later. Type and lint suppressions do the same to checks that ' +
    'run before the code ever executes.',
  remediation:
    'Handle the error: log it with context and return a meaningful result. If a suppression is genuinely correct, use @ts-expect-error with a written reason so the next reader knows it was a decision.',

  matches(ctx) {
    return ctx.changes.length > 0;
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      // Documentation showing what a bad pattern looks like is not that pattern.
      if (change.isDeletion || isNonExecutable(change.file)) continue;

      // This rule filters `added` directly rather than through matchAdded, so
      // it applies the same guards explicitly: a line defining `/@ts-ignore/`
      // as a pattern is not a suppression, and neither is prose describing one.
      const lines = change.added.filter((l) => !isPatternDefinition(l.text) && !isProseString(l.text));

      // --- swallowed exceptions
      const swallowed = lines.filter((l) => EMPTY_CATCH.test(l.text) || CATCH_SWALLOW.test(l.text) || PROMISE_SWALLOW.test(l.text));
      if (swallowed.length > 0) {
        results.push({
          title: `Error swallowed without handling in ${change.file}`,
          severity: 'medium',
          confidence: 0.88,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, swallowed),
          evidence: swallowed.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Empty or no-op catch')),
          impact:
            'The failure is discarded with no log and no signal to the caller. Downstream code proceeds on the assumption the operation succeeded, ' +
            'and the eventual symptom appears far from the cause.',
          recommendation: this.remediation,
          discriminator: 'swallowed-error',
        });
      }

      // --- type checking suppressed
      const tsIgnores = lines.filter((l) => TS_IGNORE.test(l.text));
      // A suppression carrying a written explanation is a documented decision rather
      // than a shortcut, so only bare directives with no stated reason are reported.
      const bareExpectErrors = lines.filter(
        (l) => TS_EXPECT_ERROR.test(l.text) && l.text.replace(/.*@ts-expect-error/, '').trim().length < 8,
      );
      if (tsIgnores.length > 0 || bareExpectErrors.length > 0) {
        const lines = [...tsIgnores, ...bareExpectErrors];
        results.push({
          title: `Type checking suppressed in ${change.file}`,
          severity: 'medium',
          confidence: 0.85,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, lines),
          evidence: lines.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Type check suppressed')),
          impact:
            '@ts-ignore hides the error and every future error on that line, including ones introduced later by unrelated changes. ' +
            'The compiler stops being a check for that code.',
          recommendation:
            'Prefer @ts-expect-error with a written reason — it fails once the underlying problem is fixed, so the suppression cannot outlive its justification.',
          discriminator: 'ts-suppression',
        });
      }

      // --- lint suppressed, weighted by what was suppressed
      const eslintDisables = lines.filter((l) => ESLINT_DISABLE.test(l.text));
      if (eslintDisables.length > 0) {
        const securityRules = eslintDisables.filter((l) => SECURITY_LINT_RULE.test(l.text));
        const blanket = eslintDisables.filter((l) => /eslint-disable\s*(?:\*\/|$)/.test(l.text));
        results.push({
          title:
            securityRules.length > 0
              ? `Security lint rule suppressed in ${change.file}`
              : `Lint rules suppressed in ${change.file}`,
          severity: securityRules.length > 0 ? 'high' : blanket.length > 0 ? 'medium' : 'low',
          confidence: 0.8,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, eslintDisables),
          evidence: eslintDisables.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Lint suppression')),
          impact:
            securityRules.length > 0
              ? 'A lint rule that exists specifically to catch a security defect was disabled at the point where it fired.'
              : blanket.length > 0
                ? 'A file-wide eslint-disable turns off every rule for the whole file, including rules added later.'
                : 'The reported finding no longer appears, whether or not the underlying issue was addressed.',
          recommendation:
            'Disable the single named rule on the single line that needs it, with a comment explaining why the rule is wrong here.',
          discriminator: securityRules.length > 0 ? 'eslint-security' : 'eslint-disable',
        });
      }

      // --- types asserted away
      const casts = lines.filter((l) => UNSAFE_CAST.test(l.text));
      if (casts.length > 0) {
        results.push({
          title: `Unsafe type assertion in ${change.file}`,
          severity: 'low',
          confidence: 0.72,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, casts),
          evidence: casts.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Type assertion')),
          impact:
            'The assertion tells the compiler to stop checking without changing what the value actually is at runtime. ' +
            'Where this sits on an input boundary, unvalidated external data flows on with a type that claims otherwise.',
          recommendation: 'Validate the value and let the type follow from the validation, rather than asserting the type you want.',
          discriminator: 'unsafe-cast',
        });
      }

      // --- compiler strictness reduced
      const strictOff = lines.filter((l) => STRICT_OFF.test(l.text));
      if (strictOff.length > 0) {
        results.push({
          title: 'TypeScript strictness reduced',
          severity: 'high',
          confidence: 0.92,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, strictOff),
          evidence: strictOff.map((l) => lineEvidence(change.file, l.line, l.text, 'Compiler check disabled')),
          impact:
            'Disabling a strictness flag silences an entire class of error across the whole project at once, not just at the ' +
            'line that was failing. Everything already written stops being checked for it too.',
          recommendation: 'Restore the flag and fix the reported errors. If the migration is large, scope the exception to specific files rather than the project.',
          discriminator: 'strict-off',
        });
      }
    }

    return results;
  },
};

export const QUALITY_RULES = [AGENT_003, AGENT_004];
registerRules(QUALITY_RULES);
export { AGENT_003, AGENT_004 };
