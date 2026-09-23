/**
 * The embedded Claude Code terminal.
 *
 * A pseudo-terminal lives here in the main process and the dashboard page
 * attaches to it over a loopback WebSocket. The renderer is sandboxed and has
 * no preload bridge, so this socket is the only channel — and it is
 * deliberately a narrow one.
 *
 * Three properties do the security work, because this window renders finding
 * evidence that came from untrusted repository content:
 *
 *   1. **The renderer cannot choose the command.** It sends keystrokes and a
 *      terminal size, nothing else. The program, its arguments and its working
 *      directory are decided here, from the project the user opened. A general
 *      shell would have been less code and strictly worse: a page that can
 *      write `powershell -c …` is a page that can run anything.
 *   2. **Loopback plus a per-launch token.** The port is random, the token is
 *      32 random bytes compared in constant time, and the Origin header must
 *      be the dashboard's own.
 *   3. **One terminal, owned by the opened project.** Changing project kills
 *      it; there is no way to ask for a session somewhere else on disk.
 *
 * What this does not do is make the terminal safe from the person typing into
 * it. Claude Code can run commands, and CECC watches that through hooks like
 * any other session. See docs/THREAT_MODEL.md.
 */
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { existsSync } = require('node:fs');
const http = require('node:http');
const { delimiter, extname, join } = require('node:path');

/** Output kept for a page reload, so Ctrl+R does not discard the session. */
const SCROLLBACK_BYTES = 256 * 1024;
/** A keystroke frame is tiny; a paste is not. Anything larger is not input. */
const MAX_INPUT_BYTES = 64 * 1024;

/**
 * Loads a module that is staged inside the packaged application, falling back
 * to normal resolution when running from the workspace (`desktop:start`).
 */
function loadBundled(resourcesDir, name) {
  const staged = join(resourcesDir, 'runtime', 'node_modules', name);
  if (existsSync(staged)) return require(staged);
  return require(name);
}

/**
 * Finds the Claude Code executable.
 *
 * npm installs it as a `.cmd` shim on Windows, which CreateProcess cannot run
 * directly, so the extension decides how it is spawned further down.
 */
