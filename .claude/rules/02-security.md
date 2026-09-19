# 02 — Security

Load for: authentication, authorization, input handling, uploads, webhooks,
payments, secrets, or any review of a security-sensitive change.

Treat all external input as hostile. Think like an attacker, then write the
control, then write the test that proves the control.

## 1. Authentication vs Authorization

```
Authentication — "Who are you?"   → Supabase Auth / session
Authorization  — "What may you do?" → your code + RLS
```

Supabase Auth gives you authentication. It gives you **no** authorization.
Every resource access needs an explicit ownership or permission check.

```ts
// WRONG — client supplies identity
const { userId, orderId } = await req.json();
const order = await db.from('orders').select().eq('id', orderId).single();

// RIGHT — identity from session, ownership enforced
const { data: { user } } = await supabase.auth.getUser();
if (!user) return unauthorized();

const { data: order } = await supabase
  .from('orders')
  .select('*')
  .eq('id', orderId)
  .eq('tenant_id', session.tenantId)   // server-side boundary
  .single();                            // RLS enforces it again at the DB
if (!order) return notFound();          // not 403 — do not confirm existence
```

Required authentication surface: secure sessions, working logout (server-side
invalidation), account recovery, email verification where appropriate,
role/permission checks, ownership checks.

## 2. Broken Access Control / IDOR

The most common and most expensive class of bug in this stack.

For every endpoint that takes an ID, ask:
- What happens if I pass another user's ID?
- Another tenant's ID?
- A deleted ID? A non-existent ID? A negative or huge ID?
- Can I enumerate IDs to map the dataset?

Rules:
- Filter by owner/tenant in the query itself — never fetch then compare.
- Return `404` for resources the caller may not see. `403` confirms existence.
- Prefer UUIDs over sequential integers for externally visible identifiers.
- Every IDOR-capable endpoint gets a test in `tests/security/`.

## 3. Input Validation

Validate server-side, always. Client validation is UX, not security.

Validate: type · format · length · range · allowed values · encoding · ownership · authorization.

```ts
const CreateInvoice = z.object({
  customerId: z.string().uuid(),
  amountCents: z.number().int().positive().max(100_000_00),
  currency: z.enum(['LKR', 'USD']),
  note: z.string().max(500).optional(),
});
// tenant_id is NOT in the schema — it comes from the session.
```

Never accept from the client: `tenant_id`, `organization_id`, `user_id`, `role`,
`is_admin`, `price`, `status`, `credits`, or anything else that grants value or
access. Derive them server-side.

Three layers, three jobs:

| Layer | Job |
|---|---|
| Client | UX feedback |
| Server | Security boundary |
| Database constraints | Data integrity |

## 4. OWASP Review Checklist

Review relevant features against: Broken Access Control · IDOR · Authentication
bypass · Session attacks · XSS · SQL injection · Command injection · SSRF ·
Path traversal · File upload attacks · Prototype pollution · Open redirects ·
Rate-limit abuse · Credential stuffing · Brute force · Sensitive data exposure ·
Security misconfiguration · Dependency vulnerabilities.

Specifics that bite in this stack:

- **XSS** — never `dangerouslySetInnerHTML` with user content. Sanitize if you must render HTML.
- **SQL injection** — parameterized queries only. No string-built SQL, including inside RPC functions.
- **SSRF** — if the server fetches a user-supplied URL, allowlist the host, block private ranges (`169.254.0.0/16`, `10/8`, `127/8`, `192.168/16`), disable redirects.
- **Open redirect** — validate `returnTo` against an allowlist of internal paths.
- **Prototype pollution** — never deep-merge untrusted JSON into an object.

## 5. Secrets

Never hardcode or commit: API keys · passwords · service-role keys · private
keys · database credentials · OAuth secrets · JWT secrets · production tokens.

- Environment variables + deployment secret management only.
- `.env.example` contains variable **names** and a comment — never values.
- `.env*` is gitignored except `.env.example`.
- Service-role key lives in exactly one server-only module.
- A secret that reached git history is compromised — rotate it, don't just delete the commit.
- Run secret scanning in CI (`.github/workflows/ci.yml`).

## 6. Webhooks

Every inbound webhook is an untrusted, replayable, forgeable HTTP request.

1. Verify the signature against the raw body **before** parsing.
2. Use a constant-time comparison.
3. Reject stale timestamps (replay window, e.g. 5 minutes).
4. Enforce idempotency on the provider's event ID.
5. Never mutate state from an unverified payload.

```ts
const raw = await req.text();                        // raw body, not parsed
if (!timingSafeEqual(sign(raw, secret), header)) return new Response('invalid', { status: 400 });
if (Date.now() - ts > 5 * 60_000) return new Response('stale', { status: 400 });
if (await alreadyProcessed(eventId)) return new Response('ok');  // idempotent
```

## 7. Payments

Never trust frontend payment confirmation. The browser saying "success" is a
claim by an attacker-controlled client.

- Amount, currency, and item prices come from the server/database, never the request.
- Mark paid only after server-side verification (verified webhook or provider API check).
- Idempotency on transaction/order ID — a retried webhook must not double-credit.
- Record the provider's transaction ID and reconcile.
- Log payment state transitions; never log full card data.

## 8. File Uploads

Treat every uploaded file as hostile.

Validate: size limit · MIME type · extension (allowlist, not denylist) ·
filename · content sniffing where it matters.

Consider: malicious files, polyglots, oversized uploads, decompression bombs,
executable content, path traversal via filename.

- Generate storage object names server-side (`${uuid}.${safeExt}`). Never use the
  user's filename as a path.
- Store outside the web root / in a bucket with its own access policy.
- Serve with `Content-Disposition: attachment` and a correct `Content-Type` for
  anything user-supplied.
- Scan if the threat model warrants it.

## 9. Rate Limiting

Apply to: login, password reset, email sending, OTP, signup, search, any
expensive query, any endpoint that costs money per call.

Key by user ID where authenticated, by IP otherwise (respect
`CF-Connecting-IP` behind Cloudflare). Fail closed on the limiter being
unavailable for auth endpoints.

## 10. Error & Response Hygiene

Never expose stack traces, SQL errors, internal paths, tokens, credentials,
library versions, or "user not found" vs "wrong password" distinctions.

```ts
// Server log: full detail.  Client response: safe and generic.
logger.error({ err, requestId, userId }, 'invoice.create failed');
return json({ error: 'Unable to create invoice', requestId }, { status: 500 });
```

## 11. Security Review Mode

For security-sensitive changes, explicitly consider: authentication bypass ·
authorization bypass · cross-user access · cross-tenant access · ID enumeration ·
replay attacks · rate-limit bypass · malicious uploads · injection · secret
leakage · client-side trust · forged webhooks · database policy bypass ·
server-only functionality exposed to clients.

Classify findings `CRITICAL / HIGH / MEDIUM / LOW / INFO`, and for each state:
**Problem · Why it matters · Realistic failure scenario · Recommended fix**.

Do not manufacture findings to pad the review.

## 12. No Security Theater

These are **not** security controls:

| Claim | Reality |
|---|---|
| "We use TypeScript" | Compile-time only. Runtime input is still hostile. |
| "HTTPS is on" | Protects transit. Nothing else. |
| "Supabase Auth handles it" | Authentication only. Authorization is yours. |
| "Cloudflare is in front" | DDoS/WAF. Not access control. |
| "The form validates it" | Bypassed with one `curl`. |
| "Passwords are hashed" | Irrelevant to authorization bugs. |
| "The endpoint isn't documented" | Obscurity is not a control. |

Security is demonstrated by an enforced control plus a test that fails when the
control is removed.
