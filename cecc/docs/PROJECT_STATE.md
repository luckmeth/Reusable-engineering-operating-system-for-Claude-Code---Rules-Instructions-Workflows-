# Project State — CECC

_Updated: 2026-09-22_ · version 0.2.1

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
dashboard as a child process, bundles the CLI, and hosts a pseudo-terminal the
dashboard attaches to so Claude Code runs inside the window.

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
- Desktop application packaged for Linux, Windows and macOS. The Linux build
  was launched and verified here; all three are built natively in CI.

## Last validated test state — VERIFIED

```
Test Files  12 passed (12)
     Tests  272 passed (272)
```

The embedded terminal is covered by an out-of-band harness rather than the
vitest suite, because it needs a real Claude Code binary: token rejection,
Origin rejection, PTY spawn, TUI output, reattach-after-reload and input
bounds, 12/12 against Claude Code 2.1.273 under Electron's Node 24.

`npm run lint` is a dead script — eslint is neither installed nor configured,
and CI does not call it. Pre-existing; logged in the repository's TASKS.md.

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
- `.github/workflows/desktop.yml` green on all three runners — VERIFIED
  (run 35497747169). Windows produced `CECC-0.1.0-win-x64.exe` (NSIS installer)
  and `CECC-0.1.0-win-x64.zip`; macOS produced a dmg and a zip; Linux an
  AppImage and a tar.gz. Nothing is code-signed.

## Measured performance

Taken on this repository (162 scannable files, 417 events):

| Operation | Cost | Note |
|---|---|---|
| `runRules` over the tree | 2.4 ms/file | Spread across ~8 rules; no single hotspot. |
| Reading and normalizing files | 10 ms total | Not the bottleneck. |
| `evaluateGates` | 0.10 ms | Caching it would add staleness for nothing. |
| `verifyEventChain` | 0.046 ms/event | Linear. 10k events ≈ 0.5 s, on `doctor` only. |
| `cecc status` end to end | ~141 ms | 68 ms of it is importing the core module. |

## Fixed in this pass — VERIFIED

Four defects, all silent, all found while walking a first install on Windows:

- **Switching project always reported a crash.** `stopServer` kills the
  dashboard deliberately; on Windows that arrives as exit code `null`, which
  the exit handler read as a failure. It also used `dialog.showErrorBox`,
  which blocks the main process — so the window froze on the page it was
  leaving and looked hung. Intentional stops are now marked, and the dialog is
  non-blocking.
- **`command.includes('cecc')` is case-sensitive.** The Windows installer
  uses `…\Programs\CECC\…`, so CECC failed to recognise its own hooks.
  `doctor` reported "settings.json has no CECC hooks" with all six present,
  and `init` appended a second copy of every hook — doubling every recorded
  event. Recognition now lives in `isCeccHookCommand`, covered by
  `hooks.test.ts`, and `doctor` reports duplicates explicitly.
- **Claude Code was undetectable on Windows.** `execFile('claude', …)` cannot
  run the `claude.cmd` shim npm installs, so detection returned null on every
  Windows machine that had it. Now routed through the shell on win32, with
  fixed literal arguments.
- **Desktop hooks required Node on PATH.** The command written was
  `node "<hook>"`, on an application whose premise is bringing its own
  runtime. Init under Electron now writes `.cecc/hook.cmd` (or `hook.sh`)
  using the application's own binary, and `doctor` fails a `node`-based hook
  whose interpreter is missing.

```
cecc doctor  (C:\Users\…\MCQ-SaaS, after the fixes)
  ✔ Claude Code          v2.1.273              (was: not found on PATH)
  ✔ Hook registration    SessionStart … Stop   (was: no CECC hooks)
  ✔ Hook runtime         node is on PATH
```

## Signal quality — VERIFIED

The scanner's first run against a real project returned ten findings, of which
one was worth reading. Two of the eight noisy ones were CRITICAL. That ratio,
not coverage, is the number that decides whether anyone keeps reading findings,
and nothing was measuring it.

Three causes, all fixed:

- **Placeholders read as credentials.** `isPlaceholder` is anchored and tests
  the *captured* value, which for a connection string is the password segment
  alone. `postgresql://USER:PASSWORD@HOST/db` in a README captured `PASSWORD`,
  matched nothing, and was reported CRITICAL at 94% confidence. Now recognises
  generic names, SCREAMING_SNAKE variable names, and bracketed decoration.
