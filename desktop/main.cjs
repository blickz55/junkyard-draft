// Electron shell for Junkyard Draft. Loads the production bundle from dist/ (run `npm run build` first).
// Offline only: no remote content, no telemetry. The Control Room is a dev tool and is not packaged.
const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// exported loop clips go straight to Downloads (no dialog); the name is sanitised and never leaves that folder.
// IPC hardening (review): only our window's main frame may call it, only clip types, only bounded byte payloads.
let mainWindow = null;
const CLIP_EXT = new Set(['.webm', '.mp4', '.gif']);
const MAX_CLIP_BYTES = 64 * 1024 * 1024;
ipcMain.handle('jd:save-clip', (event, name, bytes) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || (event.senderFrame && event.senderFrame !== mainWindow.webContents.mainFrame))
    throw new Error('save-clip: unexpected sender');
  const safe = String(name)
    .replace(/[^a-z0-9._$-]+/gi, '_')
    .slice(0, 80);
  if (!CLIP_EXT.has(path.extname(safe).toLowerCase())) throw new Error('save-clip: unsupported file type');
  const buf =
    bytes instanceof ArrayBuffer ? Buffer.from(bytes) : ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  if (!buf || buf.length === 0 || buf.length > MAX_CLIP_BYTES) throw new Error('save-clip: payload out of bounds');
  const dir = process.env.JD_CLIP_DIR || app.getPath('downloads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safe);
  fs.writeFileSync(file, buf);
  return file;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1a1612',
    autoHideMenuBar: true,
    title: 'Junkyard Draft',
    icon: path.join(__dirname, 'build', 'icon.png'), // used by dev runs; packaged builds embed it in the executable
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // JD_DEV_API=1 exposes the dev-only window.__jd test hooks (used by tools/perf.ts and smoke tests); never set in normal use.
  const query = process.env.JD_DEV_API === '1' ? { dev: '1' } : undefined;
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), query ? { query } : undefined);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  }); // the shell shows dist/ only; links open outside
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}
app.whenReady().then(() => {
  // production roadmap 0.8.0: the built page carries its Content-Security-Policy as a <meta> (scripts and connections only to itself and the baked verifier); the shell adds a permission handler that denies everything, since the game never asks for a device permission
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
