// Electron shell for Junkyard Draft. Loads the production bundle from dist/ (run `npm run build` first).
// Offline only: no remote content, no telemetry. The Control Room is a dev tool and is not packaged.
const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { makeSteamHandler } = require('./steam-bridge.cjs');
const { makeRecordHandler } = require('./record-file.cjs');

// IPC hardening (review): only our window's main frame may call the shell; anything else is refused before an argument is read.
let mainWindow = null;
function assertSender(event, what) {
  if (!mainWindow || event.sender !== mainWindow.webContents || (event.senderFrame && event.senderFrame !== mainWindow.webContents.mainFrame))
    throw new Error(`${what}: unexpected sender`);
}

// exported loop clips go straight to Downloads (no dialog); the name is sanitised and never leaves that folder.
// Only clip types, only bounded byte payloads.
const CLIP_EXT = new Set(['.webm', '.mp4', '.gif']);
const MAX_CLIP_BYTES = 64 * 1024 * 1024;
ipcMain.handle('jd:save-clip', (event, name, bytes) => {
  assertSender(event, 'save-clip');
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

// The Steam bridge (desktop/steam-bridge.cjs, desktop/README.md). steamworks.js is required only inside a try, so a shell without it
// (every shell until the owner installs it) answers "not available" and the game plays as the web edition does. It is attempted only
// for a Steam build (dist/build.json's edition, scripts/build-steam.mjs) that knows its app id: SteamAppId in the environment when
// Steam launched us, else steam_appid.txt beside the executable for a dev launch (and, unpackaged, beside package.json), a file that
// never ships in a depot and is git-ignored.
const DIST = path.join(__dirname, '..', 'dist');
function buildEdition() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIST, 'build.json'), 'utf8')).edition === 'steam' ? 'steam' : 'web';
  } catch {
    return 'web';
  }
}
function readAppId(text) {
  const t = String(text ?? '').trim();
  return /^[1-9]\d{0,9}$/.test(t) ? Number(t) : null;
}
function steamAppId() {
  const fromSteam = readAppId(process.env.SteamAppId);
  if (fromSteam) return fromSteam;
  const dirs = [path.dirname(process.execPath)];
  if (!app.isPackaged) dirs.push(app.getAppPath());
  for (const dir of dirs) {
    try {
      const id = readAppId(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8'));
      if (id) return id;
    } catch {}
  }
  return null;
}
const steam = makeSteamHandler({
  load: () => require('steamworks.js'),
  appId: buildEdition() === 'steam' ? steamAppId() : null,
});
ipcMain.handle('jd:steam', (event, op, args) => {
  assertSender(event, 'steam');
  return steam(op, args);
});

// The record file (desktop/record-file.cjs, desktop/README.md): the player's record as one JSON file under userData, written by the
// page whenever its record changes and read back at start, so a record survives the machine; Steam Auto-Cloud carries that folder
// with no Steam code here. JD_RECORD_DIR moves it (the smoke test keeps its writes out of the real folder); the device key never
// enters it, whatever the page sends (the handler keeps the record's keys only).
const record = makeRecordHandler({ fs, file: () => path.join(process.env.JD_RECORD_DIR || app.getPath('userData'), 'record.json') });
ipcMain.handle('jd:record', (event, op, args) => {
  assertSender(event, 'record');
  return record(op, args);
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
  win.loadFile(path.join(DIST, 'index.html'), query ? { query } : undefined);
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
