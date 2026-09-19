-- =============================================================================
-- 20260101000200_webhook_idempotency.sql
-- Idempotency for inbound webhooks and outbound email.
--
-- Enforcement is the UNIQUE CONSTRAINT, not an application-level `if already
-- processed` check -- that check races under concurrent delivery, and payment
-- providers do deliver concurrently.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- webhook_events
-- Insert BEFORE processing. A duplicate delivery hits the unique violation and
-- is acknowledged without re-running the side effect.
-- -----------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (provider in ('payhere', 'stripe', 'resend', 'other')),
  provider_event_id text not null,
  payload           jsonb not null,
  status            text not null default 'received'
                      check (status in ('received', 'processed', 'failed', 'dead')),
  attempts          int  not null default 0 check (attempts >= 0),
  last_error        text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  constraint webhook_events_provider_event_uniq unique (provider, provider_event_id)
);

create index if not exists webhook_events_pending_idx
  on public.webhook_events (received_at)
  where status in ('received', 'failed');

-- Service-role only. No policies -> RLS denies every client request.
alter table public.webhook_events enable row level security;
alter table public.webhook_events force  row level security;

-- -----------------------------------------------------------------------------
-- email_queue
-- Persist first, send from a cron-drained queue. A user's signup request must
-- not block on an email provider, and a client retry must not send twice.
-- -----------------------------------------------------------------------------
create table if not exists public.email_queue (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id) on delete cascade,
  idempotency_key text not null unique,
  template        text not null,
  to_address      text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed', 'dead')),
  attempts        int  not null default 0 check (attempts >= 0),
  max_attempts    int  not null default 5,
  next_run_at     timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- Drives the cron drain: due, not exhausted, oldest first.
create index if not exists email_queue_due_idx
  on public.email_queue (next_run_at)
  where status in ('pending', 'failed');

alter table public.email_queue enable row level security;
alter table public.email_queue force  row level security;

-- -----------------------------------------------------------------------------
-- audit_log -- security events that must survive application bugs.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  tenant_id   uuid references public.tenants(id) on delete set null,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  resource    text not null,
  resource_id text,
  -- Never store secrets, tokens, or full payment data here.
  metadata    jsonb not null default '{}'::jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_tenant_time_idx
  on public.audit_log (tenant_id, created_at desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force  row level security;

-- Admins read their own tenant's log. Nobody writes or edits it from a client;
-- inserts happen server-side. No INSERT/UPDATE/DELETE policy = denied.
create policy audit_log_select on public.audit_log
  for select using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin'])
  );
