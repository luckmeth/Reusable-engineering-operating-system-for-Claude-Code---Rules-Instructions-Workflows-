---
description: Full engineering audit — architecture, security, database, tests, deployment readiness
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(npm run:*), Bash(pnpm:*)
---

# Engineering Audit

Audit this repository against `.claude/rules/`. **Report findings. Do not fix anything yet.**

## Scope

$ARGUMENTS (if empty, audit the whole repository)

## Method

Be token-efficient: read `docs/` first, then grep for patterns, then read only
the files that greps implicate. Do not read the whole tree.

### 1. Architecture (`.claude/rules/01-architecture.md`)
- Does the structure match the documented architecture?
- Client/server boundary: does any client-reachable module import `server/`, a secret, or the service-role client?
- Duplicate implementations of the same concern
- Dependencies that the existing stack already covers
- Business logic leaking into components or SQL

### 2. Security (`.claude/rules/02-security.md`)
- Endpoints taking an ID without an ownership/tenant filter in the query
- Identity, `tenant_id`, `role`, `price`, or `status` accepted from the request body
- Missing server-side validation
- Secrets in source, in client-reachable modules, or in git history
- Webhooks without signature verification, replay protection, or idempotency
- Uploads without size/type/name controls
- Missing rate limits on auth, email, and expensive endpoints
- Error responses leaking stack traces, SQL, or internal paths

### 3. Database (`.claude/rules/03-database.md`)
- Tables without `enable row level security`
- Policies missing for any of SELECT / INSERT / UPDATE / DELETE
- `UPDATE` policies missing `with check`
- Foreign keys without indexes
- `select *`, N+1 patterns, unpaginated list queries
- Missing constraints for stated invariants
- Migrations that are not reproducible or not ordered

### 4. Backend & Frontend (`05-backend.md`, `04-frontend.md`)
- Raw database rows returned to clients
- Swallowed errors (`catch {}`), unstructured logging, secrets in logs
- In-memory state assumed to persist across serverless invocations
- Async UI missing loading / empty / error / success / disabled states
- Accessibility: unlabeled inputs, `div` used as a button, keyboard traps

### 5. Testing (`.claude/rules/06-testing.md`)
- Features with no test for unauthenticated / unauthorized / cross-tenant access
- Tests asserting implementation instead of behaviour
- Untested error paths

### 6. Deployment & Cost (`.claude/rules/08-deployment.md`)
- Env vars used in code but missing from `.env.example`
- No startup validation of environment
- Authenticated responses that could be cached at a shared layer
- Infrastructure added without justification

## Output

```markdown
# Engineering Audit — <scope>

## Summary
<3 lines: overall state, biggest risk, recommended first action>

## CRITICAL
### <finding>
- **Location:** path:line
- **Problem:** what is wrong
- **Why it matters:** the real consequence
- **Failure scenario:** concrete inputs → concrete bad outcome
- **Fix:** the specific change

## HIGH / ## MEDIUM / ## LOW / ## INFO
<same structure>

## What Is Done Well
<brief — do not pad>

## Recommended Order
1. ...
```

Rank by real exploitability and blast radius, not by how easy it is to describe.
Do not manufacture findings to lengthen the report. If a section is clean, say so
in one line.
