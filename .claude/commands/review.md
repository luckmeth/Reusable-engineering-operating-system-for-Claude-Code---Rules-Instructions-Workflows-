---
description: Code review of the current diff — correctness, security, performance, maintainability
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---

# Code Review

Review the change. **Identify problems first — do not immediately rewrite.**

## Target

$ARGUMENTS (if empty: `git diff` against the base branch, plus staged changes)

## Review Order

1. **Correctness** — does it do what it claims? Off-by-one, null/undefined,
   race conditions, wrong branch taken, unhandled async rejection, type lies (`as`).
2. **Security** — authz, identity source, validation, injection, secret handling,
   data exposure. See `.claude/rules/02-security.md`.
3. **Performance** — N+1, missing index, waterfall awaits, over-fetching, bundle cost.
4. **Scalability** — behaviour at 100× the data or the traffic; serverless assumptions.
5. **Maintainability** — naming, duplication, dead code, misplaced responsibility,
   abstraction that costs more than it saves.
6. **Testing gaps** — untested error paths, missing authz tests, tests asserting internals.
7. **Architecture** — does it fit the documented design, or quietly fork it?

## Also Check

- Scope: does the diff contain anything unrelated to its stated purpose?
- Duplication: does this already exist elsewhere in the repo? (grep before accepting)
- Error handling: any `catch {}`, any swallowed rejection, any generic 500 hiding a bug?
- Docs: did architecture / schema / security / deployment change without a doc update?

## Output

```markdown
# Review — <target>

## Verdict
APPROVE | APPROVE WITH CHANGES | REQUEST CHANGES
<one line: why>

## CRITICAL / HIGH / MEDIUM / LOW / INFO

### <title>  `path:line`
**Problem:** ...
**Why it matters:** ...
**Failure scenario:** <concrete inputs → concrete wrong result>
**Fix:**
```diff
- bad
+ good
```

## Good
<what was genuinely done well — one or two lines, no padding>
```

Rules for this review:

- Every finding needs a realistic failure scenario. If you cannot write one, it
  is a preference, not a finding — mark it INFO or drop it.
- Do not manufacture issues to make the review look thorough.
- Do not restyle working code as a "finding".
- If the diff is clean, say so and stop.
