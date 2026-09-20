# Claude Code Engineering System

A reusable engineering operating system for Claude Code — rules, instructions,
workflows, a security baseline, and token-efficiency practices for building
secure, scalable, production-ready software.

Treats Claude Code as an **AI engineering agent operating under defined software
engineering standards**, not as a code generator.

```
CORRECTNESS > SECURITY > MAINTAINABILITY > PERFORMANCE > COST > SPEED
```

The objective is not to generate the most code. It is to generate the smallest
amount of correct, secure, maintainable code that solves the actual problem.

---

## Quick Start

**Install into an existing project:**

```bash
git clone https://github.com/luckmeth/Reusable-engineering-operating-system-for-Claude-Code---Rules-Instructions-Workflows-.git claude-os
bash claude-os/scripts/install.sh /path/to/your/project

cd /path/to/your/project && claude
> /audit          # full engineering audit of what you already have
```

Existing files are never overwritten unless you pass `--force`.
Add `--with-supabase` for the reference RLS migrations, `--with-tests` for the
security test patterns.

**Start a new project:**

```bash
git clone <this repo> my-project && cd my-project
rm -rf .git && git init && claude
> /init-project A multi-tenant invoicing app for small businesses
```

**Check a repo before committing:**

```bash
bash scripts/verify.sh /path/to/project
```

---

## What's In Here

| Path | What it does |
|---|---|
| `CLAUDE.md` | The constitution — always in context. Priority order, hard rules, honesty states, task protocol. |
| `.claude/rules/` | 12 rule files, loaded per task instead of all at once |
| `.claude/commands/` | 8 slash commands for the daily workflow |
| `.claude/agents/` | `security-reviewer`, `db-reviewer` — focused review in isolated context |
| `.claude/settings.json` | Permission defaults: read-only ops allowed, destructive ops denied, `.env` unreadable |
| `docs/` | Templates for architecture, database, security, API, deployment, ADRs, project state, tasks |
| `supabase/` | Working reference migrations: tenancy, `security definer` policy helpers, four RLS policies per table, webhook idempotency |
| `tests/security/` | Access control, RLS, webhook forgery/replay, and input validation test patterns |
| `scripts/install.sh` | Installs the system into any project |
| `scripts/verify.sh` | Grep-level checks: secrets, RLS coverage, client-trusted tenant IDs, swallowed errors |
| `.verifyignore` | Paths whose *shape* matches `verify.sh` should ignore — security tests and detection rules have to write the insecure pattern down. Never applies to the literal-credential scan. |
| `.github/workflows/ci.yml` | Validates system integrity and smoke-tests the installer |

### Rules

Split by concern so a task loads one or two files, not twelve.

| File | Covers |
|---|---|
| `00-core.md` | Inspect-before-modify, minimal change, TypeScript standards, honesty states, escalation |
| `01-architecture.md` | Project init order, structure, client/server boundary, layering, tenancy, ADRs |
| `02-security.md` | Authn vs authz, IDOR, validation, OWASP, secrets, webhooks, payments, uploads, no security theater |
| `03-database.md` | Constraints, query-driven indexes, RLS policy patterns, service role, migrations |
| `04-frontend.md` | Components, server/client split, the five async states, state escalation, accessibility |
| `05-backend.md` | Endpoint contracts, output shaping, error classes, logging, serverless reality, idempotency |
| `06-testing.md` | Behaviour over implementation, mandatory security tests, test quality |
| `07-git.md` | Branching, commit format, destructive-command policy, merge gate |
| `08-deployment.md` | Vercel serverless limits, Cloudflare caching traps, env validation, readiness, cost |
| `09-email.md` | Resend server-side, retries and idempotency, development email safety |
| `10-performance.md` | Measure first, the eight real bottlenecks, caching rules |
| `11-token-efficiency.md` | The six questions, the discovery ladder, session handoff |

### Commands

| Command | Purpose |
|---|---|
| `/plan <requirement>` | Impact analysis + implementation plan. Writes no code. |
| `/review` | Reviews the current diff — correctness, security, performance, maintainability |
| `/test` | typecheck → lint → test → build, reported as VERIFIED / NOT TESTED |
| `/audit` | Full repository audit against every rule |
| `/security-audit` | Adversarial review: IDOR, tenancy, RLS, webhooks, secrets |
| `/deploy-check` | Production readiness gate |
| `/handoff` | Regenerates `docs/PROJECT_STATE.md` for the next session |
| `/init-project` | Scaffolds a new project under this system |

