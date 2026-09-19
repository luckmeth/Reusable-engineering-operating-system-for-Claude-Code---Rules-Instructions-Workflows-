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
        │                                      │
        │ BrowserWindow                        │ reads .cecc/cecc.db directly
        ▼                                      ▼
   the dashboard UI                    the same store the CLI and hooks use
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
| `docs/` | this documentation, opened by Help → Open documentation folder |
| `icon.png` | the window icon |
| `build-info.json` | version, build time, platform — so an installed copy can be identified |

## Opening a project

`File → Open project…` picks a directory. If it has no `.cecc/config.json`, the
app offers to initialize it and says plainly what that does: creates `.cecc/`,
registers Claude Code hooks in `.claude/settings.json` preserving any existing
ones, and sends nothing anywhere. The choice is remembered in the app's
`userData` directory.

`cecc init` writes the hook command pointing at whichever CLI is actually
running — the vendored copy in a project that has one, otherwise the CLI inside
the application. Writing a `node_modules` path that does not exist produces
hooks that silently never fire, which is worse than no hooks because the
dashboard still looks installed.

## Cross-building

Windows and macOS artifacts are built on their own runners by
`.github/workflows/desktop.yml` (`workflow_dispatch`, or a `v*` tag).

Cross-building the Windows **NSIS installer** from Linux needs Wine, including a
32-bit loader for the NSIS stub — `wine64` alone fails with
`failed to load ... syswow64\ntdll.dll`. The Windows **zip** target needs no
Wine and cross-builds cleanly. Nothing produced by CI is code-signed; signing
needs certificates the workflow does not have, and an installer that claimed a
publisher it could not prove would be worse than an unsigned one.

If a build host cannot download Electron (some proxies cut the download
mid-transfer), seed the cache with curl first:

```bash
node scripts/seed-electron-cache.mjs 44.4.3 linux-x64 win32-x64
```

That writes the artifacts where `@electron/get` already looks, so electron and
electron-builder both find a cache hit and never open a socket.
