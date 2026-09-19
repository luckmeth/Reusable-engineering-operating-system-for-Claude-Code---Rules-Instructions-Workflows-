# 08 — Deployment (Vercel / Cloudflare / Production Readiness)

Load for: deployment, environments, infrastructure, cost, observability.

## 1. Vercel

Default hosting. Use: environment variables per environment, preview
deployments for every branch, production deploys from `main`, the correct
runtime per route, and deliberate caching.

**Serverless is not a server.** Account for:

| Reality | Consequence |
|---|---|
| Stateless execution | No in-memory sessions, caches, counters, or rate limiters |
| Execution timeouts | Long work must be queued, not awaited |
| Cold starts | Keep imports light on latency-sensitive routes |
| Connection churn | Use the Supabase pooler, not direct connections |
| Frozen after response | No background work after returning |
| Prod ≠ dev | Different env vars, different caching, different timeouts |

Never run a persistent workload (queue consumer, WebSocket server, scheduler
loop) inside a Vercel function.

Environment variables: set per environment (Development / Preview / Production).
Only `NEXT_PUBLIC_*` reaches the browser. Changing a build-time variable
requires a redeploy — it is baked into the bundle.

## 2. Cloudflare

Use for: DNS, domain management, CDN/proxy, TLS, caching, security controls
(WAF, rate limiting, bot management), email routing, and Workers **only when
justified**.

Do not add Cloudflare Workers merely because Cloudflare serves your DNS. That is
a second runtime, a second deploy pipeline, and a second failure mode.

Understand the effects of proxying on:

- **TLS** — use Full (Strict). "Flexible" means plaintext between Cloudflare and origin.
- **Headers** — real client IP arrives as `CF-Connecting-IP`; `req.ip` is Cloudflare.
- **Caching** — page rules can cache responses you never intended to cache.
- **WebSockets** — must be explicitly enabled.
- **APIs** — bot protection and challenges can break legitimate API clients.

**Never cache authenticated or private responses.** Set explicitly:

```
Cache-Control: private, no-store   # anything user-specific
```

A cached authenticated page served to another user is a data breach, and it is
an easy one to cause.

## 3. Environment Variables

- `.env.example` lists every variable with a comment, and **no values**.
- Validate at startup and fail fast — a missing variable should crash the boot, not produce a 500 in production at 2am.

```ts
const Env = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),   // server only
  RESEND_API_KEY: z.string().startsWith('re_'),
});
export const env = Env.parse(process.env);
```

- Separate keys per environment. Never point staging at the production database.
- Rotating a key is a deploy, not just a dashboard edit — plan for it.

## 4. Production Readiness Checklist

Run `/deploy-check` before any production deploy.

**Functionality** — requirements implemented · edge cases handled · error states handled

**Security** — authentication checked · authorization checked · input validated ·
secrets protected and absent from the bundle · RLS reviewed · sensitive data protected

**Database** — schema correct · constraints correct · indexes appropriate ·
queries efficient · migration created, reviewed, and tested on a fresh DB

**Testing** — unit where required · integration where required · E2E where
required · security tests where appropriate

**Deployment** — env vars configured in every environment · build succeeds ·
Vercel config reviewed · Cloudflare config reviewed · production behaviour verified

**Observability** — useful errors · useful logs · security events observable ·
a failed deploy is visible without a customer reporting it

## 5. Rollback

Know how to undo before you deploy.

- Application: Vercel instant rollback to the previous deployment.
- Database: migrations are forward-only in production — a rollback is a new
  migration. Never make a migration that cannot be followed by a corrective one.
- Deploy code that tolerates both schema versions when the change is breaking
  (expand → migrate → contract).

## 6. Cost Control

Consider before adding: Vercel function invocations and bandwidth · Supabase
database, storage, bandwidth, and egress · Cloudflare usage · Resend send limits ·
third-party API pricing · AI/LLM API costs.

- Do not introduce infrastructure that adds cost without meaningful value.
- For high-volume operations, compute the per-unit cost at 10× current volume before shipping.
- An unindexed query on a growing table is a cost bug as well as a latency bug.

## 7. Observability

For production systems consider: structured logging · error monitoring · uptime
monitoring · database monitoring · performance monitoring.

Add external observability services only when justified. Start with structured
logs and platform-native metrics; add a vendor when you have a question those
cannot answer.

Minimum for a production system:
- Errors reach somewhere a human will look.
- Request IDs correlate a user report to a log line.
- Security events (auth failures, permission changes, admin actions) are queryable.
