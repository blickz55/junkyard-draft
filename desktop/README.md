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

## Editions and the Steam bridge

The build has an edition (`scripts/esbuild-config.mjs`, `import.meta.env.EDITION`): `web`, the product, which `npm run build`
makes and the shell loads as it is, and `steam`, which `npm run build:steam` makes in `dist-steam/` for a depot. A Steam build
bakes the hosted verifier (`VERIFIER_URL` must name it; unset, the loopback default and any loopback address are refused) and
has no service worker. `build.json` says which edition a folder is, and nothing else in the shell differs. There is no demo or
test edition: the tester build (`npm run build:test`) is the web edition with `NO_SERVER` baked (`isTestEdition()`).

What a web build must not carry is `game/src/render/steam.ts`, the one module in the game that reads `window.jdDesktop.steam`.
Three things hold that: `editionPlugin` resolves every import of `render/steam` to `steam-none.ts` (the same exports, no bridge)
unless the edition is `steam`; `main.ts` loads the module behind an inline `import.meta.env.EDITION === 'steam'` guard, which
esbuild folds, so the `import()` is dropped from a web build and makes a chunk of its own in a Steam build; and
`node --import tsx tools/bundle-size.ts --forbid 'jdDesktop\??\.steam|steam-bridge'` scans every chunk under dist and fails on a
match (perf.yml runs it after the build; `tests/editions.test.mjs` builds both editions and checks each). `isSteamEdition()` in
`render/config.ts` is for runtime branches only: a call through a helper is not folded, so it gates no module.

The bridge: `preload.cjs` exposes `jdDesktop.steam = { status(), unlock(id), setStat(id, n), presence(key) }`, each an
`ipcRenderer.invoke('jd:steam', op, args)`; `main.cjs` checks the sender (`assertSender`, the same check as the clip sink) and
hands the call to `steam-bridge.cjs`, a pure handler with no Electron in it (`tests/steam-bridge.test.mjs`). An id is 1 to 64
characters of a-z, 0-9, `_`, `.` and `-`; a stat's value is a finite number; an unknown op or an argument out of bounds rejects,
because that is a bug in the caller. `status()` resolves `{ available: false }` and every other op `false` unless all of this holds:
the loaded `dist/build.json` says `steam`, an app id is known, and `require('steamworks.js')` succeeds. That require sits inside a
try and is attempted once: the package is not installed, and that is the normal state. Game code calls `steam()` from
`render/steam.ts`, whose promises never reject.

The app id: `SteamAppId` in the environment when Steam launched the app, else `steam_appid.txt` beside the executable, or beside
package.json for an unpackaged `npm run desktop`. That file is for dev launches only, never ships in a depot, and is git-ignored.

Installing `steamworks.js` is the owner's decision once an app id exists (server/README.md, the production roadmap's rule 6: one
runtime dependency at a time). When it comes, it goes under `dependencies`, not `devDependencies`, because electron-builder ships
only those, with `asarUnpack` for its `.node` binary, which cannot load from inside the asar; the shell's `require` is already
inside a try, so nothing else in it changes. The Steam overlay needs the package's Electron switches too, which is for that day.

Not done yet: code signing, macOS/Linux builds (config present, never run), auto-update, `steamworks.js` (above).
