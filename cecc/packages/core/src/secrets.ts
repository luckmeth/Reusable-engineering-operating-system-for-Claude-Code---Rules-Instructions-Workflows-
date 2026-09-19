/**
 * Secret detection and redaction.
 *
 * Two jobs, one pattern set:
 *  1. Redaction — CECC records evidence, and evidence is drawn from source code
 *     and shell commands. If a credential passes through unmasked, the event log
 *     becomes a new place to steal it from. Redaction runs on every string that
 *     enters storage.
 *  2. Detection — the same patterns power rule AGENT-006 (hardcoded secrets) and
 *     AGENT-007 (privileged credential exposed to a client bundle).
 *
 * Precision matters more than recall here. A redactor that mangles ordinary code
 * makes evidence unreadable, and a detector that fires on every long string
 * trains developers to ignore it.
 */

export type SecretKind =
  | 'aws_access_key'
  | 'github_token'
  | 'slack_token'
  | 'stripe_key'
  | 'openai_key'
  | 'anthropic_key'
  | 'google_api_key'
  | 'npm_token'
  | 'resend_key'
  | 'private_key'
  | 'jwt'
  | 'supabase_service_role'
  | 'connection_string_password'
  | 'generic_assignment';

export interface SecretPattern {
  kind: SecretKind;
  label: string;
  regex: RegExp;
  /** 0..1 — how sure we are that a match is genuinely a credential. */
  confidence: number;
  /** Which capture group holds the sensitive value (0 = whole match). */
  valueGroup: number;
  /** Privileged credentials are a higher-severity problem wherever they appear. */
  privileged?: boolean;
}

/**
 * Ordered most-specific first. `detectSecrets` stops at the first match for a
 * given span so a Stripe key is not also reported as a generic assignment.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    kind: 'private_key',
    label: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    confidence: 0.99,
    valueGroup: 0,
    privileged: true,
  },
  {
    kind: 'aws_access_key',
    label: 'AWS access key id',
    regex: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    confidence: 0.97,
    valueGroup: 1,
    privileged: true,
  },
  {
    kind: 'github_token',
    label: 'GitHub token',
    regex: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g,
    confidence: 0.98,
    valueGroup: 1,
    privileged: true,
  },
  {
    kind: 'slack_token',
    label: 'Slack token',
    regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    confidence: 0.96,
    valueGroup: 1,
  },
  {
    kind: 'stripe_key',
    label: 'Stripe secret key',
    regex: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
    confidence: 0.97,
    valueGroup: 1,
    privileged: true,
  },
  {
    kind: 'anthropic_key',
    label: 'Anthropic API key',
    regex: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    confidence: 0.98,
    valueGroup: 1,
    privileged: true,
  },
  {
    kind: 'openai_key',
    label: 'OpenAI API key',
    regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/g,
    confidence: 0.9,
    valueGroup: 1,
    privileged: true,
  },
  {
    kind: 'google_api_key',
    label: 'Google API key',
    regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    confidence: 0.95,
    valueGroup: 1,
  },
  {
    kind: 'npm_token',
    label: 'npm access token',
    regex: /\b(npm_[A-Za-z0-9]{36})\b/g,
    confidence: 0.97,
    valueGroup: 1,
  },
  {
    kind: 'resend_key',
    label: 'Resend API key',
    regex: /\b(re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,})\b/g,
    confidence: 0.93,
    valueGroup: 1,
  },
  {
    kind: 'connection_string_password',
    label: 'Connection string with inline password',
    // Capture only the password so the host stays readable as evidence.
    regex: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/]+:([^@\s/]{3,})@/g,
    confidence: 0.94,
    valueGroup: 1,
    privileged: true,
  },
  {
    kind: 'jwt',
    label: 'JSON Web Token',
    regex: /\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    confidence: 0.85,
    valueGroup: 1,
  },
  {
    kind: 'generic_assignment',
    label: 'Credential-shaped assignment',
    // Requires a credential-ish name AND a quoted value of real length, which
    // keeps ordinary config strings out of the results.
    regex:
      /\b(?:api[_-]?key|apikey|secret|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|credential|private[_-]?key|service[_-]?role[_-]?key)\b\s*[:=]\s*['"`]([^'"`\n]{12,})['"`]/gi,
    confidence: 0.62,
    valueGroup: 1,
  },
];

/** Values that look credential-shaped but are obviously not real. */
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]+>|\$\{[^}]*\}|(?:your|my|the|a)[-_ ]|change[-_ ]?me|placeholder|example|dummy|sample|test|fake|redacted|todo|insert|put[-_ ]?your|process\.env\.|import\.meta\.env\.)/i;

function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  // A value with no character variety is almost certainly filler ("aaaaaaaa").
  return new Set(value).size <= 2;
}

export interface SecretMatch {
  kind: SecretKind;
  label: string;
  value: string;
  start: number;
  end: number;
  confidence: number;
  privileged: boolean;
  /** Set when the match carries extra meaning, e.g. a decoded JWT role. */
  note?: string;
}

/**
 * Decodes a JWT payload without verifying the signature.
 *
 * Verification is irrelevant here: we are not authenticating the token, we are
 * asking what it claims to be, so that a Supabase `service_role` key can be
 * told apart from a harmless `anon` key. Those two are visually identical and
 * have wildly different blast radii, so this distinction is worth the parse.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when a JWT claims the Supabase service role, which bypasses RLS entirely. */
export function isSupabaseServiceRoleJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  return payload['role'] === 'service_role';
}

export function detectSecrets(text: string): SecretMatch[] {
  if (!text) return [];
  const matches: SecretMatch[] = [];
  const claimed: Array<[number, number]> = [];

  for (const pattern of SECRET_PATTERNS) {
    // Each pattern carries the global flag; reset so calls do not interfere.
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      const value = m[pattern.valueGroup] ?? m[0];
      if (!value) continue;
      const start = m.index + m[0].indexOf(value);
      const end = start + value.length;

      // Skip spans already attributed to a more specific pattern.
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      if (isPlaceholder(value)) continue;

      let kind = pattern.kind;
      let label = pattern.label;
      let confidence = pattern.confidence;
      let privileged = pattern.privileged ?? false;
      let note: string | undefined;

      // Promote a generic JWT to a service-role finding when the payload says so.
      if (kind === 'jwt' && isSupabaseServiceRoleJwt(value)) {
        kind = 'supabase_service_role';
        label = 'Supabase service-role key (bypasses RLS)';
        confidence = 0.98;
        privileged = true;
        note = 'JWT payload declares role=service_role';
      }

      claimed.push([start, end]);
      matches.push({ kind, label, value, start, end, confidence, privileged, ...(note ? { note } : {}) });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Masks a secret while keeping enough shape to correlate two sightings of the
 * same credential. The last four characters are retained because that is how
 * providers' dashboards identify keys, which makes rotation actionable.
 */
export function maskValue(value: string): string {
  if (value.length <= 8) return '[REDACTED]';
  return `[REDACTED:${value.length}ch:…${value.slice(-4)}]`;
}

/**
 * Removes credentials from any string bound for storage or display.
 *
 * Applied at the storage boundary rather than at call sites: one missed call
 * site is a leak, and there are many producers of evidence.
 */
export function redact(text: string): string {
  if (!text) return text;
  const found = detectSecrets(text);
  if (found.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const match of found) {
    out += text.slice(cursor, match.start) + maskValue(match.value);
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

/** Recursively redacts strings inside an arbitrary JSON-ish value. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}
