-- =============================================================================
-- 20260101000100_domain_tables.sql
-- Example tenant-owned domain tables. Demonstrates the full pattern:
-- constraints -> indexes tied to real queries -> RLS for all four operations.
--
-- Replace `customers` and `invoices` with your domain. Keep the shape.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 200),
  email      text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness, scoped to the tenant: two tenants may both have
-- a customer at the same address, one tenant may not have duplicates.
create unique index if not exists customers_tenant_email_uniq
  on public.customers (tenant_id, lower(email))
  where email is not null;

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete restrict,
  -- Money as integer cents. Never float: 0.1 + 0.2 != 0.3.
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 1000000000),
  currency     text not null check (currency in ('LKR', 'USD')),
  status       text not null default 'draft'
                 check (status in ('draft', 'sent', 'paid', 'void')),
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Invariant enforced by the database, not by hopeful application code.
  constraint invoices_paid_has_timestamp
    check ((status = 'paid') = (paid_at is not null))
);

-- Serves: "this tenant's invoices, newest first" -- the dashboard's main query.
-- Tenant-scoped composites lead with tenant_id.
create index if not exists invoices_tenant_created_idx
  on public.invoices (tenant_id, created_at desc);

-- Serves the FK join to customers.
create index if not exists invoices_customer_idx
  on public.invoices (customer_id);

-- Partial index for the unpaid-total widget: small, hot subset.
create index if not exists invoices_tenant_unpaid_idx
  on public.invoices (tenant_id)
  where status in ('draft', 'sent');

create trigger invoices_touch_updated_at
  before update on public.invoices
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS -- four policies per table, no exceptions.
-- =============================================================================

alter table public.customers enable row level security;
alter table public.customers force  row level security;
alter table public.invoices  enable row level security;
alter table public.invoices  force  row level security;

-- customers
create policy customers_select on public.customers
  for select using (tenant_id = public.current_tenant_id());

create policy customers_insert on public.customers
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin','member'])
  );

-- Both using and with check. `using` decides which rows you may target;
-- `with check` decides what they may become. Without the second, a user can
-- move a row into another tenant with a single UPDATE.
create policy customers_update on public.customers
  for update
  using      (tenant_id = public.current_tenant_id() and public.has_role(array['owner','admin','member']))
  with check (tenant_id = public.current_tenant_id());

create policy customers_delete on public.customers
  for delete using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin'])
  );

-- invoices
create policy invoices_select on public.invoices
  for select using (tenant_id = public.current_tenant_id());

create policy invoices_insert on public.invoices
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin','member'])
    -- the referenced customer must also be in this tenant
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.tenant_id = public.current_tenant_id()
    )
  );

create policy invoices_update on public.invoices
  for update
  using      (tenant_id = public.current_tenant_id() and public.has_role(array['owner','admin','member']))
  with check (tenant_id = public.current_tenant_id());

create policy invoices_delete on public.invoices
  for delete using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin'])
    and status = 'draft'   -- issued invoices are voided, never deleted
  );
