# Project State — CECC

_Updated: 2026-09-19_

## Current phase

Phases 1–9 of the implementation plan are complete. Cloud sync (phase 8) is
implemented and opt-in. The system ships as a CLI, a dashboard and a packaged
desktop application.

## Architecture

Node 22 monorepo. `packages/core` holds the domain layer (types, storage, rules,
engines, scanners, tasks, sync, adapters) with no UI or process management.
`packages/ml` is the local model. `packages/cli` is the `cecc` command plus the
Claude Code hook handler. `apps/dashboard` is a Next.js interface reading the
local SQLite store directly. `apps/desktop` is an Electron shell that runs the
dashboard as a child process and bundles the CLI.

No daemon. Hooks write, CLI and dashboard read, SQLite WAL mediates.

## Completed — VERIFIED

- Event model with per-project hash chain; verification recomputes each event's
  content hash, so content tampering is detected, not just deletion or reorder.
- Secret detection and redaction at the storage boundary, including Supabase
  `service_role` identified by decoding the JWT payload.
- 31 rules across APPLICATION, AGENT and CECC layers (28 agent rules plus three
  external-scanner rule ids).
- 8 correlation patterns; CORR-001 (test weakened after failure) is the flagship,
  CORR-007 and CORR-008 cover token efficiency.
- Workflow inference from evidence with human pin/unpin override.
- Completion gates where `pending` blocks as firmly as `fail`.
- Policy engine: observe/warn/block, integrity-checksummed policy file.
- Claude Code adapter (verified against 2.1.278), permissive schema.
- **PreToolUse blocking verified against a live Claude Code session** — see below.
- External scanners: npm audit, OSV.dev, Semgrep, with coverage gaps recorded
  rather than silently passing.
- Task ingestion from `docs/TASKS.md` checkboxes and source TODO markers,
  idempotent and non-destructive to developer-set status.
- Cloud sync: opt-in, dry-run by default, metadata-only unless evidence is
  explicitly enabled.
- Dashboard: overview, workflow, live activity (SSE), findings, session replay,
  controls, intelligence — in plain-English and technical modes.
- Local ML triage: logistic regression and naive Bayes, chosen on held-out AUC,
  reordering within severity bands only.
- Desktop application packaged for Linux and Windows, launched and verified.

## Last validated test state — VERIFIED

```
Test Files  9 passed (9)
     Tests  236 passed (236)
```

Typecheck clean (`tsc -b packages/core packages/ml packages/cli`).

End-to-end through the real hook handler against a demo project detects the full
chain: AGENT-005 → AGENT-003 → CORR-001 → AGENT-002 → CORR-004.

## Integration state

- Claude Code 2.1.278 detected; hooks registered for SessionStart, SessionEnd,
  PreToolUse, PostToolUse, UserPromptSubmit, Stop — VERIFIED.
- **Blocking verified live.** With `AGENT-002` set to `block`, a real
  `claude -p` session was asked to run `git commit --no-verify -m wip`. The
  agent reported: *"The tool call was blocked before execution … CECC blocked
  this action: AGENT-002 git commit bypassed pre-commit verification hooks"* and
  no commit was created. The same prompt with the rule set to `warn` committed
  normally (`f36237e`). Control and negative control both observed — VERIFIED.
- Dashboard builds and serves all routes against real data — VERIFIED.
- Desktop application launches, starts its own server and renders the dashboard
  with real project data — VERIFIED (Linux AppImage and unpacked build).

## Measured performance

Taken on this repository (162 scannable files, 417 events):

| Operation | Cost | Note |
|---|---|---|
| `runRules` over the tree | 2.4 ms/file | Spread across ~8 rules; no single hotspot. |
| Reading and normalizing files | 10 ms total | Not the bottleneck. |
| `evaluateGates` | 0.10 ms | Caching it would add staleness for nothing. |
| `verifyEventChain` | 0.046 ms/event | Linear. 10k events ≈ 0.5 s, on `doctor` only. |
| `cecc status` end to end | ~141 ms | 68 ms of it is importing the core module. |

## Known issues

- OSV's live API path is asserted against recorded responses, not against
  `api.osv.dev` — that host is unreachable from the build environment used here.
  The offline degradation path is verified; the live round trip is NOT TESTED.
- The Windows NSIS installer cannot be cross-built from Linux without 32-bit
  Wine. The Windows zip cross-builds cleanly and was produced and verified; the
  installer is built natively by `.github/workflows/desktop.yml`.
- Behind an HTTPS proxy, Node's global `fetch` ignores `HTTPS_PROXY` unless
  `NODE_USE_ENV_PROXY=1` is set, which affects OSV and cloud sync but not npm
  audit.

## Known limitations (by design, documented)

- Observes only what the agent does through its tools.
- Never reads the agent's reasoning; `transcript_path` is noted, never opened.
- Tamper-evident, not tamper-proof.
- Static analysis, not proof.
- Fails open on timeout.
- Only npm lockfiles are parsed for dependency scanning.

## Not implemented

- AI-assisted analysis for cases deterministic rules cannot resolve. Deliberate:
  it would add a network dependency and a non-reproducible verdict to a tool
  whose value is that every claim is traceable.
- macOS packaging is configured but has never been built or launched.

## Architecture decisions

**No daemon.** Hooks give precise structured events; filesystem watching sees a
write but not who made it.

**`node:sqlite` via createRequire.** Zero native dependencies matters for a
security tool's supply chain. It holds in the desktop build too: Electron 44
carries Node 24, so the packaged app needs no native module and no installed
Node.

**The desktop shell adds no analysis.** Two implementations of the same rules
would eventually disagree, and the one people trusted would be whichever they
happened to be looking at.

**External scanners rather than reimplementation.** npm audit, OSV and Semgrep
are better at their jobs than a reimplementation would be. CECC's contribution
is normalizing them into one model and being honest about which of them ran.

**Warn by default.** Blocking on day one gets the tool uninstalled before it
demonstrates value.

## Next recommended task

Verify the OSV live path once from a network that can reach `api.osv.dev`, and
build the macOS target once on a Mac. Both are the same shape of gap: code that
is unit-tested and has never met the real thing.
