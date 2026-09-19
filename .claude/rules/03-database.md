# 03 — Database (Supabase / PostgreSQL)

Load for: schema changes, queries, migrations, RLS policies, tenancy.

## 1. Schema Integrity

The database is the last line of defence for data correctness. Use it.

- Foreign keys with explicit `ON DELETE` behaviour (`CASCADE`, `RESTRICT`, `SET NULL`) — decide, don't default.
- `NOT NULL` wherever the domain requires a value.
- `UNIQUE` on natural keys (`(tenant_id, slug)`, `(tenant_id, lower(email))`).
- `CHECK` constraints for invariants: `CHECK (amount_cents > 0)`, `CHECK (status IN (...))`.
- Money as `bigint` cents or `numeric(12,2)`. Never `float`.
- Timestamps as `timestamptz`, always. Never naive `timestamp`.
- `created_at timestamptz not null default now()` on every table.

```sql
create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency     text not null check (currency in ('LKR','USD')),
  status       text not null default 'draft'
                 check (status in ('draft','sent','paid','void')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

## 2. Indexes

Index based on the queries you actually run — not on every column.

- Every foreign key used in a join or filter gets an index (Postgres does not create these automatically).
- Tenant-scoped tables: composite index leading with `tenant_id`, e.g. `(tenant_id, created_at desc)`.
- Partial indexes for hot subsets: `create index ... on invoices (tenant_id) where status = 'draft';`
- Unique indexes for case-insensitive uniqueness: `create unique index on users (lower(email));`
- Verify with `explain analyze` before and after. An index you cannot justify is write-amplification.

## 3. Query Discipline

- Never `select *` when you need three columns — it costs bandwidth and leaks columns added later.
- Never N+1. Fetch related rows with a join / embedded select or a single `in` query.
- Paginate every list endpoint. Prefer keyset pagination over `offset` for large tables.
- Use transactions when multiple writes must be atomic (Supabase: an RPC function with `begin/exception`).
- Long-running or multi-statement logic belongs in a `security definer` RPC with a locked-down `search_path`.

```sql
create function public.transfer_credits(p_to uuid, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- security definer bypasses RLS: authorize explicitly inside
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  ...
end $$;
```

## 4. Row Level Security

**RLS is mandatory on every user-accessible table.** A table without RLS in a
Supabase project is a public API.

```sql
alter table public.invoices enable row level security;
alter table public.invoices force row level security;   -- applies to table owner too
```

Write a policy per operation. Do not use one `for all` policy and assume it covers writes correctly.

```sql
-- read: only your tenant
create policy invoices_select on public.invoices
  for select using (tenant_id = public.current_tenant_id());

-- insert: cannot plant a row in another tenant
create policy invoices_insert on public.invoices
  for insert with check (tenant_id = public.current_tenant_id());

-- update: both sides — cannot move a row out of your tenant
create policy invoices_update on public.invoices
  for update using (tenant_id = public.current_tenant_id())
        with check (tenant_id = public.current_tenant_id());

-- delete: role-gated
create policy invoices_delete on public.invoices
  for delete using (
    tenant_id = public.current_tenant_id() and public.has_role('admin')
  );
```

Review checklist for every policy set:

- [ ] `SELECT` — can a user read another tenant's or user's rows?
- [ ] `INSERT` — does `with check` stop writing into someone else's scope?
- [ ] `UPDATE` — are **both** `using` and `with check` present?
- [ ] `DELETE` — is it role-gated where it should be?
- [ ] Do the helper functions used in policies avoid recursive RLS lookups?
- [ ] Is there a test that fails if the policy is dropped?

Helper functions used inside policies must be `security definer` and stable, or
you get infinite recursion when the policy queries the same protected table.

## 5. Service Role

The service-role key bypasses RLS entirely.

- Server-only. One module. Never in a client bundle, never in `NEXT_PUBLIC_*`.
- Use it only where RLS genuinely cannot express the rule (webhooks, admin jobs, cron).
- Every service-role call site carries its own explicit authorization check.
- Default to the anon/user client so RLS stays in the loop.

## 6. Multi-Tenant Isolation

```
Session → tenant_id  →  server query filter  →  RLS policy  →  data
           (derived)      (defence 1)            (defence 2)
```

Both layers, always. The server filter catches logic errors; RLS catches missed
server filters. `tenant_id` never comes from the request body.

Test for: cross-tenant read, cross-tenant write, cross-tenant update, cross-tenant
delete, metadata leakage (counts, aggregates, error messages), privilege escalation
via role columns.

## 7. Migrations

Migrations must be reproducible, reviewable, and ordered.

- One migration per logical change, timestamped: `supabase/migrations/20260319120000_add_invoices.sql`.
- Forward-only in production. Roll forward with a new migration, don't edit an applied one.
- Include RLS enablement and policies **in the same migration** that creates the table.
- Test against a fresh database (`supabase db reset`) before shipping.

Destructive operations require explicit authorization and a plan:

| Operation | Risk | Safe approach |
|---|---|---|
| `drop column` | Data loss | Deprecate → stop writing → verify → drop in a later release |
| `alter type` | Lock + failure | Add new column → backfill in batches → swap → drop old |
| `not null` on existing | Fails on nulls | Backfill first, then add constraint |
| Adding an index on a big table | Write lock | `create index concurrently` |
| `drop table` | Irreversible | Explicit authorization. Back up first. |

Never run a casual destructive migration against production.

## 8. Before Declaring Database Work Done

- [ ] Constraints express the real invariants
- [ ] Indexes match the actual query patterns (checked with `explain analyze`)
- [ ] RLS enabled and all four operations reviewed
- [ ] Migration runs clean on `supabase db reset`
- [ ] Cross-tenant access test exists and passes
- [ ] `docs/DATABASE.md` updated if the model changed
