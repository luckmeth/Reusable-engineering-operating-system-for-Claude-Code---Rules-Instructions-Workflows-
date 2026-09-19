import { fingerprintFinding } from '../hash.js';
import { isTestFile } from '../analyze/content.js';
import type { CeccEvent } from '../types/event.js';
import type { Evidence, Severity } from '../types/common.js';
import type { NewFinding } from '../types/finding.js';
import type { ProjectConfig } from '../types/project.js';
import type { Store } from '../storage/store.js';

/**
 * Event correlation.
 *
 * Single-event rules answer "is this change dangerous?". Correlation answers a
 * question no individual event can: "does this sequence tell a story that each
 * step hides?"
 *
 * The canonical case is an authorization test that fails after a middleware
 * change and then passes after the test is edited. Every step in that sequence
 * is individually defensible — code changed, a test failed, a test was updated,
 * the suite went green. Only the sequence shows that a failing security check
 * was answered by changing the check. That sequence is invisible to any tool
 * that looks at one diff at a time, and it is exactly how a real regression
 * reaches production with a green dashboard.
 */

export interface CorrelationMatch {
  patternId: string;
  title: string;
  severity: Severity;
  confidence: number;
  /** The ordered chain of events that produced this conclusion. */
  chain: CeccEvent[];
  evidence: Evidence[];
  impact: string;
  recommendation: string;
  affectedFiles: string[];
  category: NewFinding['category'];
  layer: NewFinding['layer'];
}

export interface CorrelationContext {
  project: ProjectConfig;
  store: Store;
  /** Chronologically ordered window of recent session events. */
  window: CeccEvent[];
  /** The event that triggered this pass. */
  trigger: CeccEvent;
}

interface Pattern {
  id: string;
  name: string;
  detect(ctx: CorrelationContext): CorrelationMatch[];
}

// ------------------------------------------------------------------ helpers

const SECURITY_PATH = /auth|session|permission|role|tenant|middleware|guard|policy|rls|security|acl|authoriz/i;

const describeEvent = (e: CeccEvent): string => {
  const when = new Date(e.timestamp).toISOString().slice(11, 19);
  const what = e.command ?? e.filePaths[0] ?? e.tool ?? e.type;
  return `${when} ${e.type} ${what}`.trim();
};

const chainEvidence = (events: CeccEvent[], label = 'Event sequence'): Evidence => ({
  kind: 'correlation',
  label,
  detail: events.map((e, i) => `${i + 1}. ${describeEvent(e)}`).join('\n'),
});

/** Events of the given types, in order, that occurred after `after`. */
function since(window: CeccEvent[], after: CeccEvent | null, types: string[]): CeccEvent[] {
  const floor = after ? after.seq : -1;
  return window.filter((e) => e.seq > floor && types.includes(e.type));
}

/** Most recent event matching a predicate. */
function lastWhere(window: CeccEvent[], predicate: (e: CeccEvent) => boolean): CeccEvent | null {
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const event = window[i];
    if (event && predicate(event)) return event;
  }
  return null;
}

/** Rules whose firing proves the edit touched a security control, whatever the path. */
const SECURITY_RULE_IDS = new Set(['AGENT-005', 'AGENT-008', 'AGENT-009', 'AGENT-010', 'AGENT-018', 'AGENT-019', 'AGENT-020']);

/**
 * Whether an event touched security-relevant code.
 *
 * Path matching alone is unreliable: an authorization check very often lives in
 * a file named for its domain (`api/invoices.ts`), not for its security role.
 * A security rule having already fired on this event is the stronger and more
 * direct signal, so it is checked first.
 */
const touchesSecurityCode = (e: CeccEvent): boolean => {
  if (e.findingRuleIds.some((id) => SECURITY_RULE_IDS.has(id))) return true;
  return e.filePaths.some((p) => SECURITY_PATH.test(p) && !isTestFile(p));
};

const isFileWrite = (e: CeccEvent): boolean => e.type === 'file.modified' || e.type === 'file.created';

/** Did this event carry a finding from a test-manipulation rule? */
const weakensTests = (e: CeccEvent): boolean => e.findingRuleIds.includes('AGENT-003');

// ----------------------------------------------------------------- patterns

/**
 * CORR-001 — a failing test answered by editing the test.
 *
 * Requires four things in order: production code changed, a test run failed, a
 * test file was then edited in a way AGENT-003 flagged as weakening, and a
 * later test run passed. Demanding the pass at the end matters — without it
 * this is just someone iterating on a test, which is normal work.
 */
