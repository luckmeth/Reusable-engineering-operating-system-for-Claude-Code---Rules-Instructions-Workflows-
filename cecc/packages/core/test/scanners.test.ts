import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_SCANNERS,
  describeCoverage,
  getScanner,
  npmAuditScanner,
  osvScanner,
  readNpmLockfile,
  runExternalScanners,
  semgrepScanner,
  type ScannerOptions,
} from '../src/scanners/index.js';
import { findLockfiles, mapSeverity, parseLooseJson } from '../src/scanners/shared.js';
import { tempStore } from './helpers.js';

function opts(root: string, project: ScannerOptions['project'], over: Partial<ScannerOptions> = {}): ScannerOptions {
  return { root, project, allowNetwork: false, timeoutMs: 20_000, ...over };
}

describe('external scanners — honest degradation', () => {
  it('reports a missing lockfile as not-applicable, never as clean', async () => {
    const { dir, project } = tempStore();
    const run = await npmAuditScanner.run(opts(dir, project));

    expect(run.outcome).toBe('not-applicable');
    expect(run.findings).toHaveLength(0);
    // The distinction the product turns on: nothing ran, so nothing is known.
    expect(run.note.toLowerCase()).toContain('no package-lock.json');
  });

  it('refuses to reach the network unless allowed, and says what it would send', async () => {
    const { dir, project } = tempStore();
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.20' } } }),
    );

    const run = await osvScanner.run(opts(dir, project));

    expect(run.outcome).toBe('needs-network');
    expect(run.note).toContain('api.osv.dev');
    expect(run.findings).toHaveLength(0);
  });

  it('describes partial coverage as incomplete rather than as a pass', async () => {
    const { dir, project } = tempStore();
    const report = await runExternalScanners({ root: dir, project });

    expect(report.ran).toBe(0);
    expect(report.skipped).toBe(report.runs.length);
    expect(describeCoverage(report)).toContain('coverage is incomplete');
  });

  it('contains a scanner that throws instead of reporting a clean run', async () => {
    const { dir, project } = tempStore();
    const exploding = {
      id: 'boom',
      name: 'Boom',
      ruleId: 'SCAN-BOOM',
      requiresNetwork: false,
      run: async () => {
        throw new Error('scanner exploded');
      },
    };

    EXTERNAL_SCANNERS.push(exploding);
    try {
      const report = await runExternalScanners({ root: dir, project, only: ['boom'] });

      expect(report.runs).toHaveLength(1);
      expect(report.runs[0]?.outcome).toBe('failed');
      expect(report.runs[0]?.error).toContain('scanner exploded');
      expect(report.ran).toBe(0);
      // A thrown scanner must never be counted as "checked and clean".
      expect(report.runs[0]?.note).toContain('not a clean result');
    } finally {
      EXTERNAL_SCANNERS.splice(EXTERNAL_SCANNERS.indexOf(exploding), 1);
    }
  });

  it('exposes each scanner by id', () => {
    expect(getScanner('npm-audit')).toBe(npmAuditScanner);
    expect(getScanner('osv')).toBe(osvScanner);
    expect(getScanner('semgrep')).toBe(semgrepScanner);
    expect(getScanner('nope')).toBeUndefined();
  });
});

describe('lockfile discovery', () => {
  it('finds lockfiles below the root, not only at it', () => {
    const { dir } = tempStore();
    mkdirSync(join(dir, 'app'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'someDep'), { recursive: true });
    writeFileSync(join(dir, 'app', 'package-lock.json'), '{}');
    // A lockfile inside node_modules belongs to a dependency, not this project.
    writeFileSync(join(dir, 'node_modules', 'someDep', 'package-lock.json'), '{}');

    const found = findLockfiles(dir);

    expect(found).toContain(join('app', 'package-lock.json'));
    expect(found.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('reads package versions out of a v3 lockfile and ignores workspace links', () => {
    const { dir } = tempStore();
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'root' },
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/vitest': { version: '2.1.9', dev: true },
          'node_modules/@cecc/core': { link: true, resolved: 'packages/core' },
        },
      }),
    );

    const inventory = readNpmLockfile(dir);

    expect(inventory?.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual([
      'lodash@4.17.21',
      'vitest@2.1.9',
    ]);
    expect(inventory?.packages.find((p) => p.name === 'vitest')?.dev).toBe(true);
  });
});

