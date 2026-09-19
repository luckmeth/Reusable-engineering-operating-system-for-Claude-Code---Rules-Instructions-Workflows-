# Migrations

## Rules

1. **Ordered and timestamped.** `YYYYMMDDHHMMSS_short_description.sql`.
2. **RLS in the same migration as the table.** A table shipped without a policy
   is a public API, and adding it later means auditing everything written in
   between.
3. **Forward-only in production.** Never edit an applied migration — write a
   corrective one.
4. **Tested on a fresh database** before merge: `supabase db reset`.
5. **Destructive changes need explicit authorization** and an
   expand → migrate → contract plan.

## Commands

```bash
supabase migration new add_invoices     # create
supabase db reset                       # rebuild from scratch + seed (local)
supabase db diff -f my_change           # generate from Studio changes
supabase db push --project-ref <ref>    # apply to a remote project
supabase migration list                 # what is applied where
```

## Destructive Change Playbook

| Operation | Risk | Safe path |
|---|---|---|
| Drop column | Data loss | Stop writing → verify unused → drop in a later release |
| Rename column | Breaks running code | Add new → backfill → dual-write → switch reads → drop old |
| Change type | Lock + data loss | Add new column → batch backfill → swap → drop old |
| Add `NOT NULL` | Fails on existing nulls | Backfill → add constraint `not valid` → `validate constraint` |
| Add index (large table) | Write lock | `create index concurrently` (outside a transaction) |
| Drop table | Irreversible | Explicit authorization + verified backup |

## Reference Migrations

The three migrations here are a working reference, not fixed schema:

| File | Shows |
|---|---|
| `..._init_tenancy.sql` | Tenancy, roles, `security definer` policy helpers with a pinned `search_path` |
| `..._domain_tables.sql` | Constraints, query-driven indexes, four RLS policies per table |
| `..._webhook_idempotency.sql` | Idempotency via unique constraint, email queue, audit log |

Adapt the domain tables. Keep the isolation pattern.
