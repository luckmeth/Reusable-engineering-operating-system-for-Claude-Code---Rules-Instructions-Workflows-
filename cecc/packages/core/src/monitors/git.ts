import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseUnifiedDiff } from '../analyze/content.js';
import type { ContentChange } from '../types/event.js';

const exec = promisify(execFile);

/**
 * Git observation.
 *
 * Every call uses execFile with an argument array rather than a shell string.
 * CECC's own rule AGENT-011 exists to catch shell interpolation, and a security
 * tool that builds shell commands from repository paths would be the first
 * thing it should flag. No path here ever reaches a shell.
 */

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
  conflicted: string[];
  clean: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

async function git(cwd: string, args: string[], timeoutMs = 10_000): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args[0] ?? ''} failed: ${message}`);
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--git-dir'], 3000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses porcelain v2 output.
 *
 * Porcelain v2 is used rather than the default because its format is a
 * documented stability guarantee, and because it reports renames and
 * ahead/behind counts that the short format omits.
 */
export async function getStatus(cwd: string): Promise<GitStatus> {
  const out = await git(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
  const status: GitStatus = {
    branch: 'HEAD',
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
    conflicted: [],
    clean: true,
  };

  for (const line of out.split('\n')) {
    if (!line) continue;

    if (line.startsWith('# branch.head ')) {
      status.branch = line.slice('# branch.head '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      status.ahead = Number(match?.[1] ?? 0);
      status.behind = Number(match?.[2] ?? 0);
      continue;
    }
    if (line.startsWith('#')) continue;

    // '1'/'2' = tracked entry, '?' = untracked, 'u' = unmerged.
    if (line.startsWith('? ')) {
      status.untracked.push(line.slice(2));
      continue;
    }
    if (line.startsWith('u ')) {
      const path = line.split(' ').slice(10).join(' ');
      if (path) status.conflicted.push(path);
      continue;
    }
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1] ?? '..';
      // Rename entries ('2') carry "new\told"; the new path is what matters.
      const path = (line.startsWith('2 ') ? parts.slice(10).join(' ').split('\t')[0] : parts.slice(8).join(' ')) ?? '';
      if (!path) continue;

      const indexState = xy[0] ?? '.';
      const workState = xy[1] ?? '.';
      if (indexState !== '.') status.staged.push(path);
      if (workState === 'M') status.modified.push(path);
      if (indexState === 'D' || workState === 'D') status.deleted.push(path);
    }
  }

  status.clean =
    status.staged.length === 0 &&
    status.modified.length === 0 &&
    status.untracked.length === 0 &&
    status.deleted.length === 0 &&
    status.conflicted.length === 0;
  return status;
}

/** Working-tree diff as normalized changes, ready for the rule engine. */
export async function getWorkingDiff(cwd: string, staged = false): Promise<ContentChange[]> {
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3'];
  if (staged) args.push('--cached');
  const out = await git(cwd, args);
  return parseUnifiedDiff(out);
}

/** Diff for a single commit — used when a commit event arrives. */
export async function getCommitDiff(cwd: string, ref = 'HEAD'): Promise<ContentChange[]> {
  const out = await git(cwd, ['show', '--no-color', '--no-ext-diff', '-U3', '--format=', ref]);
  return parseUnifiedDiff(out);
}

export async function getRecentCommits(cwd: string, limit = 20): Promise<GitCommit[]> {
  // Unit separator between fields and record separator between commits, so a
  // subject containing any ordinary punctuation cannot corrupt the parse.
  const out = await git(cwd, ['log', `-${limit}`, '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e']);
  return out
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', author = '', date = '', subject = ''] = record.split('\x1f');
      return { hash, shortHash, author, date, subject };
    });
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

export async function getHeadCommit(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return null; // A repository with no commits yet.
  }
}

/** Files changed between two refs — the scope for a targeted scan. */
export async function getChangedFiles(cwd: string, base = 'HEAD'): Promise<string[]> {
  const out = await git(cwd, ['diff', '--name-only', base]);
  return out.split('\n').filter(Boolean);
}

export async function getTrackedFiles(cwd: string, pattern?: string): Promise<string[]> {
  const args = ['ls-files'];
  if (pattern) args.push(pattern);
  const out = await git(cwd, args);
  return out.split('\n').filter(Boolean);
}
