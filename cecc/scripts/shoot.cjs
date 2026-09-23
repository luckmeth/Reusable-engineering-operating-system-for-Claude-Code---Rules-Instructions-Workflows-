/**
 * Screenshot harness for visual review.
 *
 * Loads a dashboard URL in a real Electron window and writes a PNG. The
 * alternative — deciding the interface looks right because the types check —
 * is how a layout ships with a panel overlapping the scrollbar.
 *
 * Usage: electron scripts/shoot.cjs <url> <out.png> [width] [height]
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');

const [url, out, width = '1440', height = '900'] = process.argv.slice(2);

if (!url || !out) {
  console.error('usage: electron scripts/shoot.cjs <url> <out.png> [width] [height]');
  process.exit(2);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(width),
    height: Number(height),
    show: false,
    backgroundColor: '#0b0d10',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  try {
    await win.loadURL(url);
    // Next hydrates and Framer Motion runs entry animations on mount; capturing
    // immediately catches everything mid-fade at opacity 0.
    await new Promise((r) => setTimeout(r, 2500));
    const image = await win.webContents.capturePage();
    writeFileSync(out, image.toPNG());
    console.log(`wrote ${out}`);
    process.exitCode = 0;
  } catch (err) {
    console.error('capture failed:', err && err.message);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});
