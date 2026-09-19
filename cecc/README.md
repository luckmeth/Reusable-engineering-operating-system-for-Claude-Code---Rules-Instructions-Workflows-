# CECC — Claude Engineering Control Center

A local-first engineering observability, workflow and security control system
for AI-assisted development.

CECC does not replace your coding agent. It sits around the development
workflow and records what happened, analyses it for engineering and security
problems, and turns a session from *"I hope the agent did that correctly"* into
*"here is the evidence of what changed, what was verified, and what still needs
attention."*

Claude Code is the first agent adapter. The core is agent-agnostic.

---

## The problem it solves

An agent is asked to fix a failing authorization test. It changes the
middleware, the test still fails, so it edits the test to expect the new
behaviour. The suite goes green. The commit lands with `--no-verify` because a
pre-commit hook was complaining.

Every step is individually defensible. The result is a cross-tenant data leak
with a green CI badge.

No tool that looks at one diff at a time sees this. CECC does, because it
watches the sequence:

```
CRITICAL  CORR-001  Security test weakened after a failure, and the suite now passes
          LIKELY · 92% confidence · correlated

  Evidence
    1. 12:53:09  file.modified  src/api/invoices.ts        ← AGENT-005 authorization check removed
    2. 12:53:09  test.run       npx vitest run  FAILED
    3. 12:53:09  file.modified  tests/invoices.test.ts     ← AGENT-003 assertion weakened
    4. 12:53:09  test.run       npx vitest run  PASSED

  Aggravating factor
    No production code changed between the failure and the pass — only the test did.
```

---

## Install

Requires Node 22.5 or newer. No native dependencies.

```bash
cd cecc
npm install
npm run build

# in the project you want to monitor
node /path/to/cecc/packages/cli/dist/index.js init
```

`init` detects your stack, writes `.cecc/`, and registers hooks in
`.claude/settings.json` without disturbing hooks you already have.

```bash
cecc doctor     # verify the integration actually fires
cecc status     # stage, findings, validation, what is blocking release
```

---

## Commands

| Command | Purpose |
|---|---|
| `cecc init` | Set up CECC and register agent hooks |
| `cecc doctor` | Verify installation, hook wiring and event-chain integrity |
| `cecc status` | Workflow stage, findings, validation state, blockers |
| `cecc scan` | Run detection rules over changes (or `--all`) |
| `cecc scan --external` | Run npm audit, OSV and Semgrep; `--online` to allow network |
| `cecc tasks` | Task list read from `docs/TASKS.md` and source TODO markers |
| `cecc sync` | Show exactly what cloud sync would transmit; sends only with `--push` |
| `cecc findings` | List findings with evidence; `--id` for full detail |
| `cecc session` | List sessions, or replay one chronologically |
| `cecc workflow` | Show the workflow; `--pin` to override inference |
| `cecc policy` | Show or change enforcement per rule |
| `cecc rules` | Browse the detection rules |
| `cecc report` | Evidence report in Markdown or JSON, limitations included |

---

## Dashboard

```bash
cd apps/dashboard && npm run build && npm start   # http://localhost:4317
```

Overview, workflow, live activity (SSE), findings, controls, model intelligence
and session replay — all read from the local event store. No placeholder data
anywhere. Every page has a plain-English mode and a technical mode.

---

## Desktop application

```bash
npm run desktop:start    # run the packaged shell
npm run desktop:linux    # AppImage + tar.gz
npm run desktop:win      # NSIS installer + zip
npm run desktop:mac      # dmg + zip
```

One window, no install step, no Node required on the machine: the Electron
binary runs the dashboard as a child process on its own bundled Node 24, and
the CLI ships inside. The window is sandboxed with no preload bridge, and the
server binds to loopback on a random port. See [docs/DESKTOP.md](docs/DESKTOP.md).

---

## Three security layers, kept apart

Collapsing these would bury the second and third, which is where CECC differs
from an ordinary scanner.

