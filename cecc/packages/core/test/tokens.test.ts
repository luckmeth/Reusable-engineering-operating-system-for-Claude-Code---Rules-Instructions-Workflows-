import { describe, expect, it } from 'vitest';
import { accountTokens, estimateTokens, formatTokens } from '../src/analyze/tokens.js';
import type { CeccEvent } from '../src/types/event.js';

/**
 * Token accounting is an estimate presented next to real findings, which makes
 * it the easiest number on the page to quietly get wrong. These fix the two
 * properties that keep it honest: nothing is counted twice, and the avoidable
 * figure can never exceed what was actually read.
 */

let seq = 0;
function ev(partial: Partial<CeccEvent> & Pick<CeccEvent, 'type'>): CeccEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    seq,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    projectId: 'p',
    sessionId: 's',
    workflowRunId: null,
    agentId: 'claude-code',
    source: 'agent',
    severity: 'info',
    status: 'success',
    command: null,
    tool: null,
    filePaths: [],
    metadata: { hookEvent: 'PostToolUse' },
    evidence: [],
    durationMs: null,
    parentEventId: null,
    contentHash: null,
    findingRuleIds: [],
    ...partial,
  } as CeccEvent;
}

const read = (file: string, bytes: number) =>
  ev({ type: 'file.read', filePaths: [file], metadata: { hookEvent: 'PostToolUse', bytes } });

const write = (file: string, bytes: number) =>
  ev({ type: 'file.modified', filePaths: [file], metadata: { hookEvent: 'PostToolUse', bytes } });

describe('estimateTokens', () => {
  it('is four characters to a token, rounded up', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(-10)).toBe(0);
    expect(estimateTokens(Number.NaN)).toBe(0);
  });
});

describe('formatTokens', () => {
  it('stays exact below a thousand and compacts above it', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(25_000)).toBe('25k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('accountTokens', () => {
  it('counts one action once, not twice for the hook pair', () => {
    const pre = ev({
      type: 'file.read',
      filePaths: ['a.ts'],
      metadata: { hookEvent: 'PreToolUse', bytes: 400 },
    });
    const post = read('a.ts', 400);
    const single = accountTokens([post]);
    const paired = accountTokens([pre, post]);
    expect(paired.breakdown.filesRead).toBe(single.breakdown.filesRead);
    expect(paired.breakdown.filesRead).toBe(100);
  });

  it('separates reads, writes, command output and prompts', () => {
    const result = accountTokens([
      read('a.ts', 400),
      write('a.ts', 80),
      ev({ type: 'command.completed', metadata: { hookEvent: 'PostToolUse', output: 'x'.repeat(40) } }),
      ev({ type: 'prompt.submitted', metadata: { hookEvent: 'UserPromptSubmit', promptLength: 20 } }),
    ]);
    expect(result.breakdown).toEqual({ filesRead: 100, filesWritten: 20, commandOutput: 10, prompts: 5 });
    expect(result.estimatedTotal).toBe(135);
  });

  it('charges a re-read of an unchanged file as avoidable', () => {
    const result = accountTokens([read('a.ts', 400), read('a.ts', 400), read('a.ts', 400)]);
    expect(result.breakdown.filesRead).toBe(300);
    expect(result.avoidable).toBe(200);
    expect(result.avoidableReasons[0]).toMatchObject({ label: 'a.ts', occurrences: 2 });
  });

  it('does not charge a re-read that follows an edit', () => {
    const result = accountTokens([read('a.ts', 400), write('a.ts', 400), read('a.ts', 400)]);
    expect(result.avoidable).toBe(0);
    expect(result.avoidableReasons).toEqual([]);
  });

  it('never reports more avoidable than was read', () => {
    // Older events carry no size. The stand-in figure has to land in both
    // totals or the panel shows more waste than traffic.
    const sizeless = ev({ type: 'file.read', filePaths: ['a.ts'], metadata: { hookEvent: 'PostToolUse' } });
    const result = accountTokens([read('a.ts', 400), sizeless, sizeless, sizeless]);
    expect(result.avoidable).toBeLessThanOrEqual(result.breakdown.filesRead);
  });

  it('reports an unsized read as unmeasured rather than as zero cost', () => {
    const result = accountTokens([
      ev({ type: 'file.read', filePaths: ['never-seen.ts'], metadata: { hookEvent: 'PostToolUse' } }),
    ]);
    expect(result.breakdown.filesRead).toBe(0);
    expect(result.unmeasured).toBe(1);
  });

  it('counts an identical repeated search as avoidable', () => {
    const search = () =>
      ev({
        type: 'command.completed',
        command: 'grep createInvoice',
        metadata: { hookEvent: 'PostToolUse', intent: 'search', searchPath: 'src', output: 'y'.repeat(80) },
      });
    const result = accountTokens([search(), search()]);
    expect(result.avoidableReasons.some((r) => r.label.startsWith('search:'))).toBe(true);
  });

  it('returns zeroes for an empty log rather than throwing', () => {
    const result = accountTokens([]);
    expect(result.estimatedTotal).toBe(0);
    expect(result.avoidable).toBe(0);
    expect(result.avoidableReasons).toEqual([]);
  });
});
