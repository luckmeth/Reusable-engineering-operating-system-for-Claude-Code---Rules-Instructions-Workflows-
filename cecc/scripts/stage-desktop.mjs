#!/usr/bin/env node
/**
 * Stages everything the desktop application ships.
 *
 * The packaged app has no install step, so every file it needs at runtime has
 * to be laid out here, with module resolution that works from the directory it
 * ends up in. That is the whole job: no bundling, no rewriting, just placing
 * the already-built output where Node will find it.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const stage = join(repo, 'apps', 'desktop', 'build-resources');

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`missing build output: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true });
}

console.log('Staging desktop resources…');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 1. The dashboard, as a Next standalone server.
const standalone = join(repo, 'apps', 'dashboard', '.next', 'standalone');
copy(standalone, join(stage, 'server'));

// Next leaves the static assets out of standalone deliberately, because most
// deployments serve them from a CDN. This one serves them itself.
copy(
  join(repo, 'apps', 'dashboard', '.next', 'static'),
  join(stage, 'server', 'apps', 'dashboard', '.next', 'static'),
);

// 2. The CLI, with its dependencies placed so plain Node resolution finds them.
//    The dashboard shells out to this for scans, and the Help menu uses it to
//    initialize a project that has not been set up yet.
const cliDist = join(repo, 'packages', 'cli', 'dist');
copy(cliDist, join(stage, 'cli'));

// The CLI is ESM. Without a package.json declaring that, Node re-parses every
// file after failing to read it as CommonJS and says so on stderr — noise on
// the agent's critical path when the dashboard shells out to it.
writeFileSync(join(stage, 'cli', 'package.json'), `${JSON.stringify({ name: 'cecc-cli-runtime', private: true, type: 'module' }, null, 2)}\n`, 'utf8');

const cliModules = join(stage, 'cli', 'node_modules');
copy(join(repo, 'packages', 'core', 'dist'), join(cliModules, '@cecc', 'core', 'dist'));
copy(join(repo, 'packages', 'core', 'package.json'), join(cliModules, '@cecc', 'core', 'package.json'));
copy(join(repo, 'node_modules', 'zod'), join(cliModules, 'zod'));

// 3. Documentation, so "Help → Open documentation folder" opens something real.
copy(join(repo, 'docs'), join(stage, 'docs'));
copy(join(repo, 'README.md'), join(stage, 'docs', 'README.md'));

// 4. The window icon used at runtime (the packaged icons are separate).
copy(join(repo, 'apps', 'desktop', 'icons', 'icon.png'), join(stage, 'icon.png'));

// A manifest makes it possible to tell, from an installed copy, exactly which
// build it is — useful when a report arrives with no other context.
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
writeFileSync(
  join(stage, 'build-info.json'),
  `${JSON.stringify(
    { version, builtAt: new Date().toISOString(), node: process.version, platform: process.platform },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Staged to ${stage}`);
