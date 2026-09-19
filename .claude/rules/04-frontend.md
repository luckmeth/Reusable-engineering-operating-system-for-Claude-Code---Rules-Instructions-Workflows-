# 04 — Frontend (React / Next.js / Tailwind)

Load for: UI work, components, client state, accessibility.

## 1. Component Discipline

- One responsibility per component. If you cannot name it in three words, split it.
- Roughly: over ~200 lines or more than one data concern → split.
- `components/` = reusable and presentational. `features/` = feature-scoped composition.
- Data fetching belongs in server components, loaders, or hooks — not inline in deeply nested UI.
- Props describe data, not implementation: `<Invoice invoice={invoice} />`, not fifteen scalar props.

## 2. Server vs Client Components (App Router)

Default to server components. Add `'use client'` only when you need state,
effects, refs, browser APIs, or event handlers.

Never import a module that touches a secret, the service-role client, or
`server/` from a client component. Use `import 'server-only'` to make the
mistake a build error instead of a leak.

## 3. Every Async Interaction Has Five States

```
loading · empty · error · success · disabled
```

Missing any of these is an incomplete feature, not a polish item.

```tsx
if (isLoading) return <Skeleton />;
if (error)     return <ErrorState onRetry={refetch} message="Couldn't load invoices." />;
if (!data.length) return <EmptyState action={<NewInvoiceButton />} />;
return <InvoiceList items={data} />;
```

Mutations: disable the trigger while in flight, show the result, and make
failure recoverable. Never leave a button spinning forever on error.

## 4. State

Escalate only as far as needed:

```
local useState → lifted props → context (rarely changing) → server state (React Query/SWR)
→ global store (only when genuinely shared and frequently changing)
```

Server data is not client state. Cache it with a server-state library; don't
mirror it into a global store and desynchronize.

Do not introduce a global store because the app "might get bigger".

## 5. Forms

- Schema-validate on the client for UX with the **same** Zod schema the server uses for security.
- Show errors next to fields, associated via `aria-describedby`.
- Disable submit while pending; prevent double-submit.
- Never trust the client result — the server re-validates. Always.

## 6. Responsive & Input

Design for mobile, tablet, desktop, keyboard, touch, and network failure.

- Mobile-first Tailwind: base styles, then `sm: md: lg:`.
- Touch targets ≥ 44×44px.
- No hover-only affordances — touch devices have no hover.
- Handle offline/slow networks: timeouts, retry, and a visible failure state.

## 7. Accessibility

Not optional, and cheap when done from the start.

- Semantic HTML first: `<button>`, `<nav>`, `<main>`, `<label>`. A `div` with `onClick` is a bug.
- Every input has a label (visible or `aria-label`).
- Keyboard: everything reachable via Tab, visible focus ring, logical order.
- Modals: focus trapped, `Esc` closes, focus restored on close.
- Contrast ≥ 4.5:1 for body text.
- Announce async errors with `role="alert"` or `aria-live="polite"`.
- Images: meaningful `alt`, or `alt=""` when decorative.
- Never convey meaning by colour alone.

## 8. Performance

- `next/image` for images. Set `sizes`. Never ship a 4MB hero.
- `next/font` to avoid layout shift and third-party font requests.
- Dynamic-import heavy client-only widgets (charts, editors, maps).
- Memoize only after measuring — `useMemo` everywhere is noise with a cost.
- Keys from stable IDs, never array index, for reorderable lists.
- Watch the bundle: a date library for one `format()` call is not worth 70kB.

## 9. Security in the UI

- Never `dangerouslySetInnerHTML` with user content.
- Never put a secret in client code — assume everything shipped is public.
- Client-side route guards are UX. The server still authorizes every request.
- Validate external URLs before rendering them as links; `rel="noopener noreferrer"` on `target="_blank"`.
