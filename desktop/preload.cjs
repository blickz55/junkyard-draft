// Intentionally minimal: the game needs no Node APIs. Exposes a platform flag, one file sink for exported clips and the Steam bridge.
const { contextBridge, ipcRenderer } = require('electron');
const steam = (op, args) => ipcRenderer.invoke('jd:steam', op, args);
contextBridge.exposeInMainWorld('jdDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  /** Save an exported clip (name, bytes) into the user's Downloads folder; resolves with the full path. */
  saveClip: (name, bytes) => ipcRenderer.invoke('jd:save-clip', String(name), bytes),
  /**
   * The Steam bridge (desktop/steam-bridge.cjs answers; game/src/render/steam.ts is the game's one caller). Without steamworks.js or
   * an app id, status resolves { available: false } and the rest false; an id out of bounds or an unknown op rejects.
   */
  steam: {
    status: () => steam('status', []),
    unlock: (id) => steam('unlock', [String(id)]),
    setStat: (id, n) => steam('setStat', [String(id), n]),
    presence: (key) => steam('presence', [String(key)]),
  },
});
