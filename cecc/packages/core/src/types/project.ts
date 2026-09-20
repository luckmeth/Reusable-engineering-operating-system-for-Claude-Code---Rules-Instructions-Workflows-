import type { Environment } from './common.js';

export interface ProjectConfig {
  id: string;
  name: string;
  root: string;
  environment: Environment;
  /** Adapter ids enabled for this project, e.g. ['claude-code']. */
  adapters: string[];
  /** Detected stack hints, used to scope rules (e.g. only run RLS rules on Supabase projects). */
  stack: {
    framework: string | null;
    database: string | null;
    packageManager: string | null;
    testRunner: string | null;
    hasSupabase: boolean;
    hasNextJs: boolean;
    typescript: boolean;
  };
  /** Opt-in, default false. Nothing leaves the machine unless this is true. */
  cloudSync: {
    enabled: boolean;
    /** Even when syncing, source code is never uploaded by default. */
    includeSourceExcerpts: boolean;
    endpoint: string | null;
  };
  retentionDays: number;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  /** Adapter-native session id (e.g. Claude Code's session_id). */
  externalId: string | null;
  agentId: string | null;
  agentVersion: string | null;
  startedAt: string;
  endedAt: string | null;
  /** 'startup' | 'resume' | 'clear' | 'compact' as reported by the adapter. */
  startReason: string | null;
  endReason: string | null;
  cwd: string | null;
  /** Permission mode reported by the agent — material to AGENT-001. */
  permissionMode: string | null;
}
