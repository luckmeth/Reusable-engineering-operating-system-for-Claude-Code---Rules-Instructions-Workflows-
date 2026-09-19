---
description: Production readiness check before deploying
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(npm run:*), Bash(pnpm:*)
---

# Deploy Check

Production readiness gate. Verify what you can, state honestly what you cannot.

## Target

$ARGUMENTS (if empty: everything on this branch not yet in `main`)

## Checks

### Functionality
- [ ] Stated requirements implemented
- [ ] Edge cases handled (empty, max, boundary, concurrent)
- [ ] Error states handled in UI and API

### Security
- [ ] Authentication enforced where required
- [ ] Authorization enforced — ownership and tenant, in the query
- [ ] All external input validated server-side
- [ ] No secret in source or in the client bundle
- [ ] `grep -rn "SERVICE_ROLE\|_SECRET\|_KEY" src/` shows only server-side use
- [ ] RLS reviewed for every new or changed table
- [ ] Sensitive data not logged, not returned, not cached

### Database
- [ ] Migration exists, is ordered, and is reproducible
- [ ] Migration tested on a fresh database (`supabase db reset`)
- [ ] Constraints and indexes match the real queries
- [ ] Destructive operations authorized, or deferred behind expand→migrate→contract
- [ ] Rollback path known (forward-fix migration)

### Testing
- [ ] Unit / integration / E2E present as the change requires
- [ ] Security tests for new access-controlled resources
- [ ] Full suite run and passing

### Deployment
- [ ] Every new env var is in `.env.example` **and** set in Preview and Production
- [ ] Startup env validation covers the new variables
- [ ] Build succeeds
- [ ] Vercel runtime, region, and timeout appropriate for the new routes
- [ ] Cloudflare: no authenticated response cacheable; TLS Full (Strict); real client IP handled
- [ ] No persistent workload placed inside a serverless function

### Observability
- [ ] Errors surface somewhere a human will see
- [ ] Request IDs correlate user reports to logs
- [ ] Security events (auth failure, permission change, admin action) logged

### Cost
- [ ] Per-unit cost acceptable at 10× current volume
- [ ] No unindexed query on a growing table
- [ ] No new paid infrastructure without justification

## Output

```markdown
# Deploy Check — <branch>

## Status
READY | NOT READY
<one line: the single most important reason>

## Blocking
1. <issue> — path:line — <fix>

## Non-Blocking
- <issue> — log in docs/TASKS.md

## Verification
| Item | State | Evidence |
|---|---|---|
| Typecheck | VERIFIED | `tsc --noEmit` clean |
| Tests | VERIFIED | 47 passed |
| Build | NOT TESTED | not runnable here |
| Env vars in Vercel | ASSUMED | cannot read the dashboard |
| Migration on fresh DB | BLOCKED | no database in this environment |

## Manual Steps Before Deploy
1. Set `RESEND_API_KEY` in Vercel Production
2. Run the migration against staging first
```

Never report READY on the basis of assumptions. Anything you could not check is
`ASSUMED` or `BLOCKED`, and blocking items keep the status at NOT READY.
