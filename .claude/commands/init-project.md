---
description: Scaffold a new project under this engineering system
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(git:*), Bash(ls:*), Bash(mkdir:*)
---

# Initialize Project

Set up a new project under this engineering system. Establish decisions **before**
scaffolding files.

## Input

$ARGUMENTS (project description — ask if missing)

## 1. Establish, In Order

Ask only what you cannot reasonably infer. Batch the questions into one message.

1. **Requirements** — what it does, for whom, what must never happen
2. **Architecture** — shape, boundaries, data flow
3. **Technology** — default stack unless requirements justify otherwise
4. **Database model** — entities, relationships, ownership
5. **Authentication** — provider, session model
6. **Authorization** — roles, ownership rules, tenancy (single or multi-tenant?)
7. **Security model** — threats that matter here, trust boundaries
8. **Environment variables**
9. **Repository structure** — proportional to complexity
10. **Testing strategy**
11. **Deployment strategy** — environments, domains, pipeline

Multi-tenancy is the one decision to force early: retrofitting it is a rewrite.

## 2. Scaffold

```
CLAUDE.md                  project-specific: stack, boundaries, conventions
.claude/rules/             copied from this system, trimmed to what applies
.claude/commands/          audit, security-audit, review, test, deploy-check, plan, handoff
docs/ARCHITECTURE.md       shape and why
docs/DATABASE.md           entities, relationships, RLS model
docs/SECURITY.md           threat model, authz model, assumptions
docs/API.md                endpoints and contracts
docs/DEPLOYMENT.md         environments, env vars, steps
docs/DECISIONS.md          ADR-001 for the stack choice
docs/PROJECT_STATE.md      initial state
docs/TASKS.md              the first real tasks
.env.example               names only
.gitignore
supabase/migrations/       initial schema + RLS in the same migration
tests/{unit,integration,security}/
```

Fill each doc with real project content. A scaffold full of `TODO` costs the
next session more than no scaffold.

## 3. First Migration

Create the initial schema **with RLS enabled and policies in the same
migration**. A table shipped without a policy is a public API, and adding it
later means auditing everything written in between.

## 4. Report

```markdown
## Created
<files>

## Decisions Made
<decision → reason>  (also written to docs/DECISIONS.md)

## Needs Your Input
<anything genuinely ambiguous>

## Next
1. Configure Supabase project and set env vars
2. Run the initial migration
3. Implement authentication
```
