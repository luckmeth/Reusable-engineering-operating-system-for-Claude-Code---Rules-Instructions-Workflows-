---
description: Run the validation suite and report honest results
allowed-tools: Bash(npm:*), Bash(pnpm:*), Bash(yarn:*), Bash(npx:*), Read, Grep, Glob, Edit
---

# Test

Run validation and report what actually happened.

## Target

$ARGUMENTS (if empty: run the full validation chain)

## Sequence

Run in this order and stop at the first failure — a type error makes the test
results meaningless.

```bash
<pm> typecheck    # or: npx tsc --noEmit
<pm> lint
<pm> test
<pm> build        # only if the change could affect the build
```

Detect the package manager from the lockfile. If a script does not exist, say so
rather than inventing one.

## On Failure

1. Read the actual error — do not guess from the command name.
2. Form a hypothesis about the cause.
3. Fix the root cause, not the symptom. Never delete, skip, or `.only` a test to
   get green.
4. Re-run only the failing suite while iterating; run the full chain once at the end.

Never re-run an identical failing command without changing something first.

## Coverage Check

If `$ARGUMENTS` names a feature, verify tests exist for:
happy path · invalid input · unauthenticated · unauthorized · cross-tenant ·
ownership violation · edge cases · failure conditions.

Report anything missing. Write the missing security tests if asked.

## Output

```markdown
## Results
| Check | Result | Detail |
|---|---|---|
| typecheck | VERIFIED pass | — |
| lint | VERIFIED pass | 2 warnings |
| test | VERIFIED fail | 1 failed / 47 passed |
| build | NOT TESTED | skipped — no build-affecting change |

## Failures
<actual output, trimmed to the relevant lines>

## Fixed
<what was changed and why — or "nothing, reporting only">

## Gaps
<missing test coverage>
```

`VERIFIED` only for commands you actually ran. If something could not run in
this environment, say `NOT TESTED` and state why. Never report a pass you did
not observe.
