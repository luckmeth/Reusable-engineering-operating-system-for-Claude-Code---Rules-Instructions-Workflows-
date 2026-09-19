import { isMigrationFile, isTestFile, matchAdded, searchableText, trulyRemoved , isNonExecutable} from '../../analyze/content.js';
import { lineEvidence, locations, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';

/**
 * Database authorization: row-level security and tenant isolation.
 *
 * These rules only run for projects where the stack detection found Postgres or
 * Supabase. Running RLS rules against a project that has no Postgres produces
 * findings nobody can act on, and irrelevant findings are how a security tool
 * teaches people to ignore it.
 */

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?["'`]?(\w+)["'`]?/gi;
const ENABLE_RLS = /alter\s+table\s+(?:(\w+)\.)?["'`]?(\w+)["'`]?\s+enable\s+row\s+level\s+security/gi;

/** Tables that are service-role only by design and legitimately carry no policy. */
const INTERNAL_TABLE = /^(?:schema_migrations|_prisma_migrations|migrations|audit_log|webhook_events|email_queue|job_queue)$/i;

const AGENT_008: Rule = {
  id: 'AGENT-008',
  name: 'Row Level Security gap',
  category: 'RLS',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'A table is reachable by users without complete row-level security.',
  why:
    'In a Supabase project the database is directly reachable from the browser with the anon key. A table without RLS is ' +
    'not "protected by the API" — it is a public API. And a policy set missing `with check` on UPDATE lets a user move ' +
    'their own row into somebody else’s tenant, which reads as authorized because the row was theirs to begin with.',
  remediation:
    'Enable and force row level security on every user-reachable table, write a separate policy per operation, and pair `using` with `with check` on UPDATE. Ship the policies in the same migration as the table.',

  matches(ctx) {
    if (!ctx.project.stack.hasSupabase && ctx.project.stack.database !== 'postgres') return false;
    return ctx.changes.some((c) => isMigrationFile(c.file) && !isNonExecutable(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      // A README inside migrations/ documents SQL; it does not run it.
      if (!isMigrationFile(change.file) || isNonExecutable(change.file)) continue;
      const sql = searchableText(change);

      // --- tables created without RLS in the same migration
      CREATE_TABLE.lastIndex = 0;
      const created: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = CREATE_TABLE.exec(sql)) !== null) {
        if (match[2]) created.push(match[2]);
      }

      ENABLE_RLS.lastIndex = 0;
      const protectedTables = new Set<string>();
      while ((match = ENABLE_RLS.exec(sql)) !== null) {
        if (match[2]) protectedTables.add(match[2].toLowerCase());
      }

      const unprotected = created.filter((t) => !protectedTables.has(t.toLowerCase()) && !INTERNAL_TABLE.test(t));
      if (unprotected.length > 0) {
        const lines = change.added.filter((l) => unprotected.some((t) => new RegExp(`create\\s+table[^;]*\\b${t}\\b`, 'i').test(l.text)));
        results.push({
          title: `Table created without row level security: ${unprotected.join(', ')}`,
          confidence: 0.9,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, lines),
          evidence: [
            ...lines.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Table created')),
            { kind: 'config', label: 'Policies found in this migration', detail: protectedTables.size ? [...protectedTables].join(', ') : 'none' },
          ],
          impact:
            'Without RLS the table is readable and writable by anyone holding the anon key, which every visitor to the ' +
            'application has. Adding the policy in a later migration leaves a window where everything written is exposed.',
          recommendation: this.remediation,
          discriminator: `no-rls:${unprotected.sort().join(',')}`,
        });
      }

      // --- UPDATE policy with `using` but no `with check`
      const updatePolicies = /create\s+policy[\s\S]{0,400}?for\s+update([\s\S]{0,400}?)(?=create\s+policy|;\s*$|$)/gi;
      updatePolicies.lastIndex = 0;
      while ((match = updatePolicies.exec(sql)) !== null) {
        const body = match[1] ?? '';
        if (/with\s+check/i.test(body)) continue;
        if (!/using/i.test(body)) continue;
        const policyName = /create\s+policy\s+["'`]?(\w+)/i.exec(match[0])?.[1] ?? 'unnamed';
        results.push({
          title: `UPDATE policy '${policyName}' has 'using' but no 'with check'`,
          confidence: 0.92,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: [],
          evidence: [{ kind: 'config', label: 'Policy body', detail: match[0].slice(0, 400) }],
          impact:
            '`using` decides which rows a user may target; `with check` decides what those rows may become. With only the ' +
            'first, a user can update a row they legitimately own and set its tenant to another organization — moving data ' +
            'across the isolation boundary through an operation that looks authorized.',
          recommendation: 'Add a `with check` clause mirroring the `using` clause on every UPDATE policy.',
          discriminator: `no-with-check:${policyName}`,
        });
      }

      // --- RLS disabled or policies dropped
      const disabled = matchAdded(change, /disable\s+row\s+level\s+security|drop\s+policy/gi);
      if (disabled.length > 0) {
        results.push({
          title: `Row level security disabled or policy dropped — ${change.file}`,
          confidence: 0.95,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, disabled),
          evidence: disabled.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'RLS removed')),
          impact: 'Rows previously protected by this policy become reachable by any holder of the anon key.',
          recommendation: 'Restore the policy. If the rule genuinely changed, replace it with a narrower policy rather than removing protection.',
          discriminator: 'rls-disabled',
        });
      }

      // --- security definer without a pinned search_path
      const definers = matchAdded(change, /security\s+definer/gi);
      if (definers.length > 0 && !/set\s+search_path/i.test(sql)) {
        results.push({
          title: `SECURITY DEFINER function without a pinned search_path — ${change.file}`,
          severity: 'high',
          confidence: 0.88,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, definers),
          evidence: definers.slice(0, 3).map((l) => lineEvidence(change.file, l.line, l.text, 'SECURITY DEFINER')),
          impact:
            'The function runs with the owner’s privileges and resolves unqualified names through the caller’s search_path. ' +
            'A caller who can create objects in an earlier schema can shadow a referenced table and have their own code run as the owner.',
          recommendation: 'Add `set search_path = public, pg_temp` to every SECURITY DEFINER function and authorize explicitly inside it.',
          discriminator: 'definer-search-path',
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-009

/** Identifiers that grant access and must be derived server-side, never accepted. */
const CLIENT_TRUSTED = /\b(?:tenant_?[Ii]d|organization_?[Ii]d|org_?[Ii]d|workspace_?[Ii]d|account_?[Ii]d|user_?[Ii]d|owner_?[Ii]d|role|is_?[Aa]dmin|permissions?|price|amount|status|credits?|balance)\b/;
/** Where a value came from the caller. */
const REQUEST_SOURCE = /\b(?:req|request)\.(?:body|query|params)\b|\bbody\.|\bparams\.|\bquery\.|searchParams\.get|formData\.get|await\s+(?:req|request)\.json\(\)/;

const AGENT_009: Rule = {
  id: 'AGENT-009',
  name: 'Client-provided authorization value',
  category: 'ACCESS_CONTROL',
  layer: 'APPLICATION',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'An identifier that grants access or value is taken from the request instead of the session.',
  why:
    'The request body is written by the caller. If tenant, role or price comes from there, the caller chooses their own ' +
    'tenant, their own role and their own price. This is the most common serious bug in multi-tenant applications and it ' +
    'is exploited with a single edited HTTP request — no tooling required.',
  remediation: 'Derive these values from the authenticated server-side session. Keep them out of the input schema entirely so they cannot be supplied.',

  matches(ctx) {
    return ctx.changes.some((c) => !isTestFile(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file) || isNonExecutable(change.file) || change.isDeletion) continue;

      const risky = change.added.filter((l) => {
        if (!CLIENT_TRUSTED.test(l.text)) return false;
        if (!REQUEST_SOURCE.test(l.text)) return false;
        // Reading an id to look something up is fine; the risk is using it as the authorization boundary.
        if (/\/\/|\/\*|^\s*\*/.test(l.text.trim())) return false;
        return true;
      });

      if (risky.length === 0) continue;

      // Destructuring a privileged field straight out of the body is the clearest form.
      const destructured = risky.filter((l) =>
        /const\s*\{[^}]*\b(?:tenant_?[Ii]d|organization_?[Ii]d|role|is_?[Aa]dmin|price|amount)\b[^}]*\}\s*=\s*(?:await\s+)?(?:req|request|body)/.test(l.text),
      );

      results.push({
        title: `Authorization-relevant value read from request input — ${change.file}`,
        severity: destructured.length > 0 ? 'critical' : 'high',
        confidence: destructured.length > 0 ? 0.85 : 0.7,
        verification: destructured.length > 0 ? 'LIKELY' : 'POTENTIAL',
        affectedFiles: [change.file],
        affectedLines: locations(change.file, risky),
        evidence: risky.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Value sourced from request')),
        impact:
          'The caller controls this value. If it reaches a query filter, a permission check or a stored record, the caller ' +
          'selects their own tenant, role or price. Verify whether it is used for authorization or merely for lookup — ' +
          'the difference decides whether this is critical or harmless.',
        recommendation: this.remediation,
        discriminator: 'client-trusted-value',
      });

      // Tenant scoping removed while the query survives is the corresponding deletion case.
      const scopeGone = trulyRemoved(change, /\.eq\(\s*['"](?:tenant_id|organization_id|user_id)['"]/);
      if (scopeGone.length > 0) {
        results.push({
          title: `Tenant scoping removed from a query — ${change.file}`,
          severity: 'critical',
          confidence: 0.88,
          verification: 'LIKELY',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, scopeGone),
          evidence: scopeGone.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Scope filter removed')),
          impact: 'The query no longer restricts results to the caller’s tenant and can return or modify another organization’s rows.',
          recommendation: 'Restore the filter and add a cross-tenant test that fails when it is missing.',
          discriminator: 'tenant-scope-removed',
        });
      }
    }

    return results;
  },
};

export const DATA_RULES = [AGENT_008, AGENT_009];
registerRules(DATA_RULES);
export { AGENT_008, AGENT_009 };
