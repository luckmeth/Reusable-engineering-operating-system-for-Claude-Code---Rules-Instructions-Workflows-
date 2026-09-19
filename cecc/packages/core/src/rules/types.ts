import type {
  DetectionMethod,
  Evidence,
  FindingCategory,
  SecurityLayer,
  SourceLocation,
  Severity,
  VerificationState,
} from '../types/common.js';
import type { CeccEvent, ContentChange } from '../types/event.js';
import type { ProjectConfig } from '../types/project.js';
import type { ParsedCommand } from '../analyze/command.js';
import type { Store } from '../storage/store.js';

/**
 * What a rule sees.
 *
 * The event is pre-normalized: file changes arrive as ContentChange and shell
 * commands as ParsedCommand, so a rule never parses raw adapter payloads. That
 * keeps rules short enough to audit and portable across agent adapters.
 */
export interface RuleContext {
  event: CeccEvent;
  project: ProjectConfig;
  changes: ContentChange[];
  parsedCommand: ParsedCommand | null;
  /** Available for rules that need history. Use sparingly — rules run per event. */
  store: Store;
  now: Date;
}

/** One detection. The rule supplies the judgement; the engine supplies identity. */
export interface RuleResult {
  title: string;
  /** Overrides the rule's default when this instance is more or less serious. */
  severity?: Severity;
  confidence: number;
  verification: VerificationState;
  affectedFiles: string[];
  affectedLines: SourceLocation[];
  evidence: Evidence[];
  impact: string;
  recommendation: string;
  command?: string | null;
  /** Distinguishes several findings from one rule at one location. */
  discriminator?: string;
  relatedEvents?: string[];
}

export interface Rule {
  id: string;
  name: string;
  category: FindingCategory;
  layer: SecurityLayer;
  severity: Severity;
  detection: DetectionMethod;
  /** One line shown in rule listings. */
  description: string;
  /** Why this matters in concrete terms — surfaced in the UI, not just docs. */
  why: string;
  remediation: string;
  /**
   * Cheap pre-filter. Runs on every event, so it must stay allocation-light:
   * check the event type and maybe a path, nothing more.
   */
  matches(ctx: RuleContext): boolean;
  evaluate(ctx: RuleContext): RuleResult[];
}

/** Convenience for the common "one line of evidence from a file" case. */
export function lineEvidence(file: string, line: number | null, text: string, label: string): Evidence {
  return {
    kind: 'line',
    label,
    detail: text.trim().slice(0, 400),
    file,
    ...(line !== null ? { line } : {}),
  };
}

export function commandEvidence(command: string, label = 'Command executed'): Evidence {
  return { kind: 'command', label, detail: command.slice(0, 1000) };
}

export function locations(file: string, lines: Array<{ line: number | null }>): SourceLocation[] {
  return lines
    .filter((l): l is { line: number } => typeof l.line === 'number')
    .map((l) => ({ file, line: l.line }));
}
