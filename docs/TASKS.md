# Tasks

> **Template.** Keep tasks actionable and specific. A task nobody can start from
> the text alone is a note, not a task.

## Current

- [ ] Add `webhook_events` idempotency table and gate PayHere processing on it
      — `supabase/migrations/`, `src/app/api/webhooks/payhere/route.ts`

## Next

- [ ] Rate limit `/api/auth/login` and `/api/auth/reset` (keyed by IP + identifier)
- [ ] Bound email retries at 5 attempts with exponential backoff + dead-letter state
- [ ] Integration test: replayed webhook is a no-op

## Blocked

- [ ] Production domain on Cloudflare — waiting on registrar transfer
      **Unblocker:** client completes the transfer approval

## Backlog

_Discovered out of scope. Do not silently expand a task to include these._

- [ ] Replace `offset` pagination on `/api/invoices` with keyset (slow past ~10k rows)
- [ ] `customers.email` should be `unique (tenant_id, lower(email))`
- [ ] Audit log for admin actions
- [ ] cecc: `npm run lint` is a dead script — eslint is neither installed nor configured, and CI never calls it
- [ ] cecc: node-pty publishes no linux prebuild, so a Linux desktop build needs a compiler; decide between vendoring one and documenting the toolchain
- [ ] cecc: `.claude/settings.json` is committed but holds machine-specific absolute hook paths, so it does not survive a clone

## Done

_Move items here with the date. Trim quarterly — this file is read every session._

- [x] 2026-01-01 — RLS policies for all tenant tables
