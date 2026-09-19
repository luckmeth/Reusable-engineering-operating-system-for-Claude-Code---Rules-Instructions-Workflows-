# Test Helpers

The security tests import from `../helpers`. That module is project-specific —
it needs your API client, your Supabase config, and your auth flow. Implement it
with this contract:

```ts
export type Ctx = {
  tenantId: string;
  customerId: string;
  user: AuthedUser;
  db: { invoice(id: string): Promise<InvoiceRow> };
  addUser(opts: { role: Role }): Promise<AuthedUser>;
  expectedTotalCents: number;
};

// Creates a tenant, an auth user, a membership with the given role, and one
// customer. Each call must produce an isolated tenant — the isolation tests
// compare two of them.
export function createTenantWithUser(opts: { role: Role }): Promise<Ctx>;

// Supabase client authenticated as the given user; null = anon.
// This is the client the RLS tests use to bypass application code.
export function supabaseAs(user: AuthedUser | null): SupabaseClient;

// Service-role client. Bypasses RLS — used only to set up and verify state,
// never as the subject of a security assertion.
export const serviceClient: SupabaseClient;

// Thin HTTP client that attaches the user's session.
export const api: {
  get(path: string, o?: { as?: AuthedUser }): Promise<Response>;
  post(path: string, o: { as?: AuthedUser; body: unknown }): Promise<Response>;
  patch(path: string, o: { as?: AuthedUser; body: unknown }): Promise<Response>;
  delete(path: string, o?: { as?: AuthedUser }): Promise<Response>;
  raw(path: string, init: RequestInit): Promise<Response>;   // unparsed body, for webhook signing
};
```

Two constraints that matter:

1. **`createTenantWithUser` must create genuinely separate tenants.** If both
   test contexts end up in one tenant, every isolation test passes vacuously —
   the worst possible failure mode for a security suite.
2. **`api.raw` must send the body bytes unmodified.** Webhook signatures are
   computed over the raw body; a client that re-serializes JSON will break
   signing and mask real bugs.
