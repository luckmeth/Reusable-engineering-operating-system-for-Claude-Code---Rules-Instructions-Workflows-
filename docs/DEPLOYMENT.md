# Deployment

> **Template.** See `.claude/rules/08-deployment.md`.

## Environments

| Environment | Branch | URL | Database |
|---|---|---|---|
| Development | local | `localhost:3000` | Local Supabase |
| Preview | any PR | `*.vercel.app` | Staging Supabase project |
| Production | `main` | `app.example.com` | Production Supabase project |

Staging never points at the production database.

## Environment Variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server | Supabase endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | RLS-constrained client |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS — never client |
| `DATABASE_URL` | Server only | Pooler URL for serverless |
| `RESEND_API_KEY` | Server only | Transactional email |
| `EMAIL_FROM` | Server only | Verified sender |
| `DEV_EMAIL_SINK` | Server only | Non-prod recipient redirect |
| `<PROVIDER>_WEBHOOK_SECRET` | Server only | Signature verification |
| `CRON_SECRET` | Server only | Protects cron routes |

Validated at startup with Zod — a missing variable fails the boot, not a request
at 2am. `NEXT_PUBLIC_*` is baked at build time: changing one requires a redeploy.

## Deploy Steps

```bash
# 1. Validate locally
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 2. Migration on staging first
supabase db push --project-ref <staging-ref>

# 3. Merge to main → Vercel deploys production

# 4. Production migration (if forward-compatible with the running code)
supabase db push --project-ref <prod-ref>
```

Breaking schema changes deploy as expand → migrate → contract, so both code
versions work during the rollout.

## Cloudflare

| Setting | Value | Why |
|---|---|---|
| SSL/TLS | Full (Strict) | Flexible sends plaintext to origin |
| Proxy (orange cloud) | On for app hostnames | WAF + CDN |
| Cache | Bypass for `/api/*` and authenticated routes | Cached private responses = breach |
| Client IP | `CF-Connecting-IP` | `req.ip` is Cloudflare's |

DNS records and their purpose:

| Record | Type | Target | Purpose |
|---|---|---|---|
| `app` | CNAME | `cname.vercel-dns.com` | Application |
| `@` | MX | <provider> | Email — do not remove |
| `@` | TXT | SPF | Deliverability |
| `resend._domainkey` | TXT | DKIM | Deliverability |

## Rollback

- **Application:** Vercel dashboard → previous deployment → Promote. Instant.
- **Database:** forward-only. A rollback is a new corrective migration. Never
  write a migration you cannot follow with a corrective one.

## Post-Deploy Verification

- [ ] Health endpoint responds
- [ ] Authenticated route returns data for a real session
- [ ] A cross-tenant request returns 404 (spot-check isolation)
- [ ] One transactional email delivers
- [ ] Error monitoring shows no spike
- [ ] `Cache-Control: private, no-store` on an authenticated response
