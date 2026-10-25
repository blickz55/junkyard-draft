# Status — 2026-10-25 (end of session 1; restored on the user's PC the same day)

## Local restore — 2026-10-25 (session 2, Windows PC)
Repo restored from the delivered bundle into `C:devjunkyard draft` (9 commits intact). Verified on this machine, actual results:
- `npm install` — clean (Phaser 3.90.0 from the registry; vendor copy unused); `npx playwright install chromium` — ok; `npm i -D electron` — Electron 45.0.0
- `npm run typecheck` — clean · `npm test` — 20/20 in 7.7 s (sim 12, verifier 2, control-room reducer 4 + live browser 1, gameplay e2e 1)
- `npm run build` — dist/main.js 1240 KiB
- Autoplayer 20 seeds × 120 tries — min 1371 / median 1617 / max 2008, identical to the sandbox run (determinism holds across machines)
- `npm run desktop` — Electron window "Junkyard Draft" opens from `dist/` (first ever launch of the shell)
- Game played in the desktop app's browser pane (title → Today's challenge → round 1 draft), no console errors; Control Room live with this session's hook events
Fixed for fresh clones: build crashed when the gitignored `.control-room/reports/` and the absent `game/public/` did not exist; both browser tests hard-coded `/opt/pw-browsers` (on another OS the browser launch threw, cleanup skipped the server kills and `npm test` hung forever) — path is now conditional and cleanup is guarded; `.dev-build/main.js` was tracked and is now ignored; `.gitattributes` pins LF.

## Playable now
Complete loop in the browser: title (daily / random / custom seed, continue, import replay) → draft → build (drag, rotate, remove, sell) → animated run (pause, speed, skip) → on-grid result badges → six rounds → results (local bests, replay copy/download). Save/continue, volume/mute, pause on blur, first-run hints.

## Launch
```
npm run dev:all        # game http://127.0.0.1:5173  ·  Control Room http://127.0.0.1:4310
npm run build          # dist/ (served at http://127.0.0.1:4310/verified/)
npm run verifier       # replay verifier + verified-only board on http://127.0.0.1:4400
```
Local PC: `npm install` then `npx playwright install chromium` once. `npm run desktop` opens the Electron shell (build first). Sandbox only: `node_modules/` is symlinked to preinstalled tools and browser tests pick up `/opt/pw-browsers` automatically.

## Verified in this session (actual results)
- `npm test` — 20/20: sim 12 (transforms, jams, splitter throughput, orientation, determinism, draft seeding, replay verify, long chains, malformed actions, sell), verifier 2, control-room reducer 4 + live browser 1, gameplay e2e 1 (real drag/rotate/run/pause/save-continue/sell/6 rounds/results/verifier submit, no page errors)
- `npm run typecheck` — clean
- `npm run build` — dist/main.js ≈ 1.2 MiB; production page renders from `/verified/` with no page errors
- Autoplayer (`node --import tsx tools/autoplay.ts --seeds 20 --tries 120`): scores min 1371 / median 1617 / max 2008 vs starter-only 228; every seed reaches ingots; no score above the sanity bound. 39/120 drafts gave the searcher no improvement → added sell-from-bin.
- Control Room: real hook events from this session appear live; subagent lifecycle (Explore review agent) shown with parent, task, result; self-test fail→pass recorded; live/reload/disconnect verified by test; screenshots of dashboard, title, draft, build, running, summary, results on file.
- Subagent review of the sim (read-only) → fixed: 8-pass movement cap, strict action schema, replay size limits; noted: seed must be server-fixed for ranked play.

## Known issues / gaps
- Electron shell launches locally (Electron 45); no installer/packaging, no icon, not smoke-tested beyond opening the window.
- No keyboard-only placement; no colour-blind alternative shapes yet (materials already differ in shape).
- Hook `SessionStart` model field only arrives for sessions started after the hooks existed, so this session shows model "unavailable".
- Scheduled cloud runs: not configured (needs a persistent repo location + the user's chosen cadence; see CONTINUE.md). Cloud visibility in the dashboard is "unavailable" by design.
- The repo lives on the user's PC with no remote yet; push to GitHub before setting up any scheduled cloud continuation.

## Next task
Keyboard-only placement (arrow keys move a cursor, Enter places/picks up, R rotates, Delete removes) with a visible cursor, verified by an e2e step; then a 7th machine with a real decision (Press: 2 shards → 1 plate $8) behind a RULES_VERSION bump.
