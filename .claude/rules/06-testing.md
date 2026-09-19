# 06 — Testing

Load for: writing tests, reviewing tests, deciding test strategy.

## 1. Test Behaviour, Not Implementation

A test that breaks on a rename but not on a bug is a liability.

```ts
// Wrong — asserts internals
expect(component.state.isLoading).toBe(false);

// Right — asserts behaviour a user or caller observes
expect(await screen.findByText('Invoice created')).toBeVisible();
```

## 2. Minimum Coverage Per Feature

Do not ship a feature without these:

| Case | Why |
|---|---|
| Happy path | It works at all |
| Invalid input | Validation actually rejects |
| Unauthenticated access | 401, not data |
| Unauthorized access (wrong user) | 403/404, not data |
| Cross-tenant access | Isolation holds |
| Ownership violation on update/delete | Writes are guarded |
| Edge cases | Empty, max length, boundary values, unicode |
| Failure conditions | DB down, external API error, timeout |

## 3. Test Types

| Type | Scope | Use for |
|---|---|---|
| Unit | One function, no I/O | Pure logic, validation, calculations |
| Integration | Module + real DB | Queries, RLS, transactions, services |
| API | HTTP in, HTTP out | Contracts, status codes, authz |
| Component | Rendered UI | States, interaction, accessibility |
| E2E | Full stack in a browser | Critical user journeys only |
| Security | Attacker's perspective | Access control, injection, enumeration |

Ratio guidance: many unit, a solid layer of integration/API, a handful of E2E.
E2E is slow and flaky — reserve it for the journeys that lose money when broken.

## 4. Security Tests Are Mandatory

Every access-controlled resource gets a test that fails if the control is removed.

```ts
it('does not leak another tenant\'s invoice', async () => {
  const a = await createTenantWithUser();
  const b = await createTenantWithUser();
  const invoice = await createInvoice(a);

  const res = await api.get(`/api/invoices/${invoice.id}`, { as: b.user });

  expect(res.status).toBe(404);          // 404, not 403 — no existence disclosure
  expect(await res.text()).not.toContain(invoice.id);
});

it('RLS blocks cross-tenant select even with a direct client', async () => {
  const client = supabaseAs(b.user);
  const { data } = await client.from('invoices').select('*').eq('id', invoice.id);
  expect(data).toEqual([]);              // policy, not application code
});
```

Also test: forged webhook signature rejected · replayed webhook is a no-op ·
rate limit triggers · upload of a disallowed type rejected · price from the
client is ignored.

## 5. Test Quality

- Independent: any order, any subset, no shared mutable state.
- Deterministic: no real clock, no real network, no random without a seed. Fix time with fake timers.
- Fast: unit tests in milliseconds. A slow suite stops being run.
- Clear failure messages: the name should tell you what broke without reading the body.
- Arrange / Act / Assert structure.
- Factories over fixtures for test data: `createInvoice({ status: 'paid' })`.

Do not mock the thing under test. Mock the boundary (network, clock, payment
provider), not your own service layer.

## 6. Before Claiming Tests Pass

Run them. Paste the actual result. `VERIFIED` means observed output.

```bash
pnpm typecheck && pnpm lint && pnpm test
```

If the suite was not run in this environment, say `NOT TESTED` and why.
