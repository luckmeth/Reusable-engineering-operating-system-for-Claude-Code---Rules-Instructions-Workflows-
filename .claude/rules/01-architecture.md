# 01 — Architecture

Load for: new features, new modules, structural change, project initialization.

## 1. Project Initialization Order

Establish these before writing application code:

1. Requirements (what, for whom, what must not happen)
2. Architecture (shape, boundaries, data flow)
3. Technology decisions (and why — record in `docs/DECISIONS.md`)
4. Database model (entities, relationships, ownership)
5. Authentication model (who are you)
6. Authorization model (what may you do)
7. Security model (threats, boundaries, assumptions)
8. Environment variables (`.env.example`)
9. Repository structure
10. Testing strategy
11. Deployment strategy

Then create: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`,
`docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/PROJECT_STATE.md`, `docs/TASKS.md`.

Run `/init-project` to scaffold this.

## 2. Repository Structure

```
/
├── CLAUDE.md
├── .claude/
│   ├── rules/           # engineering rules, loaded per task
│   ├── commands/        # slash commands
│   └── agents/          # focused subagents
├── docs/                # architecture, db, security, api, deploy, decisions, state, tasks
├── src/ or app/
│   ├── app/             # routes (Next.js App Router)
│   ├── components/      # presentational, reusable
│   ├── features/        # feature-scoped UI + logic
│   ├── lib/             # pure helpers, clients, config
│   ├── server/          # server-only logic — never imported by client
│   ├── services/        # external integrations (Resend, payments, storage)
│   └── types/           # shared domain types
├── supabase/
│   ├── migrations/      # ordered, reproducible
│   ├── seed.sql
│   └── config.toml
├── tests/{unit,integration,security,e2e}
├── .env.example
└── package.json
```

Scale the structure to the project. A three-page app does not need `features/`.
Do not create empty directories to match a diagram.

## 3. Boundaries

The single most important architectural rule:

```
client code  →  may NEVER import  →  server/  or any module holding a secret
```

Enforce it, don't hope for it:

- Mark server modules with `import 'server-only'` (Next.js).
- Keep the service-role Supabase client in exactly one file under `server/`.
- `NEXT_PUBLIC_*` is the only prefix that reaches the browser. Anything else in
  client code is a leak.

## 4. Layering

```
Route / Handler     auth check → validate input → call service → shape response
Service             business rules, transactions, orchestration
Repository / Data   queries, mapping. No business rules.
```

Keep business logic out of components and out of SQL. Keep queries out of
components entirely.

## 5. Multi-Tenancy

If the system serves multiple organizations, model tenancy explicitly from day
one. Retrofitting tenancy is a rewrite.

- Every tenant-owned table carries `tenant_id` (or `organization_id`).
- `tenant_id` is derived from the session, never from the request body.
- Every query filters by tenant at the server **and** RLS enforces it at the database.
- Composite indexes lead with the tenant column: `(tenant_id, created_at desc)`.

See `.claude/rules/03-database.md` for policy patterns.

## 6. Architecture Decision Records

Record in `docs/DECISIONS.md` when a decision is expensive to reverse:

```markdown
### ADR-004 — Queue payment webhooks instead of processing inline
- **Date:** 2026-03-11
- **Context:** PayHere retries on >5s responses; inline processing timed out.
- **Options:** (a) inline + idempotency, (b) queue table + worker, (c) external queue
- **Chosen:** (b) queue table polled by a cron route
- **Reason:** No new infrastructure; survives Vercel's execution limits.
- **Trade-offs:** Up to 60s processing latency; needs a dead-letter path.
```

Do not write ADRs for trivial choices. If reversing it costs an afternoon, it is
not an ADR.

## 7. Dependencies

Before adding one, answer:

1. Can the existing stack do this? (Usually yes.)
2. What is the maintenance status and install size?
3. What is the blast radius if it is compromised?
4. What does removing it later cost?

Prefer: standard library → framework feature → existing dependency → new dependency.

## 8. Documentation

Document *why*, not *what*. The code already says what.

Worth documenting: architecture and its constraints, security assumptions,
external service roles, deployment requirements, database relationships,
important decisions, known limitations.

Not worth documenting: function-by-function restatements of the code.
