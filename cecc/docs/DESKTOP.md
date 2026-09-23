# Desktop Application

The desktop build is the same three parts as the command line — the core, the
CLI and the Next.js dashboard — with a window around them. It adds no analysis
of its own. Two implementations of the same rules would eventually disagree, and
the one people trusted would be whichever they happened to be looking at.

## Build it

```bash
cd cecc
npm ci
npm run desktop:linux    # AppImage + tar.gz
npm run desktop:win      # NSIS installer + zip
npm run desktop:mac      # dmg + zip
```

Each of those runs `npm run desktop` first, which builds the packages, builds
the dashboard as a Next standalone server, generates the icons and stages
everything into `apps/desktop/build-resources/`. Artifacts land in
`apps/desktop/release/`.

To run the packaged shell without building an installer:

```bash
npm run desktop:start
```

## How it is put together

```
Electron main process  ── spawns ──▶  Next standalone server (127.0.0.1:<random>)
        │       │                              │
        │       └── owns ──▶ pty ──▶ claude    │ reads .cecc/cecc.db directly
        │ BrowserWindow          ▲             ▼
        ▼                        │     the same store the CLI and hooks use
   the dashboard UI ── ws(127.0.0.1:<random>) ─┘
```

The dashboard runs as a **child process**, not in the renderer. It needs
`node:sqlite`, the filesystem, and the ability to spawn the CLI; a renderer that
could do those things would have to run without the sandbox, and this window
renders findings whose evidence came from untrusted repository content.

The child is spawned with `ELECTRON_RUN_AS_NODE=1` against `process.execPath`,
so the packaged application runs on its own bundled Node and needs nothing
installed on the machine. Electron 44 carries Node 24, which is why
`node:sqlite` is available there — the zero-native-dependency decision holds in
the desktop build exactly as it does on the command line.

The server binds to `127.0.0.1` on a port chosen at startup. That binding is the
access control: there is no authentication on the dashboard because there is no
network path to it.

## The window opens on the control panel

`/control` carries the terminal, the live feed and every standing number, so
the application answers "what is happening here" before anything is clicked.
The per-topic pages stay in the nav for the detail behind each panel, and
`Ctrl+1` returns to the panel from any of them.

The information was always there. It was spread over seven pages, which meant
the page someone read was whichever they happened to land on, and the answer
they got was partial.

## The embedded Claude Code terminal

`apps/desktop/electron/terminal.cjs` holds a pseudo-terminal in the main
process and the `/terminal` page attaches to it over a loopback WebSocket.
A session started there runs in the project CECC is watching, with that
project's hooks registered, so the work appears on the other tabs. That is the
actual point: the most common reason the dashboard looks empty is that the day's
work happened in a terminal CECC was never wired into.

The renderer sends two kinds of message — keystrokes and a terminal size. It
cannot name a program. What starts is resolved in the main process, in the
directory the user opened. The socket needs the random port, a 32-byte
per-launch token compared in constant time, and an Origin equal to the
dashboard's own.

The session outlives the page. Reloading reattaches and replays up to 256KB of
scrollback rather than killing a running agent; changing project ends it.

`docs/THREAT_MODEL.md` states what this costs, because it does cost something:
the window renders untrusted repository content, and it can now reach a live
agent session.

### node-pty, and the native dependency it costs

node-pty is the project's only native dependency, and its arrival contradicts a
decision documented elsewhere in these docs — so the reasoning is recorded in
`docs/DECISIONS.md` rather than left implicit.

The practical cost is smaller than it sounds. node-pty 1.1 is built against
Node-API and ships prebuilt binaries, so the same file loads under Node 22 on
the command line and under Electron 44's Node 24 in the packaged app. There is
no `electron-rebuild` step and no per-ABI matrix. What remains is a real
binary in the supply chain, which is the part that matters and the part the ADR
argues about.

Staging copies only the current platform's prebuild, and skips the `.pdb`
debug symbols that make up roughly 28MB of the 29MB Windows directory. If no
prebuild exists for the build platform, `stage-desktop.mjs` throws instead of
shipping an application whose terminal cannot start.

## Security posture of the window

| Setting | Value | Why |
|---|---|---|
| `contextIsolation` | `true` | Renderer cannot reach Electron internals |
| `nodeIntegration` | `false` | No Node in the page |
| `sandbox` | `true` | Renderer runs in the OS sandbox |
| preload bridge | none | Nothing to expose, so nothing to attack |
| `setWindowOpenHandler` | deny | Popups are refused; https links go to the system browser |
| `will-navigate` | origin-locked | Anything off `127.0.0.1:<port>` is blocked |