---

## Why This Exists

AI coding agents write code quickly, but speed alone does not produce
production-quality software. Without a system, an agent will overengineer simple
features, add unnecessary dependencies, rewrite working code, miss authorization
bugs, ignore database security, duplicate existing functionality, waste tokens
rediscovering the same context, and forget project decisions between sessions.

This repository prevents those specific failures.

---

## The Workflow

```
Requirement
   ↓
Inspect  ──────────  relevant files only
   ↓
Impact Analysis ───  security / database / API / deploy / test / cost
   ↓
Plan  ─────────────  small and targeted
   ↓
Implement ─────────  minimal change
   ↓
Validate ──────────  typecheck / lint / tests / build
   ↓
Review Diff ───────  security and quality, adversarially
   ↓
Update Project State
   ↓
DONE
```

---

## Security Baseline

Security is part of architecture, not a phase after development.

The system enforces the controls that actually matter in this stack:

- Identity from the server session — never from a request body
- Ownership and tenant filters **in the query**, not applied after the fetch
- `404` not `403` for out-of-scope resources — `403` confirms existence
- RLS enabled *and forced*, with a separate policy per operation, and `with check`
  on every `UPDATE` (without it, a user can move their row into your tenant)
- Two independent isolation layers: the server filter catches logic errors, RLS
  catches the filter someone forgot
- Webhook signatures verified over the **raw** body, with replay windows and
  unique-constraint idempotency
- Amounts and prices sourced from the database, never the payload

### It also rejects security theater

TypeScript, HTTPS, Supabase Auth, Cloudflare, hashed passwords, frontend
validation, and undocumented endpoints are **not** access controls. Security is
demonstrated by an enforced control plus a test that fails when the control is
removed.

---

## Token Efficiency

Every token should have a purpose. Before acting, the system asks:

| Before you... | Ask |
|---|---|
| read a file | "Do I need this information?" |
| write code | "Does this change actually need to exist?" |
| add a dependency | "Can the existing stack solve this?" |
| refactor | "Does this reduce real complexity or just move it?" |
| run a command | "What information will this provide?" |
| retry a failure | "What changed since the previous attempt?" |

```
Documentation → less rediscovery → less context → fewer tokens → faster development
```

This principle is applied to the system itself: `CLAUDE.md` stays short and
always loaded, and routes to the one rule file a task actually needs. Loading
all twelve every session would cost tokens on every turn and bury the relevant
rule in noise.

---

## Never Pretend

Every claim about the system carries a state:

```
VERIFIED    — executed and observed
ASSUMED     — reasonable inference, not checked
NOT TESTED  — written but never run
BLOCKED     — cannot proceed; reason stated
```

Never claim tests passed, a deploy succeeded, a migration ran, or security is
complete without having verified it. A wrong "tests pass" costs more than an
honest "not tested".

---

## Default Stack

| Area | Default |
|---|---|
| Language | TypeScript (strict) |
| Frontend | React / Next.js |
| Styling | Tailwind CSS |
| Backend | Next.js / Node.js |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Authorization | Server-side checks + PostgreSQL RLS |
| Hosting | Vercel |
| DNS / CDN / Edge | Cloudflare |
| Email | Resend |
| Payments | PayHere or equivalent |
| Validation | Zod |
| AI development | Claude Code |

A preference, not a restriction. Swap any layer when requirements justify it —
`00-core`, `02-security`, `06-testing`, `07-git`, `10-performance` and
`11-token-efficiency` are stack-independent.

---

## Customizing

1. Edit `CLAUDE.md` — replace the default stack with your project's real stack.
2. Fill `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATABASE.md` with real
   content. A scaffold full of `TODO` costs more than no scaffold.
3. **Delete rule files that do not apply.** Unused rules cost tokens every session.
4. Keep `docs/PROJECT_STATE.md` under ~50 lines — it is read at the start of
   every session.

See `docs/USAGE.md` for the full guide.

---

## What This System Will Not Do

It will not make an insecure design secure, replace a threat model, or substitute
for running the tests. It enforces discipline and preserves context across
sessions — the engineering judgment is still yours.

---

## Status

An evolving framework. Update the rules when better practices emerge, security
requirements change, the stack changes, Claude Code's capabilities change, or
production experience reveals a weakness.

Evolve it from real engineering results, not by accumulating rules.

## License

MIT — see [LICENSE](LICENSE).
