-- =============================================================================
-- seed.sql — local development seed data.
--
-- Two tenants exist deliberately: isolation cannot be tested with one.
-- Every cross-tenant security test in tests/security/ depends on this shape.
--
-- Never seed real customer data. Never seed production.
-- =============================================================================

-- Deterministic IDs so tests can reference them without a lookup.
insert into public.tenants (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Acme Ltd',   'acme'),
  ('22222222-2222-2222-2222-222222222222', 'Globex Pvt', 'globex')
on conflict (id) do nothing;

-- Memberships are inserted by the test harness after it creates auth users,
-- since user IDs come from Supabase Auth. Shape:
--
--   insert into public.memberships (user_id, tenant_id, role)
--   values (<acme_owner_uid>,  '1111...', 'owner'),
--          (<globex_owner_uid>,'2222...', 'owner');

insert into public.customers (id, tenant_id, name, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Acme Customer One',   'one@acme-customer.test'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Globex Customer One', 'one@globex-customer.test')
on conflict (id) do nothing;

insert into public.invoices (id, tenant_id, customer_id, amount_cents, currency, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 2500000, 'LKR', 'sent'),
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001',   49900, 'USD', 'draft')
on conflict (id) do nothing;
