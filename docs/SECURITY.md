# Security

> **Template.** Security is demonstrated by enforced controls plus tests that
> fail when a control is removed. See `.claude/rules/02-security.md`.

## Threat Model

**Assets:** <customer data, payment records, credentials, documents>

**Adversaries:**
- Authenticated user reaching another user's or tenant's data
- Unauthenticated attacker probing endpoints and enumerating IDs
- Malicious upload or forged webhook
- Compromised dependency

**Trust boundaries:**
```
Browser ──[hostile]──► Route handler ──[trusted]──► Service ──► Database (RLS)
Webhook ──[hostile until signature-verified]──► Handler
```

## Authentication

- Provider: Supabase Auth
- Session: <cookie, httpOnly, sameSite, lifetime>
- Logout invalidates server-side
- Reset/verification tokens: single-use, <n> minute lifetime, account-bound
- Rate limits on login, reset, signup, OTP

## Authorization

Authentication answers *who are you*. Authorization answers *what may you do*.
Supabase Auth provides only the first.

| Layer | Enforces |
|---|---|
| Route handler | Session present, role permits the operation |
| Service | Ownership and tenant scope in the query |
| RLS | The same rule again, at the database |

Roles: <owner / admin / member / viewer — and what each may do>

Rule: `404`, not `403`, for resources the caller may not see. `403` confirms existence.

## Tenant Isolation

`tenant_id` comes from the session. It is never accepted from a request body,
query string, or header. Two enforcing layers, always.

Tested in `tests/security/`: cross-tenant read, write, update, delete, and
metadata leakage via counts and error messages.

## Input Validation

Every external input is validated server-side with Zod. Privileged fields
(`tenant_id`, `role`, `price`, `status`, `credits`) are never in an input schema —
they are derived server-side.

| Layer | Job |
|---|---|
| Client | UX |
| Server | Security boundary |
| DB constraints | Data integrity |

## Secrets

| Secret | Where | Never |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env, server-only module | Client bundle |
| `RESEND_API_KEY` | Vercel env, server-only | Client bundle |
| `<PROVIDER>_WEBHOOK_SECRET` | Vercel env, server-only | Logs |

`.env.example` holds names only. Secret scanning runs in CI. A secret that
reached git history is rotated, not just deleted.

## Webhooks

1. Signature verified against the **raw** body, constant-time comparison
2. Timestamp outside <n> minutes rejected
3. Idempotency on `provider_event_id`, enforced by a unique constraint
4. No state mutation before verification

## File Uploads

Size limit <n>MB · MIME allowlist <types> · extension allowlist · object names
generated server-side (`${uuid}.${ext}`) · user filename never used as a path ·
served with `Content-Disposition: attachment`.

## Logging

**Never logged:** passwords, API keys, tokens, session cookies, full payment data.
**Always logged:** login, logout, failed auth, permission changes, admin actions,
payment state transitions — structured, with a request ID.

## Verified Controls

| Control | Enforced at | Proven by | State |
|---|---|---|---|
| Cross-tenant read blocked | RLS + service | `tests/security/rls.test.ts` | VERIFIED |
| IDOR on invoices | Query filter | `tests/security/access-control.test.ts` | VERIFIED |
| Webhook forgery rejected | Signature check | `tests/security/webhook.test.ts` | VERIFIED |
| Rate limit on login | Middleware | — | NOT TESTED |

Anything without a test is `NOT TESTED`. Do not list it as secure.

## Known Gaps

<Accepted risks, with the reason and the condition that would change the decision.>
