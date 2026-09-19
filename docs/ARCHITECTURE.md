# Architecture

> **Template.** Document *why*, not *what*. The code already says what.

## Overview

<One paragraph: what the system does and its overall shape.>

```
Browser ──► Cloudflare (DNS, TLS, WAF, CDN)
              │
              ▼
          Vercel (Next.js App Router)
          ├── Server Components ── read path
          ├── Route Handlers ───── write path, webhooks
          └── Server Actions ───── form mutations
              │
              ├──► Supabase Postgres (RLS enforced)
              ├──► Supabase Auth
              ├──► Supabase Storage
              └──► Resend (transactional email)
```

## Stack And Why

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) | Domain rules in the type system |
| Framework | Next.js App Router | Server-first; one deploy unit |
| Database | Supabase Postgres | Real Postgres + RLS as a second authz layer |
| Auth | Supabase Auth | Sessions handled; authorization stays ours |
| Hosting | Vercel | Preview per branch, instant rollback |
| Edge | Cloudflare | DNS, TLS, WAF, caching |
| Email | Resend | Transactional only |

## Boundaries

The one rule that must never be broken:

```
client code  →  may NEVER import  →  src/server/**  or any secret-holding module
```

Enforced by `import 'server-only'` in `src/server/`. The service-role Supabase
client exists in exactly one file: `src/server/supabase-admin.ts`.

## Layers

| Layer | Responsibility | Never does |
|---|---|---|
| Route handler | authn → validate → authz → call service → shape response | business rules |
| Service | business rules, transactions, orchestration | HTTP, rendering |
| Data | queries, row→domain mapping | business rules |
| Component | render state | fetch inside deep trees |

## Tenancy Model

<Single-tenant or multi-tenant? If multi-tenant:>

`tenant_id` is derived from the session on every request and never read from the
request body. Every tenant-owned query filters on it server-side, and an RLS
policy enforces it again at the database. Both layers, always — the server filter
catches logic errors, RLS catches missed filters.

## Data Flow — <critical path>

<Trace one important request end to end: who authenticates it, what validates
it, what authorizes it, what it writes, what it returns.>

## External Services

| Service | Role | Failure mode | Handling |
|---|---|---|---|
| Supabase | Data + auth | Outage = total | Fail closed, clear error |
| Resend | Email | Send fails | Queue + bounded retry |
| Cloudflare | DNS/CDN/WAF | Misconfig = outage | Documented DNS records |

## Constraints

- Serverless: stateless, time-limited, frozen after response. No in-memory state,
  no background work after returning, no persistent connections.
- Database connections go through the pooler.
- <Project-specific limits: regions, compliance, budget.>

## Known Limitations

<What the architecture deliberately does not handle, and what would change if it had to.>