- **Benign context judged one line at a time.** In a Fisher-Yates shuffle the
  word "shuffle" is three lines up; on a confetti piece the `delay` is one line
  down. Both were HIGH-severity predictable-randomness findings. The window is
  now ±6 lines.
- **A name written down treated as an exposure.** AGENT-007 matched
  documentation and comments, so writing up a vulnerability you had just fixed
  re-raised it at CRITICAL. Comments and documentation files are excluded from
  the name-based signal; the value-based rule still covers a real key pasted in
  either place.

| | Before | After |
|---|---|---|
| Findings on a real project | 10 | 1 |
| Of those, worth acting on | 1 | 1 |
| Planted real vulnerabilities caught | 6/6 | 6/6 |

The second row is the control. A canary repository carrying a live connection
string, a Stripe secret key, a Resend key, a Supabase service-role JWT, a
service-role key behind `NEXT_PUBLIC_`, and a `Math.random` session token
still reports all six. Regression cover is in `secrets.test.ts` and
`noise.test.ts`, and every suppression case there is paired with the genuine
version of the same shape that must still fire.

Residual weakness, stated rather than hidden: the benign window is still text
proximity. A comment mentioning "animation" within six lines of a real
`Math.random` token will silence it. The structural fix is AST-based — what
the value is assigned to — and is logged in `ROADMAP.md`.

## First run — VERIFIED

The overview used to render a readiness verdict computed from no agent evidence
at all. On a project that had only been scanned it said "Do not ship this yet",
and on an untouched one it would have reached "ready" through empty gates.

There is now an explicit first-run state, keyed on whether any agent-sourced
event exists — not on an event count, because `scan` and `init` write events
of their own and open a session row. Verified by serving a scan-only project:
the first-run panel renders and the readiness hero does not.

## Control panel and context accounting — VERIFIED (0.2.1)

`/control` is one page carrying the terminal, the live feed, status, workflow,
findings, context spend and enforcement. It is the desktop landing page. Every
panel reads the same store as the CLI; none of them re-implements anything.

Context accounting is new, and it is an estimate by construction. Claude Code's
hook payloads carry no usage numbers, so the figures come from observed content
at ~4 characters per token. Two things were needed to make them real:

- **Reads were unmeasured.** `file.read` recorded no size at all, leaving the
  largest consumer of context invisible. It now records one — and the size has
  to come from `tool_response.file.content`, because the existing extractor
  scans top-level keys only and reported zero for every Read.
- **Avoidable could exceed what was read.** A repeat whose own size was unknown
  fell back to the file's last known size, but that figure never entered the
  read total. The panel could show more waste than traffic. Both totals are now
  computed from the same per-read figure, so `avoidable ≤ filesRead` holds by
  construction and is asserted in `tokens.test.ts`.

Measured against a real recorded session (68 events):

```
estimated      2.0k        files read 375 · written 301 · output 1.2k · prompts 121
avoidable      225         src/invoices.mjs read 4× unchanged
```

The word "saved" appears nowhere. A saving is a counterfactual and nothing
measures one; "avoidable" is content that demonstrably entered context twice
with nothing changing in between.

## Packaging note — 0.2.1

`node-pty` was declared as a dependency of `apps/desktop`, which made
electron-builder run `@electron/rebuild` and try to compile it from source.
That fails on a machine without the winpty submodule and build tools, and it
was never necessary: the package ships Node-API prebuilds and the stage script
copies the current platform's into `build-resources/runtime`. It is now a root
devDependency — a build input, not an app dependency — with `npmRebuild: false`
recording the intent.

## Interface — rebuilt (0.2.1)

The application shell was replaced. What changed, and why:

- **Frameless window.** `titleBarStyle: 'hidden'` with `titleBarOverlay` on
  Windows and Linux, `hiddenInset` on macOS. The OS still draws minimise,
  maximise and close — redrawing those in HTML loses Windows snap layouts and
  produces a close button that behaves almost like the real one. No Electron
  security setting changed: `contextIsolation`, `sandbox` and the absent
  preload bridge are exactly as they were.
- **Navigation rail** instead of a row of tabs. Eleven destinations in a line
  forced short labels and left no room for a count, so navigation could not
  show the one thing it is most needed for — where the problem is. Collapse
  state persists per machine.
- **Command palette** on `Ctrl+K` or `/`, with `Ctrl+1…4` for the four
  screens people move between while an agent works. Nothing shadows an OS or
  browser shortcut.
