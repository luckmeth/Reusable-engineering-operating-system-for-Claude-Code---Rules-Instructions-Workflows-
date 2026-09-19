# Using This System

How to apply the engineering OS to a project, and how it behaves once installed.

## Install Into An Existing Project

```bash
git clone https://github.com/luckmeth/Reusable-engineering-operating-system-for-Claude-Code---Rules-Instructions-Workflows-.git /tmp/claude-os
bash /tmp/claude-os/scripts/install.sh /path/to/your/project
```

The installer copies `CLAUDE.md`, `.claude/` (rules, commands, agents, settings),
and the `docs/` templates. It never overwrites an existing file unless you pass
`--force`, and it reports exactly what it wrote.

## Start A New Project

```bash
git clone <this repo> my-project && cd my-project
rm -rf .git && git init
claude
> /init-project A multi-tenant invoicing app for small businesses in Sri Lanka
```

`/init-project` establishes requirements, architecture, tenancy, auth, security,
and deployment **before** scaffolding — because retrofitting tenancy or
authorization is a rewrite, not a patch.

## Daily Loop

```
/plan <requirement>        impact analysis + plan, no code
   ↓  implement
/review                    review your own diff before anyone else does
/test                      typecheck → lint → test → build, honestly reported
/security-audit            when the change touched auth, tenancy, money, or uploads
/deploy-check              gate before production
/handoff                   write PROJECT_STATE.md for the next session
```

## Commands

| Command | Purpose |
|---|---|
| `/plan` | Impact analysis and implementation plan. No code. |
| `/review` | Code review of the current diff. |
| `/test` | Run validation; report VERIFIED / NOT TESTED honestly. |
| `/audit` | Full repository audit against all rules. |
| `/security-audit` | Adversarial security review. |
| `/deploy-check` | Production readiness gate. |
| `/handoff` | Regenerate `docs/PROJECT_STATE.md` and `docs/TASKS.md`. |
| `/init-project` | Scaffold a new project under this system. |

## Subagents

`security-reviewer` and `db-reviewer` run focused reviews in their own context,
which keeps a long security review from consuming your main session's context.

```
> Use the security-reviewer agent on the payment webhook handler
> Use the db-reviewer agent on the new migration
```

## Customizing

- **Different stack?** Edit `.claude/rules/03-database.md`, `04-frontend.md`,
  `08-deployment.md`, `09-email.md`. The principles in `00`, `02`, `06`, `07`,
  `10`, `11` are stack-independent.
- **Trim what does not apply.** A single-tenant app does not need the tenancy
  sections. Deleting them saves tokens on every session.
- **Keep `CLAUDE.md` short.** It loads every session. Detail belongs in
  `.claude/rules/`, loaded only when the task needs it.

## Why Rules Are Split By File

Loading all twelve rule files into every session costs tokens on every turn and
buries the relevant rule in noise. `CLAUDE.md` stays small and always loaded; it
routes to the one or two rule files a task actually needs. That is the
token-efficiency principle applied to the system itself.

## What This System Will Not Do

It will not make an insecure design secure, replace a threat model, or substitute
for running the tests. It enforces discipline and preserves context — the
engineering is still yours.