| Layer | Question |
|---|---|
| **Application** | Is the software being built vulnerable? |
| **Agent** | Did the coding agent take a dangerous shortcut? |
| **CECC** | Is something attacking the monitoring system itself? |

28 detection rules and 8 correlation patterns. `cecc rules` lists them all.

---

## Design decisions

**No security score.** A number implies precision the evidence does not support
and hides the difference between "checked and clean" and "never checked".
Findings, verification state and gates carry that honestly.

**Warn by default, never block.** A tool that blocks on day one is uninstalled
before it proves itself. Blocking requires policy, high severity and high
confidence to agree.

**Fails open on timeout.** If analysis exceeds its deadline the action proceeds
and the gap is recorded. A monitor that freezes your session gets removed, and
a removed monitor detects nothing.

**"Not tested" ≠ "passing".** Gates return `pending` when a check never ran, and
pending blocks readiness as firmly as failure.

**Evidence, not assertion.** A task marked DONE with no recorded evidence fails
its gate. Implementation existing is not the same as it working.

---

## What CECC does *not* do

Stated plainly, because a security tool that overstates itself is worse than none.

- **It does not read the agent's reasoning.** `transcript_path` is noted as
  present and never opened. Every conclusion comes from observable actions —
  tool calls, commands, file changes, git state, test results.
- **It only sees what the agent does through its tools.** Work in another
  terminal is invisible until `cecc scan` or git picks it up.
- **Tamper-evident, not tamper-proof.** The event hash chain detects casual
  tampering and corruption. Anything with write access to the database could
  rebuild it.
- **Static analysis, not proof.** Rules find classes of mistake reliably. They
  prove nothing about code they did not match.
- **No findings ≠ secure.** It means no active rule matched. The UI says so
  wherever a list is empty.

---

## Privacy

Everything stays on your machine. No telemetry, no analytics, no network calls.
Cloud sync is configured but not implemented, and would be opt-in per project
with source code never uploaded.

Every string entering the store is redacted first — CECC's own database must not
become a second place to steal credentials from. See [docs/PRIVACY.md](docs/PRIVACY.md).

---

## Status

Working software. 236 tests pass, including adversarial tests that treat CECC as
the target.

**Implemented:** event model with integrity chain · 31 rules · 8 correlation
patterns · workflow inference and gates · policy engine · Claude Code adapter
with live-verified blocking · external scanners (npm audit, OSV, Semgrep) ·
task ingestion · opt-in cloud sync · local ML triage · CLI · dashboard ·
packaged desktop application.

**Not implemented:** AI-assisted analysis for ambiguous cases — deliberately, as
it would add a network dependency and a non-reproducible verdict to a tool whose
value is that every claim is traceable.

**Honest gaps:** the OSV live round trip is tested against recorded responses,
not against `api.osv.dev`. The macOS target is configured and has never been
built. Both are recorded in [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).

Known rough edges are listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Shape, packages, why there is no daemon |
| [EVENT_MODEL.md](docs/EVENT_MODEL.md) | The event, integrity chain, normalized changes |
| [RULE_ENGINE.md](docs/RULE_ENGINE.md) | Layers, all 28 agent rules, false-positive control |
| [EXTERNAL_SCANNERS.md](docs/EXTERNAL_SCANNERS.md) | npm audit, OSV, Semgrep, and how coverage gaps are reported |
| [DESKTOP.md](docs/DESKTOP.md) | The Electron shell, what ships inside, cross-building |
| [MACHINE_LEARNING.md](docs/MACHINE_LEARNING.md) | The local model, its metrics, what it is not allowed to do |
| [WORKFLOW.md](docs/WORKFLOW.md) | Stage inference and completion gates |
| [CLAUDE_CODE_INTEGRATION.md](docs/CLAUDE_CODE_INTEGRATION.md) | Hooks, payloads, blocking, safety rules |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md) | What CECC defends against, and what it does not |
| [PRIVACY.md](docs/PRIVACY.md) | What is recorded, what never is |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, adding rules, testing conventions |

## License

MIT.
