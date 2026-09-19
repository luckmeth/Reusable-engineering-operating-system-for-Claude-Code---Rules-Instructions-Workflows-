# Tests

Reference test patterns for the Claude Code Engineering System.
See `.claude/rules/06-testing.md` for the rules these follow.

```
tests/
├── unit/          pure logic — no I/O, milliseconds
├── integration/   module + real database — queries, transactions, services
├── security/      attacker's perspective — MANDATORY for access-controlled resources
└── e2e/           full stack in a browser — critical journeys only
```

## The Rule That Matters

**Every access-controlled resource needs a test that fails when the control is
removed.** A control with no test is an assumption, and assumptions are how
cross-tenant breaches ship.

Minimum per feature: happy path · invalid input · unauthenticated ·
unauthorized · cross-tenant · ownership violation · edge cases · failure conditions.

## Running

```bash
pnpm test                          # everything
pnpm test tests/security           # security suite only
supabase db reset && pnpm test:integration   # integration needs a seeded DB
```

The RLS suite requires `supabase db reset` first — `seed.sql` creates the two
tenants the isolation tests compare.

## Adapting These Files

The files here are patterns, written against Vitest + Supabase. Port the
structure to your runner. What matters is what is asserted, not the syntax:

- Cross-tenant requests return `404`, not `403` — `403` confirms existence
- RLS blocks the query even when application code is bypassed entirely
- Forged and replayed webhooks change nothing
- Client-supplied `tenant_id`, `role`, and `price` are ignored
