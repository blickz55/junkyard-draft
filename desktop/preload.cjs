// Intentionally minimal: the game needs no Node APIs. Exposes a platform flag and one file sink for exported clips.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jdDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  /** Save an exported clip (name, bytes) into the user's Downloads folder; resolves with the full path. */
  saveClip: (name, bytes) => ipcRenderer.invoke('jd:save-clip', String(name), bytes),
});
