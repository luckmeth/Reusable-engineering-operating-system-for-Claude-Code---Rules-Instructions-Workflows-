import { existsSync, readFileSync } from 'node:fs';

/**
 * Detects whether we are running inside a disposable/isolated environment.
 *
 * This is not trivia. Rule AGENT-001 exists because highly privileged agent
 * automation is genuinely different on a developer's laptop (where it can reach
 * production credentials, SSH keys and the real filesystem) than in a throwaway
 * container. Flagging both at the same severity would train people to ignore
 * the alert in the context where it actually matters.
 */
let cached: SandboxInfo | null = null;

export interface SandboxInfo {
  isolated: boolean;
  /** How isolation was determined, recorded as evidence. */
  signal: string;
  confidence: number;
}

export function detectSandbox(env: NodeJS.ProcessEnv = process.env): SandboxInfo {
  if (cached) return cached;

  // Explicit operator declaration wins — the person running CECC knows best.
  if (env['CECC_ISOLATED'] === '1' || env['CECC_ISOLATED'] === 'true') {
    cached = { isolated: true, signal: 'CECC_ISOLATED env var set', confidence: 1 };
    return cached;
  }
  if (env['CECC_ISOLATED'] === '0' || env['CECC_ISOLATED'] === 'false') {
    cached = { isolated: false, signal: 'CECC_ISOLATED explicitly disabled', confidence: 1 };
    return cached;
  }

  if (existsSync('/.dockerenv')) {
    cached = { isolated: true, signal: '/.dockerenv present (container)', confidence: 0.9 };
    return cached;
  }
  if (existsSync('/run/.containerenv')) {
    cached = { isolated: true, signal: '/run/.containerenv present (podman)', confidence: 0.9 };
    return cached;
  }
  if (env['CODESPACES'] === 'true' || env['GITPOD_WORKSPACE_ID']) {
    cached = { isolated: true, signal: 'cloud development workspace', confidence: 0.85 };
    return cached;
  }
  if (env['CI'] === 'true' || env['GITHUB_ACTIONS'] === 'true') {
    cached = { isolated: true, signal: 'CI runner', confidence: 0.85 };
    return cached;
  }

  try {
    // cgroup membership naming docker/containerd/kubepods is a reliable tell.
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|lxc/.test(cgroup)) {
      cached = { isolated: true, signal: 'container cgroup detected', confidence: 0.8 };
      return cached;
    }
  } catch {
    // Not Linux, or no permission. Absence of proof is not proof of absence:
    // fall through to the safe assumption that this is a real workstation.
  }

  cached = { isolated: false, signal: 'no container or CI markers found', confidence: 0.6 };
  return cached;
}

/** Test-only. */
export function __resetSandboxCache(): void {
  cached = null;
}
