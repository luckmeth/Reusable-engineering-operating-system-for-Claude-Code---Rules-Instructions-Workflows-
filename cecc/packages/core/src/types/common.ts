/**
 * Shared vocabulary for the whole system.
 *
 * These unions are deliberately closed: a value that is not listed here should
 * fail validation at the boundary rather than flow into storage as a surprise.
 */

/** Where an observation came from. Agent-agnostic by design. */
export const EVENT_SOURCES = [
  'agent', // any AI coding agent, via an adapter
  'user', // the human developer
  'git',
  'test',
  'build',
  'security',
  'filesystem',
  'system',
  'cecc', // CECC's own audit trail
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const EVENT_STATUSES = ['started', 'success', 'failed', 'blocked', 'warning'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * How strongly CECC stands behind a claim.
 *
 * The distinction that matters most: NOT_TESTED is not the same as VERIFIED,
 * and "no findings detected" is not the same as "secure". Never collapse them.
 */
export const VERIFICATION_STATES = [
  'VERIFIED', // observed directly — a command ran, output was captured
  'LIKELY', // strong deterministic signal, small chance of a benign explanation
  'POTENTIAL', // pattern matched; requires human judgement
  'INFORMATIONAL', // worth knowing, not necessarily a problem
  'NOT_TESTED', // the check exists but was never executed here
  'BLOCKED', // could not be evaluated — reason recorded
  'UNKNOWN',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** How a finding was produced. Surfaced in the UI so users can weigh it. */
export const DETECTION_METHODS = [
  'RULE_BASED',
  'STATIC_ANALYSIS',
  'DEPENDENCY',
  'TEST',
  'GIT_ANALYSIS',
  'CONFIG_ANALYSIS',
  'CORRELATED',
  'AI_ASSISTED',
] as const;
export type DetectionMethod = (typeof DETECTION_METHODS)[number];

/**
 * The three security layers. Keeping these separate is a core product decision:
 * a vulnerability in the user's app, a dangerous shortcut by the agent, and an
 * attack on CECC itself are different problems with different audiences.
 */
export const SECURITY_LAYERS = [
  'APPLICATION', // vulnerabilities in the software being built
  'AGENT', // dangerous shortcuts / bypasses by the coding agent
  'CECC', // attacks on the monitoring and control system itself
] as const;
export type SecurityLayer = (typeof SECURITY_LAYERS)[number];

export const FINDING_CATEGORIES = [
  'AUTHENTICATION',
  'AUTHORIZATION',
  'ACCESS_CONTROL',
  'MULTI_TENANCY',
  'DATABASE',
  'RLS',
  'SECRETS',
  'CRYPTOGRAPHY',
  'INJECTION',
  'XSS',
  'CSRF',
  'SSRF',
  'COMMAND_INJECTION',
  'PATH_TRAVERSAL',
  'FILE_UPLOAD',
  'WEBHOOKS',
  'API_SECURITY',
  'CORS',
  'HEADERS',
  'SESSIONS',
  'COOKIES',
  'DEPENDENCIES',
  'SUPPLY_CHAIN',
  'CONFIGURATION',
  'LOGGING',
  'PRIVACY',
  'INFRASTRUCTURE',
  'CI_CD',
  'CLOUD',
  'AGENT_SECURITY',
  'PROMPT_INJECTION',
  'TESTING',
  'QUALITY',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_STATUSES = ['open', 'resolved', 'suppressed', 'accepted'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** Enforcement posture. WARN is the default for a new project. */
export const POLICY_MODES = ['observe', 'warn', 'block'] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * A single piece of supporting proof. Findings without evidence are opinions,
 * so every rule is required to attach at least one of these.
 */
export interface Evidence {
  kind:
    | 'command'
    | 'file'
    | 'diff'
    | 'line'
    | 'test'
    | 'config'
    | 'event'
    | 'output'
    | 'correlation';
  label: string;
  /** Redacted before storage — see redact.ts. */
  detail: string;
  file?: string;
  line?: number;
  eventId?: string;
}

export interface SourceLocation {
  file: string;
  line: number;
  endLine?: number;
}
