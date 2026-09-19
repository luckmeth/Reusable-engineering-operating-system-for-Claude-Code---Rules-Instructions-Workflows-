/**
 * Input validation and injection.
 *
 * The server is the security boundary. These tests bypass the UI entirely,
 * which is exactly what an attacker does.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenantWithUser, type Ctx } from '../helpers';

describe('input validation', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createTenantWithUser({ role: 'owner' }); });

  const create = (body: unknown) => api.post('/api/invoices', { as: ctx.user, body });

  it.each([
    ['missing required field', { currency: 'USD' }],
    ['wrong type',             { customerId: 123, amountCents: '50', currency: 'USD' }],
    ['negative amount',        { customerId: ctx?.customerId, amountCents: -100, currency: 'USD' }],
    ['zero amount',            { customerId: ctx?.customerId, amountCents: 0, currency: 'USD' }],
    ['non-integer amount',     { customerId: ctx?.customerId, amountCents: 10.5, currency: 'USD' }],
    ['absurd amount',          { customerId: ctx?.customerId, amountCents: 9e15, currency: 'USD' }],
    ['invalid currency',       { customerId: ctx?.customerId, amountCents: 100, currency: 'XXX' }],
    ['invalid uuid',           { customerId: 'not-a-uuid', amountCents: 100, currency: 'USD' }],
    ['oversized note',        { customerId: ctx?.customerId, amountCents: 100, currency: 'USD', note: 'x'.repeat(10_000) }],
  ])('rejects %s', async (_label, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
  });

  it('strips privileged fields instead of honouring them', async () => {
    const res = await create({
      customerId: ctx.customerId,
      amountCents: 100,
      currency: 'USD',
      status: 'paid',          // must not be settable on create
      tenantId: 'other',       // must come from the session
      id: 'chosen-by-client',  // must be generated
    });

    if (res.status === 201) {
      const { invoice } = await res.json();
      expect(invoice.status).toBe('draft');
      expect(invoice.id).not.toBe('chosen-by-client');
    } else {
      expect(res.status).toBe(400);
    }
  });

  it('does not execute SQL from string input', async () => {
    const res = await api.get("/api/customers?q=';drop table invoices;--", { as: ctx.user });

    expect([200, 400]).toContain(res.status);
    // The table still exists — parameterized queries, not string building.
    expect((await api.get('/api/invoices', { as: ctx.user })).status).toBe(200);
  });

  it('stores script payloads inertly rather than reflecting them', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const res = await api.post('/api/customers', {
      as: ctx.user,
      body: { name: xss, email: 'x@example.test' },
    });

    if (res.status === 201) {
      const { customer } = await res.json();
      // Stored as data is fine; the UI must escape on render. What must never
      // happen is the API reflecting it into an HTML response.
      expect(customer.name).toBe(xss);
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });

  it('does not leak internals in error responses', async () => {
    const res = await create({ customerId: 'bad', amountCents: 1, currency: 'USD' });
    const text = await res.text();

    for (const leak of ['stack', 'node_modules', 'at Object.', 'PostgrestError', 'SUPABASE', 'password']) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('rate limits repeated failed logins', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () =>
        api.post('/api/auth/login', { body: { email: 'a@b.test', password: 'wrong' } }),
      ),
    );
    expect(attempts.some((r) => r.status === 429)).toBe(true);
  });
});
