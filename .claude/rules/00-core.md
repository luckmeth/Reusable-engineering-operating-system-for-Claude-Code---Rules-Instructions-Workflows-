# 00 — Core Engineering Rules

Always applies.

## 1. Inspect Before Modifying

```
Requirement → Inspect relevant files → Impact analysis → Plan
           → Smallest correct change → Validate → Review diff → Document
```

Before touching code:

1. Do I understand the requirement, including the edge cases?
2. Does this already exist somewhere in the repo? (`grep` before you write.)
3. What depends on the code I am about to change?
4. What breaks in security, database, or deployment if I get this wrong?

## 2. Minimal Change Principle

The correct diff is the smallest one that fully solves the problem.

| Do | Do not |
|---|---|
| Extend an existing module | Create a parallel module that does the same thing |
| Fix the bug | Rewrite the file "while I'm here" |
| Add the one field needed | Redesign the schema speculatively |
| Use what the stack already provides | Add a dependency for a 20-line helper |

Discovered an unrelated problem? Write it into `docs/TASKS.md` under **Backlog**
and keep going. Silently expanding scope is a defect, not diligence.

## 3. Language Standards (TypeScript)

- `strict: true`. No exceptions without a comment explaining why.
- No `any` unless documented inline with the reason.
- Untrusted external data is `unknown` until validated (Zod or equivalent).
- Type assertions (`as`) are not a fix for a compiler error — they hide one.
- Types encode domain rules: `type OrderStatus = 'pending' | 'paid' | 'refunded'`,
  not `string`.
- Prefer discriminated unions over optional-field soup.
- Return types on exported functions. Inference is fine internally.

```ts
// Wrong — assertion hides an unvalidated boundary
const body = (await req.json()) as CreateOrder;

// Right — unknown until proven
const parsed = CreateOrderSchema.safeParse(await req.json());
if (!parsed.success) return badRequest(parsed.error);
```

## 4. Scope Discipline

Stay inside what was asked. Fixing an auth bug does not license refactoring the
router. If the fix genuinely requires a structural change, say so and get
agreement before doing it.

## 5. Honesty States

Every claim about the system carries a state:

| State | Means |
|---|---|
| `VERIFIED` | Command run, output observed |
| `ASSUMED` | Inferred from code, not executed |
| `NOT TESTED` | Written, never run |
| `BLOCKED` | Cannot proceed — reason and unblocker stated |

Never report `VERIFIED` for something you did not execute. A wrong "tests pass"
costs more than an honest "not tested".

## 6. Escalation Triggers

Stop and ask when:

- Requirements contradict each other or contradict existing code.
- The change is destructive (drops data, rewrites history, deletes resources).
- A migration could cause data loss or downtime.
- The architecture must fundamentally change to proceed.
- Production secrets or credentials are needed.
- A business rule is ambiguous and the readings differ materially.
- Two or more materially different architectures are viable.

Do not stop for: naming, file placement, minor refactors, library-internal
choices, formatting. Decide and move.

## 7. Final Report

```markdown
## Changed
- path/to/file.ts — what and why

## Security
- Authorization enforced at <layer>; RLS policy <name> covers <table>

## Tests
- `pnpm test:unit` — 42 passed  (VERIFIED)
- E2E not run in this environment (NOT TESTED)

## Verification
- Typecheck VERIFIED, lint VERIFIED, build NOT TESTED

## Remaining
- Webhook retry handling — logged in docs/TASKS.md
```

## 8. Golden Rule

The best solution is the simplest architecture that reliably satisfies the real
requirements. Leave the repository easier to understand than you found it.
