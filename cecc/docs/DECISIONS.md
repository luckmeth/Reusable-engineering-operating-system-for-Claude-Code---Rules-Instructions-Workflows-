# Decisions

Architecture decisions that are expensive to reverse. Decisions cheap to change
live in `PROJECT_STATE.md` under *Architecture decisions*; this file is for the
ones a future maintainer would otherwise re-litigate without knowing the cost.

---

### ADR-001 — Embed Claude Code in the desktop window, accepting one native dependency

- **Date:** 2026-09-20
- **Status:** accepted

**Context.** The most common reason the dashboard looks empty is not that CECC
is broken — it is that the day's work happened in a terminal CECC was never
wired into. Hooks are registered per project, so a session started from the
right directory is captured and one started elsewhere is not, and nothing in
the interface makes that distinction visible before the fact. Putting the agent
in the window removes the gap by construction: the session runs in the project
CECC opened, with that project's hooks.

Two prior decisions are in tension with this:

- *Zero native dependencies*, recorded in `PROJECT_STATE.md`. The argument was
  supply chain: a security tool that ships compiled blobs is asking for trust
  it spends elsewhere arguing against. `node:sqlite` exists specifically so
  the store needs no native module.
- *The renderer is sandboxed with no preload bridge*, recorded in
  `DESKTOP.md`. The window renders finding evidence taken from untrusted
  repository content, so it was given no capability worth attacking.

**Options considered.**

1. **A launch button.** Open the system terminal in the project directory. No
   new dependency, no posture change. It does not put the agent in the window,
   and on Windows it means a second application with its own font, colours and
   lifecycle — the thing the request was about avoiding.
2. **Pipes instead of a PTY.** `child_process` with piped stdio and no native
   module. Claude Code is a full-screen TUI: it needs raw-mode input, cursor
   addressing and a real window size. Through pipes it degrades to unusable,
   and there is no pure-JS ConPTY binding to fall back on.
3. **A non-interactive panel.** Drive `claude -p --output-format stream-json`
   from a chat-style UI. No PTY, no native module, but it is a different and
   worse product than the CLI people already know, and a large build.
4. **node-pty plus xterm.js.** The real terminal, at the cost of a native
   dependency and a wider renderer capability.

**Chosen:** (4).

**Reason.** The supply-chain cost turned out to be much smaller than the
original decision assumed. node-pty 1.1 is built against Node-API and ships
prebuilt binaries, so one file loads unchanged under Node 22 on the command
line and under Electron 44's Node 24 in the packaged app. There is no
`electron-rebuild`, no per-ABI matrix, and no compiler on the build host. What
remains is one well-maintained binary from a first-party Microsoft package,
staged for the current platform only.

The renderer's capability is the part that genuinely changed, and it is bounded
deliberately rather than by hope:

- the page sends keystrokes and a terminal size, and cannot name a program —
  the executable, its arguments and its cwd are chosen in the main process;
- the session belongs to the opened project and dies when it changes;
- the socket needs a loopback connection, a random port, a 32-byte per-launch
  token compared in constant time, and the dashboard's own Origin;
- frames over 64KB are dropped.

**Trade-offs, stated plainly.**

- The "zero native dependencies" claim is no longer true and has been corrected
  wherever it was written down. `node:sqlite` still means the *store* needs no
  native module; the terminal does.
- An XSS in the dashboard now reaches a live agent session in the opened
  project, where before it reached a read-only page. That is a real escalation.
  It is argued, bounded and recorded in `THREAT_MODEL.md` rather than described
  as harmless.
- node-pty publishes prebuilds for darwin and win32 but not linux, so a Linux
  build compiles it from source and needs a toolchain. `stage-desktop.mjs`
  throws rather than shipping an app whose terminal silently cannot start.

**Reversing it** costs a release: delete `terminal.cjs`, the `/terminal` route
and the `runtime/` staging block, and drop two dependencies. Nothing else
depends on it, which is why it was built as a separate process boundary rather
than threaded through the dashboard server.
