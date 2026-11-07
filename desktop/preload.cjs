// Intentionally minimal: the game needs no Node APIs. Exposes a platform flag, one file sink for exported clips, the Steam bridge and
// the record file.
const { contextBridge, ipcRenderer } = require('electron');
const steam = (op, args) => ipcRenderer.invoke('jd:steam', op, args);
const record = (op, args) => ipcRenderer.invoke('jd:record', op, args);
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
  /**
   * The record file (desktop/record-file.cjs answers; game/src/render/recordfile.ts is the game's one caller): the player's record
   * under userData. load() resolves the file parsed or null (missing or corrupt); save(data) writes the record's keys and nothing
   * else, atomically, and resolves true; a call out of bounds rejects.
   */
  record: {
    load: () => record('load', []),
    save: (data) => record('save', [data]),
  },
});
