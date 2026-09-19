# 07 — Git

Load for: branching, committing, merging, history operations.

## 1. Know The State Before You Change It

```bash
git status          # uncommitted work — is any of it the user's?
git branch --show-current
git diff            # what is actually different
git log --oneline -10
```

Never modify a repository whose current state you have not inspected.
Preserve unrelated changes in the working tree — they are not yours to discard.

## 2. Branching

```
main
├── feature/<scope>     new functionality
├── fix/<scope>         bug fixes
├── security/<scope>    security fixes
└── refactor/<scope>    structural change, no behaviour change
```

One branch, one purpose. A branch mixing a feature, a refactor, and a
dependency bump cannot be reviewed properly or reverted cleanly.

## 3. Commits

Small and logical. Each commit should build and pass tests on its own.

```
<type>(<scope>): <imperative summary>

Why the change was needed. What changed at a high level.
Anything a reviewer would otherwise have to reconstruct.
```

Types: `feat` `fix` `security` `refactor` `perf` `test` `docs` `chore` `db`.

```
security(invoices): enforce tenant scope on invoice detail route

The handler fetched by ID and compared ownership after the read, which
leaked existence via response timing and 403 vs 404. The query now filters
on tenant_id and returns 404 for out-of-scope IDs. RLS policy added as a
second layer. Regression test in tests/security/invoice-access.test.ts.
```

Do not write `update files`, `fix stuff`, or `wip` on a branch that will merge.

## 4. Destructive Operations — Explicit Authorization Only

Never run without the user explicitly asking:

- `git reset --hard`
- `git push --force` / `--force-with-lease` on a shared branch
- `git branch -D`
- `git checkout .` / `git restore .` over uncommitted work
- `git clean -fd`
- `git rebase` on a pushed, shared branch
- `git commit --amend` on a pushed commit

On someone else's branch, merge the base in — never rewrite their history.
Their local checkout depends on it.

## 5. Never Commit

- `.env` and any real secret
- `node_modules/`, build output, `.next/`, `dist/`, coverage
- Editor/OS noise (`.DS_Store`, `.idea/`)
- Large binaries or datasets
- Generated files that the build produces

A secret that reached history is compromised: rotate it, then clean the history.

## 6. Before Merging

- [ ] Tests pass
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Security-sensitive changes reviewed
- [ ] Database migrations reviewed and run on a fresh DB
- [ ] Deployment impact understood (env vars, build, runtime)
- [ ] Docs updated if architecture/schema/security/deployment changed
- [ ] The diff contains nothing unrelated to the branch's purpose

## 7. Pull Requests

Include: what changed and why · security impact · migrations · env var changes ·
what was actually tested · rollback plan if non-trivial.

Keep PRs reviewable. A 3,000-line PR gets rubber-stamped, which defeats review.
