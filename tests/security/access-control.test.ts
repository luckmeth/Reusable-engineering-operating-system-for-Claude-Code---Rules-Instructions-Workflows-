/**
 * Access control / IDOR — the highest-value security tests in this stack.
 *
 * Pattern reference. Port to your runner and API client; keep the assertions.
 * Each test must fail if its control is removed — that is the whole point.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenantWithUser, createInvoice, type Ctx } from '../helpers';

describe('invoice access control', () => {
  let acme: Ctx;
  let globex: Ctx;
  let acmeInvoiceId: string;

  beforeAll(async () => {
    // Two tenants. Isolation cannot be tested with one.
    acme = await createTenantWithUser({ role: 'owner' });
    globex = await createTenantWithUser({ role: 'owner' });
    acmeInvoiceId = (await createInvoice(acme, { amountCents: 50_000 })).id;
  });

  it('rejects unauthenticated reads', async () => {
    const res = await api.get(`/api/invoices/${acmeInvoiceId}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 — not 403 — for another tenant\'s invoice', async () => {
    const res = await api.get(`/api/invoices/${acmeInvoiceId}`, { as: globex.user });

    // 403 tells the attacker the ID is real. 404 is indistinguishable from a
    // random UUID, which is what we want.
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(acmeInvoiceId);
  });

  it('gives the same response for a real out-of-scope ID and a fake ID', async () => {
    const real = await api.get(`/api/invoices/${acmeInvoiceId}`, { as: globex.user });
    const fake = await api.get('/api/invoices/00000000-0000-0000-0000-000000000000', { as: globex.user });

    // Identical status AND body: no existence oracle via response shape.
    expect(real.status).toBe(fake.status);
    expect(await real.json()).toEqual(await fake.json());
  });

  it('ignores a client-supplied tenant_id', async () => {
    // Classic privilege escalation attempt: name someone else's tenant.
    const res = await api.post('/api/invoices', {
      as: globex.user,
      body: {
        tenantId: acme.tenantId,        // must be ignored entirely
        customerId: globex.customerId,
        amountCents: 1000,
        currency: 'USD',
      },
    });

    if (res.status === 201) {
      const { invoice } = await res.json();
      const stored = await globex.db.invoice(invoice.id);
      expect(stored.tenant_id).toBe(globex.tenantId); // session wins, not the body
    } else {
      expect(res.status).toBe(400); // schema strips unknown keys — also correct
    }
  });

  it('blocks cross-tenant update', async () => {
    const res = await api.patch(`/api/invoices/${acmeInvoiceId}`, {
      as: globex.user,
      body: { status: 'void' },
    });
    expect(res.status).toBe(404);

    const unchanged = await acme.db.invoice(acmeInvoiceId);
    expect(unchanged.status).not.toBe('void'); // the write must not have landed
  });

  it('blocks cross-tenant delete', async () => {
    const res = await api.delete(`/api/invoices/${acmeInvoiceId}`, { as: globex.user });
    expect(res.status).toBe(404);
    expect(await acme.db.invoice(acmeInvoiceId)).toBeTruthy();
  });

  it('does not leak another tenant\'s rows through the list endpoint', async () => {
    const res = await api.get('/api/invoices', { as: globex.user });
    const { invoices } = await res.json();

    expect(invoices.every((i: { id: string }) => i.id !== acmeInvoiceId)).toBe(true);
  });

  it('does not leak counts or totals across tenants', async () => {
    // Aggregates are a common isolation hole: the rows are filtered but the
    // dashboard sums the whole table.
    const res = await api.get('/api/invoices/summary', { as: globex.user });
    const { totalCents } = await res.json();

    expect(totalCents).toBe(globex.expectedTotalCents);
  });

  it('enforces role permissions within a tenant', async () => {
    const viewer = await acme.addUser({ role: 'viewer' });

    const res = await api.delete(`/api/invoices/${acmeInvoiceId}`, { as: viewer });
    expect([403, 404]).toContain(res.status);
    expect(await acme.db.invoice(acmeInvoiceId)).toBeTruthy();
  });
});
