# Project State — CECC

_Updated: 2026-09-19_

## Current phase

Phases 1–7 of the implementation plan are complete and working end to end.
Phase 8 (cloud sync) is deliberately not started; phase 9 (hardening) is
partially done through the adversarial test suite.

## Architecture

Node 22 monorepo. `packages/core` holds the domain layer (types, storage,
rules, engines, adapters) with no UI or process management. `packages/cli` is
the `cecc` command plus the Claude Code hook handler. `apps/dashboard` is a
Next.js interface reading the local SQLite store directly.

No daemon. Hooks write, CLI and dashboard read, SQLite WAL mediates.

## Completed — VERIFIED

- Event model with per-project hash chain; verification recomputes each event's
  content hash, so content tampering is detected, not just deletion/reorder.
- Secret detection and redaction at the storage boundary, including Supabase
  `service_role` identified by decoding the JWT payload.
- 28 agent/security rules across APPLICATION, AGENT and CECC layers.
- 6 correlation patterns; CORR-001 (test weakened after failure) is the flagship.
- Workflow inference from evidence with human pin/unpin override.
- Completion gates where `pending` blocks as firmly as `fail`.
- Policy engine: observe/warn/block, integrity-checksummed policy file.
- Claude Code adapter (verified against 2.1.278), permissive schema.
- CLI: init, doctor, status, scan, findings, policy, rules, workflow, session, report.
- Hook handler with hard deadline, always exits 0, fails open on timeout.
- Dashboard: overview, workflow, live activity (SSE), findings, session replay.
- 159 tests across 5 suites, including adversarial tests targeting CECC itself.

## Last validated test state — VERIFIED

```
Test Files  5 passed (5)
     Tests  159 passed (159)
```

End-to-end through the real hook handler against a demo project detects the
full chain: AGENT-005 → AGENT-003 → CORR-001 → AGENT-002 → CORR-004.

## Integration state

- Claude Code 2.1.278 detected; hooks registered for SessionStart, SessionEnd,
  PreToolUse, PostToolUse, UserPromptSubmit, Stop — VERIFIED.
- Blocking path implemented and unit-tested. **Not yet verified against a live
  agent session** — the deny response shape is asserted in tests, not observed
  in practice. NOT TESTED.
- Dashboard builds and serves all routes against real data — VERIFIED.

## Known issues

- `cecc scan --all` reads tracked files one at a time; unmeasured above ~10k files.
- Dashboard polls every second; fine locally, would need rethinking remotely.
- `cecc status` recomputes gates on every invocation with no caching.

## Known limitations (by design, documented)

- Observes only what the agent does through its tools.
- Never reads the agent's reasoning; `transcript_path` is noted, never opened.
- Tamper-evident, not tamper-proof.
- Static analysis, not proof.
- Fails open on timeout.

## Not implemented

- Cloud sync (configuration shape exists, defaults to disabled).
- Automatic task ingestion from docs, TODO scanning.
- External scanner adapters (Semgrep, OSV, npm audit).
- AI-assisted analysis for cases deterministic rules cannot resolve.
- Token-efficiency metrics beyond CORR-005 (repeated failed commands).

## Architecture decisions

**No daemon.** Hooks give precise structured events; filesystem watching sees a
write but not who made it. A daemon would add a process to supervise and a
second place for state to go stale.

**`node:sqlite` via createRequire.** Zero native dependencies matters for a
security tool's supply chain. createRequire keeps the package bundleable by
consumers whose bundler predates the module.

**`findingRuleIds` in its own column.** CECC annotates events with which rules
fired. Keeping that in `metadata` meant a legitimate post-insert update broke
the integrity hash.

**Warn by default.** Blocking on day one gets the tool uninstalled before it
demonstrates value.

## Next recommended task

Verify the PreToolUse blocking path against a live Claude Code session — set
`AGENT-002` to `block`, attempt `git commit --no-verify`, and confirm the agent
actually receives and acts on the deny decision. It is the one integration
behaviour asserted only in tests.
