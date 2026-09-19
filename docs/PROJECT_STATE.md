# Project State

> **Template.** Replace the example content with your project's real state.
> Read this first in every session. Keep it under ~50 lines — it is a recurring
> token cost. Regenerate with `/handoff`.

_Updated: 2026-01-01_

## Architecture

Next.js (App Router) + Supabase Postgres + Vercel + Cloudflare DNS + Resend.
Multi-tenant: every business-owned table carries `tenant_id`.

## Current Feature

Subscription management — plan selection, checkout, webhook reconciliation.

## Completed

- Supabase Auth email/password + session handling — VERIFIED
- Core schema: `tenants`, `memberships`, `customers`, `invoices` — VERIFIED
- RLS on all tenant tables, four policies each — VERIFIED (`tests/security/rls.test.ts`)
- Invoice CRUD API with tenant scoping — VERIFIED

## In Progress

- PayHere webhook verification — signature check done, idempotency table not
  wired yet — `src/app/api/webhooks/payhere/route.ts`

## Known Issues

- Email retry is unbounded — a failing send loops forever (`src/services/email.ts`)
- No rate limit on `/api/auth/reset` yet

## Next Recommended Task

Add the `webhook_events` idempotency table (unique on `provider_event_id`) and
gate webhook processing on it. Then write the replay test.

## Gotchas

- Use the Supabase **pooler** URL in serverless routes; the direct URL exhausts
  connections under load.
- `NEXT_PUBLIC_*` changes are baked at build time — a dashboard edit needs a redeploy.
- `supabase db reset` is required before the RLS suite; it seeds two tenants.
