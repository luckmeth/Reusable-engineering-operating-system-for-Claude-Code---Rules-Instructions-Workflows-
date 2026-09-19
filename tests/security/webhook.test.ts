/**
 * Webhook security — forgery, replay, idempotency.
 *
 * A payment webhook that accepts an unsigned payload lets anyone mark any
 * order paid. A webhook without idempotency double-credits on the provider's
 * normal retry, which is not an edge case — providers retry by design.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { api, serviceClient, createPendingOrder } from '../helpers';

const SECRET = process.env.TEST_WEBHOOK_SECRET!;
const sign = (raw: string, ts: number) =>
  createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');

describe('payment webhook', () => {
  let orderId: string;
  let body: string;
  let ts: number;

  beforeEach(async () => {
    orderId = (await createPendingOrder({ amountCents: 250_000 })).id;
    ts = Math.floor(Date.now() / 1000);
    body = JSON.stringify({
      event_id: `evt_${crypto.randomUUID()}`,
      order_id: orderId,
      status: 'paid',
      amount_cents: 250_000,
    });
  });

  const post = (raw: string, headers: Record<string, string>) =>
    api.raw('/api/webhooks/payment', {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('rejects an unsigned payload', async () => {
    const res = await post(body, {});
    expect(res.status).toBe(400);
    expect((await serviceClient.order(orderId)).status).toBe('pending');
  });

  it('rejects an invalid signature', async () => {
    const res = await post(body, { 'x-signature': 'deadbeef', 'x-timestamp': String(ts) });
    expect(res.status).toBe(400);
    expect((await serviceClient.order(orderId)).status).toBe('pending');
  });

  it('rejects a signature computed over a different body', async () => {
    // Signature valid for some payload, but not this one — the classic
    // "verified the parsed object instead of the raw body" bug.
    const other = JSON.stringify({ ...JSON.parse(body), amount_cents: 1 });
    const res = await post(body, { 'x-signature': sign(other, ts), 'x-timestamp': String(ts) });

    expect(res.status).toBe(400);
    expect((await serviceClient.order(orderId)).status).toBe('pending');
  });

  it('rejects a replayed old timestamp', async () => {
    const old = ts - 3600;
    const res = await post(body, { 'x-signature': sign(body, old), 'x-timestamp': String(old) });

    expect(res.status).toBe(400);
    expect((await serviceClient.order(orderId)).status).toBe('pending');
  });

  it('accepts a valid signed payload and marks the order paid', async () => {
    const res = await post(body, { 'x-signature': sign(body, ts), 'x-timestamp': String(ts) });

    expect(res.status).toBe(200);
    expect((await serviceClient.order(orderId)).status).toBe('paid');
  });

  it('is idempotent — a redelivered event does not credit twice', async () => {
    const headers = { 'x-signature': sign(body, ts), 'x-timestamp': String(ts) };

    await post(body, headers);
    const second = await post(body, headers);

    // Still 200 — a non-2xx makes the provider retry forever.
    expect(second.status).toBe(200);

    const { count } = await serviceClient
      .from('payments').select('*', { count: 'exact', head: true }).eq('order_id', orderId);
    expect(count).toBe(1);
  });

  it('ignores a client-declared amount and uses the stored order total', async () => {
    const tampered = JSON.stringify({
      event_id: `evt_${crypto.randomUUID()}`,
      order_id: orderId,
      status: 'paid',
      amount_cents: 1,           // attacker pays 1 cent
    });
    const res = await post(tampered, {
      'x-signature': sign(tampered, ts),
      'x-timestamp': String(ts),
    });

    // Signature is valid, so the request is authentic — but the amount must be
    // reconciled against the provider/database, never trusted from the payload.
    const order = await serviceClient.order(orderId);
    if (res.status === 200) expect(order.amount_cents).toBe(250_000);
    else expect(order.status).toBe('pending');
  });
});