describe('OSV mapping', () => {
  /** api.osv.dev is unreachable from some networks; the mapping is still testable. */
  function recordedOsv(): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('querybatch')) {
        return new Response(JSON.stringify({ results: [{ vulns: [{ id: 'GHSA-test-1234' }] }, { vulns: [] }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'GHSA-test-1234',
          summary: 'Prototype pollution in example',
          aliases: ['CVE-2026-0001'],
          database_specific: { severity: 'HIGH' },
          details: 'A crafted payload pollutes Object.prototype.',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
  }

  it('turns advisories into findings that point at the lockfile', async () => {
    const { dir, project } = tempStore();
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/vulnerable': { version: '1.0.0' },
          'node_modules/safe': { version: '2.0.0' },
        },
      }),
    );

    const run = await osvScanner.run(opts(dir, project, { allowNetwork: true, fetchImpl: recordedOsv() }));

    expect(run.outcome).toBe('ran');
    expect(run.findings).toHaveLength(1);
    const finding = run.findings[0]!;
    expect(finding.ruleId).toBe('SCAN-OSV');
    expect(finding.severity).toBe('high');
    expect(finding.title).toContain('GHSA-test-1234');
    expect(finding.affectedFiles).toEqual(['package-lock.json']);
    expect(finding.verification).toBe('LIKELY'); // never VERIFIED — reachability is unproven
    expect(finding.evidence.some((e) => e.detail.includes('vulnerable@1.0.0'))).toBe(true);
  });

  it('grades a dev-only dependency one band lower and says why', async () => {
    const { dir, project } = tempStore();
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': {}, 'node_modules/vulnerable': { version: '1.0.0', dev: true }, 'node_modules/safe': { version: '2.0.0' } },
      }),
    );

    const run = await osvScanner.run(opts(dir, project, { allowNetwork: true, fetchImpl: recordedOsv() }));

    expect(run.findings[0]!.severity).toBe('medium'); // high, downgraded once
    expect(run.findings[0]!.evidence.some((e) => e.detail.includes('Development dependency only'))).toBe(true);
  });

  it('reports an unreachable database as failed, not as no advisories', async () => {
    const { dir, project } = tempStore();
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/x': { version: '1.0.0' } } }),
    );
    const broken = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.osv.dev');
    }) as unknown as typeof fetch;

    const run = await osvScanner.run(opts(dir, project, { allowNetwork: true, fetchImpl: broken }));

    expect(run.outcome).toBe('failed');
    expect(run.findings).toHaveLength(0);
    expect(run.error).toContain('ENOTFOUND');
  });

  it('produces a stable fingerprint so a re-scan updates rather than duplicates', async () => {
    const { dir, project } = tempStore();
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/vulnerable': { version: '1.0.0' }, 'node_modules/safe': { version: '2.0.0' } } }),
    );

    const first = await osvScanner.run(opts(dir, project, { allowNetwork: true, fetchImpl: recordedOsv() }));
    const second = await osvScanner.run(opts(dir, project, { allowNetwork: true, fetchImpl: recordedOsv() }));

    expect(first.findings[0]!.fingerprint).toBe(second.findings[0]!.fingerprint);
  });
});

describe('scanner helpers', () => {
  it('maps third-party severity words down, never up', () => {
    expect(mapSeverity('moderate')).toBe('medium');
    expect(mapSeverity('ERROR')).toBe('high');
    expect(mapSeverity('critical')).toBe('critical');
    // An unrecognised word must not become a high-severity finding.
    expect(mapSeverity('spicy')).toBe('low');
    expect(mapSeverity(undefined)).toBe('low');
  });

  it('parses JSON that a tool prefixed with a banner', () => {
    expect(parseLooseJson<{ a: number }>('Scanning...\n{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseJson('not json at all')).toBeNull();
    expect(parseLooseJson('')).toBeNull();
  });
});
