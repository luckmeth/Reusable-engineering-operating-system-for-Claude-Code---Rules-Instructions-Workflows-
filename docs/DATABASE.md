# Database

> **Template.** See `.claude/rules/03-database.md` for the rules this follows.

## Model

```
tenants ──< memberships >── auth.users
   │
   ├──< customers
   └──< invoices >── customers
```

## Tables

### `tenants`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `name` | text not null | |
| `slug` | text not null unique | URL identifier |
| `created_at` | timestamptz not null | `now()` |

### `memberships`
Links a user to a tenant with a role. This is the authorization source of truth.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid fk → auth.users | on delete cascade |
| `tenant_id` | uuid fk → tenants | on delete cascade |
| `role` | text not null | `owner \| admin \| member \| viewer` |
| | | pk `(user_id, tenant_id)` |

### `invoices`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid fk → tenants | on delete cascade — isolation key |
| `customer_id` | uuid fk → customers | on delete restrict |
| `amount_cents` | bigint not null | `check > 0`. Never float. |
| `currency` | text not null | `check in ('LKR','USD')` |
| `status` | text not null | `check in ('draft','sent','paid','void')` |

## Indexes

| Index | Query it serves |
|---|---|
| `invoices (tenant_id, created_at desc)` | Tenant invoice list, newest first |
| `invoices (customer_id)` | FK join — Postgres does not auto-index FKs |
| `invoices (tenant_id) where status='draft'` | Draft counter on the dashboard |
| `customers (lower(email))` unique per tenant | Case-insensitive dedupe |

Every index here is tied to a real query. Verify with `explain analyze` before
adding one.

## RLS

Every user-accessible table: `enable row level security` **and**
`force row level security`, with a policy per operation.

```sql
create policy invoices_select on public.invoices
  for select using (tenant_id = public.current_tenant_id());

create policy invoices_update on public.invoices
  for update using      (tenant_id = public.current_tenant_id())
              with check (tenant_id = public.current_tenant_id());
```

`current_tenant_id()` and `has_role()` are `security definer` with a pinned
`search_path`, so policies do not recurse into the protected table.

**Service role bypasses RLS.** It is used only in `src/server/supabase-admin.ts`
for <webhooks / cron / admin jobs>, and every call site carries its own
authorization check.

## Migrations

- Location: `supabase/migrations/`, timestamped, forward-only in production.
- RLS and policies ship in the same migration as the table.
- Tested with `supabase db reset` before merge.

Destructive changes use expand → migrate → contract:
add the new column → backfill in batches → switch reads/writes → drop the old
column in a later release.

## Invariants Enforced By The Database

- An invoice always belongs to exactly one tenant (FK + not null)
- Amounts are always positive (`check`)
- Status is always one of four values (`check`)
- A user cannot hold two roles in one tenant (composite pk)
