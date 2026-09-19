import { isTestFile, matchAdded, searchableText, trulyRemoved } from '../../analyze/content.js';
import { lineEvidence, locations, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';
import type { ContentChange } from '../../types/event.js';

/**
 * Removal or weakening of security controls.
 *
 * The defining move here is looking at what was *deleted*. Most scanners read
 * the file as it stands and ask "is this code insecure?". That misses the case
 * where an authorization check existed yesterday and does not today — the file
 * that remains may look unremarkable while the control that protected it is
 * gone. CECC sees the removal because it works on changes, not snapshots.
 */

interface ControlPattern {
  pattern: RegExp;
  label: string;
  category: Rule['category'];
  severity: Rule['severity'];
  impact: string;
}

const CONTROLS: ControlPattern[] = [
  {
    pattern: /\b(?:requireAuth|ensureAuthenticated|isAuthenticated|getSession|getUser|auth\(\)|currentUser|verifySession|withAuth)\b/,
    label: 'Authentication check',
    category: 'AUTHENTICATION',
    severity: 'critical',
    impact: 'The endpoint no longer establishes who the caller is, so anonymous requests reach logic that assumes a user.',
  },
  {
    pattern: /\b(?:authorize|can|hasRole|hasPermission|checkPermission|requireRole|isAdmin|isOwner|assertOwner|ability|forbidden|unauthorized)\b/,
    label: 'Authorization check',
    category: 'AUTHORIZATION',
    severity: 'critical',
    impact: 'The caller is identified but no longer checked against what they are allowed to do — any authenticated user can perform the action.',
  },
  {
    pattern: /\.eq\(\s*['"](?:tenant_id|organization_id|org_id|workspace_id|account_id)['"]|WHERE\s+tenant_id|tenantId\s*[:=]|where:\s*\{[^}]*tenantId/i,
    label: 'Tenant scoping filter',
    category: 'MULTI_TENANCY',
    severity: 'critical',
    impact: 'The query no longer restricts rows to the caller’s tenant, so it can return or modify another organization’s data.',
  },
  {
    pattern: /\b(?:csrfToken|verifyCsrf|csrfProtection|doubleSubmit|sameSite)\b/,
    label: 'CSRF protection',
    category: 'CSRF',
    severity: 'high',
    impact: 'State-changing requests can be triggered from another origin using the victim’s session cookie.',
  },
  {
    pattern: /\b(?:rateLimit|rateLimiter|throttle|limiter\.check|Ratelimit)\b/,
    label: 'Rate limiting',
    category: 'API_SECURITY',
    severity: 'high',
    impact: 'The endpoint accepts unlimited requests, enabling brute force, credential stuffing and cost-driven abuse.',
  },
  {
    pattern: /\b(?:verifySignature|validateSignature|timingSafeEqual|createHmac|constantTimeEqual|verifyWebhook)\b/,
    label: 'Signature verification',
    category: 'WEBHOOKS',
    severity: 'critical',
    impact: 'Inbound payloads are trusted without proof of origin, so anyone who knows the URL can forge them.',
  },
  {
    pattern: /\b(?:helmet|Content-Security-Policy|X-Frame-Options|Strict-Transport-Security|X-Content-Type-Options)\b/i,
    label: 'Security header',
    category: 'HEADERS',
    severity: 'medium',
    impact: 'A browser-side protection was removed, widening the impact of any content-injection defect elsewhere.',
  },
  {
    pattern: /\b(?:sanitize|escapeHtml|DOMPurify|xss\(|encodeURIComponent|escape\()/,
    label: 'Output encoding or sanitization',
    category: 'XSS',
    severity: 'high',
    impact: 'User-controlled content reaches output unencoded, which is the direct precondition for cross-site scripting.',
  },
  {
    pattern: /\b(?:httpOnly|secure:\s*true|sameSite)\b/,
    label: 'Secure cookie attribute',
    category: 'COOKIES',
    severity: 'high',
    impact: 'Session cookies become readable by scripts or transmissible over plaintext, exposing them to theft.',
  },
];

const AGENT_005: Rule = {
  id: 'AGENT-005',
  name: 'Security control removal',
  category: 'ACCESS_CONTROL',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'A security control present before this change is no longer there.',
  why:
    'Removing a control is not the same as never having written one. Something previously decided this check was needed, ' +
    'and the code around it was built on that assumption. Deletions like this rarely survive review — they survive because ' +
    'nobody notices them in a large diff.',
  remediation: 'Restore the control. If it genuinely belongs elsewhere now, point at where it moved to and add a test that fails if it is removed again.',

  matches(ctx) {
    return ctx.changes.some((c) => c.removed.length > 0 && !isTestFile(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      // Test files are covered by AGENT-003; applying control rules here would double-report.
      if (isTestFile(change.file) || change.isNewFile) continue;

      for (const control of CONTROLS) {
        // trulyRemoved ignores lines that came back in any form, so moving or
        // reindenting a check does not read as deleting it.
        const removed = trulyRemoved(change, control.pattern);
        if (removed.length === 0) continue;

        // A removal in the same edit that adds an endpoint is materially worse:
        // new surface plus a missing control is the combination that gets exploited.
        const addsEndpoint = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|router\.(?:get|post|put|patch|delete)|app\.(?:get|post|put|patch|delete)/.test(
          change.added.map((l) => l.text).join('\n'),
        );

        results.push({
          title: `${control.label} removed from ${change.file}`,
          severity: addsEndpoint && control.severity !== 'critical' ? 'critical' : control.severity,
          confidence: addsEndpoint ? 0.9 : 0.8,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, removed),
          evidence: [
            ...removed.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, `${control.label} removed`)),
            ...(addsEndpoint
              ? [{ kind: 'correlation' as const, label: 'Aggravating factor', detail: 'The same change also adds a request handler' }]
              : []),
          ],
          impact:
            control.impact +
            (addsEndpoint
              ? ' This change also introduces a new request handler, so the new surface is exposed without the control that was protecting the old one.'
              : ''),
          recommendation: this.remediation,
          discriminator: control.label,
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-010

const VALIDATION = /\b(?:z\.object|z\.string|zod|\.safeParse|\.parse\(|yup\.|joi\.|valibot|ajv|validate\(|schema\.|\.validateAsync)\b/;
const RAW_BODY_USE = /await\s+(?:req|request)\.json\(\)|JSON\.parse\(\s*(?:await\s+)?(?:req|request|body)|req\.body|request\.body/;

const AGENT_010: Rule = {
  id: 'AGENT-010',
  name: 'Validation removal or bypass',
  category: 'API_SECURITY',
  layer: 'APPLICATION',
  severity: 'high',
  detection: 'STATIC_ANALYSIS',
  description: 'Schema validation was removed, or external input is consumed without it.',
  why:
    'Server-side validation is the boundary where untrusted input stops being arbitrary. Without it, every downstream ' +
    'assumption about shape, type and range is just hope, and fields the client was never supposed to set flow straight ' +
    'into the database.',
  remediation: 'Parse external input through a schema before use, and derive privileged fields such as tenant, role and price from the session rather than accepting them.',

  matches(ctx) {
    return ctx.changes.some((c) => !isTestFile(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file)) continue;
      const addedText = change.added.map((l) => l.text).join('\n');

      // Validation deleted from a file that still reads a request body.
      const validationGone = trulyRemoved(change, VALIDATION);
      const stillReadsInput = RAW_BODY_USE.test(searchableText(change));
      if (validationGone.length > 0 && stillReadsInput) {
        results.push({
          title: `Input validation removed while request input is still consumed — ${change.file}`,
          confidence: 0.86,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, validationGone),
          evidence: validationGone.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Validation removed')),
          impact:
            'The handler still reads the request body but no longer constrains it. Type, length, range and allowed-value checks are gone, ' +
            'and any field the caller invents is carried forward.',
          recommendation: this.remediation,
          discriminator: 'validation-removed',
        });
      }

      // New handler reading a body with no validation anywhere in the file.
      const addsHandler = /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH)|router\.(?:post|put|patch)|app\.(?:post|put|patch)/.test(addedText);
      const readsBody = RAW_BODY_USE.test(addedText);
      const hasValidation = VALIDATION.test(searchableText(change));
      if (addsHandler && readsBody && !hasValidation) {
        const lines = matchAdded(change, RAW_BODY_USE);
        results.push({
          title: `Request body consumed without validation — ${change.file}`,
          confidence: 0.75,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, lines),
          evidence: lines.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Unvalidated input')),
          impact:
            'A write endpoint accepts an arbitrary JSON body. Fields that should be server-derived — tenant, role, status, price — can be supplied by the caller.',
          recommendation: this.remediation,
          discriminator: 'unvalidated-input',
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-018

const AUTH_WEAKENING: Array<{ pattern: RegExp; label: string; impact: string; severity: Rule['severity'] }> = [
  {
    pattern: /verify\s*\([^)]*\{\s*[^}]*algorithms?\s*:\s*\[\s*['"]none['"]/i,
    label: 'JWT verification accepts the "none" algorithm',
    impact: 'A token with an empty signature is accepted as valid, so anyone can mint an arbitrary identity.',
    severity: 'critical',
  },
  {
    pattern: /jwt\.decode\s*\(/,
    label: 'JWT decoded without verification',
    impact: 'decode() reads the claims without checking the signature. Any value in the token is attacker-controlled.',
    severity: 'critical',
  },
  {
    pattern: /ignoreExpiration\s*:\s*true|verify_exp\s*:\s*False|exp\s*:\s*false/i,
    label: 'Token expiry check disabled',
    impact: 'Expired and revoked tokens keep working indefinitely, so logout and rotation stop having any effect.',
    severity: 'high',
  },
  {
    pattern: /httpOnly\s*:\s*false/,
    label: 'Session cookie readable by JavaScript',
    impact: 'Any script on the page — including one injected through an XSS defect — can read the session cookie.',
    severity: 'high',
  },
  {
    pattern: /secure\s*:\s*false.*cookie|cookie.*secure\s*:\s*false/i,
    label: 'Session cookie sent over plaintext',
    impact: 'The cookie is transmitted on unencrypted connections and can be captured in transit.',
    severity: 'high',
  },
  {
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    label: 'TLS certificate verification disabled',
    impact: 'Any certificate is accepted, which removes the protection against an interception proxy on the connection.',
    severity: 'high',
  },
];

const AGENT_018: Rule = {
  id: 'AGENT-018',
  name: 'Authentication weakening',
  category: 'AUTHENTICATION',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'Authentication or session handling was changed in a way that reduces its strength.',
  why:
    'These are not gradual weakenings — each one converts authentication from a check into a formality. A token accepted ' +
    'without signature verification is not a weaker credential, it is no credential at all.',
  remediation: 'Verify tokens with an explicit allowed-algorithm list, keep expiry enforcement on, and set httpOnly, secure and sameSite on session cookies.',

  matches(ctx) {
    return ctx.changes.some((c) => !isTestFile(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];
    for (const change of ctx.changes) {
      if (isTestFile(change.file)) continue;
      for (const weakening of AUTH_WEAKENING) {
        const lines = matchAdded(change, weakening.pattern);
        if (lines.length === 0) continue;
        results.push({
          title: `${weakening.label} — ${change.file}`,
          severity: weakening.severity,
          confidence: 0.88,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, lines),
          evidence: lines.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, weakening.label)),
          impact: weakening.impact,
          recommendation: this.remediation,
          discriminator: weakening.label,
        });
      }
    }
    return results;
  },
};

// ---------------------------------------------------------------- AGENT-019

const AGENT_019: Rule = {
  id: 'AGENT-019',
  name: 'CORS weakening',
  category: 'CORS',
  layer: 'APPLICATION',
  severity: 'high',
  detection: 'STATIC_ANALYSIS',
  description: 'Cross-origin policy was widened, or origins are reflected back without an allowlist.',
  why:
    'CORS is what stops a page on another domain reading authenticated responses from your API. A wildcard, or an origin ' +
    'reflected straight from the request header, hands that ability to every site the victim visits.',
  remediation: 'Allow a fixed list of known origins and compare against it. Never reflect the request Origin, and never pair credentials with a wildcard.',

  matches(ctx) {
    return ctx.changes.some((c) => /origin|cors/i.test(c.added.map((l) => l.text).join('\n')));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file)) continue;
      const text = change.added.map((l) => l.text).join('\n');

      const wildcard = matchAdded(change, /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*|origin\s*:\s*['"]\*['"]/i);
      const credentials = /Access-Control-Allow-Credentials['"]?\s*[,:]\s*['"]?true|credentials\s*:\s*true/i.test(text);
      const reflected = matchAdded(
        change,
        /Access-Control-Allow-Origin['"]?\s*[,:]\s*(?:req|request)[.\[]|origin\s*:\s*(?:req|request)[.\[]|headers\.get\(['"]origin/i,
      );

      if (wildcard.length > 0) {
        results.push({
          // A wildcard plus credentials is rejected by browsers, so the real risk
          // is an open API — unless the code also reflects, which is the exploitable shape.
          title: credentials
            ? `Wildcard CORS combined with credentials — ${change.file}`
            : `Wildcard CORS origin — ${change.file}`,
          severity: credentials ? 'critical' : 'medium',
          confidence: 0.9,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, wildcard),
          evidence: wildcard.slice(0, 3).map((l) => lineEvidence(change.file, l.line, l.text, 'Wildcard origin')),
          impact: credentials
            ? 'Wildcard origin together with credentials is an explicit attempt to let any site make authenticated cross-origin requests. Browsers reject this combination, so the endpoint is likely broken as well as unsafe.'
            : 'Any origin can read responses from this endpoint. Acceptable for genuinely public data; a disclosure path for anything else.',
          recommendation: this.remediation,
          discriminator: 'wildcard-origin',
        });
      }

      if (reflected.length > 0) {
        results.push({
          title: `Request origin reflected into CORS response — ${change.file}`,
          severity: credentials ? 'critical' : 'high',
          confidence: 0.85,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, reflected),
          evidence: reflected.slice(0, 3).map((l) => lineEvidence(change.file, l.line, l.text, 'Origin reflected')),
          impact:
            'Echoing the caller’s Origin header allows every origin while appearing specific. ' +
            (credentials
              ? 'With credentials enabled, any site the victim visits can make authenticated requests and read the responses.'
              : 'Any site can read responses from this endpoint.'),
          recommendation: this.remediation,
          discriminator: 'reflected-origin',
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-020

const AGENT_020: Rule = {
  id: 'AGENT-020',
  name: 'Webhook verification bypass',
  category: 'WEBHOOKS',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'A webhook handler processes payloads without verifying origin, freshness or uniqueness.',
  why:
    'A webhook URL is a public endpoint that changes state — usually state involving money. Without signature verification ' +
    'anyone who learns the URL can mark an order paid. Without a replay window and idempotency, a captured legitimate ' +
    'delivery can simply be sent again.',
  remediation: 'Verify the signature against the raw body with a constant-time comparison, reject stale timestamps, and enforce idempotency on the provider event id with a unique constraint.',

  matches(ctx) {
    return ctx.changes.some((c) => /webhook|stripe|payhere|paypal|razorpay/i.test(c.file) || /webhook/i.test(c.added.map((l) => l.text).join('\n')));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file)) continue;
      const isWebhook = /webhook/i.test(change.file) || /webhook/i.test(change.added.map((l) => l.text).join('\n'));
      if (!isWebhook) continue;

      const text = searchableText(change);
      const verifies = /createHmac|timingSafeEqual|verifySignature|constructEvent|webhooks?\.verify|validateSignature/i.test(text);
      const readsRaw = /\.text\(\)|rawBody|raw_body|bodyParser\.raw/i.test(text);
      const hasReplayWindow = /timestamp|tolerance|\bexp\b|Date\.now\(\)\s*-/i.test(text);
      const hasIdempotency = /idempotenc|event_id|eventId|already(?:Processed|Handled)|ON CONFLICT|unique/i.test(text);

      // Verification deleted outright.
      const verificationGone = trulyRemoved(change, /createHmac|timingSafeEqual|verifySignature|constructEvent|validateSignature/);
      if (verificationGone.length > 0) {
        results.push({
          title: `Webhook signature verification removed — ${change.file}`,
          confidence: 0.93,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, verificationGone),
          evidence: verificationGone.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Verification removed')),
          impact:
            'The handler now acts on unauthenticated input. Anyone who can reach the URL can send a payload that the ' +
            'application treats as coming from the provider — including a payment confirmation.',
          recommendation: this.remediation,
          discriminator: 'verification-removed',
        });
        continue;
      }

      // New handler with no verification at all.
      const addsHandler = /export\s+(?:async\s+)?function\s+POST|router\.post|app\.post/.test(change.added.map((l) => l.text).join('\n'));
      if (addsHandler && !verifies) {
        results.push({
          title: `Webhook handler without signature verification — ${change.file}`,
          confidence: 0.82,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'No verification found in handler', detail: change.file, file: change.file }],
          impact: 'The endpoint accepts and acts on any well-formed payload sent to it.',
          recommendation: this.remediation,
          discriminator: 'no-verification',
        });
      }

      if (verifies && !readsRaw) {
        results.push({
          title: `Webhook signature may be verified against a re-serialized body — ${change.file}`,
          severity: 'high',
          confidence: 0.68,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'No raw body access found', detail: change.file, file: change.file }],
          impact:
            'Signatures cover the exact bytes the provider sent. Parsing to JSON and re-serializing changes key order and ' +
            'whitespace, so verification either fails for everyone or, worse, is performed against attacker-influenced data.',
          recommendation: 'Read the raw request body as text and verify against those bytes before parsing.',
          discriminator: 'not-raw-body',
        });
      }

      if (verifies && !hasIdempotency) {
        results.push({
          title: `Webhook handler has no idempotency guard — ${change.file}`,
          severity: 'high',
          confidence: 0.74,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'No idempotency key or unique constraint found', detail: change.file, file: change.file }],
          impact:
            'Payment providers retry deliveries by design, and concurrent retries are normal. Without idempotency the same ' +
            'event is processed more than once — double-crediting an account or sending duplicate email.',
          recommendation: 'Record the provider event id with a unique constraint and short-circuit when it is already present. A code-level check alone races under concurrency.',
          discriminator: 'no-idempotency',
        });
      }

      if (verifies && !hasReplayWindow) {
        results.push({
          title: `Webhook handler has no replay window — ${change.file}`,
          severity: 'medium',
          confidence: 0.7,
          verification: 'POTENTIAL',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'file', label: 'No timestamp tolerance check found', detail: change.file, file: change.file }],
          impact: 'A correctly signed request captured at any point in the past stays valid forever and can be replayed.',
          recommendation: 'Reject deliveries whose signed timestamp is outside a short tolerance, typically five minutes.',
          discriminator: 'no-replay-window',
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-021

const SENSITIVE_LOG = /\b(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|session|credit_?card|cardNumber|cvv|ssn|private_?key|refresh_?token|access_?token)\b/i;
const LOG_CALL = /\b(?:console\.(?:log|info|warn|error|debug)|logger\.(?:log|info|warn|error|debug|trace)|log\.(?:info|warn|error|debug)|print|println|fmt\.Print)/;

const AGENT_021: Rule = {
  id: 'AGENT-021',
  name: 'Sensitive data logged',
  category: 'LOGGING',
  layer: 'APPLICATION',
  severity: 'high',
  detection: 'STATIC_ANALYSIS',
  description: 'Credentials or personal data appear to be written to logs.',
  why:
    'Logs travel further than the code that wrote them: aggregators, third-party monitoring, support tickets, screenshots. ' +
    'A credential in a log is a credential in every one of those places, held under weaker access control than the ' +
    'system it protects, and usually retained far longer.',
  remediation: 'Log identifiers rather than values, and redact at the logger so one missed call site cannot leak. Rotate anything already written.',

  matches(ctx) {
    return ctx.changes.some((c) => c.added.some((l) => LOG_CALL.test(l.text)));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file)) continue;

      const risky = change.added.filter((l) => {
        if (!LOG_CALL.test(l.text)) return false;
        if (!SENSITIVE_LOG.test(l.text)) return false;
        // Logging that something was redacted, or a key's absence, is fine.
        if (/redact|\[REDACTED\]|masked|\*{4,}|hasToken|tokenPresent|!!\s*token|Boolean\(/i.test(l.text)) return false;
        // A bare message with no interpolation is not leaking a value.
        if (!/[`'"]\s*[,+]|\$\{|%s|\{\}|,\s*\w/.test(l.text)) return false;
        return true;
      });

      if (risky.length === 0) continue;

      // Whole-object logging is worse: it leaks whatever the object happens to carry.
      const wholeObject = risky.filter((l) => /\b(?:req|request|user|session|body|headers|config|env)\b\s*[,)]/.test(l.text));

      results.push({
        title: `Sensitive data may be written to logs — ${change.file}`,
        severity: wholeObject.length > 0 ? 'high' : 'medium',
        confidence: wholeObject.length > 0 ? 0.78 : 0.65,
        verification: 'POTENTIAL',
        affectedFiles: [change.file],
        affectedLines: locations(change.file, risky),
        evidence: risky.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Log statement')),
        impact:
          (wholeObject.length > 0
            ? 'An entire request, session or config object is being logged, which captures every field it holds now and every field added to it later. '
            : '') +
          'Anything written here reaches log storage and any downstream aggregator, under access controls weaker than the data deserves.',
        recommendation: this.remediation,
        discriminator: 'sensitive-log',
      });
    }

    return results;
  },
};

export const CONTROL_RULES = [AGENT_005, AGENT_010, AGENT_018, AGENT_019, AGENT_020, AGENT_021];
registerRules(CONTROL_RULES);
export { AGENT_005, AGENT_010, AGENT_018, AGENT_019, AGENT_020, AGENT_021 };

export type { ContentChange };
