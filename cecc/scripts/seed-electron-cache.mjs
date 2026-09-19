#!/usr/bin/env node
/**
 * Seeds the @electron/get download cache using curl.
 *
 * Electron's own downloader talks to GitHub through undici, which aborts
 * mid-transfer behind some corporate/CI HTTPS proxies. curl handles the same
 * proxy correctly. Rather than patching the downloader, this puts the finished
 * artifacts where @electron/get already looks, so `electron`, `electron-builder`
 * and anything else built on it find a cache hit and never open a socket.
 *
 * Usage:
 *   node scripts/seed-electron-cache.mjs 44.4.3 linux-x64 win32-x64
 *
 * Safe to re-run: an artifact already in the cache is left alone.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';

const BASE = 'https://github.com/electron/electron/releases/download';

/** Mirrors Cache.getCacheDirectory: sha256 of the URL with the filename stripped. */
function cacheDirFor(downloadUrl) {
  const parsed = new URL(downloadUrl);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = posix.dirname(parsed.pathname);
  return createHash('sha256').update(parsed.toString()).digest('hex');
}

function cacheRoot() {
  // env-paths('electron', { suffix: '' }).cache
  const override = process.env['electron_config_cache'] ?? process.env['ELECTRON_CACHE'];
  if (override) return override;
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'electron', 'Cache');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'electron');
  return join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'electron');
}

function fetchTo(url, dest) {
  // Download beside the target and rename, so an interrupted transfer never
  // leaves a truncated file that later looks like a valid cache hit.
  const tmp = join(tmpdir(), `seed-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', tmp, url], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (statSync(tmp).size === 0) {
    rmSync(tmp, { force: true });
    throw new Error(`empty download: ${url}`);
  }
  renameSync(tmp, dest);
}

function seed(version, fileName) {
  const url = `${BASE}/v${version}/${fileName}`;
  const dir = resolve(cacheRoot(), cacheDirFor(url));
  const dest = join(dir, fileName);
  if (existsSync(dest)) {
    console.log(`  cached  ${fileName}`);
    return dest;
  }
  mkdirSync(dir, { recursive: true });
  console.log(`  fetch   ${fileName}`);
  fetchTo(url, dest);
  return dest;
}

const [version, ...targets] = process.argv.slice(2);
if (!version || targets.length === 0) {
  console.error('usage: node scripts/seed-electron-cache.mjs <version> <platform-arch>...');
  process.exit(2);
}

console.log(`Seeding electron ${version} into ${cacheRoot()}`);
seed(version, 'SHASUMS256.txt');
for (const target of targets) seed(version, `electron-v${version}-${target}.zip`);
console.log('Done.');
