# API

> **Template.** Every endpoint declares authentication, authorization, input,
> output, errors, rate limits, and database effects. See `.claude/rules/05-backend.md`.

## Conventions

- JSON in, JSON out. `content-type: application/json`.
- Errors: `{ "error": "Safe message", "requestId": "..." }` — never a stack trace.
- `404` (not `403`) for resources the caller may not see.
- Every 5xx carries a `requestId` that correlates to a server log line.
- Identity comes from the session cookie. Never from the body.

## Error Codes

| Code | Meaning | Body |
|---|---|---|
| 400 | Validation failed | `{ error, issues }` |
| 401 | Not authenticated | `{ error }` |
| 403 | Authenticated, not permitted | `{ error }` |
| 404 | Not found / not visible to you | `{ error }` |
| 409 | Conflict (duplicate, state) | `{ error }` |
| 429 | Rate limited | `{ error, retryAfter }` |
| 500 | Unexpected | `{ error, requestId }` |

---

## `POST /api/invoices`

Create an invoice in the caller's tenant.

| Aspect | Value |
|---|---|
| Auth | Required (session) |
| Authorization | Role `owner \| admin \| member` in the tenant |
| Rate limit | 60/min per user |
| Tables | `invoices` (insert) |
| Idempotency | Optional `Idempotency-Key` header |

**Request**
```ts
{
  customerId: string,   // uuid, must belong to the caller's tenant
  amountCents: number,  // integer > 0, <= 10_000_000
  currency: 'LKR' | 'USD',
  note?: string         // <= 500 chars
}
```

`tenant_id` is **not** accepted — it is derived from the session.

**Response `201`**
```ts
{ invoice: { id, amountCents, currency, status, createdAt } }
```

Row mapped explicitly. Internal columns are never returned.

**Errors:** `400` invalid body · `401` no session · `404` customer not in tenant
(not `403` — no existence disclosure) · `429` rate limited

---

## `GET /api/invoices/:id`

| Aspect | Value |
|---|---|
| Auth | Required |
| Authorization | Tenant scope enforced **in the query**, plus RLS |
| Response | `200 { invoice }` · `404` if absent or out of scope |

Out-of-tenant IDs return `404`, identical to a non-existent ID.

---

## `POST /api/webhooks/<provider>`

| Aspect | Value |
|---|---|
| Auth | None — signature-verified instead |
| Verification | HMAC over the **raw** body, constant-time compare |
| Replay | Timestamps older than 5 minutes rejected |
| Idempotency | Unique constraint on `webhook_events.provider_event_id` |
| Response | `200` always after verification (providers retry on non-2xx) |

No state is mutated before the signature verifies. Amounts come from the
database, never from the payload.
