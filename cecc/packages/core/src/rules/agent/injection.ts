import { isTestFile, matchAdded, searchableText , isNonExecutable} from '../../analyze/content.js';
import { lineEvidence, locations, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';
import type { ContentChange } from '../../types/event.js';

/**
 * Injection and unsafe-input handling.
 *
 * Every rule here follows the same shape: a dangerous sink, plus evidence that
 * untrusted data can reach it. The second half is what keeps these usable —
 * `exec()` with a string literal is fine, `exec()` with an interpolated request
 * field is a remote shell. Reporting both identically would bury the real one.
 */

/** Interpolation carrying something that plausibly originates with the caller. */
const TAINTED_INTERPOLATION =
  /\$\{[^}]*\b(?:req|request|body|params|query|input|user|args|payload|data|searchParams|formData|props)\b[^}]*\}|["'`]\s*\+\s*(?:req|request|body|params|query|input|userInput|args)\b/;

/** Any interpolation at all — weaker signal, lower confidence. */
const ANY_INTERPOLATION = /\$\{[^}]+\}|["'`]\s*\+\s*\w+/;

interface SinkRule {
  id: string;
  name: string;
  category: Rule['category'];
  severity: Rule['severity'];
  sink: RegExp;
  why: string;
  impact: string;
  remediation: string;
  /** Extra check beyond "sink + taint". */
  extra?: (change: ContentChange, lineText: string) => boolean;
}

const SINKS: SinkRule[] = [
  {
    id: 'AGENT-011',
    name: 'Command injection risk',
    category: 'COMMAND_INJECTION',
    severity: 'critical',
    sink: /\b(?:exec|execSync|spawnSync|execFileSync)\s*\(|\bspawn\s*\([^)]*shell\s*:\s*true|child_process\.\w+\s*\(|\bsystem\s*\(|os\.system\s*\(|subprocess\.\w+\([^)]*shell\s*=\s*True/,
    why:
      'A shell command built from caller-controlled text gives the caller a shell. Shell metacharacters need no exploit ' +
      'chain — a semicolon is enough.',
    impact:
      'An attacker who controls any part of the interpolated value can append their own command and execute it with the ' +
      'privileges of the application process.',
    remediation:
      'Use the argument-array form (execFile/spawn without shell:true) so arguments are passed directly to the process and never parsed by a shell.',
  },
  {
    id: 'AGENT-012',
    name: 'SQL injection risk',
    category: 'INJECTION',
    severity: 'critical',
    sink: /\b(?:query|execute|raw|unsafe|exec)\s*\(\s*[`'"]\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|WITH)\b|sql\s*`|db\.raw\s*\(|\.rpc\([^)]*sql/i,
    why:
      'String-built SQL cannot distinguish data from syntax. Parameterization exists precisely because escaping by hand ' +
      'is unreliable, and one missed case is complete database access.',
    impact:
      'An attacker can alter the query structure to read arbitrary tables, modify or delete data, or in some configurations reach the host.',
    remediation: 'Use parameter placeholders and pass values separately. Never interpolate caller data into SQL text, including inside stored procedures.',
  },
  {
    id: 'AGENT-013',
    name: 'Cross-site scripting risk',
    category: 'XSS',
    severity: 'high',
    sink: /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|v-html\s*=|document\.write\s*\(|insertAdjacentHTML\s*\(|\{\{\{/,
    why:
      'Assigning caller-controlled text as HTML executes whatever markup it contains, in the victim’s session, with their cookies and privileges.',
    impact:
      'Injected script runs as the logged-in user: it can read the page, exfiltrate session data and perform authenticated actions.',
    remediation: 'Render user content as text. If HTML is genuinely required, sanitize with a maintained library and keep the allowlist narrow.',
  },
  {
    id: 'AGENT-014',
    name: 'Server-side request forgery risk',
    category: 'SSRF',
    severity: 'high',
    sink: /\b(?:fetch|axios(?:\.\w+)?|got|request|http\.get|https\.get|urllib|requests\.\w+)\s*\(/,
    why:
      'A server fetching a caller-supplied URL can be pointed inward — at cloud metadata endpoints, internal admin services, ' +
      'or anything else reachable from the server but not from the internet.',
    impact:
      'An attacker can reach internal services and cloud instance metadata through the server, frequently retrieving credentials from it.',
    remediation: 'Allowlist permitted hosts, resolve the address and reject private ranges, and disable redirect following on these requests.',
    // Only outbound calls whose URL is caller-influenced are interesting.
    extra: (_change, lineText) => /https?:\/\//.test(lineText) === false || TAINTED_INTERPOLATION.test(lineText),
  },
  {
    id: 'AGENT-016',
    name: 'Path traversal risk',
    category: 'PATH_TRAVERSAL',
    severity: 'high',
    sink: /\b(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|rm|sendFile|open|path\.join|path\.resolve)\s*\(/,
    why:
      'A filesystem path built from caller input can escape the intended directory with `../`, reaching configuration, keys or source outside it.',
    impact:
      'An attacker can read or overwrite files outside the intended directory, including secrets and application code.',
    remediation:
      'Resolve the path and verify the result is still inside the intended root before touching it, or index by an opaque id and keep caller strings out of paths entirely.',
  },
];

function buildSinkRule(spec: SinkRule): Rule {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    layer: 'APPLICATION',
    severity: spec.severity,
    detection: 'STATIC_ANALYSIS',
    description: `${spec.name}: a dangerous sink appears to receive caller-controlled input.`,
    why: spec.why,
    remediation: spec.remediation,

    matches(ctx) {
      return ctx.changes.some((c) => !isTestFile(c.file) && c.added.some((l) => spec.sink.test(l.text)));
    },

    evaluate(ctx): RuleResult[] {
      const results: RuleResult[] = [];

      for (const change of ctx.changes) {
        if (isTestFile(change.file) || isNonExecutable(change.file) || change.isDeletion) continue;

        const sinkLines = matchAdded(change, spec.sink);
        if (sinkLines.length === 0) continue;

        // Split by how strong the taint evidence is. Findings without taint are
        // reported at low severity and INFORMATIONAL rather than dropped: the
        // taint may enter on an adjacent line this rule cannot see.
        const tainted = sinkLines.filter(
          (l) => TAINTED_INTERPOLATION.test(l.text) && (spec.extra ? spec.extra(change, l.text) : true),
        );
        const interpolated = sinkLines.filter(
          (l) => !tainted.includes(l) && ANY_INTERPOLATION.test(l.text) && (spec.extra ? spec.extra(change, l.text) : true),
        );

        if (tainted.length > 0) {
          results.push({
            title: `${spec.name} — caller-controlled value reaches a dangerous sink in ${change.file}`,
            severity: spec.severity,
            confidence: 0.82,
            verification: 'LIKELY',
            affectedFiles: [change.file],
            affectedLines: locations(change.file, tainted),
            evidence: tainted.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Sink with request-derived input')),
            impact: spec.impact,
            recommendation: spec.remediation,
            discriminator: 'tainted-sink',
          });
        }

        if (interpolated.length > 0) {
          results.push({
            title: `${spec.name} — dynamic value reaches a dangerous sink in ${change.file}`,
            severity: spec.severity === 'critical' ? 'medium' : 'low',
            confidence: 0.5,
            verification: 'POTENTIAL',
            affectedFiles: [change.file],
            affectedLines: locations(change.file, interpolated),
            evidence: interpolated.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Sink with interpolated value')),
            impact:
              `${spec.impact} The interpolated value could not be traced to request input from this change alone, so whether it is ` +
              'reachable by an attacker needs a human to confirm.',
            recommendation: spec.remediation,
            discriminator: 'interpolated-sink',
          });
        }
      }

      return results;
    },
  };
}

// ---------------------------------------------------------------- AGENT-015

const AGENT_015: Rule = {
  id: 'AGENT-015',
  name: 'Unsafe file upload',
  category: 'FILE_UPLOAD',
  layer: 'APPLICATION',
  severity: 'high',
  detection: 'STATIC_ANALYSIS',
  description: 'An upload handler is missing size, type, or filename controls.',
  why:
    'An upload is attacker-supplied content that the server stores and often serves back. Without a size limit it is a ' +
    'denial-of-service primitive; without a type allowlist and a generated object name it is a way to place chosen content ' +
    'at a chosen path.',
  remediation:
    'Enforce a maximum size, allowlist content types, and generate the storage object name server-side. Never use the supplied filename as a path.',

  matches(ctx) {
    return ctx.changes.some((c) => /upload|multer|formidable|busboy|multipart|formData|putObject|\.upload\(/i.test(c.added.map((l) => l.text).join('\n')));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file) || isNonExecutable(change.file) || change.isDeletion) continue;
      const text = searchableText(change);
      const handlesUpload =
        /multer|formidable|busboy|multipart|\.upload\(|putObject|createSignedUploadUrl|originalname|originalFilename/i.test(text) ||
        /(?:formData|form|body)\s*\.\s*get\s*\(\s*['"`]file/i.test(text);
      // `continue`, not `return`: a non-upload file must not abort the scan of
      // every file after it.
      if (!handlesUpload) continue;

      const missing: string[] = [];
      if (!/(?:maxFileSize|fileSize|limits|maxSize|MAX_(?:FILE_)?SIZE|content-length|sizeLimit)/i.test(text)) missing.push('size limit');
      if (!/(?:mimetype|mimeType|content-?type|allowedTypes|accept|fileFilter|ALLOWED_)/i.test(text)) missing.push('content-type allowlist');

      // The filename becoming the storage path is the exploitable part.
      const unsafeName = change.added.filter((l) =>
        /(?:path\.join|`|\+)\s*[^)]*\b(?:originalname|originalName|file\.name|filename|fileName)\b/.test(l.text) &&
        !/randomUUID|uuid|nanoid|crypto\.random|Date\.now\(\)|hash/.test(l.text),
      );

      if (unsafeName.length > 0) {
        results.push({
          title: `Upload stored under a caller-supplied filename — ${change.file}`,
          severity: 'high',
          confidence: 0.8,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, unsafeName),
          evidence: unsafeName.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Filename used as path')),
          impact:
            'The caller chooses where the file lands and what it is called. A name containing `../` escapes the upload ' +
            'directory, and a chosen extension can make the stored file executable or served as active content.',
          recommendation: 'Generate the object name server-side — a UUID plus a validated extension — and keep the original name only as metadata.',
          discriminator: 'unsafe-filename',
        });
      }

      if (missing.length > 0) {
        results.push({
          title: `Upload handler missing ${missing.join(' and ')} — ${change.file}`,
          severity: missing.length > 1 ? 'high' : 'medium',
          confidence: 0.68,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'Controls not found in this change', detail: missing.join(', '), file: change.file }],
          impact:
            'Missing a size limit allows a single request to exhaust disk or memory. Missing a type allowlist allows ' +
            'executable or active content to be stored and later served.',
          recommendation: this.remediation,
          discriminator: `missing:${missing.join('-')}`,
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-017

interface CryptoIssue {
  pattern: RegExp;
  label: string;
  impact: string;
  severity: Rule['severity'];
  /** Contexts where this algorithm is legitimate and should not be flagged. */
  benign?: RegExp;
}

const CRYPTO_ISSUES: CryptoIssue[] = [
  {
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]|hashlib\.(?:md5|sha1)\s*\(/i,
    label: 'Weak hash algorithm',
    impact: 'MD5 and SHA-1 have practical collision attacks and are unsuitable wherever the hash carries a security decision.',
    severity: 'medium',
    // Non-security uses — cache keys, ETags, checksums — are legitimate.
    benign: /etag|cache|checksum|fingerprint|gravatar|dedup|content[_-]?hash/i,
  },
  {
    pattern: /Math\.random\s*\(\s*\)/,
    label: 'Predictable randomness',
    impact: 'Math.random is not cryptographically secure. Its output is predictable, so any token derived from it is guessable.',
    severity: 'high',
    benign: /jitter|backoff|delay|animation|shuffle|sample|mock|placeholder|colou?r/i,
  },
  {
    pattern: /createCipheriv?\s*\(\s*['"](?:des|rc4|aes-\d+-ecb)['"]/i,
    label: 'Broken cipher or mode',
    impact: 'DES and RC4 are broken, and ECB mode leaks structure because identical plaintext blocks produce identical ciphertext.',
    severity: 'high',
  },
  {
    pattern: /\biv\s*=\s*(?:Buffer\.alloc\(\s*\d+\s*\)|['"][A-Za-z0-9+/=]{8,}['"])|nonce\s*=\s*['"][^'"]+['"]/i,
    label: 'Static initialization vector',
    impact: 'A fixed IV or nonce makes encryption deterministic. Identical plaintexts produce identical ciphertexts, and for stream ciphers key reuse becomes trivially breakable.',
    severity: 'high',
  },
  {
    pattern: /createHash\s*\(\s*['"]sha(?:256|512)['"]\s*\)[\s\S]{0,80}\b(?:password|passwd|pwd)\b/i,
    label: 'Password hashed with a general-purpose hash',
    impact: 'SHA-256 is designed to be fast, which is exactly wrong for passwords — it makes brute-force cheap. Password hashing needs a deliberately slow, salted algorithm.',
    severity: 'high',
  },
];

const AGENT_017: Rule = {
  id: 'AGENT-017',
  name: 'Weak cryptography',
  category: 'CRYPTOGRAPHY',
  layer: 'APPLICATION',
  severity: 'high',
  detection: 'STATIC_ANALYSIS',
  description: 'A weak or misused cryptographic primitive was introduced.',
  why:
    'Cryptographic mistakes fail silently. The code runs, the output looks random, the tests pass — and the property that ' +
    'was supposed to hold does not. Nothing surfaces it until someone attacks it.',
  remediation: 'Use SHA-256 or better for integrity, argon2/bcrypt/scrypt for passwords, crypto.randomBytes for tokens, and AES-GCM with a fresh random IV per message.',

  matches(ctx) {
    return ctx.changes.some((c) => !isTestFile(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file) || isNonExecutable(change.file) || change.isDeletion) continue;

      for (const issue of CRYPTO_ISSUES) {
        const lines = matchAdded(change, issue.pattern).filter((l) => {
          // Context can make a weak primitive legitimate. Skip the obvious cases
          // rather than training people to ignore this rule.
          if (!issue.benign) return true;
          return !issue.benign.test(l.text) && !issue.benign.test(change.file);
        });
        if (lines.length === 0) continue;

        results.push({
          title: `${issue.label} — ${change.file}`,
          severity: issue.severity,
          confidence: issue.benign ? 0.7 : 0.85,
          verification: issue.benign ? 'POTENTIAL' : 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, lines),
          evidence: lines.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, issue.label)),
          impact: issue.impact,
          recommendation: this.remediation,
          discriminator: issue.label,
        });
      }
    }

    return results;
  },
};

const SINK_RULES = SINKS.map(buildSinkRule);
export const INJECTION_RULES = [...SINK_RULES, AGENT_015, AGENT_017];
registerRules(INJECTION_RULES);
export { AGENT_015, AGENT_017, SINK_RULES };
