import { isClientReachable, isTestFile, searchableText } from '../../analyze/content.js';
import { detectSecrets, isSupabaseServiceRoleJwt, maskValue } from '../../secrets.js';
import { lineEvidence, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';

/**
 * Credential exposure.
 *
 * Findings here never quote the secret itself. The value is masked in evidence
 * and the finding points at file and line instead: CECC's own database and UI
 * must not become a second, less-protected copy of the credential.
 */

const ENV_EXAMPLE = /\.env\.(?:example|sample|template)$|\.env\.dist$/;

const AGENT_006: Rule = {
  id: 'AGENT-006',
  name: 'Hardcoded secret',
  category: 'SECRETS',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'A credential appears to be written directly into tracked content.',
  why:
    'A secret in source is a secret in every clone, every fork, every CI log and every backup. Once it reaches git history, ' +
    'deleting the line does not undo it — the only real remedy is rotation, and that only works if someone notices in time.',
  remediation: 'Rotate the credential first — assume it is compromised. Then move it to an environment variable and keep only the variable name in the repository.',

  matches(ctx) {
    return ctx.changes.length > 0;
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (change.isDeletion) continue;
      // A template file is supposed to list variable names; flagging it is noise.
      // A real value in one is caught below by the placeholder check failing.
      const isTemplate = ENV_EXAMPLE.test(change.file);

      for (const line of change.added) {
        const found = detectSecrets(line.text);
        for (const secret of found) {
          // Low-confidence generic matches in tests are usually fixtures.
          if (isTestFile(change.file) && secret.confidence < 0.9) continue;

          const severity: Rule['severity'] = secret.privileged ? 'critical' : secret.confidence > 0.9 ? 'high' : 'medium';

          results.push({
            title: isTemplate
              ? `Real value in template file ${change.file}: ${secret.label}`
              : `${secret.label} hardcoded in ${change.file}`,
            severity: isTemplate ? 'high' : severity,
            confidence: secret.confidence,
            verification: secret.confidence >= 0.9 ? 'VERIFIED' : 'LIKELY',
            affectedFiles: [change.file],
            affectedLines: line.line !== null ? [{ file: change.file, line: line.line }] : [],
            evidence: [
              // The masked form only — never the credential.
              {
                kind: 'line',
                label: secret.label,
                detail: `${secret.label} detected, value masked: ${maskValue(secret.value)}`,
                file: change.file,
                ...(line.line !== null ? { line: line.line } : {}),
              },
              ...(secret.note ? [{ kind: 'config' as const, label: 'Classification', detail: secret.note }] : []),
            ],
            impact:
              (isTemplate
                ? 'A template file is committed by design and read by everyone with repository access. '
                : 'Anyone with repository access, now or later, has this credential. ') +
              (secret.privileged
                ? 'This credential type carries broad privileges, so the blast radius is the whole service it authenticates to.'
                : 'Treat it as compromised from the moment it was committed.'),
            recommendation: this.remediation,
            discriminator: `${secret.kind}:${line.line ?? 0}`,
          });
        }
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-007

/** Env vars that reach the browser bundle in common frameworks. */
const PUBLIC_ENV_PREFIX = /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_|GATSBY_|NUXT_PUBLIC_)([A-Z0-9_]+)/g;
/** Names that should never be public, whatever prefix they carry. */
const PRIVILEGED_NAME = /SERVICE_ROLE|SECRET|PRIVATE_KEY|ADMIN_KEY|MASTER_KEY|PASSWORD|_TOKEN$|WEBHOOK_SECRET|DATABASE_URL|CONNECTION_STRING/;

const AGENT_007: Rule = {
  id: 'AGENT-007',
  name: 'Privileged credential exposed to client',
  category: 'SECRETS',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'A privileged credential is reachable from code that ships to the browser.',
  why:
    'Everything in a client bundle is public. A service-role key there is not a leak waiting to happen — it is already ' +
    'published to every visitor, and it bypasses every row-level policy the database has. This is the single highest-impact ' +
    'mistake available in a Supabase or Firebase project.',
  remediation:
    'Remove the credential from client-reachable code and rotate it immediately. Keep privileged keys in one server-only module; the browser gets the anon/publishable key, which is constrained by row-level security.',

  matches(ctx) {
    return ctx.changes.length > 0;
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (change.isDeletion || isTestFile(change.file)) continue;
      const content = searchableText(change);
      const clientReachable = isClientReachable(change.file, content);

      // Signal 1: a privileged name behind a public env prefix. Dangerous in any
      // file, because the prefix itself is what publishes it.
      for (const line of change.added) {
        PUBLIC_ENV_PREFIX.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = PUBLIC_ENV_PREFIX.exec(line.text)) !== null) {
          const name = match[1] ?? '';
          if (!PRIVILEGED_NAME.test(name)) continue;
          results.push({
            title: `Privileged credential behind a public env prefix: ${match[0]}`,
            severity: 'critical',
            confidence: 0.93,
            verification: 'VERIFIED',
            affectedFiles: [change.file],
            affectedLines: line.line !== null ? [{ file: change.file, line: line.line }] : [],
            evidence: [lineEvidence(change.file, line.line, line.text, 'Public env prefix on a privileged name')],
            impact:
              'The framework inlines variables with this prefix into the client bundle at build time. The value is served to ' +
              'every visitor and is readable in the page source.',
            recommendation: this.remediation,
            discriminator: `public-env:${match[0]}`,
          });
        }
      }

      if (!clientReachable) continue;

      // Signal 2: a literal privileged credential inside client-reachable code.
      for (const line of change.added) {
        for (const secret of detectSecrets(line.text)) {
          if (!secret.privileged) continue;
          const isServiceRole = secret.kind === 'supabase_service_role' || isSupabaseServiceRoleJwt(secret.value);
          results.push({
            title: isServiceRole
              ? `Supabase service-role key in client-reachable file ${change.file}`
              : `${secret.label} in client-reachable file ${change.file}`,
            severity: 'critical',
            confidence: 0.95,
            verification: 'VERIFIED',
            affectedFiles: [change.file],
            affectedLines: line.line !== null ? [{ file: change.file, line: line.line }] : [],
            evidence: [
              {
                kind: 'line',
                label: secret.label,
                detail: `Value masked: ${maskValue(secret.value)}`,
                file: change.file,
                ...(line.line !== null ? { line: line.line } : {}),
              },
              { kind: 'file', label: 'Why this file is client-reachable', detail: clientReachableReason(change.file, content) },
            ],
            impact: isServiceRole
              ? 'The service-role key bypasses row-level security entirely. Published to the browser, it grants every visitor full read and write access to every table, regardless of any policy.'
              : 'This privileged credential is served to every visitor and can be extracted from the bundle in seconds.',
            recommendation: this.remediation,
            discriminator: `client-secret:${secret.kind}:${line.line ?? 0}`,
          });
        }
      }

      // Signal 3: a service-role client constructed in client-reachable code.
      const adminClient = change.added.filter((l) =>
        /createClient\s*\([^)]*SERVICE_ROLE|supabaseAdmin|createAdminClient|service_role/i.test(l.text),
      );
      if (adminClient.length > 0) {
        results.push({
          title: `Privileged database client constructed in client-reachable file ${change.file}`,
          severity: 'critical',
          confidence: 0.85,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: adminClient.filter((l) => l.line !== null).map((l) => ({ file: change.file, line: l.line as number })),
          evidence: adminClient.slice(0, 3).map((l) => lineEvidence(change.file, l.line, l.text, 'Admin client in client code')),
          impact:
            'A client built with service-role credentials bypasses row-level security. In a file that ships to the browser, the credential it needs goes with it.',
          recommendation: this.remediation,
          discriminator: 'admin-client-in-client',
        });
      }
    }

    return results;
  },
};

function clientReachableReason(path: string, content: string): string {
  if (/^\s*['"]use client['"]/m.test(content)) return `${path} is marked 'use client'`;
  return `${path} sits on a client-rendered path and carries no server-only marker`;
}

export const SECRET_RULES = [AGENT_006, AGENT_007];
registerRules(SECRET_RULES);
export { AGENT_006, AGENT_007 };
