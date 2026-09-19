import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** CECC keeps all state inside the project, so removing `.cecc/` fully uninstalls it. */
export const CECC_DIR = '.cecc';

export interface CeccPaths {
  root: string;
  dir: string;
  db: string;
  config: string;
  policies: string;
  logs: string;
}

export function ceccPaths(projectRoot: string): CeccPaths {
  const dir = join(projectRoot, CECC_DIR);
  return {
    root: projectRoot,
    dir,
    db: join(dir, 'cecc.db'),
    config: join(dir, 'config.json'),
    policies: join(dir, 'policies.json'),
    logs: join(dir, 'logs'),
  };
}

/**
 * Walks up from `start` looking for an initialized CECC project, then for a git
 * root.
 *
 * Hooks run with an arbitrary cwd — often a subdirectory — so resolving the
 * project by walking up is what lets one installation serve the whole tree.
 * The walk is bounded by reaching the filesystem root.
 */
export function findProjectRoot(start: string = process.cwd()): string | null {
  let current = resolve(start);

  while (true) {
    if (existsSync(join(current, CECC_DIR, 'config.json'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Global CECC directory, used only for cross-project defaults. */
export function globalCeccDir(): string {
  return join(homedir(), '.cecc');
}
