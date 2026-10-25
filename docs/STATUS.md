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

**Daily-seed board** (ROADMAP M4): `game/src/sim/daily.ts` is the single source of the UTC daily seed (client `storage.ts` re-exports it; verifier imports it). Verifier gained `Verifier.daily()` and `GET /daily?limit=` → `{ seed, date, rulesVersion, verified: true, entries }`. The title screen shows a "TODAY'S VERIFIED BOARD" strip under the panels: top 5 verified entries for today's seed, "No verified scores yet today…" when empty, or an explicit offline message when the verifier is not running (`?verifier=` URL param as on the results screen). Verifier tests cover `daily()` (seed, UTC date, only today's entries) and the HTTP route; the e2e asserts the title strip renders against the test's own verifier.

**Accessibility settings** (ROADMAP M5): `game/src/render/prefs.ts` holds `reducedMotion` (default: OS `prefers-reduced-motion`) and `textScale` (1 / 1.15 / 1.3), persisted in `jd.settings.v1` through a read-modify-write `updateSettings` so audio and accessibility never clobber each other. Reduced motion: belts stay on frame 0, no machine wobble, items snap between cells, no transform/absorb flashes, dock pops or despawn pops, `+$n` fades in place, title belt static, results score does not pop, button press tween off. Text size goes through `px()` in the UI helpers and every direct text in GameScene. Title controls "Motion" and "Text size" next to Volume (scene restarts to re-render). e2e: toggles both, checks persistence and a 15 px label at 17 px, cycles back, and verifies belts are static during a reduced-motion run.

**Performance budget** (ROADMAP M5): `tools/perf.ts` plays the autoplayer's $2088 run for seed `auto-12` (10 machines, two hoppers) through the dev API to round 6, runs it at 4× and samples rAF deltas plus CDP `Performance` TaskDuration/ScriptDuration. Packaged app launched through Playwright's Electron support with `JD_DEV_API=1` (new opt-in in `desktop/main.cjs` that adds `?dev=1`). Results (2026-10-25, this PC, 240 Hz monitor):

| environment | frames | p50 ms | p95 ms | max ms | dropped (>25 ms) | CPU ms/frame | script ms/frame |
|---|---|---|---|---|---|---|---|
| chromium @4× | 202 | 16.7 | 16.7 | 16.8 | 0 | 10.02 | 0.71 |
| chromium cpu×4 @4× | 202 | 16.7 | 16.7 | 16.8 | 0 | 15.84 | 3.75 |
| electron packaged @4× | 811 | 4.2 | 4.3 | 4.4 | 0 | 0.34 | 0.25 |

Reading: every environment is vsync-bound (16.7 ms at headless Chromium's 60 Hz, 4.2 ms at the desktop's 240 Hz) with zero dropped frames. The game's own work is the script column: 0.25–0.7 ms per frame on hardware, 3.75 ms even with 4× CPU throttling. Headless Chromium's 10 ms CPU/frame is its software rasterizer (SwiftShader), not the game, and still fits the budget with 4× throttling on top. **Decision: nothing to fix.** Caveat: the busiest legal layout the autoplayer builds keeps only ~4 items in flight (short lines); a 48-cell conveyor snake would add item sprites but no per-frame text work, so it is not expected to change the picture. Evidence in `docs/perf-2026-10-25.json`.

**Installer + packaged smoke test** (ROADMAP M3): `npm run desktop:dist` builds the unpacked app and `release/Junkyard-Draft-Setup-0.1.0.exe` (NSIS, 122 MB, per-user, user-chosen folder, desktop shortcut, uninstaller; ~20 s). It is **unsigned** (SmartScreen will warn) and has not been run on this PC — verified by listing its archive (7-Zip) and reading its version resource, not by installing. `tests/desktop-smoke.test.mjs` (in `npm test`, skips without a build) launches `release/win-unpacked/Junkyard Draft.exe` with `JD_DEV_API=1`, checks the preload bridge, jumps to the game scene, plays a crusher round through the dev API, asserts the result (> $38, shards shipped), the minimum window size and no page errors.

**Colour-blind / contrast audit** (ROADMAP M5): `tools/a11y-lib.ts` (WCAG luminance/contrast, Machado 2009 CVD matrices in linear RGB, CIE76 ΔE) + `tools/a11y-audit.ts` (20 text/background pairs the scenes actually draw; materials and ok/bad/selection/cursor colours under protanopia, deuteranopia, tritanopia; `--sheet` renders the real textures through each matrix). `tests/a11y.test.ts` enforces it in `npm test`. Before: 2 contrast failures, shards/plate only ΔE 12.7 apart under protanopia. After: 0 failures.

| text | before | after |
|---|---|---|
| red diagnostics on panel | #e5574a 4.47:1 | #eb6757 5.1:1 |
| build label on page background | #6f6758 3.22:1 | #948a79 5.29:1 |

