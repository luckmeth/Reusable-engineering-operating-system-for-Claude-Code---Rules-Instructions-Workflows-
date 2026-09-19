---
description: Update PROJECT_STATE.md and TASKS.md for the next session
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git log:*), Bash(git diff:*), Bash(git status:*)
---

# Handoff

Write the session state so the next session — human or AI — starts productive
without reconstructing the project.

## Steps

1. `git log --oneline -15` and `git status` — what actually changed.
2. Read the current `docs/PROJECT_STATE.md` and `docs/TASKS.md`.
3. Rewrite `docs/PROJECT_STATE.md` — replace it, do not append. This is state,
   not a diary.
4. Update `docs/TASKS.md`: move completed items out, promote what is next,
   record anything discovered but out of scope.
5. Add an ADR to `docs/DECISIONS.md` only if a hard-to-reverse decision was made.

## PROJECT_STATE.md Format

```markdown
# Project State
_Updated: YYYY-MM-DD_

## Architecture
<one or two lines: stack and shape>

## Current Feature
<what is being built right now>

## Completed
- <capability> — VERIFIED/NOT TESTED

## In Progress
- <item> — <exact next step> — <file(s)>

## Known Issues
- <issue> — <impact> — <where>

## Next Recommended Task
<one specific, actionable task>

## Gotchas
<non-obvious things that would cost the next session an hour to rediscover>
```

## Rules

- Keep it under ~50 lines. It is read at the start of every session; length is a
  recurring token cost.
- State, not history. "Auth done, RLS done, webhooks in progress" — not a
  narrative of what happened.
- Mark every completion `VERIFIED` or `NOT TESTED`. Never overstate.
- "Gotchas" is the highest-value section: the pooler URL vs direct URL, the env
  var that needs a redeploy, the test that only passes after a `db reset`.
