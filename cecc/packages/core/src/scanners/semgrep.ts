import { existsSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { mapSeverity, parseLooseJson, probeVersion, runTool, toScannerFinding } from './shared.js';
import { scannerResult, type ExternalScanner, type ScannerOptions, type ScannerRun } from './types.js';
import type { FindingCategory } from '../types/common.js';
import type { NewFinding } from '../types/finding.js';

interface SemgrepOutput {
  results?: SemgrepResult[];
  errors?: Array<{ message?: string; level?: string }>;
  paths?: { scanned?: string[] };
}

interface SemgrepResult {
  check_id?: string;
  path?: string;
  start?: { line?: number; col?: number };
  end?: { line?: number };
  extra?: {
    message?: string;
    severity?: string;
    lines?: string;
    metadata?: {
      category?: string;
      cwe?: string[] | string;
      owasp?: string[] | string;
      confidence?: string;
      references?: string[];
    };
  };
}

/** Local rule configurations, in the order Semgrep itself would prefer them. */
const LOCAL_CONFIGS = ['.semgrep.yml', '.semgrep.yaml', '.semgrep/', 'semgrep.yml', 'semgrep.yaml'];

/**
 * Maps a Semgrep metadata category onto CECC's finding categories.
 *
 * Unmapped categories land on QUALITY rather than a security category. Filing
 * an unknown check as a security finding inflates the security picture, which
 * is the specific failure mode CECC's three-layer split exists to avoid.
 */
function categoryFor(result: SemgrepResult): FindingCategory {
  const id = (result.check_id ?? '').toLowerCase();
  const cwe = JSON.stringify(result.extra?.metadata?.cwe ?? '').toLowerCase();
  const haystack = `${id} ${cwe}`;

  if (/sql[-_.]?inject|cwe-89/.test(haystack)) return 'INJECTION';
  if (/command[-_.]?inject|cwe-78/.test(haystack)) return 'COMMAND_INJECTION';
  if (/\bxss\b|cross[-_.]?site[-_.]?script|cwe-79/.test(haystack)) return 'XSS';
  if (/ssrf|cwe-918/.test(haystack)) return 'SSRF';
  if (/path[-_.]?travers|cwe-22/.test(haystack)) return 'PATH_TRAVERSAL';
  if (/csrf|cwe-352/.test(haystack)) return 'CSRF';
  if (/secret|hardcoded|credential|cwe-798/.test(haystack)) return 'SECRETS';
  if (/crypto|cipher|cwe-327|cwe-326/.test(haystack)) return 'CRYPTOGRAPHY';
  if (/authz|authoriz|access[-_.]?control|cwe-285|cwe-862/.test(haystack)) return 'AUTHORIZATION';
  if (/auth(?!oriz)|cwe-287/.test(haystack)) return 'AUTHENTICATION';
  if (/deserial|prototype[-_.]?pollut/.test(haystack)) return 'INJECTION';
  if (/cors/.test(haystack)) return 'CORS';
  if (/cookie|session/.test(haystack)) return 'SESSIONS';
  if (/\bheader/.test(haystack)) return 'HEADERS';
  if (/upload/.test(haystack)) return 'FILE_UPLOAD';
  if (/security|vuln/.test(haystack)) return 'CONFIGURATION';
  return 'QUALITY';
}

/**
 * Semgrep — pattern-based static analysis.
 *
 * Two things are deliberate here. It runs only when Semgrep is already
 * installed: CECC will not install a scanner on someone's machine as a side
 * effect of a scan. And it prefers rules the project already committed, because
 * `--config auto` fetches a rule pack over the network and uploads scan
 * metadata, which is not something a local-first tool should do silently.
 */
export const semgrepScanner: ExternalScanner = {
  id: 'semgrep',
  name: 'Semgrep',
  ruleId: 'SCAN-SEMGREP',
  requiresNetwork: false,

  async run(opts: ScannerOptions): Promise<ScannerRun> {
    const started = Date.now();
    const self = { id: this.id, name: this.name };

    const version = await probeVersion('semgrep', ['--version'], opts.root);
    if (version === null) {
      return scannerResult(
        self,
        'unavailable',
        'Semgrep is not installed. `pipx install semgrep` (or `brew install semgrep`) enables this scanner.',
      );
    }

    const localConfig = LOCAL_CONFIGS.find((f) => existsSync(join(opts.root, f)));
    const config = localConfig ?? (opts.allowNetwork ? 'auto' : null);
    if (!config) {
      return scannerResult(
        self,
        'needs-network',
        'No committed Semgrep config found, and `--config auto` downloads a rule pack. Add .semgrep.yml, or re-run with --online.',
        { version },
      );
    }

    const result = await runTool(
      'semgrep',
      ['scan', '--json', '--quiet', '--disable-version-check', '--metrics=off', '--config', config, '.'],
      opts.root,
      opts.timeoutMs,
    );
    const durationMs = Date.now() - started;

    const output = parseLooseJson<SemgrepOutput>(result.stdout);
    if (!output) {
      return scannerResult(self, 'failed', 'Semgrep produced no parseable JSON.', {
        version,
        durationMs,
        error: (result.stderr || result.stdout).trim().slice(0, 500) || 'empty output',
      });
    }

    const findings: NewFinding[] = [];
    for (const item of output.results ?? []) {
      const checkId = item.check_id ?? 'semgrep.unknown';
      const rawPath = item.path ?? '';
      const file = isAbsolute(rawPath) ? relative(opts.root, rawPath) : rawPath;
      const line = item.start?.line ?? null;
      const severity = mapSeverity(item.extra?.severity, 'medium');
      const message = item.extra?.message?.trim() ?? checkId;
      const category = categoryFor(item);
      const snippet = matchedSource(opts.root, file, line, item.extra?.lines);

      findings.push(
        toScannerFinding({
          ruleId: semgrepScanner.ruleId,
          project: opts.project,
          sessionId: null,
          workflowRunId: null,
          title: `${message.split('\n')[0]?.slice(0, 130) ?? checkId}`,
          category,
          layer: 'APPLICATION',
          severity,
          // Semgrep states its own confidence; pattern matching without dataflow
          // is a hypothesis, so nothing here is graded above 0.8.
          confidence: mapConfidence(item.extra?.metadata?.confidence),
          verification: 'POTENTIAL',
          affectedFiles: file ? [file] : [],
          affectedLines: file && line !== null ? [{ file, line, ...(item.end?.line ? { endLine: item.end.line } : {}) }] : [],
          evidence: [
            ...(snippet ? [{ kind: 'line' as const, label: 'Matched code', detail: snippet, ...(file ? { file } : {}), ...(line !== null ? { line } : {}) }] : []),
            { kind: 'config', label: 'Semgrep check', detail: checkId },
            ...(item.extra?.metadata?.owasp ? [{ kind: 'output' as const, label: 'OWASP', detail: JSON.stringify(item.extra.metadata.owasp).slice(0, 200) }] : []),
            ...(item.extra?.metadata?.references?.length ? [{ kind: 'output' as const, label: 'Reference', detail: item.extra.metadata.references.slice(0, 2).join(' ') }] : []),
          ],
          impact: `${message.slice(0, 600)}\n\nReported by Semgrep check ${checkId}. This is a pattern match, not proof of exploitability — read the matched code before acting.`,
          recommendation:
            'Confirm the match against the surrounding code. If it is real, fix it; if the pattern does not apply here, suppress the finding with the reason so the next scan does not re-raise it.',
          discriminator: `${checkId}:${file}:${line ?? 0}`,
          source: 'scanner:semgrep',
        }),
      );
    }

    const scanned = output.paths?.scanned?.length ?? 0;
    const toolErrors = (output.errors ?? []).filter((e) => e.level !== 'warn').length;

    return scannerResult(
      self,
      'ran',
      [
        findings.length === 0 ? `No matches across ${scanned} file(s).` : `${findings.length} match(es) across ${scanned} file(s).`,
        `Config: ${localConfig ?? 'auto (downloaded rule pack)'}.`,
        toolErrors > 0 ? `${toolErrors} file(s) could not be parsed — coverage is incomplete.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      { findings, version, durationMs },
    );
  },
};

/**
 * Resolves the source line behind a match.
 *
 * Semgrep substitutes the placeholder "requires login" for the matched text
 * when the scan is unauthenticated. Storing that as evidence would put a string
 * in the record that is not in the code, so it is discarded and the line is
 * read from disk instead. Evidence has to be the thing itself.
 */
function matchedSource(root: string, file: string, line: number | null, reported: string | undefined): string {
  const text = (reported ?? '').trim();
  if (text && !/^requires login$/i.test(text)) return text.slice(0, 400);
  if (!file || line === null) return '';
  try {
    const absolute = join(root, file);
    if (!existsSync(absolute)) return '';
    const lines = readFileSync(absolute, 'utf8').split('\n');
    return (lines[line - 1] ?? '').trim().slice(0, 400);
  } catch {
    return '';
  }
}

function mapConfidence(raw: string | undefined): number {
  switch ((raw ?? '').toUpperCase()) {
    case 'HIGH':
      return 0.8;
    case 'MEDIUM':
      return 0.65;
    case 'LOW':
      return 0.45;
    default:
      return 0.6;
  }
}
