// Intentionally minimal: the game needs no Node APIs. Exposes only a platform flag.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('jdDesktop', { platform: process.platform, version: process.versions.electron });
