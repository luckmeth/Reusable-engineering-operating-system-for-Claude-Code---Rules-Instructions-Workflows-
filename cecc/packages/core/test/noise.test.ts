import { describe, expect, it } from 'vitest';
import { changeFromWrite } from '../src/analyze/content.js';
import { getRule } from '../src/rules/registry.js';
import '../src/rules/index.js';
import type { RuleContext } from '../src/rules/types.js';

/**
 * False-positive cover.
 *
 * A first run of `cecc scan` against a small real project returned ten
 * findings, of which one was worth reading. Two of the eight noisy ones were
 * CRITICAL. That ratio is the failure mode that matters most for this tool:
 * people stop reading criticals, and the real leak goes past with them.
 *
 * Every case below is paired. The suppression is only correct if the genuine
 * version of the same shape still fires, so each block asserts both.
 */

function ctxFor(file: string, content: string): RuleContext {
  return {
    changes: [changeFromWrite(file, content, false)],
    events: [],
    commands: [],
    project: { stack: { hasSupabase: true } },
  } as unknown as RuleContext;
}

function run(ruleId: string, file: string, content: string) {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`rule ${ruleId} is not registered`);
  const ctx = ctxFor(file, content);
  if (!rule.matches(ctx)) return [];
  return rule.evaluate(ctx);
}

describe('AGENT-017 — predictable randomness in context', () => {
  it('does not flag a shuffle, where the giveaway is in the function name above', () => {
    const src = [
      '/** Fisher-Yates shuffle - returns a new array. */',
      'export function shuffle<T>(input: readonly T[]): T[] {',
      '  const arr = input.slice();',
      '  for (let i = arr.length - 1; i > 0; i--) {',
      '    const j = Math.floor(Math.random() * (i + 1));',
      '    [arr[i], arr[j]] = [arr[j], arr[i]];',
      '  }',
      '  return arr;',
      '}',
    ].join('\n');
    expect(run('AGENT-017', 'src/utils.ts', src)).toEqual([]);
  });

  it('still flags a session token, where nothing nearby excuses it', () => {
    const src = [
      'export function newSessionToken(): string {',
      "  let token = '';",
      '  for (let i = 0; i < 32; i += 1) {',
      '    token += Math.floor(Math.random() * 16).toString(16);',
      '  }',
      '  return token;',
      '}',
    ].join('\n');
    const found = run('AGENT-017', 'src/auth.ts', src);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.severity).toBe('high');
  });
});

describe('AGENT-007 — a name written down is not an exposure', () => {
  const dangerous = 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY';

  it('does not flag a comment explaining the mistake', () => {
    const src = [
      '// Never do this:',
      `// const key = import.meta.env.${dangerous};`,
      ` * The old build read ${dangerous} and shipped it to the browser.`,
      'export const client = createClient(url, anonKey);',
    ].join('\n');
    expect(run('AGENT-007', 'src/supabase.ts', src)).toEqual([]);
  });

  it('does not flag documentation that names the variable', () => {
    expect(run('AGENT-007', 'README.md', `Set \`${dangerous}\` in your environment.`)).toEqual([]);
  });

  it('still flags the variable actually being read in code', () => {
    const found = run('AGENT-007', 'src/supabase.ts', `export const KEY = process.env.${dangerous};`);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.severity).toBe('critical');
  });
});
