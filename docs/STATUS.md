# Status — 2026-10-25

## Playable now
Full loop in the browser: title → draft → build (drag/rotate/rearrange) → animated run → round summary → six rounds → results with local bests, replay export/import, save/continue, volume/mute, pause (Esc / window blur), onboarding hints.

## Launch
```
npm run dev:all            # game http://127.0.0.1:5173  ·  Control Room http://127.0.0.1:4310
npm run build              # dist/  (also served at http://127.0.0.1:4310/verified/)
```
Sandbox note: `node_modules/` is symlinked to preinstalled tools because the npm registry is blocked here; on a normal machine run `npm install` first (see CLAUDE.md).

## Verified commands (this session)
- `npm run typecheck` — clean (tsc 6.0.3)
- `node --import tsx --test tests/sim.test.ts` — 9/9 pass
- `node --test tests/control-room-state.test.mjs tests/control-room-live.test.mjs` — 5/5 pass (live SSE, reload, disconnect, collector restart)
- `node --test tests/game-e2e.test.mjs` — 1/1 pass (Chromium: real drag + keyboard, six rounds, results, no page errors)
- `npm run build` — dist/main.js ≈ 1.2 MiB; title renders from `/verified/` with no page errors
- `npm run selftest:instrumentation` — fail→pass pair recorded and visible in the dashboard
- Hooks verified live: real PreToolUse/PostToolUse/SessionStart events from this Claude Code session appear in the dashboard without any restart.

## Known issues / gaps
- Autoplayer / seed exploration not written yet (M1 open item).
- Subagent lifecycle not yet observed through hooks (in progress).
- Round summary panel has unused space; no per-machine tooltips yet.
- `tile-ok/bad` hover tint only during drags; no keyboard placement.
- Cloud-run visibility in the Control Room is "unavailable" by design: a localhost collector cannot receive events from an isolated scheduled cloud session.
- This workspace is ephemeral: the repo must be pushed or copied to the user's machine to persist (see CONTINUE.md).

## Next task
Write `tools/autoplay.ts`: greedy/random automated player over N seeds, reporting score distribution, dead-end seeds (no offer improves the line), and any layout whose score exceeds a sanity bound; emit results as a Control Room check; then tooltips + summary mini-map (M2).
