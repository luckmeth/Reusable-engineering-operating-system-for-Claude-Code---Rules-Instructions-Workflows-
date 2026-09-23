import type { CeccEvent } from '../types/event.js';

/**
 * Token accounting from observed content.
 *
 * Claude Code's hook payloads carry no usage numbers, so nothing here is a
 * billed figure and nothing here should ever be presented as one. What CECC
 * does have is the content it watched cross the boundary: bytes written, bytes
 * read, command output, prompt text. That is an estimate, and it is labelled as
 * an estimate everywhere it is shown.
 *
 * The word "saved" is deliberately absent. Savings are a counterfactual — what
 * a session would have cost had it behaved differently — and no measurement
 * can produce one. What is measurable is *avoidable* spend: context that
 * demonstrably entered twice with nothing changing in between. That is an
 * observation about what happened, not a claim about what could have.
 */

/**
 * Characters per token.
 *
 * Four is the long-standing rule of thumb for English prose and source code
 * with a byte-pair tokenizer. Shipping a real tokenizer would add a dependency
 * and several megabytes of vocabulary to make a number that is already only
 * used for orders of magnitude, so the constant stays and the label says
 * "estimated".
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Where estimated context came from, so a large number can be explained. */
export interface TokenBreakdown {
  filesRead: number;
  filesWritten: number;
  commandOutput: number;
  prompts: number;
}

export interface TokenAccounting {
  /** Estimated tokens of content observed entering or leaving the model. */
  estimatedTotal: number;
  breakdown: TokenBreakdown;
  /**
   * Estimated tokens spent on content that had already been supplied, with
   * nothing changing in between. Measured, not projected.
   */
  avoidable: number;
  /** Human-readable reasons behind `avoidable`, largest first. */
  avoidableReasons: Array<{ label: string; tokens: number; occurrences: number }>;
  /** Events that carried no size information and are therefore uncounted. */
  unmeasured: number;
}

function metadataNumber(event: CeccEvent, key: string): number {
  const value = event.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function metadataString(event: CeccEvent, key: string): string {
  const value = event.metadata[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Bytes attributable to one event, and whether the size was actually known.
 *
 * A read whose size was never recorded counts as unmeasured rather than zero.
 * Treating an unknown as nothing is how a total quietly becomes wrong in the
 * flattering direction.
 */
function eventBytes(event: CeccEvent): { bytes: number; known: boolean } {
  const explicit = metadataNumber(event, 'bytes');
  if (explicit > 0) return { bytes: explicit, known: true };

  const output = metadataString(event, 'output');
  if (output) return { bytes: output.length, known: true };

  const promptLength = metadataNumber(event, 'promptLength');
  if (promptLength > 0) return { bytes: promptLength, known: true };

  const added = metadataString(event, 'addedText');
  if (added) return { bytes: added.length, known: true };

  return { bytes: 0, known: false };
}

/** A read counts as repeated only when nothing wrote to the file in between. */
function isWrite(event: CeccEvent): boolean {
  return event.type === 'file.modified' || event.type === 'file.created' || event.type === 'file.deleted';
}

export function accountTokens(events: readonly CeccEvent[]): TokenAccounting {
  const breakdown: TokenBreakdown = { filesRead: 0, filesWritten: 0, commandOutput: 0, prompts: 0 };
  let unmeasured = 0;

  // PreToolUse and PostToolUse both produce an event for one action. Counting
  // both would double every figure on the page.
  const counted = events.filter((e) => metadataString(e, 'hookEvent') !== 'PreToolUse');

  // ---- reads, in order, so a repeat can be attributed and priced
  //
  // Reads are walked first because both totals depend on the same per-read
  // figure. When a read's own size was not recorded — events written before
  // the adapter measured them — the last known size of that file stands in.
  // Feeding that same figure into both the read total and the avoidable total
  // is what keeps the invariant that avoidable can never exceed what was read.
  const reasons = new Map<string, { tokens: number; occurrences: number }>();
  const lastReadTokens = new Map<string, number>();
  const readCount = new Map<string, number>();
  const writtenSince = new Set<string>();

  for (const event of counted) {
    if (isWrite(event)) {
      for (const file of event.filePaths) writtenSince.add(file);
      continue;
    }
    if (event.type !== 'file.read') continue;

    const file = event.filePaths[0];
    const { bytes, known } = eventBytes(event);
    const tokens = known ? estimateTokens(bytes) : (file ? lastReadTokens.get(file) ?? 0 : 0);

    if (!known && tokens === 0) unmeasured += 1;
    breakdown.filesRead += tokens;

    if (!file) continue;
    if (known) lastReadTokens.set(file, tokens);

    if (writtenSince.has(file)) {
      // Re-reading after an edit is correct behaviour, so the counter resets.
      writtenSince.delete(file);
      readCount.set(file, 1);
      continue;
    }

    const seen = (readCount.get(file) ?? 0) + 1;
    readCount.set(file, seen);

    if (seen > 1) {
      const entry = reasons.get(file) ?? { tokens: 0, occurrences: 0 };
      entry.tokens += tokens;
      entry.occurrences += 1;
      reasons.set(file, entry);
    }
  }

  // ---- everything else
  for (const event of counted) {
    if (event.type === 'file.read') continue;
    const { bytes, known } = eventBytes(event);
    if (!known) {
      if (event.type === 'command.completed') unmeasured += 1;
      continue;
    }
    const tokens = estimateTokens(bytes);
    if (isWrite(event)) breakdown.filesWritten += tokens;
    else if (event.type === 'prompt.submitted') breakdown.prompts += tokens;
    else breakdown.commandOutput += tokens;
  }

  const estimatedTotal =
    breakdown.filesRead + breakdown.filesWritten + breakdown.commandOutput + breakdown.prompts;

  // ---- avoidable: an identical search repeated over an unchanged tree
  const searchSeen = new Map<string, number>();
  for (const event of counted) {
    if (metadataString(event, 'intent') !== 'search') continue;
    const key = `${event.command ?? ''}|${metadataString(event, 'searchPath')}`;
    const seen = (searchSeen.get(key) ?? 0) + 1;
    searchSeen.set(key, seen);
    if (seen > 1) {
      const { bytes, known } = eventBytes(event);
      const label = `search: ${event.command ?? key}`;
      const entry = reasons.get(label) ?? { tokens: 0, occurrences: 0 };
      entry.tokens += known ? estimateTokens(bytes) : 0;
      entry.occurrences += 1;
      reasons.set(label, entry);
    }
  }

  const avoidableReasons = [...reasons.entries()]
    .map(([label, v]) => ({ label, tokens: v.tokens, occurrences: v.occurrences }))
    .sort((a, b) => b.tokens - a.tokens || b.occurrences - a.occurrences);

  return {
    estimatedTotal,
    breakdown,
    avoidable: avoidableReasons.reduce((sum, r) => sum + r.tokens, 0),
    avoidableReasons,
    unmeasured,
  };
}

/** Compact display form: 1234 -> "1.2k". Exact below a thousand. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
