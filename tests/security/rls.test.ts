/**
 * RLS policy tests — the second isolation layer, tested directly.
 *
 * These bypass application code entirely and talk to Postgres as the user.
 * If application filtering is the only thing protecting the data, these fail.
 * That is exactly what they are for.
 *
 * Requires: supabase db reset (seed.sql creates both tenants).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { supabaseAs, serviceClient, createTenantWithUser, type Ctx } from '../helpers';

describe('row level security', () => {
  let acme: Ctx;
  let globex: Ctx;
  let acmeInvoiceId: string;

  beforeAll(async () => {
    acme = await createTenantWithUser({ role: 'owner' });
    globex = await createTenantWithUser({ role: 'owner' });

    const { data } = await serviceClient
      .from('invoices')
      .insert({
        tenant_id: acme.tenantId,
        customer_id: acme.customerId,
        amount_cents: 12_345,
        currency: 'LKR',
      })
      .select('id')
      .single();
    acmeInvoiceId = data!.id;
  });

  it('SELECT policy hides other tenants\' rows', async () => {
    const db = supabaseAs(globex.user);

    const { data, error } = await db.from('invoices').select('*').eq('id', acmeInvoiceId);

    // RLS filters rather than erroring — an empty set is the pass condition.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('SELECT policy scopes an unfiltered query to the caller\'s tenant', async () => {
    const db = supabaseAs(globex.user);
    const { data } = await db.from('invoices').select('tenant_id');

    expect(data!.every((r) => r.tenant_id === globex.tenantId)).toBe(true);
  });

  it('INSERT with_check blocks writing into another tenant', async () => {
    const db = supabaseAs(globex.user);

    const { error } = await db.from('invoices').insert({
      tenant_id: acme.tenantId,          // not mine
      customer_id: acme.customerId,
      amount_cents: 999,
      currency: 'USD',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/row-level security/i);
  });

  it('UPDATE with_check blocks moving a row into another tenant', async () => {
    // The bug this catches: a policy with `using` but no `with check` lets a
    // user re-parent their own row into someone else's tenant.
    const db = supabaseAs(globex.user);
    const { data: mine } = await db.from('invoices').select('id').limit(1).single();

    const { error } = await db
      .from('invoices')
      .update({ tenant_id: acme.tenantId })
      .eq('id', mine!.id);

    expect(error).not.toBeNull();
  });

  it('UPDATE policy blocks editing another tenant\'s row', async () => {
    const db = supabaseAs(globex.user);

    const { data } = await db
      .from('invoices')
      .update({ amount_cents: 1 })
      .eq('id', acmeInvoiceId)
      .select();

    expect(data).toEqual([]); // matched nothing — the row is invisible

    const { data: after } = await serviceClient
      .from('invoices').select('amount_cents').eq('id', acmeInvoiceId).single();
    expect(after!.amount_cents).toBe(12_345);
  });

  it('DELETE policy blocks deleting another tenant\'s row', async () => {
    const db = supabaseAs(globex.user);
    await db.from('invoices').delete().eq('id', acmeInvoiceId);

    const { data } = await serviceClient
      .from('invoices').select('id').eq('id', acmeInvoiceId).single();
    expect(data).toBeTruthy();
  });

  it('every public table has RLS enabled', async () => {
    // Catches the new table someone adds without a policy — the single most
    // common way a Supabase project leaks.
    const { data } = await serviceClient.rpc('exec_sql', {
      sql: `select tablename from pg_tables t
            where schemaname = 'public'
              and not exists (
                select 1 from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where c.relname = t.tablename and n.nspname = 'public' and c.relrowsecurity
              )`,
    });

    expect(data).toEqual([]);
  });

  it('anonymous access reads nothing', async () => {
    const anon = supabaseAs(null);
    const { data } = await anon.from('invoices').select('*');
    expect(data ?? []).toEqual([]);
  });
});
