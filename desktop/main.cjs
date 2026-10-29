// Electron shell for Junkyard Draft. Loads the production bundle from dist/ (run `npm run build` first).
// Offline only: no remote content, no telemetry. The Control Room is a dev tool and is not packaged.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// exported loop clips go straight to Downloads (no dialog); the name is sanitised and never leaves that folder
ipcMain.handle('jd:save-clip', (_event, name, bytes) => {
  const safe = String(name).replace(/[^a-z0-9._$-]+/gi, '_').slice(0, 80) || 'clip.webm';
  const dir = process.env.JD_CLIP_DIR || app.getPath('downloads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safe);
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1120, height: 700, minWidth: 900, minHeight: 560,
    backgroundColor: '#1a1612', autoHideMenuBar: true, title: 'Junkyard Draft',
    icon: path.join(__dirname, 'build', 'icon.png'), // used by dev runs; packaged builds embed it in the executable
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // JD_DEV_API=1 exposes the dev-only window.__jd test hooks (used by tools/perf.ts and smoke tests); never set in normal use.
  const query = process.env.JD_DEV_API === '1' ? { dev: '1' } : undefined;
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), query ? { query } : undefined);
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
