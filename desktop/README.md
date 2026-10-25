# Desktop build (Electron + electron-builder)

Verified 2026-10-25 on Windows 11 (Electron 45.0.0, electron-builder 26.18.0):

```
npm run desktop         # dev: opens dist/index.html in an Electron window (run npm run build first)
npm run desktop:pack    # production build + unpacked app in release/win-unpacked/ (≈5 s after the first run)
npm run desktop:dist    # unpacked app + NSIS installer release/Junkyard-Draft-Setup-<version>.exe (≈20 s)
npm run desktop:icon    # re-render desktop/build/icon.png from desktop/build/icon.svg (Playwright Chromium)
npm run test:desktop    # smoke test: launches the packaged app, plays a round, asserts no page errors
```

`release/win-unpacked/Junkyard Draft.exe`: 1120×700 window, title bar icon, ~91 MB RSS, 359 MB on disk (Electron
runtime; the game itself is `resources/app.asar`, 1.25 MB). The installer is 122 MB, per-user (no admin prompt),
lets the user pick the folder, creates a desktop shortcut and an uninstaller. **It is unsigned**: Windows SmartScreen
will warn on first run until a code-signing certificate is configured (electron-builder `win.certificateFile` /
`signtoolOptions`). Nobody has run the installer yet; the smoke test exercises the unpacked app.

Config lives under the `build` key in package.json: `appId` dev.junkyarddraft.app, resources in `desktop/build`,
output in `release/` (git-ignored), asar on, Windows targets `dir` + `nsis`. Phaser is a devDependency because
esbuild bundles it, so no `node_modules` ship in the app.

Test hooks: `JD_DEV_API=1` makes `main.cjs` load the page with `?dev=1`, which exposes `window.__jd` exactly as in the
browser dev build. `tests/desktop-smoke.test.mjs` and `tools/perf.ts` use it through Playwright's Electron support; it
is never set for normal launches.

Not done yet: code signing, macOS/Linux builds (config present, never run), auto-update.
