# Desktop build (Electron + electron-builder)

Verified 2026-10-25 on Windows 11 (Electron 45.0.0, electron-builder 26.18.0):

```
npm run desktop         # dev: opens dist/index.html in an Electron window (run npm run build first)
npm run desktop:pack    # production build + unpacked app in release/win-unpacked/ (≈5 s after the first run)
npm run desktop:icon    # re-render desktop/build/icon.png from desktop/build/icon.svg (Playwright Chromium)
```

`release/win-unpacked/Junkyard Draft.exe` launched on the dev machine: 1120×700 window, title bar icon, ~91 MB RSS,
359 MB on disk (Electron runtime; the game itself is `resources/app.asar`, 1.25 MB: `desktop/*.cjs`, `dist/`, `package.json`).

Config lives under the `build` key in package.json: `appId` dev.junkyarddraft.app, resources in `desktop/build`,
output in `release/` (git-ignored), asar on, Windows target `dir`. Phaser is a devDependency because esbuild bundles it,
so no `node_modules` ship in the app. Code signing is not configured (electron-builder skips it and says so).

Not done yet: installers (add `{ target: 'nsis' }` to `win.target`; needs a code-signing certificate to avoid
SmartScreen warnings), macOS/Linux builds (config present, never run), a smoke test that drives the packaged window.
