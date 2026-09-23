/**
 * CECC desktop shell.
 *
 * The desktop application is the same three parts as the command line — the
 * core, the CLI and the Next.js dashboard — with a window around them. It adds
 * no analysis of its own, which is deliberate: two implementations of the same
 * rules would eventually disagree, and the one people trusted would be whichever
 * they happened to be looking at.
 *
 * The dashboard runs as a child process rather than inside the renderer. It
 * needs `node:sqlite`, the filesystem and the ability to spawn the CLI; a
 * renderer that could do those things would have to run without the sandbox,
 * and this window renders findings that came from untrusted repository content.
 */
const { app, BrowserWindow, Menu, dialog, shell, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { join, resolve, sep } = require('node:path');
const { TerminalHost } = require('./terminal.cjs');

// Staged resources live beside the Electron entry point in both layouts. In a
// packaged build they are unpacked out of the asar archive, because a child
// process cannot be spawned from a path inside one and Next reads its build
// output as ordinary files. Rewriting the segment covers both cases without a
// branch that only one of them ever exercises.
const RESOURCES = resolve(__dirname, '..', 'build-resources').replace(
  `${sep}app.asar${sep}`,
  `${sep}app.asar.unpacked${sep}`,
);

/** Where the staged dashboard server and CLI live inside the application. */
const SERVER_ENTRY = join(RESOURCES, 'server', 'apps', 'dashboard', 'server.js');
const SERVER_CWD = join(RESOURCES, 'server', 'apps', 'dashboard');
const CLI_ENTRY = join(RESOURCES, 'cli', 'index.js');

let serverProcess = null;
let mainWindow = null;
let serverPort = 0;
let quitting = false;
/** The embedded Claude Code terminal, or null if its backend failed to load. */
let terminal = null;

/**
 * Paths the dashboard can ask the main process to act on.
 *
 * The renderer is sandboxed with no preload bridge, so it cannot call in. A
 * navigation to one of these is intercepted below and never actually loaded,
 * which gives the page a way to raise a native dialog without exposing an API
 * surface. The set is fixed and every entry opens something the user must then
 * act on themselves — a page cannot make a silent change this way.
 */
const CONTROL_PREFIX = '/__cecc/';

/**
 * The page the window opens on.
 *
 * The control panel carries the terminal, the live feed and every standing
 * number, so it is the page that answers "what is happening" without a click.
 * The per-topic pages stay in the nav for the detail behind each panel.
 */
const LANDING = '/control';

// ---------------------------------------------------------------- app state

function statePath() {
  return join(app.getPath('userData'), 'state.json');
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(statePath(), `${JSON.stringify({ ...readState(), ...patch }, null, 2)}\n`, 'utf8');
  } catch {
    // Losing the remembered project is a small inconvenience, not a reason to
    // fail startup. The picker still works.
  }
}

/** The project the window is pointed at, if one was chosen and still exists. */
function currentProject() {
  const saved = readState().projectRoot;
  if (saved && existsSync(saved)) return saved;
  return null;
}

// ------------------------------------------------------------ server process

function freePort() {
  return new Promise((resolveport, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolveport(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        resolveWait();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`The dashboard did not start within ${Math.round(timeoutMs / 1000)}s.`));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

/**
 * Starts the dashboard.
 *
 * `ELECTRON_RUN_AS_NODE` runs the bundled Electron binary as plain Node, so the
 * packaged application needs no Node installed on the machine. It is also why
 * `node:sqlite` is available: Electron 44 carries Node 24.
 */
async function startServer(projectRoot) {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`The dashboard server is missing from this build (${SERVER_ENTRY}).`);
  }

  serverPort = await freePort();

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_CWD,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(serverPort),
      HOSTNAME: '127.0.0.1',
      // Binding to loopback is the access control. There is no authentication
      // on the dashboard because there is no network path to it.
      ...(projectRoot ? { CECC_PROJECT_ROOT: projectRoot } : {}),
      CECC_CLI_PATH: CLI_ENTRY,
      // Lets the dashboard offer things that only exist in the desktop shell —
      // the project picker and the embedded terminal — and hide them in a
      // plain browser, where they would be dead links.
      CECC_DESKTOP: '1',
      ...(terminal ? { CECC_TERMINAL_PORT: String(terminal.port), CECC_TERMINAL_TOKEN: terminal.token } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const child = serverProcess;
  child.stdout.on('data', (chunk) => process.stdout.write(`[dashboard] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[dashboard] ${chunk}`));

  child.on('exit', (code, signal) => {
    if (serverProcess === child) serverProcess = null;
    // Opening a project restarts this process on purpose. On Windows that
    // arrives as exit code null, which the previous check read as a crash, so
    // switching project always raised "CECC stopped". Worse, showErrorBox
    // blocks the main process: the window sat on the page it was leaving until
    // the dialog was dismissed, which looked like the app had hung.
    if (quitting || child.ceccExpectedExit || code === 0) return;

    const options = {
      type: 'error',
      title: 'CECC stopped',
      message: 'The dashboard stopped unexpectedly.',
      detail: signal
        ? `The process was terminated by ${signal}. Use File → Open project… to start it again.`
        : `The process exited with code ${code}. Use File → Open project… to start it again.`,
      buttons: ['OK'],
    };
    void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
  });

  await waitForServer(serverPort);
  return serverPort;
}

function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  // Tells the exit handler above that what follows is intentional.
  child.ceccExpectedExit = true;
  try {
    child.kill('SIGTERM');
    // SIGTERM first, then insist. A stranded server would hold the port and
    // the SQLite WAL after the window is gone.
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 3000).unref?.();
  } catch {
    /* already gone */
  }
}

