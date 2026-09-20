import type { Rule } from './types.js';

/**
 * The rule registry.
 *
 * Rules register themselves at import time. Duplicate ids throw rather than
 * silently overwrite: a rule id is the stable identity used by policies,
 * suppressions and findings, so two rules sharing one would corrupt all three.
 */
const registry = new Map<string, Rule>();

export function registerRule(rule: Rule): Rule {
  if (registry.has(rule.id)) {
    throw new Error(`CECC: duplicate rule id '${rule.id}'`);
  }
  registry.set(rule.id, rule);
  return rule;
}

export function registerRules(rules: Rule[]): void {
  for (const rule of rules) registerRule(rule);
}

export function getRule(id: string): Rule | undefined {
  return registry.get(id);
}

export function allRules(): Rule[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function rulesByLayer(layer: Rule['layer']): Rule[] {
  return allRules().filter((r) => r.layer === layer);
}

export function ruleCount(): number {
  return registry.size;
}

/** Test-only: lets suites build an isolated registry. */
export function __resetRegistry(): void {
  registry.clear();
}