A single instance lock means a second launch focuses the existing window rather
than starting a second dashboard against the same database.

## What ships inside

`apps/desktop/build-resources/` is packaged as **unpacked** app files
(`asarUnpack`), not as `extraResources`. electron-builder strips `node_modules`
from `extraResources`, which silently removes the dashboard's and the CLI's
dependencies; unpacked app files keep the tree intact and, just as importantly,
keep them as real files on disk, which spawning a process and reading Next's
build output both require.

Staged contents:

| Path | What |
|---|---|
| `server/` | Next standalone output plus `.next/static` |
| `cli/` | the built CLI, with `@cecc/core` and `zod` placed for plain Node resolution |
| `runtime/` | `node-pty` (this platform's prebuild only) and `ws`, for the terminal |
| `docs/` | this documentation, opened by Help → Open documentation folder |
| `icon.png` | the window icon |
| `build-info.json` | version, build time, platform — so an installed copy can be identified |

## Opening a project

`File → Open project…` picks a directory. If it has no `.cecc/config.json`, the
app offers to initialize it and says plainly what that does: creates `.cecc/`,
registers Claude Code hooks in `.claude/settings.json` preserving any existing
ones, and sends nothing anywhere. The choice is remembered in the app's
`userData` directory.

The same action is a button in the middle of the window when no project is
open. It has to be: the previous screen told people to run `cecc init`, and the
Windows installer puts nothing on PATH, so the only instruction on screen was a
command that does not exist.

The button is an ordinary link to `/__cecc/open-project`. The main process
intercepts the navigation in `will-navigate` and never loads it. That gives the
page a way to raise a native dialog while the renderer keeps its sandbox and
its lack of a preload bridge — there is no API object to reach for, and the
accepted names are a fixed list, each of which opens something the user then has
to act on. A page cannot make a silent change this way.

`cecc init` writes the hook command pointing at whichever CLI is actually
running — the vendored copy in a project that has one, otherwise the CLI inside
the application. Writing a `node_modules` path that does not exist produces
hooks that silently never fire, which is worse than no hooks because the
dashboard still looks installed.

The same argument applies to the interpreter, which is why init running inside
Electron does not write `node "<hook>"`. This application exists so that people
without Node can use CECC; handing them a hook that needs `node` on PATH is the
same silent failure one level down. Instead it writes `.cecc/hook.cmd` (or
`hook.sh`), a one-line launcher that sets `ELECTRON_RUN_AS_NODE=1` and runs the
application's own binary — an environment variable a settings.json command
string cannot portably carry. `cecc doctor` reports a `node`-based hook whose
interpreter is missing as a failure.

## Cross-building

Windows and macOS artifacts are built on their own runners by
`.github/workflows/desktop.yml` (`workflow_dispatch`, or a `v*` tag).

Cross-building the Windows **NSIS installer** from Linux needs Wine, including a
32-bit loader for the NSIS stub — `wine64` alone fails with
`failed to load ... syswow64\ntdll.dll`. The Windows **zip** target needs no
Wine and cross-builds cleanly. Nothing produced by CI is code-signed; signing
needs certificates the workflow does not have, and an installer that claimed a
publisher it could not prove would be worse than an unsigned one.

Two things the workflow has to work around, both worth knowing if you fork it:

- **Windows MAX_PATH.** This repository's name is 85 characters and the runner
  puts it in the checkout path twice, which pushes app-builder-lib's NSIS
  includes past 260 characters and fails the build with `!include: could not
  open file`. `makensis` is a legacy binary that ignores long-path support, so
  the build needs a genuinely shorter path. A junction is not enough — Node
  resolves `require` through `realpath`, so app-builder-lib's `__dirname` comes
  back long and NSIS is handed the long path anyway. The workflow copies the
  tree to `D:\w` and builds there.
- **Auto-publish.** electron-builder publishes to GitHub Releases on its own
  when it sees CI and a `repository` field, and then fails for want of a token
  *after* building every artifact. Every `dist:*` script passes
  `--publish never`; releasing is a deliberate act, not a side effect of a
  build.

If a build host cannot download Electron (some proxies cut the download
mid-transfer), seed the cache with curl first:

```bash
node scripts/seed-electron-cache.mjs 44.4.3 linux-x64 win32-x64
```

That writes the artifacts where `@electron/get` already looks, so electron and
electron-builder both find a cache hit and never open a socket.
