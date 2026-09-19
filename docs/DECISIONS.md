# Architecture Decision Records

> **Template.** Record decisions that are expensive to reverse. If undoing it
> costs an afternoon, it is not an ADR.

Format: Decision · Context · Options · Chosen · Reason · Trade-offs · Date.

---

### ADR-001 — Supabase Postgres with RLS as the second authorization layer

- **Date:** 2026-01-01
- **Context:** Multi-tenant SaaS. Application-layer tenant filtering is one
  missed `where` clause away from a cross-tenant breach.
- **Options:**
  (a) Application filtering only — fastest to write, single point of failure
  (b) RLS only — safe, but hard to express role logic and easy to make recursive
  (c) Both layers
- **Chosen:** (c)
- **Reason:** The server filter catches logic errors; RLS catches the filter
  someone forgets. Two independent layers, one shared rule.
- **Trade-offs:** Policies must be maintained alongside queries; `security
  definer` helpers need care to avoid recursion; service-role code bypasses RLS
  and needs its own checks.

---

### ADR-002 — Queue table + cron route instead of an external queue

- **Date:** 2026-01-01
- **Context:** Email sends and webhook processing exceed a serverless request's
  useful lifetime and must survive retries.
- **Options:**
  (a) Inline, awaited in the request — times out, blocks the user
  (b) External queue (SQS/QStash) — robust, new infrastructure and cost
  (c) Postgres queue table drained by a cron-triggered route
- **Chosen:** (c)
- **Reason:** No new infrastructure or vendor; the database is already the
  source of truth; idempotency is enforced by a unique constraint rather than
  application logic.
- **Trade-offs:** Up to one cron interval of latency; needs a dead-letter state;
  the cron route must be protected by a shared secret.

---

### ADR-00N — <title>

- **Date:**
- **Context:**
- **Options:**
- **Chosen:**
- **Reason:**
- **Trade-offs:**
