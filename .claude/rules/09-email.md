# 09 — Email (Resend)

Load for: transactional email, verification, notifications, email infrastructure.

## 1. Server-Side Only

Email sending happens on the server. Always.

- `RESEND_API_KEY` is server-only. Never `NEXT_PUBLIC_*`, never in a client bundle.
- An exposed email API key means an attacker sends mail from your domain. That
  destroys your sending reputation, not just your quota.

## 2. What Resend Handles

Verification emails · password resets · notifications · transactional messages
(receipts, invoices, alerts).

Not marketing blasts from your application server — that is a different system
with different compliance requirements.

## 3. Reliability

Handle explicitly:

| Concern | Approach |
|---|---|
| Delivery failure | Catch, log with context, retry with backoff |
| Retries | Bounded (3–5), exponential backoff, dead-letter on exhaustion |
| Rate limits | Respect provider limits; queue rather than hammer |
| Duplicate sends | Idempotency key per logical message |
| Slow provider | Never block the user's request on the send |

**Send asynchronously.** A user clicking "Sign up" should not wait on an SMTP
provider, and must not see a failure because email was slow.

```ts
// Persist first, send after — the record is the source of truth
await db.insert('email_queue', {
  idempotency_key: `invoice_sent:${invoice.id}`,   // unique constraint
  template: 'invoice_sent',
  to: customer.email,
  payload,
});
// a cron route drains the queue
```

A client retrying a request must not produce a second email. Enforce that with a
unique constraint on the idempotency key, not an `if` check.

## 4. Development Email Safety

**Development email must never reach a real customer.** This is the single most
common way a test environment embarrasses a business.

Layered defence:

1. Separate API keys for development and production. Never share one.
2. In non-production, route every recipient to a safe address or a catcher
   (Resend test address, Mailtrap, or your own inbox).
3. An allowlist guard in the send function itself:

```ts
function resolveRecipient(to: string): string {
  if (env.NODE_ENV === 'production') return to;
  if (env.EMAIL_ALLOWLIST?.split(',').includes(to)) return to;
  return env.DEV_EMAIL_SINK;   // everything else is redirected
}
```

4. Prefix non-production subjects: `[DEV] Your invoice is ready`.
5. Never seed a development database with real customer email addresses.

## 5. Deliverability

- Verify the sending domain (SPF, DKIM, DMARC). Unverified domains land in spam.
- Send from a real, monitored address — not `noreply@` if a human might reply.
- Every email needs a plain-text alternative.
- Handle bounces and complaints: stop sending to hard-bounced addresses.
- Document Cloudflare's exact role if it handles your MX or email routing —
  overlapping DNS/email configuration is a common outage cause, so write down
  which records live where and why.

## 6. Content Safety

- Never put a secret, password, or long-lived token in an email body.
- Reset and verification links are single-use, short-lived, and tied to the account.
- Escape user-supplied content rendered into HTML email — email clients render HTML.
- Do not include personal data beyond what the message requires.
