/**
 * Importing this module registers every built-in rule.
 *
 * Registration happens as an import side effect so a rule file cannot be added
 * without also being wired in — a rule that exists but never runs is worse than
 * no rule, because it reads as coverage that is not there.
 */
import './agent/bypass.js';
import './agent/quality.js';
import './agent/controls.js';
import './agent/secrets.js';
import './agent/data.js';
import './agent/injection.js';
import './agent/supply.js';

export * from './types.js';
export * from './registry.js';
export { runRules } from './engine.js';