- **Design tokens** in `lib/design.ts`: one easing curve, three durations, a
  named surface set and a single status vocabulary. Severity colours stay in
  the Tailwind config, because those carry meaning the rules engine assigns
  rather than meaning the interface chooses.
- **Workflow as a rail**, not a list. Position carries "where are we" so the
  labels stop competing, and the fill stops at the current node rather than
  running past it — a bar reaching a stage nobody entered would claim progress
  the evidence does not support.
- **Findings open in a drawer**, with focus trapped and returned on close.
  Leaving the page threw away the context that made the finding legible.
- **Custom scrollbars**, which were the loudest remaining "web page in a
  window" signal.

Every animation is tied to real state. The only sustained motion on the page is
the current workflow node and a live dot that reflects actual connection state;
a live indicator that pulses while nothing is connected is the fastest way to
stop being believed.

### Not done

- Visual QA (the redesign brief's §62) could not be completed here. Electron's
  `capturePage` detaches without output in this shell and headless Edge would
  not write a file, so the interface was verified structurally — every route
  returns 200, every panel renders, the honest copy survives — but nobody has
  *looked* at it. That check is outstanding and it is the one that catches
  spacing, alignment and hierarchy problems.
- Diff viewer, security centre, agent-shortcuts screen, session replay redesign
  and the per-page treatments beyond the control panel are untouched. They use
  the new shell and tokens but keep their existing layouts.

## Known issues

- OSV's live API path is asserted against recorded responses, not against
  `api.osv.dev` — that host is unreachable from the build environment used here.
  The offline degradation path is verified; the live round trip is NOT TESTED.
- The Windows NSIS installer cannot be cross-built from Linux without 32-bit
  Wine. The Windows zip cross-builds cleanly and was produced and verified here;
  the installer is built natively by `.github/workflows/desktop.yml`.
- Building on Windows requires a short path. This repository's name is 85
  characters and the runner's checkout path contains it twice, which pushes
  app-builder-lib's NSIS includes past MAX_PATH. The workflow copies the tree to
  `D:\w` first; a junction is not enough, because Node resolves `require`
  through realpath and hands NSIS the long path anyway.
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
- The macOS dmg is built in CI but has never been launched on a Mac. Nothing in
  the desktop build is code-signed or notarized, so macOS will quarantine it.

## Architecture decisions

**No daemon.** Hooks give precise structured events; filesystem watching sees a
write but not who made it.

**`node:sqlite` via createRequire.** The event store needs no native module:
Electron 44 carries Node 24, so the packaged app gets SQLite from the runtime
it already ships.

**One native dependency, for the terminal only.** node-pty. This reverses the
earlier "zero native dependencies" position, and the argument is written up in
`DECISIONS.md` (ADR-001) rather than assumed. In short: it is Node-API based
and ships prebuilds, so it loads unchanged under both Node 22 and Electron's
Node 24 with no rebuild step — and embedding the agent closes the gap where a
session run in the wrong directory is simply never recorded.

**The desktop shell adds no analysis.** Two implementations of the same rules
would eventually disagree, and the one people trusted would be whichever they
happened to be looking at.

**External scanners rather than reimplementation.** npm audit, OSV and Semgrep
are better at their jobs than a reimplementation would be. CECC's contribution
is normalizing them into one model and being honest about which of them ran.

**Warn by default.** Blocking on day one gets the tool uninstalled before it
demonstrates value.

## Embedded terminal — verification state

VERIFIED against the running Electron application on Windows 11:

- The app starts, serves the dashboard on a random loopback port, and opening a
  project no longer raises "CECC stopped".
- `/terminal` returns 200 and renders "Running in MCQ-SaaS", which only happens
  when the PTY port and token reached the dashboard server.
- Connecting to that live socket with the credentials the page itself carries,
  and the page's own Origin, drives `idle → running` and returns 931 bytes of
  Claude Code TUI in the opened project.
- A standalone harness covers what the UI cannot reach: wrong token rejected,
  foreign Origin rejected, reattach replays scrollback, session survives a page
  reload, oversized input dropped. 12/12 against Claude Code 2.1.273.

NOT TESTED: the pixels. xterm.js has not been visually confirmed drawing in the
window — every layer beneath it has. "The socket works" is not "the canvas
draws", and that is the whole of the remaining gap.

## Next recommended task

Verify the OSV live path once from a network that can reach `api.osv.dev`, and
launch the macOS dmg once on a Mac. Both are the same shape of gap: code that
builds and is unit-tested, and has never met the real thing.
