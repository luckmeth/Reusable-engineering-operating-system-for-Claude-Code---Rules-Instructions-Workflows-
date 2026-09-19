-- =============================================================================
-- 20260101000000_init_tenancy.sql
-- Multi-tenant foundation: tenants, memberships, and the authorization helpers
-- that RLS policies depend on.
--
-- Reference migration for the Claude Code Engineering System.
-- Adapt the domain tables; keep the isolation pattern.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 200),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- memberships — the authorization source of truth.
-- A user's tenant access and role live here, never in a client-supplied field.
-- -----------------------------------------------------------------------------
create table if not exists public.memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  role       text not null default 'member'
               check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- Postgres does not index foreign keys automatically. This one serves
-- "who belongs to this tenant" and every policy lookup below.
create index if not exists memberships_tenant_idx on public.memberships (tenant_id);

-- =============================================================================
-- Authorization helpers
--
-- SECURITY DEFINER so a policy on `invoices` can read `memberships` without
-- triggering that table's own RLS -- which would recurse infinitely.
-- search_path is pinned: an unpinned search_path on a definer function is a
-- privilege-escalation vector.
-- =============================================================================

-- The caller's active tenant. Read from a JWT claim set at session creation.
-- Never from a request body -- that would let any user name any tenant.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id',
      current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'
    ),
    ''
  )::uuid;
$$;

-- Membership check: is the caller in this tenant at all?
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
  );
$$;

-- Role check within the caller's active tenant.
create or replace function public.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = public.current_tenant_id()
      and m.role = any(p_roles)
  );
$$;

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS
-- Enabled AND forced in the same migration that creates the tables.
-- A user-accessible table without a policy is a public API.
-- FORCE applies the policies to the table owner too.
-- =============================================================================

alter table public.tenants     enable row level security;
alter table public.tenants     force  row level security;
alter table public.memberships enable row level security;
alter table public.memberships force  row level security;

-- tenants: you see only tenants you belong to.
create policy tenants_select on public.tenants
  for select
  using (public.is_tenant_member(id));

create policy tenants_update on public.tenants
  for update
  using      (public.is_tenant_member(id) and public.has_role(array['owner','admin']))
  with check (public.is_tenant_member(id) and public.has_role(array['owner','admin']));

-- No INSERT or DELETE policy: tenant creation and deletion go through
-- server-side code using the service role, which carries its own checks.
-- Omitting a policy denies the operation -- that is deliberate here.

-- memberships: you see the roster of tenants you belong to.
create policy memberships_select on public.memberships
  for select
  using (public.is_tenant_member(tenant_id));

-- Only owners/admins manage membership, and only inside their own tenant.
-- with check stops an admin from planting a membership in another tenant.
create policy memberships_insert on public.memberships
  for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin'])
  );

create policy memberships_update on public.memberships
  for update
  using      (tenant_id = public.current_tenant_id() and public.has_role(array['owner','admin']))
  with check (tenant_id = public.current_tenant_id() and public.has_role(array['owner','admin']));

create policy memberships_delete on public.memberships
  for delete
  using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin'])
    -- an owner cannot be removed by an admin
    and not (role = 'owner' and not public.has_role(array['owner']))
  );