function findClaude() {
  const fromEnv = process.env.CECC_CLAUDE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  // npm's global bin is not always on the PATH of a GUI process launched from
  // the shell, which is exactly how this application starts.
  if (process.platform === 'win32' && process.env.APPDATA) {
    dirs.push(join(process.env.APPDATA, 'npm'));
  } else if (process.env.HOME) {
    dirs.push(join(process.env.HOME, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin');
  }

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `claude${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

class TerminalHost {
  /** @param {string} resourcesDir staged resources root */
  constructor(resourcesDir) {
    this.resourcesDir = resourcesDir;
    this.token = randomBytes(32).toString('hex');
    this.port = 0;
    this.allowedOrigin = null;
    this.projectRoot = null;

    this.pty = null;
    this.scrollback = '';
    this.sockets = new Set();
    this.lastExit = null;

    this.server = null;
    this.wss = null;
  }

  // ------------------------------------------------------------- lifecycle

  async start() {
    const { WebSocketServer } = loadBundled(this.resourcesDir, 'ws');

    this.server = http.createServer((_req, res) => {
      // Nothing is served over HTTP here; the port exists for the upgrade.
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ noServer: true });

    this.server.on('upgrade', (req, socket, head) => {
      if (!this.authorize(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve();
      });
    });

    return { port: this.port, token: this.token };
  }

  /** Called once the dashboard's own port is known. */
  setAllowedOrigin(origin) {
    this.allowedOrigin = origin;
  }

  /** Changing project ends the session; a terminal belongs to one repository. */
  setProjectRoot(root) {
    if (this.projectRoot === root) return;
    this.projectRoot = root;
    this.killPty('project changed');
    this.scrollback = '';
    this.broadcast({ t: 'reset' });
  }

  stop() {
    this.killPty('shutting down');
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    }
    this.sockets.clear();
    try {
      this.wss?.close();
      this.server?.close();
    } catch {
      /* already gone */
    }
  }

  // ----------------------------------------------------------------- authz

  authorize(req) {
    if (this.allowedOrigin && req.headers.origin !== this.allowedOrigin) return false;

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const offered = Buffer.from(url.searchParams.get('token') ?? '', 'utf8');
    const expected = Buffer.from(this.token, 'utf8');
    if (offered.length !== expected.length) return false;
    return timingSafeEqual(offered, expected);
  }

  // ------------------------------------------------------------- transport

  attach(ws) {
    this.sockets.add(ws);

    // Replay what the session already printed, so reloading the page rejoins
    // the running Claude Code rather than losing it.
    if (this.scrollback) this.send(ws, { t: 'o', d: this.scrollback });
    if (this.pty) this.send(ws, { t: 'running' });
    else if (this.lastExit !== null) this.send(ws, { t: 'x', code: this.lastExit });
    else this.send(ws, { t: 'idle' });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.handle(ws, msg);
    });

    ws.on('close', () => this.sockets.delete(ws));
    ws.on('error', () => this.sockets.delete(ws));
  }

  handle(ws, msg) {
    switch (msg?.t) {
      case 'start':
        this.startPty(Number(msg.cols), Number(msg.rows));
        break;
      case 'i': {
        // A string, bounded. The PTY is the only consumer and it is attached
        // to a fixed program, so this is keystrokes — never a command.
        if (typeof msg.d !== 'string' || Buffer.byteLength(msg.d) > MAX_INPUT_BYTES) return;
        this.pty?.write(msg.d);
        break;
      }
      case 'r': {
        const cols = clamp(msg.c, 20, 500);
        const rows = clamp(msg.r, 5, 300);
        if (cols && rows) {
          try {
            this.pty?.resize(cols, rows);
          } catch {
            /* the process may have just exited */
          }
        }
        break;
      }
      case 'stop':
        this.killPty('stopped from the dashboard');
        break;
      default:
        break;
    }
  }

  send(ws, payload) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* the socket went away mid-write */
    }
  }

  broadcast(payload) {
    for (const ws of this.sockets) this.send(ws, payload);
  }

  // ------------------------------------------------------------------- pty

  startPty(cols, rows) {
    if (this.pty) return;
    if (!this.projectRoot) {
      this.broadcast({ t: 'e', m: 'Open a project first — a terminal belongs to one repository.' });
      return;
    }

    const claude = findClaude();
    if (!claude) {
      this.broadcast({
        t: 'e',
        m: 'Claude Code was not found. Install it with `npm install -g @anthropic-ai/claude-code`, then reopen this tab.',
      });
      return;
    }

    let pty;
    try {
      pty = loadBundled(this.resourcesDir, 'node-pty');
    } catch (err) {
      this.broadcast({ t: 'e', m: `The terminal backend failed to load: ${err.message}` });
      return;
    }

    // A .cmd shim needs a command interpreter; a real executable does not.
    // Either way the argument list is built here and never from the renderer.
    const windowsShim = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(claude).toLowerCase());
    const file = windowsShim ? process.env.ComSpec || 'cmd.exe' : claude;
    const args = windowsShim ? ['/c', claude] : [];

    try {
      this.pty = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: clamp(cols, 20, 500) || 100,
        rows: clamp(rows, 5, 300) || 30,
        cwd: this.projectRoot,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (err) {
      this.broadcast({ t: 'e', m: `The terminal could not start: ${err.message}` });
      return;
    }

    this.lastExit = null;
    this.scrollback = '';
    this.broadcast({ t: 'running' });

    this.pty.onData((data) => {
      this.scrollback = (this.scrollback + data).slice(-SCROLLBACK_BYTES);
      this.broadcast({ t: 'o', d: data });
    });

    this.pty.onExit(({ exitCode }) => {
      this.pty = null;
      this.lastExit = exitCode ?? 0;
      this.broadcast({ t: 'x', code: this.lastExit });
    });
  }

  killPty(reason) {
    if (!this.pty) return;
    const pty = this.pty;
    this.pty = null;
    this.lastExit = null;
    try {
      pty.kill();
    } catch {
      /* already gone */
    }
    this.broadcast({ t: 'e', m: `Session ended — ${reason}.` });
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

module.exports = { TerminalHost, findClaude };