const TEST_WEAKENED_AFTER_FAILURE: Pattern = {
  id: 'CORR-001',
  name: 'Failing test weakened instead of fixed',

  detect(ctx): CorrelationMatch[] {
    const { window } = ctx;

    // Anchor on the passing run, walking backwards from the trigger.
    const passed = lastWhere(window, (e) => e.type === 'test.run' && e.status === 'success');
    if (!passed) return [];

    const failed = lastWhere(window, (e) => e.type === 'test.run' && e.status === 'failed' && e.seq < passed.seq);
    if (!failed) return [];

    // A test edit between the failure and the pass, flagged as weakening.
    const testEdits = window.filter(
      (e) => e.seq > failed.seq && e.seq < passed.seq && isFileWrite(e) && e.filePaths.some(isTestFile),
    );
    if (testEdits.length === 0) return [];

    const weakening = testEdits.filter(weakensTests);

    // Production code changed before the failure — what the test was reacting to.
    const codeEdits = window.filter((e) => e.seq < failed.seq && isFileWrite(e) && e.filePaths.some((p) => !isTestFile(p)));
    const securityEdits = codeEdits.filter(touchesSecurityCode);

    // Production code edited between failure and pass means the fix may be real.
    const realFixAttempted = window.some(
      (e) => e.seq > failed.seq && e.seq < passed.seq && isFileWrite(e) && e.filePaths.some((p) => !isTestFile(p)),
    );

    // No weakening detected and the code was also changed: ordinary iteration.
    if (weakening.length === 0 && realFixAttempted) return [];

    const chain = [...securityEdits.slice(-2), ...(securityEdits.length ? [] : codeEdits.slice(-2)), failed, ...testEdits, passed];

    // Confidence and severity both hinge on whether security code was involved
    // and whether the test was actually weakened rather than merely touched.
    let confidence = 0.6;
    if (weakening.length > 0) confidence += 0.2;
    if (securityEdits.length > 0) confidence += 0.1;
    if (!realFixAttempted) confidence += 0.05;

    const severity: Severity = securityEdits.length > 0 ? 'critical' : weakening.length > 0 ? 'high' : 'medium';

    return [
      {
        patternId: 'CORR-001',
        title:
          securityEdits.length > 0
            ? 'Security test weakened after a failure, and the suite now passes'
            : 'Test modified after a failure, and the suite now passes',
        severity,
        confidence: Math.min(confidence, 0.92),
        chain,
        category: securityEdits.length > 0 ? 'ACCESS_CONTROL' : 'TESTING',
        layer: securityEdits.length > 0 ? 'APPLICATION' : 'AGENT',
        affectedFiles: [...new Set(chain.flatMap((e) => e.filePaths))],
        evidence: [
          chainEvidence(chain, 'Correlated sequence'),
          { kind: 'test', label: 'Failing run', detail: describeEvent(failed), eventId: failed.id },
          { kind: 'file', label: 'Test files edited after the failure', detail: [...new Set(testEdits.flatMap((e) => e.filePaths))].join(', ') },
          { kind: 'test', label: 'Passing run', detail: describeEvent(passed), eventId: passed.id },
          ...(securityEdits.length > 0
            ? [{ kind: 'file' as const, label: 'Security-relevant code changed first', detail: [...new Set(securityEdits.flatMap((e) => e.filePaths))].join(', ') }]
            : []),
          ...(realFixAttempted
            ? [{ kind: 'correlation' as const, label: 'Mitigating factor', detail: 'Production code was also changed between the failure and the pass, so the fix may be genuine' }]
            : [{ kind: 'correlation' as const, label: 'Aggravating factor', detail: 'No production code changed between the failure and the pass — only the test did' }]),
        ],
        impact:
          'A test failed, the test was then edited, and the suite now reports success. ' +
          (securityEdits.length > 0
            ? 'The preceding change touched authentication, authorization or tenancy code, so the behaviour the test was protecting may now be broken while CI reports green. '
            : '') +
          (realFixAttempted
            ? 'Production code also changed in the same window, so this may be a legitimate fix — the diff needs a human read.'
            : 'No production code changed between the failure and the pass, which means the test was made to agree with the code rather than the other way around.'),
        recommendation:
          'Read the test diff against the failing run. If the original expectation was correct, restore it and fix the code. If the requirement genuinely changed, record that reasoning in the commit.',
      },
    ];
  },
};