// -------------------------------------------------------------------- window

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0d10',
    title: 'CECC — Engineering Control Center',
    show: false,
    icon: join(RESOURCES, 'icon.png'),
    // The window frame is ours to draw, but the buttons are not.
    //
    // `titleBarOverlay` keeps the real minimise, maximise and close controls —
    // drawn by the OS, positioned over the page — while the rest of the bar
    // becomes application surface. Redrawing those three buttons in HTML is
    // how an application ends up with a close button that behaves almost like
    // the real one, and it costs the snap layouts Windows attaches to them.
    //
    // macOS keeps its traffic lights through `hiddenInset`; the overlay API is
    // Windows and Linux only.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarOverlay: {
            color: '#0b0d10',
            symbolColor: '#9aa3af',
            height: 44,
          },
        }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // No preload bridge. The window talks to the local server over HTTP and
      // needs nothing from the main process, so there is no API to expose and
      // nothing for a compromised renderer to call.
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // A finding's evidence comes from repository content, which is untrusted.
  // Anything that tries to leave the local dashboard is handed to the system
  // browser instead of being rendered with this window's privileges.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const action = controlAction(url);
    if (action) {
      event.preventDefault();
      runControlAction(action);
      return;
    }
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      if (/^https:/.test(url)) void shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/** The control name in a `/__cecc/<name>` navigation, or null. */
function controlAction(url) {
  if (!serverPort) return null;
  const prefix = `http://127.0.0.1:${serverPort}${CONTROL_PREFIX}`;
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length).split(/[?#]/)[0];
}

/** An allowlist, not a dispatcher: an unknown name does nothing at all. */
function runControlAction(action) {
  if (action === 'open-project') {
    void pickProject();
    return;
  }
  if (action === 'reveal') {
    const root = currentProject();
    if (root) void shell.openPath(root);
  }
}

function loadSplash(message) {
  if (!mainWindow) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CECC</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin:0; height:100vh; display:grid; place-items:center; font:15px/1.5 ui-sans-serif,system-ui,sans-serif;
             background:#f7f8fa; color:#3d4351; }
      @media (prefers-color-scheme: dark) { body { background:#0b0d12; color:#9aa3b2; } }
      .box { text-align:center; }
      .mark { font-size:13px; letter-spacing:.22em; text-transform:uppercase; opacity:.55; margin-bottom:.9rem; }
      .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:currentColor; margin:0 3px;
             animation:p 1.2s infinite ease-in-out; }
      .dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}
      @keyframes p { 0%,80%,100%{opacity:.25} 40%{opacity:1} }
      @media (prefers-reduced-motion: reduce) { .dot { animation:none; opacity:.6 } }
    </style></head>
    <body><div class="box"><div class="mark">CECC</div><div>${message}</div>
    <div style="margin-top:1rem"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div></body></html>`;
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function showError(message, detail) {
  if (!mainWindow) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CECC</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin:0; min-height:100vh; display:grid; place-items:center; font:15px/1.6 ui-sans-serif,system-ui,sans-serif;
             background:#f7f8fa; color:#3d4351; padding:2rem; }
      @media (prefers-color-scheme: dark) { body { background:#0b0d12; color:#9aa3b2; } }
      .box { max-width:44rem; }
      h1 { font-size:1.15rem; margin:0 0 .6rem; color:#c0392b; }
      pre { white-space:pre-wrap; font-size:12.5px; opacity:.8; background:rgba(127,127,127,.12); padding:.8rem; border-radius:8px; }
    </style></head>
    <body><div class="box"><h1>${message}</h1><pre>${String(detail ?? '').replace(/[<&]/g, (m) => (m === '<' ? '&lt;' : '&amp;'))}</pre>
    <p>Use <strong>File → Open project…</strong> to point CECC at a directory, or run <code>cecc init</code> there first.</p>
    </div></body></html>`;
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function openProject(root) {
  writeState({ projectRoot: root });
  loadSplash('Opening project…');
  stopServer();
  try {
    const port = await startServer(root);
    terminal?.setAllowedOrigin(`http://127.0.0.1:${port}`);
    terminal?.setProjectRoot(root);
    await mainWindow?.loadURL(`http://127.0.0.1:${port}${LANDING}`);
  } catch (err) {
    showError('The dashboard could not start.', err && err.message);
  }
}

async function pickProject() {
  const result = await dialog.showOpenDialog({
    title: 'Open a project',
    properties: ['openDirectory'],
    message: 'Choose the repository CECC should watch.',
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const chosen = result.filePaths[0];
  if (!existsSync(join(chosen, '.cecc', 'config.json'))) {
    const answer = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Initialize here', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'CECC is not initialized in that directory.',
      detail:
        'Initializing creates .cecc/ and registers Claude Code hooks in .claude/settings.json. ' +
        'Existing hooks are preserved. Nothing is sent anywhere.',
    });
    if (answer.response !== 0) return;
    await runCli(['init', '--cwd', chosen]);
  }
  await openProject(chosen);
}

/** Runs the bundled CLI. The argument list is built here, never from input. */
function runCli(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('exit', (code) => resolveRun({ code, out }));
    child.on('error', (err) => resolveRun({ code: -1, out: String(err) }));
  });
}

