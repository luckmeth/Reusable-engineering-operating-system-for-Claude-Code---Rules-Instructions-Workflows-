import 'server-only';

/**
 * What the desktop shell has made available to this dashboard.
 *
 * The same build serves a plain browser (`npm start`) and the Electron window.
 * Offering the project picker or the terminal in a browser would be offering
 * dead links, so the shell announces itself through the environment it spawns
 * the server with, and pages ask here rather than guessing.
 */
export interface DesktopShell {
  inShell: boolean;
  /**
   * Where the embedded terminal accepts a WebSocket, and the token for it.
   *
   * The token reaches the page HTML, which is the point — the sandboxed
   * renderer has no other way to receive it. It authenticates the socket
   * against anything else on the machine that might find the port; it is not
   * a defence against code already running inside this page, and nothing in
   * the design pretends otherwise.
   */
  terminal: { port: number; token: string } | null;
}

export function desktopShell(): DesktopShell {
  const inShell = process.env['CECC_DESKTOP'] === '1';
  const port = Number(process.env['CECC_TERMINAL_PORT'] ?? '');
  const token = process.env['CECC_TERMINAL_TOKEN'] ?? '';

  return {
    inShell,
    terminal: inShell && Number.isInteger(port) && port > 0 && token ? { port, token } : null,
  };
}
