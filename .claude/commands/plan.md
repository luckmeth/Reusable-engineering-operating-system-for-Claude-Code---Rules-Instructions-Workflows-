---
description: Impact analysis and implementation plan before writing code
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git log:*), Bash(git diff:*)
---

# Plan

Produce an impact analysis and a plan. **Write no code in this command.**

## Requirement

$ARGUMENTS

## Steps

### 1. Understand
Read `docs/PROJECT_STATE.md` and the relevant `docs/` files first. Then grep for
the code this touches. Read only what the greps implicate — do not sweep the tree.

State the requirement back in one sentence, including what must *not* happen.

### 2. Check For Prior Art
Does this already exist, fully or partly? Search before designing. Extending an
existing module beats adding a parallel one.

### 3. Impact Analysis

| Area | Impact |
|---|---|
| Frontend | components, states, routes |
| Backend | endpoints, services, contracts |
| Database | tables, columns, constraints, indexes, migration |
| Security | authn, authz, tenancy, validation, new attack surface |
| Deployment | env vars, runtime, build, Cloudflare/Vercel config |
| Testing | what must be proven |
| Performance | query cost, payload, latency |
| Cost | per-unit cost at scale |

Mark anything with "none" explicitly — a blank means you did not consider it.

### 4. Options
Only when materially different approaches exist. Two or three, with trade-offs
and a recommendation. Skip this section when there is one obvious approach.

### 5. Plan

```markdown
## Plan
1. <step> — `path/to/file` — <what changes>
2. ...

## Files Touched
- created: ...
- modified: ...

## Migration
<sql sketch, or "none">

## Security Controls Added
- <control> enforced at <layer>, proven by <test>

## Tests To Write
- <test> — <what it proves>

## Out Of Scope
- <thing> — log in docs/TASKS.md

## Needs A Decision
- <question> — <why it blocks>
```

Keep the plan proportional. A two-line fix does not need a nine-section
document — say what you will change and stop. Escalate only on the triggers in
`.claude/rules/00-core.md §6`.
