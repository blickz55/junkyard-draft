# Desktop shell (Electron) — launches, not yet packaged

Verified 2026-10-25 on Windows 11 with Electron 45.0.0 (devDependency):

```
npm run build        # the shell loads dist/index.html
npm run desktop      # opens the 1120×700 "Junkyard Draft" window
```

The window is offline-only, context-isolated, no Node integration; `preload.cjs` exposes only a platform flag. The Control Room is a dev tool and is not shipped.

Not done yet: installers (add `electron-builder`, config under package.json `build`, `--dir` for an unpacked test build), an app icon, and a smoke test that drives the shell.
