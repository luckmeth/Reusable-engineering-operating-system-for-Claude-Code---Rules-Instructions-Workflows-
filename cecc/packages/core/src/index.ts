/**
 * @cecc/core — the domain layer.
 *
 * Everything here is UI-free and process-free so the same logic serves the CLI,
 * the hook handler and the dashboard without duplication.
 */

// Types
export * from './types/common.js';
export * from './types/event.js';
export * from './types/finding.js';
export * from './types/workflow.js';
export * from './types/task.js';
export * from './types/policy.js';
export * from './types/project.js';

// Primitives
export { sha256, shortHash, newId, fingerprintFinding } from './hash.js';
export { detectSecrets, redact, redactDeep, maskValue, decodeJwtPayload, isSupabaseServiceRoleJwt, SECRET_PATTERNS } from './secrets.js';
export { detectSandbox, type SandboxInfo } from './env.js';

// Analysis
export * from './analyze/command.js';
export * from './analyze/content.js';

// Storage
export { Store, type EventQuery, type TestResultRecord } from './storage/store.js';
export { openDb, SCHEMA_VERSION, type Db } from './storage/db.js';

// Rules
export { allRules, getRule, registerRule, registerRules, ruleCount, rulesByLayer } from './rules/registry.js';
export { runRules, type RuleRunResult } from './rules/engine.js';
export type { Rule, RuleContext, RuleResult } from './rules/types.js';
import './rules/index.js';

// Engines
export { runCorrelations, PATTERNS, type CorrelationMatch, type CorrelationResult } from './correlate/engine.js';
export { createWorkflowRun, updateWorkflow, inferStage, pinStage, nextStage, STAGE_ORDER } from './workflow/engine.js';
export { evaluateGates, type GateInput } from './workflow/gates.js';

// Policy
export {
  defaultPolicySet,
  loadPolicySet,
  savePolicySet,
  resolvePolicy,
  decideEnforcement,
  isProtectedPath,
  setRuleMode,
  computePolicyChecksum,
  DEFAULT_PROTECTED_PATHS,
  type EnforcementDecision,
  type EnforcementAction,
} from './policy.js';

// External scanners
export {
  EXTERNAL_SCANNERS,
  getScanner,
  runExternalScanners,
  describeCoverage,
  readNpmLockfile,
  npmAuditScanner,
  osvScanner,
  semgrepScanner,
  type ExternalScanner,
  type ExternalScanOptions,
  type ExternalScanReport,
  type ScannerOptions,
  type ScannerOutcome,
  type ScannerRun,
} from './scanners/index.js';

// Cloud sync — opt-in, never on by default
export {
  syncNow,
  preflight,
  buildSyncPayload,
  payloadDigest,
  type SyncOptions,
  type SyncResult,
  type SyncPreflight,
  type SyncRefusal,
  type SyncPayload,
  type SyncFinding,
} from './sync/client.js';

// Tasks
export {
  ingestTasks,
  ingestedTaskId,
  reconcileStatus,
  parseTaskDocument,
  scanTodoMarkers,
  findTaskDocuments,
  TASK_DOCUMENTS,
  type DiscoveredTask,
  type TaskIngestOptions,
  type TaskIngestReport,
} from './tasks/ingest.js';

// Monitors
export * as git from './monitors/git.js';
export { parseTestOutput, parseValidationOutput, type TestSummary } from './monitors/test.js';

// Adapters
export type { AgentAdapter, AdapterContext, NormalizedActivity } from './adapters/types.js';
export { ClaudeCodeAdapter, claudeCodeAdapter, safeReadFile, type ClaudeHookPayload } from './adapters/claude-code.js';

// Config and paths
export { ceccPaths, findProjectRoot, globalCeccDir, CECC_DIR, type CeccPaths } from './paths.js';
export { createProjectConfig, saveProjectConfig, loadProjectConfig, isInitialized, detectStack } from './config.js';

// Pipeline
export { ingest, type IngestOptions, type IngestResult } from './pipeline.js';
