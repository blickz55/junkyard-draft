# Status — 2026-10-25 (session 2 on the user's PC: rules v2 + keyboard placement)

## Session 2 increments — 2026-10-25 (Windows PC)
**Keyboard-only placement** (ROADMAP M2): arrow keys reveal/move a blue grid cursor (first press lands on the selected machine, else top-left); Enter places the next bin part, or picks up / drops the machine under the cursor (occupied cells refuse with the red flash); Tab cycles bin parts into the hand; R rotates; Delete / Backspace return to the bin; Esc drops → deselects → hides. Same rule-checked actions as the mouse; `window.__jd.cursor()` exposes it to tests.
**Plate Press** (ROADMAP M2, `RULES_VERSION` 1 → 2): two shards → one $8 plate, 2-tick hold, input from behind, other materials pass through; the first shard is absorbed (new `absorb` event, `RunResult.absorbed`, so in-transit diagnostics stay honest). Draft weight 10 (conveyor 34 → 30). Saves, replays and the verifier reject v1 files by design.
Verified (actual results):
- `npm run typecheck` clean · `npm test` 22/22 in 10 s (2 new sim tests; e2e gained a keyboard step: reveal, move, place, rotate, pick up, refused drop, move, Delete, Esc)
- Browser (desktop app pane, seed `forge`): round 2 offers the Plate Press with its card art; hopper → crusher → press → dock shipped 18 plates = $144 with "clean run" diagnostics and "19 made" on the press badge; keyboard cursor visible and moving; no console errors
- Autoplayer v2 (20 seeds × 120): min 1210 / median 1697 / max 2088 vs starter 228, no suspicious scores; press picked 4/120 (it is the fallback it was designed to be — see Next task)
- An e2e timing flake was found and fixed in the test (two arrow presses back-to-back under CPU load): keyboard steps are now paced at 150 ms

**Press balance pass** (`tools/balance.ts`, new `ban` option in the autoplayer so the same seeds and offers are played with the press allowed vs refused; 40 seeds × 120 tries, 4 min): v2 press drafted 19/56 times offered (34%), 0 seeds worse / 7 better vs refusing it, +44 mean when taken, +19 mean overall. Hold 1 tick: identical within noise. Plate $9 or $10: pick rate 41% but 3 seeds regress (worst −394) — a trap. **Decision: no tuning change, rules stay v2.** Added: shards left in a press at round end are recorded (`CellStats.stored`) and shown on its badge ("1 shard held"). Evidence summary in `docs/balance-press.json`.

**Packaged desktop build** (ROADMAP M3): `electron-builder` 26.18.0 added, config under package.json `build` (asar, `desktop/build` resources, `release/` output, Windows target `dir`); app icon rendered from `desktop/build/icon.svg` by `npm run desktop:icon` (Playwright Chromium, no image tooling); Phaser moved to devDependencies so nothing from `node_modules` ships. `npm run desktop:pack` = production build + `electron-builder --dir`, ~5 s. Result: `release/win-unpacked/Junkyard Draft.exe` (359 MB on disk, Electron runtime; `app.asar` 1.25 MB). Launched from `release/`: window "Junkyard Draft" 1120×700 with the icon, ~91 MB RSS; screenshot captured from the desktop and registered in the Control Room. Code signing not configured (skipped with a notice); no installer yet.


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
- No colour-blind alternative shapes yet (materials already differ in shape). A shard left in a press at round end is simply lost and not yet shown on its badge.
- Hook `SessionStart` model field only arrives for sessions started after the hooks existed, so this session shows model "unavailable".
- Scheduled cloud runs: not configured (needs a persistent repo location + the user's chosen cadence; see CONTINUE.md). Cloud visibility in the dashboard is "unavailable" by design.
- The repo lives on the user's PC with no remote yet; push to GitHub before setting up any scheduled cloud continuation.

## Next task
M4 daily-seed board: add a verifier endpoint `GET /daily` returning `{ seed, rulesVersion, entries }` for today's UTC seed (same `dailySeed()` the client uses), show it on the title screen next to "Today's challenge" when the verifier is reachable (and say so when it is not), cover it with a verifier test and an e2e assertion. Then M5 accessibility: colour-blind-safe material shapes are already distinct — add a reduced-motion setting (no belt animation / flashes) and a UI scale option. Still needed from a human: playtest notes from one full manual run (M1), and a GitHub remote before any scheduled cloud continuation.