/**
 * CORR-002 — validation removed, then the unvalidated input used in a query.
 */
const VALIDATION_THEN_QUERY: Pattern = {
  id: 'CORR-002',
  name: 'Validation removed and input reaches the database',

  detect(ctx): CorrelationMatch[] {
    const { window, trigger } = ctx;

    const validationRemoved = window.filter(
      (e) => e.findingRuleIds.includes('AGENT-010') || e.findingRuleIds.includes('AGENT-009'),
    );
    if (validationRemoved.length === 0) return [];

    // A database write in the same file family, after the removal.
    const dbWrites = window.filter((e) => {
      if (e.seq <= (validationRemoved[0]?.seq ?? 0)) return false;
      const touched = e.metadata['dbOperation'];
      return touched === true || (typeof e.metadata['addedText'] === 'string' && /\.(?:insert|update|upsert|delete)\s*\(|INSERT INTO|UPDATE\s+\w+\s+SET/i.test(e.metadata['addedText'] as string));
    });
    if (dbWrites.length === 0) return [];

    const chain = [...validationRemoved.slice(0, 2), ...dbWrites.slice(0, 2), trigger].filter(
      (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i,
    );

    return [
      {
        patternId: 'CORR-002',
        title: 'Unvalidated request input reaches a database write',
        severity: 'critical',
        confidence: 0.78,
        chain,
        category: 'INJECTION',
        layer: 'APPLICATION',
        affectedFiles: [...new Set(chain.flatMap((e) => e.filePaths))],
        evidence: [
          chainEvidence(chain),
          { kind: 'correlation', label: 'Validation weakened at', detail: validationRemoved.map(describeEvent).join('; ') },
          { kind: 'correlation', label: 'Database write at', detail: dbWrites.map(describeEvent).join('; ') },
        ],
        impact:
          'Input validation was removed or bypassed, and request-derived data now flows into a database write. Fields the ' +
          'caller was never meant to control — tenant, role, price, status — can be set directly, and the shape of the data is no longer constrained.',
        recommendation: 'Restore schema validation before the write, and derive privileged fields from the session rather than the request.',
      },
    ];
  },
};

/**
 * CORR-003 — authorization or tenancy changed with no test covering it.
 *
 * This is a coverage gap rather than a defect: the change may be perfectly
 * correct. What CECC can say honestly is that nothing verified it.
 */
const SECURITY_CHANGE_UNTESTED: Pattern = {
  id: 'CORR-003',
  name: 'Security-relevant change with no covering test',

  detect(ctx): CorrelationMatch[] {
    const { window, trigger } = ctx;

    // Only conclude this at a natural checkpoint, not mid-edit.
    const isCheckpoint = trigger.type === 'git.commit' || trigger.type === 'session.ended' || trigger.type === 'workflow.gate.evaluated';
    if (!isCheckpoint) return [];

    const securityChanges = window.filter((e) => isFileWrite(e) && touchesSecurityCode(e));
    if (securityChanges.length === 0) return [];

    const testsRun = window.filter((e) => e.type === 'test.run');
    const testsWritten = window.filter((e) => isFileWrite(e) && e.filePaths.some(isTestFile));

    if (testsRun.length > 0 && testsWritten.length > 0) return [];

    const files = [...new Set(securityChanges.flatMap((e) => e.filePaths.filter((p) => SECURITY_PATH.test(p))))];

    return [
      {
        patternId: 'CORR-003',
        title: 'Authorization or tenancy code changed without any test being written or run',
        severity: 'high',
        confidence: 0.8,
        chain: [...securityChanges.slice(-4), trigger],
        category: 'TESTING',
        layer: 'APPLICATION',
        affectedFiles: files,
        evidence: [
          chainEvidence([...securityChanges.slice(-4), trigger]),
          { kind: 'file', label: 'Security-relevant files changed', detail: files.join(', ') },
          { kind: 'test', label: 'Test runs observed in this session', detail: String(testsRun.length) },
          { kind: 'test', label: 'Test files written in this session', detail: String(testsWritten.length) },
        ],
        impact:
          'Access-control code changed and reached a checkpoint with no test written and no suite run in this session. ' +
          'The change may be correct — but nothing here demonstrates that, and access-control defects are silent until exploited. ' +
          'This is an absence of evidence, not evidence of a defect.',
        recommendation:
          'Add a test that fails when the control is removed: an unauthenticated request, a cross-tenant request, and an ownership violation on write.',
      },
    ];
  },
};

/**
 * CORR-004 — a security control removed and then committed past the hooks.
 * Two deliberate bypasses in sequence is a much stronger signal than either alone.
 */
const REMOVAL_THEN_BYPASS: Pattern = {
  id: 'CORR-004',
  name: 'Security control removed, then committed with verification skipped',

  detect(ctx): CorrelationMatch[] {
    const { window, trigger } = ctx;
    if (trigger.type !== 'git.commit' && trigger.type !== 'command.completed') return [];

    const bypassed = window.filter((e) => e.findingRuleIds.includes('AGENT-002'));
    if (bypassed.length === 0) return [];

    const removals = window.filter(
      (e) =>
        e.findingRuleIds.includes('AGENT-005') ||
        e.findingRuleIds.includes('AGENT-008') ||
        e.findingRuleIds.includes('AGENT-020'),
    );
    if (removals.length === 0) return [];

    const lastBypass = bypassed[bypassed.length - 1]!;
    const relevant = removals.filter((r) => r.seq < lastBypass.seq);
    if (relevant.length === 0) return [];

    const chain = [...relevant.slice(-3), lastBypass];

    return [
      {
        patternId: 'CORR-004',
        title: 'Security control removed, then committed with verification hooks skipped',
        severity: 'critical',
        confidence: 0.88,
        chain,
        category: 'ACCESS_CONTROL',
        layer: 'AGENT',
        affectedFiles: [...new Set(relevant.flatMap((e) => e.filePaths))],
        evidence: [
          chainEvidence(chain),
          { kind: 'file', label: 'Controls removed', detail: [...new Set(relevant.flatMap((e) => e.filePaths))].join(', ') },
          { kind: 'command', label: 'Verification skipped', detail: lastBypass.command ?? '(command not recorded)', eventId: lastBypass.id },
        ],
        impact:
          'A security control was removed and the resulting change was then committed in a way that skipped the repository’s ' +
          'pre-commit checks. Whichever check would have caught this — secret scanning, lint, tests — did not run, and the ' +
          'commit is in history as though it had passed.',
        recommendation:
          'Review the commit contents directly. Re-run the skipped hooks against it, restore the removed control, and commit the fix without --no-verify.',
      },
    ];
  },
};

/**
 * CORR-005 — the same failing command repeated with nothing changed in between.
 *
 * Both an efficiency signal and a correctness one: repeating an identical
 * command against an unchanged tree cannot produce a different result, so it
 * indicates the agent is stuck rather than progressing.
 */
const REPEATED_FAILURE: Pattern = {
  id: 'CORR-005',
  name: 'Identical failing command repeated without any change',

  detect(ctx): CorrelationMatch[] {
    const { window, trigger } = ctx;
    if (trigger.status !== 'failed' || !trigger.command) return [];

    const sameCommand = window.filter((e) => e.command === trigger.command && e.status === 'failed');
    if (sameCommand.length < 3) return [];

    const first = sameCommand[0]!;
    const editsBetween = window.filter((e) => e.seq > first.seq && e.seq < trigger.seq && isFileWrite(e));
    if (editsBetween.length > 0) return [];

    return [
      {
        patternId: 'CORR-005',
        title: `Same command failed ${sameCommand.length} times with no file changes in between`,
        severity: 'low',
        confidence: 0.9,
        chain: sameCommand,
        category: 'QUALITY',
        layer: 'AGENT',
        affectedFiles: [],
        evidence: [
          chainEvidence(sameCommand, 'Repeated attempts'),
          { kind: 'command', label: 'Command', detail: trigger.command },
          { kind: 'correlation', label: 'File changes between attempts', detail: '0' },
        ],
        impact:
          'An identical command was re-run against an unchanged working tree, so it could not have produced a different ' +
          'result. This consumes time and tokens without advancing the task, and usually means the actual cause has not been identified.',
        recommendation: 'Change the hypothesis before retrying: read the full error, inspect the relevant state, then run a command that tests something new.',
      },
    ];
  },
};

/**
 * CORR-006 — a secret introduced and then committed.
 * Elevates a hardcoded-secret finding from "in the working tree" to "in history".
 */
const SECRET_THEN_COMMIT: Pattern = {
  id: 'CORR-006',
  name: 'Secret introduced and then committed',

  detect(ctx): CorrelationMatch[] {
    const { window, trigger } = ctx;
    if (trigger.type !== 'git.commit') return [];

    const secretEvents = window.filter(
      (e) => e.findingRuleIds.includes('AGENT-006') || e.findingRuleIds.includes('AGENT-007'),
    );
    if (secretEvents.length === 0) return [];

    const files = [...new Set(secretEvents.flatMap((e) => e.filePaths))];
    const chain = [...secretEvents.slice(-3), trigger];

    return [
      {
        patternId: 'CORR-006',
        title: 'Credential introduced earlier in this session was committed',
        severity: 'critical',
        confidence: 0.85,
        chain,
        category: 'SECRETS',
        layer: 'APPLICATION',
        affectedFiles: files,
        evidence: [
          chainEvidence(chain),
          { kind: 'file', label: 'Files carrying detected credentials', detail: files.join(', ') },
          { kind: 'command', label: 'Commit', detail: trigger.command ?? '(command not recorded)', eventId: trigger.id },
        ],
        impact:
          'The credential is now in git history. Removing the line in a later commit does not remove it from history, and ' +
          'if the branch has been pushed it exists in every clone and fork. Treat the credential as compromised from the moment of this commit.',
        recommendation:
          'Rotate the credential now — that is the only step that actually restores security. Then remove it from the working tree, and purge history only if the branch has not been widely distributed.',
      },
    ];
  },
};

const PATTERNS: Pattern[] = [
  TEST_WEAKENED_AFTER_FAILURE,
  VALIDATION_THEN_QUERY,
  SECURITY_CHANGE_UNTESTED,
  REMOVAL_THEN_BYPASS,
  REPEATED_FAILURE,
  SECRET_THEN_COMMIT,
];

export interface CorrelationResult {
  findings: NewFinding[];
  matches: CorrelationMatch[];
  errors: Array<{ patternId: string; message: string }>;
}

/**
 * Runs every correlation pattern over the session window.
 *
 * Also writes the discovered relationships into the event graph, so the UI can
 * walk from any event to the others it is implicated with. Like the rule
 * engine, each pattern is isolated: a throwing pattern must not fail the hook.
 */
export function runCorrelations(ctx: CorrelationContext): CorrelationResult {
  const findings: NewFinding[] = [];
  const matches: CorrelationMatch[] = [];
  const errors: CorrelationResult['errors'] = [];

  for (const pattern of PATTERNS) {
    let found: CorrelationMatch[] = [];
    try {
      found = pattern.detect(ctx);
    } catch (err) {
      errors.push({ patternId: pattern.id, message: err instanceof Error ? err.message : String(err) });
      continue;
    }

    for (const match of found) {
      matches.push(match);

      // Record the chain in the graph so the relationship survives the finding.
      for (let i = 0; i < match.chain.length - 1; i += 1) {
        const from = match.chain[i];
        const to = match.chain[i + 1];
        if (from && to) ctx.store.linkEvents(ctx.project.id, from.id, to.id, match.patternId);
      }

      findings.push({
        ruleId: match.patternId,
        title: match.title,
        category: match.category,
        layer: match.layer,
        severity: match.severity,
        confidence: match.confidence,
        // Correlation reports a sequence it observed; whether that sequence is a
        // defect needs human judgement, so it is never claimed as VERIFIED.
        verification: 'LIKELY',
        detection: 'CORRELATED',
        status: 'open',
        source: `correlation-engine:${match.patternId}`,
        projectId: ctx.project.id,
        sessionId: ctx.trigger.sessionId,
        workflowRunId: ctx.trigger.workflowRunId,
        affectedFiles: match.affectedFiles,
        affectedLines: [],
        command: ctx.trigger.command,
        evidence: match.evidence,
        impact: match.impact,
        recommendation: match.recommendation,
        relatedEvents: match.chain.map((e) => e.id),
        relatedFindings: [],
        relatedTests: match.chain.filter((e) => e.type === 'test.run').map((e) => e.id),
        relatedCommits: match.chain.filter((e) => e.type === 'git.commit').map((e) => e.id),
        fingerprint: fingerprintFinding({
          ruleId: match.patternId,
          projectId: ctx.project.id,
          files: match.affectedFiles,
          // Anchor to the session so one story yields one finding, not one per event.
          discriminator: `${ctx.trigger.sessionId}:${match.patternId}`,
        }),
      });
    }
  }

  return { findings, matches, errors };
}

export { PATTERNS };
