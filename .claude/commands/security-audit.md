---
description: Deep security review — OWASP, access control, tenancy, secrets, webhooks
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(grep:*)
---

# Security Audit

Adversarial security review against `.claude/rules/02-security.md`.
**Report findings. Do not fix unless asked.**

## Scope

$ARGUMENTS (if empty: the current diff vs `main`, plus all auth, API, and database policy code)

## Mindset

You are the attacker. For every endpoint, every query, and every policy, ask:
*"How do I read, change, or destroy data that is not mine?"*

## Attack Surface Review

### Access Control
- [ ] Every ID-taking endpoint filters by owner/tenant **in the query**, not after the fetch
- [ ] Identity derived from the server session — never from body, query, or header
- [ ] `403` vs `404` does not disclose existence
- [ ] Role and permission checks present where the feature implies them
- [ ] Sequential IDs not exposed where enumeration matters
- [ ] Admin routes actually check for admin

### Multi-Tenancy
- [ ] `tenant_id` never accepted from the client
- [ ] Server-side tenant filter **and** an RLS policy — both layers
- [ ] Cross-tenant read / write / update / delete each tested
- [ ] No leakage via counts, aggregates, autocomplete, or error text

### Database / RLS
- [ ] RLS enabled **and forced** on every user-accessible table
- [ ] Separate policies for SELECT, INSERT, UPDATE, DELETE
- [ ] `UPDATE` policies have both `using` and `with check`
- [ ] `security definer` functions pin `search_path` and authorize internally
- [ ] Service-role key used only server-side, with its own authorization at each call site

### Input
- [ ] All external input validated server-side (type, format, length, range, allowed values)
- [ ] Privileged fields (`role`, `price`, `status`, `credits`, `tenant_id`) stripped from input
- [ ] No string-concatenated SQL anywhere, including inside RPC bodies
- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] Server-side fetches of user URLs: host allowlist, private ranges blocked, redirects disabled
- [ ] Redirect targets validated against an allowlist
- [ ] No deep-merge of untrusted JSON (prototype pollution)

### Authentication
- [ ] Session invalidated on logout, server-side
- [ ] Password reset and verification tokens: single-use, short-lived, account-bound
- [ ] Rate limits on login, reset, OTP, signup
- [ ] No user enumeration via differing messages or timing

### Webhooks & Payments
- [ ] Signature verified against the **raw** body, constant-time comparison
- [ ] Timestamp/replay window enforced
- [ ] Idempotency on the provider event ID, enforced by a unique constraint
- [ ] Amounts and prices sourced from the server, never the request
- [ ] Paid state set only after server-side verification

### Uploads
- [ ] Size limit, MIME check, extension allowlist
- [ ] Storage object names generated server-side — user filename never used as a path
- [ ] Served with safe `Content-Type` / `Content-Disposition`

### Secrets & Output
- [ ] No secret in source, client bundle, logs, or git history
- [ ] `.env.example` has names only
- [ ] Errors expose no stack traces, SQL, paths, tokens, or versions
- [ ] Database rows mapped before being returned — no accidental column leakage

## Output

For each finding:

```markdown
### [CRITICAL|HIGH|MEDIUM|LOW|INFO] <title>
- **Location:** path:line
- **Vulnerability:** class (e.g. IDOR, broken access control, SSRF)
- **Attack:** the exact request or steps an attacker uses
- **Impact:** what they get
- **Fix:** the specific code or policy change
- **Test:** the test that fails if the fix is reverted
```

End with:

```markdown
## Verdict
- Reviewed: <files/areas>  (VERIFIED)
- Not reviewed: <areas>    (state why)
- Blocking issues: <n>
```

Do not call anything secure that you did not verify. No security theater.
