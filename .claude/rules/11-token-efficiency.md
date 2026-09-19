# 11 — Token Efficiency

Always applies. Optimize for engineering output per token, not for token usage.

## 1. Six Questions

| Before you... | Ask |
|---|---|
| read a file | "Do I need this information?" |
| write code | "Does this change actually need to exist?" |
| add a dependency | "Can the existing stack solve this?" |
| refactor | "Does this reduce real complexity or just move it?" |
| run a command | "What information will this command provide?" |
| retry a failure | "What changed since the previous attempt?" |

That last one matters most. Running the same failing command again produces the
same output and teaches nothing. Change the hypothesis first.

## 2. Do Not

- Read the entire repository for a small task.
- Re-read unchanged files you already have in context.
- Re-explain architecture that `docs/ARCHITECTURE.md` already states.
- Dump a 2,000-line file into context when 40 lines are the answer.
- Generate speculative code "in case it's needed".
- Rewrite a large file to change three lines.
- Run redundant commands (`ls` after `find`, `cat` after `grep -A`).
- Repeat an identical failed command without changing anything.
- Inspect directories unrelated to the task.
- Produce long explanations where a short one is complete.

## 3. Prefer

- **Targeted search** — `grep -rn "createInvoice" src/` beats reading `src/`.
- **Targeted reads** — `sed -n '120,180p' file.ts` beats `cat file.ts`.
- **Diffs** — `git diff` tells you what changed without re-reading both versions.
- **Existing docs** — `docs/PROJECT_STATE.md` replaces rediscovering the project.
- **Focused tests** — run the one relevant suite, not everything, while iterating.
- **Incremental changes** — small verified steps beat a large unverified one.
- **Small logical commits** — they make the next session's `git log` useful.

## 4. Discovery Ladder

Climb only as far as the answer requires:

```
1. docs/PROJECT_STATE.md, docs/ARCHITECTURE.md   ← cheapest, often sufficient
2. git log --oneline -20 / git diff
3. grep for the symbol
4. Read the specific function (sed range)
5. Read the whole file
6. Read the directory                            ← most expensive, rarely needed
```

## 5. Command Efficiency

```bash
# Expensive                    # Cheap
cat src/lib/auth.ts            grep -n "export" src/lib/auth.ts
find . -type f                 git ls-files 'src/**/*.ts'
npm test                       npm test -- tests/unit/invoice.test.ts
cat huge.log                   tail -50 huge.log | grep -i error
```

Never pipe a full build log or a full test run into context. Filter to the
failure, then read that.

## 6. Documentation Is A Token Investment

```
Documentation → less rediscovery → less context → fewer tokens → faster development
```

Write `docs/PROJECT_STATE.md` so the next session starts productive in one read
instead of reconstructing the project from source. That single file repays its
cost within one session.

Keep it concise. A diary is not a state file — bloated docs cost tokens on every
future session and are worse than none.

## 7. Session Handoff

At the end of substantial work, update `docs/PROJECT_STATE.md`:

```markdown
Current architecture: Next.js + Supabase + Vercel + Cloudflare + Resend
Current feature:      Subscription management
Completed:            Auth · schema · RLS policies
In progress:          Payment webhook verification
Known issues:         Email retry handling is unbounded
Next:                 Integration tests for webhook idempotency
```

Six lines. The next session — human or AI — knows where it is without reading
the codebase or the history. Run `/handoff` to generate it.

## 8. Response Discipline

Match response length to the question. A yes/no question gets a yes/no plus the
reason. Do not restate the request, do not narrate what you are about to do at
length, do not list options you will not pursue.

Every token should have a purpose.
