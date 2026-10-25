# Desktop packaging (Electron) — scaffold, not yet verified

Electron is not installable in the cloud sandbox (npm registry blocked), so this shell has not been launched yet.
On a machine with npm access:

```
npm run build
npm i -D electron            # pin the version that installs, e.g. "electron": "<version>"
npx electron desktop/main.cjs
```

For installers add electron-builder later (`npm i -D electron-builder`, config in package.json `build` key, `--dir` for an unpacked test build).
The window is 1120×700, offline-only, with context isolation and no Node integration; the Control Room is not shipped.
