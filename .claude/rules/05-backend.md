# 05 — Backend (API / Server Logic)

Load for: API routes, server actions, business logic, error handling, logging.

## 1. Where Logic Lives

Business logic is server-side. The client is a rendering layer and a hostile
input source — never a place to enforce a rule.

```
Handler   auth → validate → authorize → call service → shape response
Service   business rules, transactions, orchestration
Data      queries only
```

## 2. Endpoint Contract

Every endpoint defines, explicitly:

| Aspect | Question |
|---|---|
| Authentication | Required? Which session? |
| Authorization | Which role / ownership / tenant rule? |
| Input schema | Validated with what, where? |
| Output schema | What exactly is returned — no accidental columns? |
| Errors | Which codes, which safe messages? |
| Rate limits | Needed? Keyed on what? |
| Database | Which tables, which writes, transactional? |
| Logging | What is recorded, what is redacted? |

```ts
export async function POST(req: Request) {
  // 1. authenticate
  const session = await getSession();
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 });

  // 2. validate
  const parsed = CreateInvoice.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  // 3. authorize (ownership / tenant / role)
  if (!can(session, 'invoice:create')) return json({ error: 'Not found' }, { status: 404 });

  // 4. act — tenant from session, never from body
  try {
    const invoice = await invoiceService.create({ ...parsed.data, tenantId: session.tenantId });
    return json({ invoice: toPublicInvoice(invoice) }, { status: 201 });
  } catch (err) {
    logger.error({ err, requestId: session.requestId }, 'invoice.create failed');
    return json({ error: 'Unable to create invoice' }, { status: 500 });
  }
}
```

## 3. Output Shaping

Never return a database row directly. Map it.

```ts
// A raw row leaks columns you add later: internal_notes, cost_price, stripe_customer_id
const toPublicInvoice = (r: InvoiceRow) => ({
  id: r.id, amountCents: r.amount_cents, currency: r.currency,
  status: r.status, createdAt: r.created_at,
});
```

## 4. Error Handling

Do not silently swallow errors. `catch {}` with an empty body is a defect.

Separate the classes — they have different status codes, different logging, and
different user messaging:

| Class | Status | Log level | User message |
|---|---|---|---|
| Validation | 400 | debug | Field-specific, helpful |
| Authentication | 401 | info | Generic |
| Authorization | 403 / 404 | warn | Generic (404 to avoid confirming existence) |
| Not found | 404 | debug | Generic |
| Conflict | 409 | info | Specific and actionable |
| Rate limit | 429 | warn | Retry-after |
| Infrastructure | 502/503 | error | Generic + request ID |
| Unexpected | 500 | error | Generic + request ID |

```ts
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly publicMessage = 'Something went wrong',
  ) { super(message); }
}
```

Rich detail goes to the log. Safe, generic detail plus a request ID goes to the user.

## 5. Logging

**Never log:** passwords · API keys · access or refresh tokens · full payment
details · session cookies · personal data beyond what the purpose requires.

**Do log (structured, JSON):** login, logout, failed authentication, permission
changes, administrative actions, security events, important data changes,
suspicious activity, payment state transitions.

```ts
logger.info({ event: 'auth.login', userId, tenantId, ip, ua }, 'login succeeded');
logger.warn({ event: 'authz.denied', userId, resource: 'invoice', id }, 'access denied');
```

Include a request ID on every log line and return it with 5xx responses so a
user report maps to a log entry.

Redact at the logger, not at each call site — one missed call site is a breach.

## 6. Serverless Reality (Vercel)

Handlers are stateless and short-lived. Do not assume a persistent process.

- No in-memory cache, counter, session store, or rate limiter that must be shared.
- No background work after the response — the function is frozen or killed.
- No long polling, no persistent WebSocket server, no cron loops inside a request.
- Mind execution timeouts; offload long work to a queue table + cron route or a worker.
- Use a connection pooler (Supabase pooler / pgBouncer) — serverless opens many short connections.
- Cold starts are real: keep handler imports light.

## 7. Idempotency

Any operation that costs money, sends a message, or mutates external state must
be safe to retry.

- Accept or derive an idempotency key; store it with the result.
- Return the original result on a repeat, do not re-execute.
- Unique constraints in the database are the enforcement, not a code check
  (which races under concurrency).

## 8. Background & Scheduled Work

- Queue table + cron-triggered route is the default: no new infrastructure, survives timeouts.
- Rows carry `attempts`, `last_error`, `next_run_at`, `status`.
- Cap retries with exponential backoff; move exhausted rows to a dead-letter state.
- Protect cron routes with a secret header — a public cron endpoint is an open trigger.
