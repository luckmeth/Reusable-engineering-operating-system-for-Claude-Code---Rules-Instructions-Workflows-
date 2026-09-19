import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { newId } from './hash.js';
import { ceccPaths } from './paths.js';
import type { Environment } from './types/common.js';
import type { ProjectConfig } from './types/project.js';

/**
 * Stack detection.
 *
 * The purpose is rule scoping: running Postgres RLS rules against a project
 * with no Postgres produces findings nobody can act on, and irrelevant findings
 * are how a security tool teaches people to ignore it. Detection is
 * best-effort; everything it cannot determine stays null rather than guessing.
 */
export function detectStack(root: string): ProjectConfig['stack'] {
  const stack: ProjectConfig['stack'] = {
    framework: null,
    database: null,
    packageManager: null,
    testRunner: null,
    hasSupabase: false,
    hasNextJs: false,
    typescript: false,
  };

  const read = (file: string): string | null => {
    const path = join(root, file);
    try {
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  };

  // Lockfile identifies the package manager more reliably than any field.
  if (existsSync(join(root, 'pnpm-lock.yaml'))) stack.packageManager = 'pnpm';
  else if (existsSync(join(root, 'yarn.lock'))) stack.packageManager = 'yarn';
  else if (existsSync(join(root, 'bun.lockb'))) stack.packageManager = 'bun';
  else if (existsSync(join(root, 'package-lock.json'))) stack.packageManager = 'npm';

  stack.typescript = existsSync(join(root, 'tsconfig.json'));

  const pkgRaw = read('package.json');
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['next']) {
        stack.framework = 'nextjs';
        stack.hasNextJs = true;
      } else if (deps['react']) stack.framework = 'react';
      else if (deps['vue']) stack.framework = 'vue';
      else if (deps['svelte']) stack.framework = 'svelte';
      else if (deps['express'] || deps['fastify'] || deps['hono']) stack.framework = 'node-server';

      if (deps['@supabase/supabase-js'] || deps['supabase']) {
        stack.hasSupabase = true;
        stack.database = 'postgres';
      } else if (deps['pg'] || deps['postgres'] || deps['drizzle-orm']) stack.database = 'postgres';
      else if (deps['mysql2'] || deps['mysql']) stack.database = 'mysql';
      else if (deps['mongodb'] || deps['mongoose']) stack.database = 'mongodb';
      else if (deps['better-sqlite3'] || deps['sqlite3']) stack.database = 'sqlite';

      if (deps['vitest']) stack.testRunner = 'vitest';
      else if (deps['jest']) stack.testRunner = 'jest';
      else if (deps['mocha']) stack.testRunner = 'mocha';
      else if (deps['@playwright/test']) stack.testRunner = 'playwright';
    } catch {
      // A malformed package.json is the project's problem, not a reason to fail init.
    }
  }

  // A supabase/ directory is decisive even when the client library is absent.
  if (existsSync(join(root, 'supabase', 'config.toml')) || existsSync(join(root, 'supabase', 'migrations'))) {
    stack.hasSupabase = true;
    stack.database = stack.database ?? 'postgres';
  }
  if (existsSync(join(root, 'requirements.txt')) || existsSync(join(root, 'pyproject.toml'))) {
    stack.framework = stack.framework ?? 'python';
    stack.testRunner = stack.testRunner ?? 'pytest';
  }
  if (existsSync(join(root, 'go.mod'))) stack.framework = stack.framework ?? 'go';

  return stack;
}

export function createProjectConfig(root: string, opts: { name?: string; environment?: Environment } = {}): ProjectConfig {
  return {
    id: newId(),
    name: opts.name ?? basename(root),
    root,
    environment: opts.environment ?? 'development',
    adapters: ['claude-code'],
    stack: detectStack(root),
    cloudSync: {
      // Opt-in, always. Nothing leaves the machine unless someone turns this on.
      enabled: false,
      includeSourceExcerpts: false,
      endpoint: null,
    },
    retentionDays: 90,
    createdAt: new Date().toISOString(),
  };
}

export function saveProjectConfig(config: ProjectConfig): void {
  const paths = ceccPaths(config.root);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.config, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function loadProjectConfig(root: string): ProjectConfig | null {
  const paths = ceccPaths(root);
  if (!existsSync(paths.config)) return null;
  try {
    const parsed = JSON.parse(readFileSync(paths.config, 'utf8')) as ProjectConfig;
    // The recorded root can go stale if the directory is moved or cloned.
    return { ...parsed, root };
  } catch {
    return null;
  }
}

export function isInitialized(root: string): boolean {
  return existsSync(ceccPaths(root).config);
}
