# Architecture

## Shape

```
Developer machine
│
├── Claude Code ──(hooks)──► cecc hook ──► ingest pipeline
│                                             │
│                                             ├── adapter      normalize payload → events + changes
│                                             ├── store        append (redacted, hash-chained)
│                                             ├── rule engine  28 rules over events and changes
│                                             ├── correlation  6 patterns over the session window
│                                             ├── workflow     infer stage from evidence
│                                             └── policy       observe / warn / block
│                                             │
│                                             ▼
│                                     .cecc/cecc.db (SQLite)
│                                             │
├── cecc CLI ────────────────────────────────►│ read + analyse
└── dashboard (Next.js) ─────────────────────►│ read + stream
```

Everything is local. There is no server, no daemon and no network call unless
cloud sync is explicitly enabled.

## Packages

| Package | Responsibility |
|---|---|
| `packages/core` | Domain layer: types, storage, rules, engines, adapters. No I/O beyond the local database and git. |
| `packages/cli` | The `cecc` command and the hook handler. |
| `apps/dashboard` | Next.js interface reading the local store directly. |

`core` is UI-free and process-free so the CLI, the hook and the dashboard share
one implementation rather than three that drift.

## Why there is no daemon

An earlier design had a background agent with file watchers and an HTTP API.
It was removed because it bought nothing: Claude Code's hooks already deliver
precise, structured events at the moment they happen — more precise than
filesystem watching, which sees a write but not who made it or why. A daemon
would have added a process to supervise, a port to secure, and a second place
for state to go stale.

What replaced it:

- **Writes** happen in the hook process, which is short-lived and already running.
- **Reads** happen in the CLI and dashboard, directly against SQLite in WAL mode.
- **Live updates** come from the dashboard polling `seq > lastSeen` on an indexed
  column and pushing over SSE.

The cost is that CECC observes only what the agent does through its tools. Work
done in another terminal is invisible until `cecc scan` or a git-derived event
picks it up. That trade is stated in the README rather than hidden.

## Agent-agnostic core

Claude Code is the first adapter, not the architecture. The behaviours CECC
detects — weakening a test to make it pass, deleting an authorization check,
committing past the hooks — are not specific to one vendor.

An adapter translates native payloads into `CeccEvent` and `ContentChange`.
It makes no security decisions and must not widen the event vocabulary. Adding
a second agent means writing one adapter; no rule changes.

## Data flow for one tool call

1. Claude Code invokes the hook with a JSON payload on stdin.
2. `ClaudeCodeAdapter.normalize` produces events and normalized file changes.
3. `Store.appendEvent` redacts every string and extends the hash chain.
4. `runRules` evaluates each rule against the event, isolated in try/catch.
5. Findings are upserted by fingerprint, so re-detection increments a counter
   rather than creating duplicates.
6. `stampFindingRules` records which rules fired, in a column excluded from the
   integrity hash.
7. `runCorrelations` looks at the session window for multi-event patterns.
8. `updateWorkflow` advances the stage if the evidence supports it.
9. `decideEnforcement` returns allow / warn / block.
10. The hook writes a deny decision (PreToolUse only) or a stderr warning, and exits 0.

Steps 4 through 9 are individually wrapped: a failure in any of them is recorded
as an error and the rest continue.

## Storage

SQLite via `node:sqlite`, loaded through `createRequire` so bundlers that
predate the module do not try to resolve it. WAL mode lets the dashboard read
while hooks write. There are no native dependencies; `zod` is the only runtime
dependency in `core`.

Key tables: `events` (hash-chained), `findings` (fingerprint-unique per
project), `sessions`, `workflow_runs`, `test_results`, `event_links` (the
correlation graph), and `audit_log` — kept separate from `events` so that
clearing event history cannot also erase what CECC enforced.

## Decisions worth knowing

**No security score.** A single number implies a precision the evidence does not
support and hides the difference between "checked and clean" and "never
checked". Findings, verification state and gates carry that information honestly.

**Warn by default, never block.** A tool that blocks on day one is uninstalled
before it demonstrates value. Blocking requires policy, high severity and high
confidence to agree.

**Fail open on timeout.** If analysis exceeds its deadline the action proceeds.
A monitor that freezes the developer's session gets removed, and a removed
monitor detects nothing.
