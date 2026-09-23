import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/**
 * Recognising a hook entry that CECC wrote.
 *
 * This used to be `command.includes('cecc')`, which is case-sensitive. The
 * Windows desktop build installs to `…\Programs\CECC\…`, so the check never
 * matched its own hooks. Two things followed, both silent:
 *
 *   - `doctor` reported "settings.json has no CECC hooks" while all six were
 *     present, and told the user to run `init --force` to fix it;
 *   - `init` appended a second copy of every hook, because its idempotency
 *     check was the same expression. Every event was then recorded twice.
 *
 * The install directory is user-chosen, so no substring is reliable on its own.
 * The checks below go from cheapest to most certain, and the file's own
 * package.json is the one that cannot be fooled by a rename.
 */

/** Extensions a hook command can point at, across the launchers CECC writes. */
const SCRIPT_EXTENSION = /\.(?:[cm]?js|cmd|bat|sh)$/i;

/** `/cecc/`, `/@cecc/`, `/.cecc/`, `\CECC\` — any case, any separator. */
const CECC_SEGMENT = /(^|[\\/])\.?@?cecc([\\/.]|$)/i;

/**
 * Pulls the script path out of a hook command.
 *
 * Commands look like `node "C:\…\hook.js"` or, where no Node is guaranteed on
 * the machine, just `"C:\…\.cecc\hook.cmd"`. Scanning from the right finds the
 * script rather than the interpreter in both shapes.
 */
export function hookPathFromCommand(command: string | undefined): string | null {
  if (!command) return null;
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i]!.replace(/^["']|["']$/g, '');
    if (SCRIPT_EXTENSION.test(token)) return token;
  }
  return null;
}

/** Path equality that accounts for separators and Windows's case-insensitivity. */
function samePath(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** True when `dir` holds a CECC CLI package — the one signal a rename cannot break. */
function isCeccCliDirectory(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof pkg.name === 'string' && /^(?:@cecc\/|cecc-)/.test(pkg.name);
  } catch {
    return false;
  }
}

/**
 * Is this hook command one of ours?
 *
 * `knownHookPath` is the path this CLI would write right now. Passing it makes
 * the common case an exact match rather than a heuristic.
 */
export function isCeccHookCommand(command: string | undefined, knownHookPath?: string): boolean {
  const path = hookPathFromCommand(command);
  if (!path) return false;
  if (knownHookPath && samePath(path, knownHookPath)) return true;
  if (CECC_SEGMENT.test(path)) return true;
  if (isCeccCliDirectory(dirname(path))) return true;
  // Last resort: our own staging layout, for an install directory that was
  // renamed *and* removed, where the package.json can no longer be read. A
  // stale hook still has to be recognised — reporting "no hooks" for one that
  // is present but broken is the failure this function exists to prevent.
  return /[\\/]build-resources[\\/]cli[\\/]hook\.[cm]?js$/i.test(path);
}