| simulation | closest material pair before | closest material pair after |
|---|---|---|
| normal | shards vs plate: ΔE 13.5, ΔL* 11.7 | shards vs plate: ΔE 24.7, ΔL* 21.2 |
| protanopia | shards vs plate: ΔE 12.7, ΔL* 11.2 | shards vs plate: ΔE 23.5, ΔL* 20.3 |
| deuteranopia | shards vs plate: ΔE 13.9, ΔL* 12.1 | scrap vs slag: ΔE 20.1, ΔL* 17 |
| tritanopia | shards vs plate: ΔE 13.5, ΔL* 11.7 | scrap vs slag: ΔE 20.5, ΔL* 17.4 |

Shapes were already distinct per material, so only the palette moved: red, plate, build label, and a dedicated light cursor tint. Evidence: `docs/a11y/audit-2026-10-25.json`, `docs/a11y/materials-cvd-before.png`, `docs/a11y/materials-cvd-after.png`.

**Hosted-verifier groundwork** (ROADMAP M4): `server/verify.ts` now takes HOST / PORT / DATA_DIR (or `--host --port --data-dir` flags), logs one line per request, rate-limits `POST /verify` per client IP (fixed window, default 60/min, `RATE_LIMIT`), sends CORS for `CORS_ORIGIN` (default `*`), honours `X-Forwarded-For` only with `TRUST_PROXY=1`, and `/health` reports entry count and uptime. `npm run verifier:build` bundles it with esbuild into `server/dist/verify.mjs` (no tsx at runtime, < 200 KB); `Dockerfile` (multi-stage, node:24-alpine, `/data` volume, healthcheck) and `server/README.md` document deployment. The game reads `import.meta.env.VERIFIER_URL` (baked by `VERIFIER_URL=… npm run build`, recorded in `dist/build.json`; `?verifier=` still overrides). Tests: rate limiter unit, HTTP 429 + Retry-After + CORS origin + proxy IP + request log, bundle exports. **Not done: Docker is not installed on this PC, so the image is unbuilt; nothing is deployed** (needs a host and the user's go-ahead).

**Player name, verified rank, share text, daily rank** (ROADMAP M4): `jd.player` (title button "Player: …" / "Set player name…", prompt; results screen asks once before the first submission; `cleanPlayer` trims to 32 chars). After a successful submission the results status reads "Verified by re-simulation: $S — #N of M on the local verified board as <name>" (rank by replay hash among the top 100) and the submission is recorded locally in `jd.submissions.v1`. "Copy share text" (`game/src/render/share.ts`, unit-tested) writes seed, score, per-round earnings and the exact verification state to the clipboard (prompt fallback). The title's daily strip prefixes "You: #N of M ($S)" when this device has a recorded submission for today's seed, located on the board by hash. e2e: name preset → submission carries it → status shows #1 of 1 → share text content → local record by hash → title strip shows "You: #1 of 1" after a daily submission to the test verifier. Dev note: a dev server started before a new `define` was added keeps the old define map (seen as `import.meta.env` undefined in the pane) — restart `npm run dev` after editing `scripts/esbuild-config.mjs`.

**Verified replay viewer** (ROADMAP M4): the verifier stores each verified replay's actions next to the board (`Board.replays` by hash; `board()` adds `replayAvailable`) and serves `GET /replay?hash=` for verified entries only (404 otherwise; boards from before replay storage report `replayAvailable: false`). Client `game/src/render/verified.ts` fetches, **re-verifies locally** (`verifyReplay` must reproduce the stated score) and starts the Game scene with the existing replay queue plus a label; the HUD seed line and the results subtitle read "verified replay by <name> ($score)" in blue and playback never records bests or submits. Entry points: results-screen board entries (▶, click) and a "Watch #1" button on the title's daily strip. Tests: verifier unit + HTTP `/replay` (actions, player, score; 404), e2e clicks the board entry, sees the labelled Game HUD, finishes six playback rounds through the dev API, lands on the labelled results with an unchanged local best and the verified score. Suite 31/31.

**Playback controls + retention** (ROADMAP M4): while watching, the HUD shows a blue "REPLAY · Esc stops" marker, the running panel adds "Original run: $X this round · $Y after round N · $Z final" (re-simulated from the fetched actions at init) and a "Stop watching (Esc)" button; Esc stops instead of pausing and returns to the title; the hint explains the controls. **Bug found by the new e2e step and fixed: playback used to write `jd.save.v1` as it replayed, leaving the watched player's run as "Continue run" on the title — `act()` no longer saves during playback (this also covered imported replays).** Verifier: `Verifier(file, { replaysPerSeed })` (default 100 = the `/board` cap) prunes stored actions for entries below the cut on every write; entries keep their scores; tested with three distinct-score runs on one seed (cap 2 → lowest loses its replay, persisted). Suite 32/32.


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
Release candidate pass: bump to 0.2.0, write `CHANGELOG.md` from the git history since the bundle (rules v2, press, keyboard, accessibility, daily board, verifier, replay viewer, installer), add a `--version` style build stamp to the title (already shows build) and the verifier `/health`, run the full battery (typecheck, tests, autoplayer 20×120, balance 40, perf, a11y audit, desktop:dist, smoke) and record every number in STATUS as the 0.2.0 baseline. Still needed from a human: playtest notes from one full manual run (M1), a Docker build of the verifier image where Docker exists, running the installer once on a clean machine, and a GitHub remote before any scheduled cloud continuation.
