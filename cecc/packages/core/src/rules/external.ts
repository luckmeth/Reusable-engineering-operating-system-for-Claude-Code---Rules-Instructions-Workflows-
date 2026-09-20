import { registerRules } from './registry.js';
import type { Rule, RuleContext, RuleResult } from './types.js';

/**
 * Registry entries for the external scanners.
 *
 * The scanners do not run on events — they are invoked by `cecc scan
 * --external` and produce findings directly. They are registered anyway so
 * their ids are first-class: policy modes, severity thresholds, path
 * exclusions, suppression and `cecc rules` all key off the registry, and a
 * finding whose rule id is not in it would be a finding nobody can configure.
 *
 * `matches()` therefore returns false by construction. The event engine skips
 * them, which is correct: their input is a lockfile or a source tree, not a
 * single tool call.
 */
function externalRule(rule: Omit<Rule, 'matches' | 'evaluate'>): Rule {
  return {
    ...rule,
    matches: (_ctx: RuleContext): boolean => false,
    evaluate: (_ctx: RuleContext): RuleResult[] => [],
  };
}

export const externalScannerRules: Rule[] = [
  externalRule({
    id: 'SCAN-NPM-AUDIT',
    name: 'Dependency advisory (npm audit)',
    category: 'DEPENDENCIES',
    layer: 'APPLICATION',
    severity: 'medium',
    detection: 'DEPENDENCY',
    description: 'A package in the lockfile has a published npm security advisory.',
    why:
      'A dependency executes with the full privileges of the process that imports it. A vulnerability in a package ' +
      'three levels down the tree is a vulnerability in your application, and no amount of care in your own code ' +
      'compensates for it.',
    remediation: 'Upgrade to the patched version. If none exists, assess reachability and pin, replace or suppress with a recorded reason.',
  }),
  externalRule({
    id: 'SCAN-OSV',
    name: 'Dependency advisory (OSV.dev)',
    category: 'SUPPLY_CHAIN',
    layer: 'APPLICATION',
    severity: 'medium',
    detection: 'DEPENDENCY',
    description: 'OSV.dev reports an advisory against an exact resolved dependency version.',
    why:
      'OSV is queried by exact version rather than by semver range, so it catches advisories the registry feed misses ' +
      'and disagrees with npm audit usefully rather than redundantly. Running both is the point.',
    remediation: 'Open the advisory, upgrade past the affected range, and re-scan to confirm it clears.',
  }),
  externalRule({
    id: 'SCAN-SEMGREP',
    name: 'Static analysis match (Semgrep)',
    category: 'QUALITY',
    layer: 'APPLICATION',
    severity: 'medium',
    detection: 'STATIC_ANALYSIS',
    description: 'A Semgrep rule matched source code in this project.',
    why:
      'Semgrep performs syntactic and light dataflow analysis that CECC\'s own rules deliberately do not attempt. ' +
      'Its findings are hypotheses that need a human to read the surrounding code — they are recorded as POTENTIAL, ' +
      'never as verified.',
    remediation: 'Read the matched code. Fix it if the pattern applies; suppress with a reason if it does not.',
  }),
];

registerRules(externalScannerRules);
