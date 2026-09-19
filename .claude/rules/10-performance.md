# 10 — Performance

Load for: latency, bundle size, query performance, scaling, cost-driven optimization.

## 1. Measure First

Do not optimize blindly. An optimization without a measurement is a guess that
costs maintainability.

```
Observe slowness → Measure → Find the actual bottleneck → Fix that one thing
→ Measure again → Keep it only if it moved the number
```

Tools: `explain analyze` for queries, browser Performance panel and Lighthouse
for the frontend, request timing logs for API routes, bundle analyzer for size.

## 2. Where The Time Actually Goes

In this stack, in rough order of frequency:

1. **N+1 queries** — 200 queries where 2 would do.
2. **Missing index** — sequential scan on a growing table.
3. **Over-fetching** — `select *` plus rows the UI never renders.
4. **Waterfalls** — sequential awaits that could be `Promise.all`.
5. **Bundle bloat** — a heavy library for one function.
6. **Unoptimized images** — the largest single payload on most pages.
7. **Re-renders** — a context value rebuilt every render.
8. **Cold starts** — heavy imports on a latency-sensitive route.

## 3. Database

```sql
explain analyze select ... ;   -- before and after. Always.
```

- Index what you filter, join, and sort on. Tenant-scoped: lead with `tenant_id`.
- Fix N+1 with a join or a single `in (...)`; never a loop of awaits.
- Paginate everything. Keyset pagination beats `offset` past a few thousand rows.
- Select the columns you use.
- Aggregate in the database, not in JavaScript over 50,000 rows.
- Cache expensive read-mostly aggregates deliberately, with a defined invalidation.

## 4. Network

```ts
// Waterfall — 3 round trips
const user = await getUser(id);
const org  = await getOrg(user.orgId);
const plan = await getPlan(org.planId);

// Parallel where independent — 1 round trip's worth of latency
const [invoices, customers] = await Promise.all([getInvoices(t), getCustomers(t)]);
```

Batch related requests. Set timeouts on every outbound call — a hanging third
party must not hang your handler until the platform kills it.

## 5. Frontend

- `next/image` with correct `sizes`; modern formats.
- Code-split heavy client-only components with `dynamic()`.
- `next/font` to avoid layout shift.
- Stable list keys; virtualize lists beyond a few hundred rows.
- Memoize only what profiling shows is expensive.
- Watch the budget: JS on first load, LCP, CLS, INP.

## 6. Caching

Every cache needs three answers before you add it: **What is cached? For how
long? What invalidates it?** No answer to the third means a correctness bug later.

- Never cache authenticated or user-specific responses at a shared layer (CDN, Cloudflare).
- `Cache-Control: private, no-store` on anything personal.
- Prefer short TTLs plus explicit invalidation over long TTLs plus hope.

## 7. Serverless Cost & Scale

Performance and cost are the same conversation here: every millisecond of
execution is billed, and every unindexed query is billed twice — once in
latency, once in database load.

Before shipping a high-volume path, compute cost and latency at 10× current
volume. If the answer is unacceptable, fix it now — it is cheaper than after
the data grows.

## 8. Do Not Prematurely Optimize

Avoid obvious problems (N+1, missing index, 4MB image, sequential awaits) from
the start — these are not optimizations, they are defects.

Everything else waits for a measurement. Complexity added for unmeasured
performance is pure cost.