// ---------------------------------------------------------------------- menu

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open project…', accelerator: 'CmdOrCtrl+O', click: () => void pickProject() },
        {
          label: 'Control panel',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            if (serverPort) void mainWindow?.loadURL(`http://127.0.0.1:${serverPort}${LANDING}`);
          },
        },
        {
          label: 'Claude Code terminal',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (serverPort) void mainWindow?.loadURL(`http://127.0.0.1:${serverPort}/terminal`);
          },
        },
        {
          label: 'Reveal project folder',
          click: () => {
            const root = currentProject();
            if (root) void shell.openPath(root);
          },
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload dashboard', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'What CECC does not do',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              message: 'Known limitations',
              detail:
                'CECC observes what an agent does through its tools. It never reads the agent\'s reasoning.\n\n' +
                'Detection is static analysis, not proof. "No findings" means no rule matched — not that the code is secure.\n\n' +
                'The event log is tamper-evident, not tamper-proof: edits are detectable, not prevented.\n\n' +
                'Hooks fail open. If analysis exceeds its deadline the action proceeds, and the gap is recorded.\n\n' +
                'Nothing leaves this machine unless cloud sync is explicitly enabled.',
            });
          },
        },
        {
          label: 'Open documentation folder',
          click: () => void shell.openPath(join(RESOURCES, 'docs')),
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu' });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --------------------------------------------------------------------- start

// One window is the whole application; a second instance should focus it
// rather than start a second dashboard against the same database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    createWindow();
    loadSplash('Starting the dashboard…');

    // Started before the dashboard so its port and token can be handed to
    // the server as environment. A failure here costs the terminal tab and
    // nothing else — the dashboard is the product.
    try {
      terminal = new TerminalHost(RESOURCES);
      await terminal.start();
    } catch (err) {
      console.error('[terminal] backend unavailable:', err && err.message);
      terminal = null;
    }

    const root = currentProject();
    try {
      const port = await startServer(root);
      terminal?.setAllowedOrigin(`http://127.0.0.1:${port}`);
      terminal?.setProjectRoot(root);
      await mainWindow?.loadURL(`http://127.0.0.1:${port}${LANDING}`);
      if (!root) {
        // No project yet: the dashboard renders its own "not initialized"
        // screen, and the picker is one menu item away.
        writeState({ projectRoot: null });
      }
    } catch (err) {
      showError('The dashboard could not start.', err && err.message);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    terminal?.stop();
    stopServer();
  });

  app.on('window-all-closed', () => {
    terminal?.stop();
    stopServer();
    if (process.platform !== 'darwin') app.quit();
  });
}
