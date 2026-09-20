import { createHash, randomUUID } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Short hash for fingerprints and ids that humans occasionally read. */
export function shortHash(input: string): string {
  return sha256(input).slice(0, 16);
}

export function newId(): string {
  return randomUUID();
}

/**
 * Stable identity for a finding across repeated scans.
 *
 * Deliberately excludes timestamps and event ids: re-running a scan on an
 * unchanged file must produce the same fingerprint so the store updates the
 * existing finding rather than accumulating duplicates. Noise is the main way
 * security tooling gets ignored.
 */
export function fingerprintFinding(parts: {
  ruleId: string;
  projectId: string;
  files: string[];
  lines?: number[];
  command?: string | null;
  discriminator?: string;
}): string {
  const canonical = [
    parts.ruleId,
    parts.projectId,
    [...parts.files].sort().join(','),
    (parts.lines ?? []).join(','),
    parts.command ?? '',
    parts.discriminator ?? '',
  ].join('|');
  return shortHash(canonical);
}
