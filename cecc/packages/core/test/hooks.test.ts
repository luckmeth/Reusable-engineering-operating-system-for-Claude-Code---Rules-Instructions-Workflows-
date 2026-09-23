import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hookPathFromCommand, isCeccHookCommand } from '../src/adapters/hooks.js';

/**
 * These exist because the original check was `command.includes('cecc')`, and
 * the Windows installer puts the application in `…\Programs\CECC\…`. The
 * lowercase match failed against CECC's own hooks, so `doctor` reported them
 * missing and `init` installed a second copy of each. Both failures were
 * silent, and the second one doubled every recorded event.
 */

const scratch = mkdtempSync(join(tmpdir(), 'cecc-hooks-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('hookPathFromCommand', () => {
  it('reads a quoted path from behind an interpreter', () => {
    expect(hookPathFromCommand('node "C:\\Apps\\CECC\\cli\\hook.js"')).toBe('C:\\Apps\\CECC\\cli\\hook.js');
  });

  it('reads a bare path', () => {
    expect(hookPathFromCommand('node /opt/cecc/dist/hook.js')).toBe('/opt/cecc/dist/hook.js');
  });

  it('reads a launcher invoked with no interpreter', () => {
    expect(hookPathFromCommand('"/home/me/app/.cecc/hook.sh"')).toBe('/home/me/app/.cecc/hook.sh');
  });

  it('returns null when nothing looks like a script', () => {
    expect(hookPathFromCommand('some-other-tool --watch')).toBeNull();
    expect(hookPathFromCommand(undefined)).toBeNull();
    expect(hookPathFromCommand('')).toBeNull();
  });
});

describe('isCeccHookCommand', () => {
  it('recognises the Windows desktop install, whose path is uppercase', () => {
    // The exact command the desktop build writes. This is the regression.
    const command =
      'node "C:\\Users\\me\\AppData\\Local\\Programs\\CECC\\resources\\app.asar.unpacked\\build-resources\\cli\\hook.js"';
    expect(isCeccHookCommand(command)).toBe(true);
  });

  it('recognises a vendored checkout', () => {
    expect(isCeccHookCommand('node "/repo/cecc/packages/cli/dist/hook.js"')).toBe(true);
  });

  it('recognises an npm dependency install', () => {
    expect(isCeccHookCommand('node "/repo/node_modules/@cecc/cli/dist/hook.js"')).toBe(true);
  });

  it('recognises the project-local launcher written when there is no Node', () => {
    expect(isCeccHookCommand('"C:\\work\\app\\.cecc\\hook.cmd"')).toBe(true);
    expect(isCeccHookCommand('"/work/app/.cecc/hook.sh"')).toBe(true);
  });

  it('recognises an install in a renamed directory by its package.json', () => {
    const dir = join(scratch, 'Monitoring Tool', 'cli');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'cecc-cli-runtime', type: 'module' }), 'utf8');
    expect(isCeccHookCommand(`node "${join(dir, 'hook.js')}"`)).toBe(true);
  });

  it('matches the path this CLI would write, whatever it is called', () => {
    const hookPath = join(scratch, 'anonymous', 'hook.js');
    expect(isCeccHookCommand(`node "${hookPath}"`, hookPath)).toBe(true);
  });

  it('does not claim another tool as its own', () => {
    const dir = join(scratch, 'other-tool');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-linter' }), 'utf8');
    expect(isCeccHookCommand(`node "${join(dir, 'hook.js')}"`)).toBe(false);
    expect(isCeccHookCommand('npx prettier --write')).toBe(false);
    expect(isCeccHookCommand('node "/repo/scripts/hook.js"')).toBe(false);
  });
});
