# Status — 2026-10-29 (v0.3 code complete; v0.4 opened with the DOM UI shell slice 1: title and results)

## Session 2026-10-30 (5) — PLAN-v1 0.4.6 non-ranked badges
- `game/src/sim/badges.ts`: `badgesFor(run, botPar)` → Clean (every round's `cellStats` has `jammedTicks === 0 && blockedTicks === 0`), Minimalist (`MINIMALIST_MACHINES = 8`; final round's machines ≤ 8 and `score >= botPar`; unjudgeable without a par), Full Grid (any round with width × height machines); `BADGE_INFO` titles and one-line texts. Tests build runs through the real sim (starter line is Clean; a head-on conveyor forfeits it; par boundary; crowded final round; synthetic full grid).
- Results: a pill row under the best note (`badges`, `badge-<id>`, "badges · not ranked"), re-rendered when the histogram brings the par; the detailed share variant lists them only for a verified run (`share.ts` `badges`), never the grid variant, never unverified. E2E checks every pill is a known badge and the detailed verified text lists exactly them.
- `npm test` **72/72**.

## Session 2026-10-30 (4) — PLAN-v1 0.4.3 spoiler-free share grid
- `game/src/render/share.ts`: `SHARE_THRESHOLDS` [100, 250, 400] and `SHARE_GLYPHS` ░▒▓█ (`roundGlyph`, `roundGrid`), `seedLabel` (Daily date / Tutorial / seed), `standingText` (percentile once N ≥ 5, else rank; a population of one never reads "better than 0 %"), `shareText` with `variant: 'grid' | 'detailed'`, optional `daysPlayed` and `permalink` lines. Storage: `loadDaysPlayed`/`recordDayPlayed`/`daysPlayed` (UTC dates, validated, bounded 400); ResultsScene records the day for the player's own runs and keeps `lastPercentile`/`lastN` from the histogram for the share line.
- Results: "Copy share text" (grid), "Copy detailed", and an "add link" checkbox that appends `?scene=game&seed=…`; telemetry `share_copied` carries the variant.
- Tests: `tests/share.test.ts` rewritten (threshold boundaries, six glyphs, monochrome, default text byte-exact, no URL/dollars/layout words, rank vs percentile, days played, permalink, detailed), storage days test; e2e asserts the exact default text after the verified submission (`#1 of 1 … as e2e player`, `1 day played`) and the detailed text with the link.
- `npm test` **69/69**.

## Session 2026-10-30 (3) — PLAN-v1 0.4.2 loop clip export (WebM first)
- `game/src/render/clip.ts`: `ClipPainter` draws a layout from the generated textures (tiles, machines rotated by facing, belt frames, items interpolated between cells with the same easing as the game, +$ pops, jam wash) plus the strip; `recordClip(game, run, opts)` runs the real `createSim`/`step` at 4× for `passes` (2) with a hold, captures the canvas live (`captureStream(30)` + `MediaRecorder`, VP9/VP8/MP4 by `isTypeSupported`, 4 Mbit/s), resolves with blob, mime, duration, frames and a filename; `saveClip` prefers the Electron bridge. Deviation from the dossier wording: it is the real simulation and the real textures on a 2D canvas, not the Phaser scene rendered offscreen — no Phaser side effects, no input, deterministic framing. Full motion regardless of the reduced-motion setting.
- Results (`ui/ResultsScreen.ts`): "Export clip (round N)" with progress in the label and the outcome in the status line; `ResultsScene.exportClip(round?)` is the one entry point (button and e2e), keeps `lastClip` for tests.
- Electron: `preload.cjs` exposes `jdDesktop.saveClip(name, bytes)`; `main.cjs` writes it into Downloads (or `JD_CLIP_DIR`) with a sanitised name and no dialog. Packaged app rebuilt (`npm run desktop:pack`); the smoke test now writes a 3-byte file through the bridge into a temp dir and removes it.
- E2E (game-e2e): `exportClip()` in Chromium → blob > 0 bytes, recorded ≥ 3 s, finished < 10 s, WebM mime, filename pattern, ≥ 60 frames at ≥ 624×536, button usable again. A painted frame was captured by eye (grid, items mid-move, strip). Measured in headless Chromium on this PC: 690 KB VP9 WebM, 7.45 s, 446 frames at 624×536, exported in 7.5 s.
- `npm test` **66/66**.

## Session 2026-10-30 (2) — PLAN-v1 0.4.5 autoplayer par per seed
- `server/verify.ts`: `computeParSync(seed, runs = 5, tries = 40)` = median of `playSeed` over fixed rng streams `${seed}:par:k`; the same module doubles as the worker entry (`isMainThread`/`workerData.parSeed`), `computeParInWorker(seed, capMs = 20 s)` terminates at the cap; only loader flags (`--import tsx`) are forwarded to the worker because `node --test` adds flags a Worker rejects (found by the test). `ParService` dedups and serialises jobs, backs off 10 min after a failure/cap. Pars persist in `board.json` (`pars`, per rules version) through the same atomic commit; `Board` shape unchanged when none exist. Routes `/board`, `/histogram`, `/daily` return `botPar` and request a job; a successful `/verify` requests one too. Main guard now requires `isMainThread` so the worker never starts a second server. `BOT_PAR=0`, `BOT_PAR_CAP_MS`.
- Tests: same par in-process and from a worker; a hanging par job leaves `POST /verify` under 1.5 s and the histogram's `botPar` null until the job resolves, then persisted; `/daily` carries it; a failing job retries only after the cooldown.
- Client: results histogram shows the bot-par line (`bot-par`) with "you beat it / matched"; the daily strip shows `daily-par`. E2E: after the submission the bot-par line appears (the test verifier computed it in a worker) and `/board` carries a numeric `botPar` while still holding exactly one entry.
- Cost: ~1 s per new seed on this PC in the worker (several seconds under e2e load, hence the results screen polls the histogram every 4 s while the par is pending); nothing on the request path. `npm test` **66/66**.

## Session 2026-10-30 — PLAN-v1 0.4.1 histogram-first results and daily strip
- Verifier: pure `histogramOf(ranked, hash?, binCount = 10)` + `niceStep` (1, 2, 2.5, 5 × 10^k) in `server/verify.ts`; `Verifier.histogram(seed, hash)`; `GET /histogram` (seed and hash clamped to 64 chars). Percentile = other runs strictly below ÷ (N − 1), floor; ties not beaten; one entry → percentile 0, rank 1; `around` = up to 5 above and 5 below in board order with the caller flagged. Tests: empty, 1, 4 and 200 synthetic entries (≈ ten bins, median ≈ 50 %, tie rule, unknown hash → no `mine`), nice steps, and the route with a real verified entry.
- Results (`ui/ResultsScreen.ts`): `loadHistogram()` after every board load/submission — bars (`hist-bin-i`, the player's bin `.jd-hist-mine`), an axis from $0 to the last bin edge, the percentile line (`percentile`), and the "around you" list (`around`); nothing shown when N = 0. Title strip: a miniature (`daily-hist`) appended to the head once today's board has an entry. Styles in `ui/dom.ts` (palette colours only; the a11y colour test covers them).
- E2E: game-e2e asserts "1 verified run so far · you are #1" with exactly one highlighted bin after the submission, and the daily strip's miniature after the planted daily submission. Screenshot of a seeded six-entry board plus the player's run checked by eye.
- `npm test` **65/65** (the verifier suite grew by one test).

## Session 2026-10-29 (night, 2) — DOSSIER-v1 0.4.0 DOM UI shell, slice 2 (game chrome)
- `game/src/ui/GamePanel.ts` (DOM): HUD bar, side panel for draft / build / running / summary, hint strip, result banner + per-machine badges positioned over the grid in em (`left/top` from cell coordinates), pause veil; `render(state)` rebuilds only when the change key differs (same inputs the Phaser `sideInputs()` hashed, plus tips badge/open); `setHud` (CSS pulse unless reduced motion), `setProgress` (progress and earned update in place only when changed), `setStall`, `setHint`; the VALUES legend element is built once and re-appended. Styles are appended as a second stylesheet; the game root is `pointer-events: none` with controls `auto` so the canvas still receives drags (a specificity slip here failed the bin-drop e2e until the root rule was made more specific).
- GameScene lost `buildHud`, `buildReplayBanner`, `renderSide`'s bodies, `legend`, `renderSideSummary`, `showPauseOverlay` and the canvas summary banner/badges; it now exposes `panelState()` and wires `PanelActions`; `hintText()`/`stallInfo()` read the panel. Tips open hides the DOM (`ui.setHidden`) because the tips panel is still canvas.
- Anchors migrated to `data-testid` in `tests/game-e2e.test.mjs`, `tests/render-e2e.test.mjs` and `tools/perf.ts` (speed button click). The 64-character-seed HUD check now asserts the CSS ellipsis engages while the full seed stays in the text, and that the score block ends before the Title button.
- Perf (`tools/perf.ts --skip-electron`, seed auto-12 last round at 4×): Text objects created per busy round **68 → 12**; script ms/frame hardware 0.51 ms, 4× CPU throttle 2.43 ms (from 2.63); `docs/baselines/0.3.0/perf-after-0.4.0.json`. Screenshots of draft, build (selection), running and summary checked by eye.
- `npm test` 64/64.

## Session 2026-10-29 (late night) — DOSSIER-v1 0.4.0 DOM UI shell, slice 1 (title + results)
- **Layer** `game/src/ui/dom.ts`: `h()` element builder, `btn()`, one injected stylesheet (palette colours only), `ui` overlay manager: `#ui` absolutely positioned over the canvas, re-synced on Phaser resize / window resize, `--k` = overlay width ÷ 1120 and `--text-scale` = prefs.textScale so `em` sizes follow the canvas; `mount(scene, screen, onKey)` / `unmount()` / `setHidden()` (the Phaser tips panel hides the DOM while open); `textureImg()` turns a generated texture into an `<img>`.
- **Title** (`ui/TitleScreen.ts`): top bar (build, player, resolution, share stats + note), hero, Continue + note, daily/random, learn/custom/import, HOW TO PLAY (with Tips) and LOCAL PERSONAL BESTS (volume range, mute, motion, text size) in a two-column grid, the verified-board strip with Watch; Enter continues or starts. `TitleScene` keeps the belt and the tips panel (16 lines of scene).
- **Results** (`ui/ResultsScreen.ts`): score with CSS pop (off under reduced motion), subtitle, best note, round bars, what shipped with texture icons, verified board with clickable entries, actions, status line; `ResultsScene` keeps bests/save bookkeeping and the `lastRank/lastPlayer/lastShareText` fields the e2e reads.
- **E2E migration**: every Title/Results reference in `tests/game-e2e.test.mjs` and `render-e2e` now uses `data-testid` (Playwright locators); the 130 % layout check became DOM geometry (continue note clears the buttons, how-to clears the strip, nothing outside the overlay, no scrolling) — the first version overflowed by 114 px at 130 % with a save and the spacing was tightened until `scrollHeight === clientHeight`. New render-e2e step dom_overlay_tracks_the_canvas at 1280×800 and 1920×1080. New a11y test dom_ui_uses_audited_colours.
- Screenshots (title 100 % / 130 % with a save, results) checked by eye. `npm test` **64/64**.
- **Slice 2 (next)**: the game scene's side panel, HUD and hint strip to DOM (`renderSide` → DOM components keyed by the same change key; `getByName('speed-4')`, `'undo'`, `'tips'`, `'earned'`, `'progress'`, `'stall'`, `'hud-seed'` anchors in e2e and `tools/perf.ts` to migrate); then 0.4.1 histogram.


## Session 2026-10-29 (late) — PLAN-v1 0.3.4 tutorial seed
- **Sim** (`run.ts`): `isTutorialSeed` (`tutorial-*`), `TUTORIAL_SEED = 'tutorial-1'`, `TUTORIAL_OFFERS` [[crusher],[furnace],[splitter]] for rounds 1–3 (then the seed's own stream), `TUTORIAL_SPARE_CONVEYORS = 3` in the starting bin. Not a rules change: `tests/sim.test.ts` pins a SHA-256 of `draftOffers` over 54 ordinary seeds × 6 rounds taken before the table existed (OFFERS_SNAPSHOT); a tutorial run replays and verifies like any other.
- **Hints** (`GameScene.tutorialHint()`): one rule per round, checked against the real layout — crusher unfed/misoriented vs fed (`placementWarning`), furnace before the crusher ("raw scrap would reach the furnace first"), splitter merge confirmed by `runLayout(layout, 40).shipped.ingot > 0`; round 4 says the rest is an ordinary draft and `setOnboarded()`. Funnel steps 1–6 map onto these. A new profile on any other seed gets one hint pointing at Learn.
- **Title**: second row is now Learn (3 min) · Custom seed… · Import replay… (220 px each); Learn is amber "Learn to play (3 min)" and Enter starts it while the profile is not onboarded and nothing is saved.
- **Autoplayer**: `tests/tutorial.test.ts` — 8 rng seeds × 40 tries on `tutorial-1`: picks are crusher/furnace/splitter and ingots ship within rounds 1–3 every time.
- **E2E** (render-e2e step 6): fresh profile → Learn highlighted; scripted lesson via the dev API reaches round 4 in **21 actions** (≤ 40) asserting the hints at each state (misoriented crusher explained; "Shards reach the furnace"; "Not flowing yet" → "ingots flow" once both splitter branches side-load back; spare sold); `jd.onboarded.v1` set; no panel/modal opened; afterwards the title shows "Learn (3 min)" unhighlighted. Screenshots of the title row and round 1 checked by eye.
- `npm test` **63/63**.
- **Open design note**: the lesson's round 3 needs 4 conveyors for the two-branch merge, which is why the tutorial bin starts with 3 spares (the hint mentions them); a human playtest should confirm the splitter round is not too long — if it is, drop the south branch and teach side-loading with one branch.


## Session 2026-10-29 (night) — PLAN-v1 0.3.7 opt-in funnel events
- **Vocabulary** `game/src/telemetry/events.ts` (shared client/server): the Measurement-plan list with allowed property keys per event; `validateEvent`/`validateBatch` (consent must be `true`, install id 32 hex, ≤ 100 events, strings ≤ 64, a `seed` key only with a `daily-*`/`tutorial-*` value); `ONCE_EVENTS`; `FUNNEL` step order.
- **Client** `game/src/render/telemetry.ts`: off until the title toggle (`telemetry` button, `jd.settings.v1.telemetry`); on consent a random install id (`jd.telemetry.v1`) and `consent_set`; `track()` dedups once-events, drops invalid ones, batches every 8 s / 20 events to `POST /events`; the unsent queue is persisted and re-sent at the next boot (found by the e2e: a `sendBeacon` on navigation was counted as sent but never arrived — no beacons now, nothing double-counted); `gameStart(seed)` → second_game_start / daily_start; opting out deletes the state. Hooks: main (app_start, session_end on pagehide), Title (settings_changed), GameScene (first_draft_pick, first_place_attempt/rejected with reason, first_rotate, undo_used, first_run_start, round_complete, first_run_complete, game_complete {mode}, tutorial_step_start/complete 1–5), TipsPanel (tip_opened), Results (daily_submit_result verified/rejected/busy, share_copied). Dev API `telemetry()`, `flushTelemetry()`.
- **Verifier**: `EventStore` (append-only JSON lines, `ipHash` = SHA-256(per-process salt : UTC date : ip)[0:16], `prune(now)` atomic rewrite, `funnel()`); `POST /events` (own limiter 30/min/IP, 64 KB cap, 422 with the reason, 503 on storage failure) and `GET /funnel`; main prunes at start and hourly; file defaults next to the board (`EVENTS_FILE`, `EVENTS_RETENTION_DAYS`). `tools/funnel.ts` / `npm run funnel` prints the step table (% of app_start), tutorial steps, rejection reasons, modes, results, tips, settings, session length.
- **Tests**: `tests/telemetry.test.ts` (2), verifier events test, game-e2e opt_in_funnel_events (off by default; toggle → consent + install id; after the run every funnel step shows 1 install, counts for daily_submit_result/share_copied/undo_used/first_place_rejected, the events file has no seed and no address). `npm test` **61/61**. Funnel tool run on a generated file: table prints.
- **Not done / notes**: no privacy page yet (0.9.5) — the toggle's one-line note is the only disclosure, which is why it stays off by default; the Electron build has no hosted verifier so events go nowhere until 0.4.7 ⚑.


## Session 2026-10-29 (evening) — RoundController extraction, then PLAN-v1 0.3.6 tips
- **Extraction (review follow-up):** `game/src/render/RoundController.ts` (206 lines, pure TS) owns run state, mode (build → running → paused → summary → build), tick pacing (`advance(deltaMs)`, `tickPhase`), the frozen-layout rule, undo/redo and playback (`advanceReplay`, scheduled through a hook). GameScene (825 lines, from 885) implements the hooks (onTick, onRunStart, onPause, onRoundEnd, onNextRound, onFinished, onStateChange, onReject, onPlaybackDone, persist, schedule) and exposes `run`/`mode`/`sim` as getters, so the dev API, perf tool and every e2e were unchanged. `tests/controller.test.ts` (4) covers the phase machine without a browser; one bug found by it: a watched replay's final 'next' left the empty queue non-null (playback never reported done).
- **0.3.6:** `sim/tips.ts` — six tips with small real layouts and a `check(result)` each; `tests/tips.test.ts` runs every demo for one loop and asserts the claim (crusher ships only shards; two hoppers merge ≥ 12 scrap; both splitter docks ship; furnace on raw scrap ships slag and no ingot; press ships a plate and absorbed ≥ 1). `render/TipsPanel.ts` — list + text + a live demo (real textures at 0.75 scale, `createSim`/`step` every 240 ms, looping; item moves tween unless reduced motion). Title: "Tips & demos" button in the HOW TO PLAY panel; Game: "Tips" at the right end of the draft/build header, amber with "●" while a first-time draft has an unread tip (`tipForMachine`, `jd.tips.v1`), never during playback; Esc closes the panel before anything else. Dev API `tips()`, `openTips(id)`, `closeTips()`. The hint strip is untouched by tips (asserted).
- **E2E:** render-e2e step first_draft_suggests_its_tip_once — a seed with a round-1 press is found with `draftOffers`; pick → suggested 'press' and "Tips ●"; open → marked read, the demo ships a plate within 20 s; Esc closes; reload + pick again → no badge. Screenshot checked by eye (panel, badge, demo at tick 13 with 2 plates shipped).
- `npm test` **58/58**.


## Session 2026-10-29 (later still) — PLAN-v1 0.3.5 money heartbeat and stall marker
- GameScene: ships mark the HUD total dirty; `update()` re-rasterises it at most every 100 ms (`HUD_MS`) with a 140 ms pulse unless reduced motion (a per-ship `setText` at 4× cost a measurable ~1 ms/frame under CPU throttle in the first attempt, so it is coalesced). `updateStall(jammedNow)` after each tick: no ship for `STALL_TICKS` = 8 while any cell is jammed (a blocked hopper emits a `jam` at its own cell) → the lowest jammed cell is flagged: HUD line `Stalled: <machine> at <x>,<y> is waiting|blocked — nothing shipped for 8 ticks` (1-based cell like the summary badges) and a red `tile-sel` frame on the cell, pulsing alpha unless reduced motion; cleared when the stall ends or the round ends. Dev API `stall()` → text, cell, tick.
- Test: render-e2e step stall_marker_names_the_blocking_cell (head-on conveyor at (3,2); flagged by tick ≤ 10 at the hopper or the conveyor in front of it; total stays $0; marker visible; cleared at the summary). Screenshot checked by eye.
- Perf: `tools/perf.ts` A/B on the same machine state (stash vs working tree): previous commit 4.06 ms script/frame at 4× CPU throttle, this code 3.76 ms; both above the 2.6 ms baseline because Firefox was busy in the background during this session, so the day's absolute numbers are noise and the A/B is the evidence: no change beyond noise.
- `npm test` 52/52.


## Session 2026-10-29 (later) — PLAN-v1 0.3.3 undo / redo
- `game/src/sim/undo.ts`: `canUndo` (building, last action is place/unplace/rotate/sell), `undo` (state re-derived by `replay()` from seed + remaining actions, returns the removed action), `redo` (re-apply if the rules still accept it). The replay stays a flat list of final actions; nothing crosses a run or a pick.
- GameScene: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, "Undo (Ctrl+Z)" and "Redo" buttons in the build panel (disabled when unavailable, in the panel's change key), redo stack cleared by any new edit, selection/held ids dropped if their machine vanished, save rewritten. Dev API `undo()` / `redo()`.
- Found and worked around: Phaser's keyboard plugin delivers a modifier+key keydown twice in this Chromium (its duplicate bailout compares timeStamps, which differ), so one Ctrl+Z undid two edits; shortcuts are now guarded to one per 30 ms (`lastShortcutAt`). `R` alone was never affected.
- Tests: `tests/undo.test.ts` (2) and the e2e step undo_restores_facing (Ctrl+Z after R restores dir 0, a second Ctrl+Z returns the part to the bin, two Ctrl+Y redo both, button alphas 1 / 0.4 track availability). `npm test` 52/52.


## Session 2026-10-29 — worst-machine foundation (docs/DOSSIER-v1.md §8)
Reviewed and merged the routine's PR #1 (0.3.2) after running its suite here (47/47). Then the three increments, each a commit on main:

| Id | What | Evidence |
|---|---|---|
| 0.3.8 | Render probe folded into `tools/perf.ts` (draws, binds, objects, Text creations, heap); `--device A|B|C|D`; `--renderer` via `?renderer=`; `tools/perf-gate.ts`; `.github/workflows/perf.yml` | gate passes today vs 0.2.0, fails a synthetic +30 % (`tests/perf-gate.test.ts`); workflow green on 9c9e93d and 78adf2d (no CI baseline yet, see below) |
| 0.3.9 | Pooled, coalesced +$ pops (16 slots); `renderSide()` no-op while inputs unchanged; legend built once; caches reset in `create()` (Phaser reuses the scene instance; the replay e2e caught a destroyed legend) | Text objects per busy round **208 → 68**; script ms/frame at 4× CPU throttle **3.05 → 2.5–2.7**; device B webgl 5.05 → 4.3 ms (dropped 2 → 1), canvas 5.23 → 4.75 ms. Target was −20 %, achieved −13 to −17 %: the rest is the running/summary panels, which 0.4.0 removes |
| 0.3.10 | DPR-sized canvas (cap 2) + camera zoom per scene; Text resolution injected once via `TextStyle.setStyle`; pointer handlers use world coordinates; adaptive probe (`quality.ts`, 120 frames, p95 > 20 ms → `renderQuality: 'low'`); title "Resolution" button; `?renderer=canvas`; context-loss handling verified | `tests/render-e2e.test.mjs`: 2240×1400 backing store, text resolution 2, a real drag lands on (5,4) under the zoomed camera; Canvas renderer completes a round; `WEBGL_lose_context` lose + restore leaves `state()` identical, textures re-uploaded, grid visible, a round still runs. Screenshots at DPR 1 and 2 compared by eye: identical layout, crisp text at 2× |

Numbers after the slice (Chromium headless on this PC, seed auto-12 last round at 4×; headless Chromium renders WebGL in software, so fill cost appears as CPU): hardware 1× script 0.55 ms, cpu 8.5 ms, 0 dropped · 4× CPU throttle script 2.6 ms, cpu 12.4 ms, 0 dropped · **device A** (1920×1080, DPR 1.5) cpu 17.8 ms, 8 dropped of 200 · **device B** (1366×768, ×6) webgl cpu 15.6 ms 1 dropped, canvas cpu 10.6 ms 0 dropped · **device D** (915×412, DPR 2.6→2, ×4) p95 66 ms, 72 dropped — exactly the case the adaptive probe exists for (it would store 'low' after that run; `tests/quality.test.ts` pins the decision). A real GPU does not pay software fill cost; measuring A and D on hardware is a human item. All files under `docs/baselines/0.3.0/`.

**Not done / needs a human:** (1) commit a CI baseline: download the `perf-ci` artifact from a green run of the perf workflow (https://github.com/blickz55/junkyard-draft/actions) and save it as `docs/baselines/0.3.0/perf-ci.json` to arm the gate (CI numbers only compare with CI numbers); (2) run the packaged app on a HiDPI laptop and a Chromebook and note the probe's decision (`jd.settings.v1`.renderQuality); (3) the packaged build in `release/` is still 0.2.0 (rebuild with `npm run desktop:pack` before the next perf run that includes Electron). Deviation from the dossier prompt: the adaptive fallback does not reload mid-run; it stores the decision and applies it on the next start (the run in progress keeps its resolution, a hint says so).

## Routine run 2026-10-26 — PLAN-v1 0.3.2 (merged 2026-10-29 as PR #1)

## Routine run 2026-10-26 — PLAN-v1 0.3.2 (no rule changes, RULES_VERSION stays 2)
- New pure module `game/src/sim/advice.ts`: `explainRunError()` (every `RunError` message from `apply` → player sentence), `placementWarning()` (legal-but-unfed: nothing behind a behind-only machine, neighbour not pointing in, output off the grid), `inputTravelDirs`/`outputDirs` (mirror `accepts` in sim.ts).
- GameScene: ghost arrows on the machine in hand (mouse drag and keyboard cursor): blue = input side(s), amber = output side(s). A refused drop shows its reason in the hint strip for ~2 s and pre-empts every other hint; an unfed spot shows "Heads up: …" while hovering. Nothing is refused that the rules accepted.
- Tests: `tests/advice.test.ts` (3, in `npm test`); e2e asserts the occupied-cell reason (mouse and keyboard) and the unfed warning; screenshot `e2e-ghost-arrows-*.png` (arrows visible in keyboard mode; mouse-drag arrows use the same drawing code but were not separately screenshotted).
- Verified: `npm run typecheck` clean; `npm test` 47 tests, 46 pass, 0 fail, 1 skipped (desktop smoke, no packaged build in the cloud).
- Not done: tested only in headless Chromium; no human playtest of the arrow legibility.

## Next task
**0.4.8 SVG art pipeline and runtime atlas** (M, DOSSIER-v1 §2.3): a one-off script that replays `game/src/render/textures.ts` into SVG files under `game/assets/svg/` (7 machines facing east, 8 belt frames, 5 items, 4 tiles, 3 UI, 3 state overlays), a `BootScene` loader that rasterises them at `min(DPR, 2)` into one dynamic atlas with the current frame names (`m-crusher`, `i-plate`, `belt-0`…) so no scene code changes, and the procedural generator kept as the fallback. Accept: snapshot of texture keys unchanged; `tools/perf.ts` binds per frame ≤ 8; `tools/a11y-audit.ts --sheet` regenerated from the live textures passes; a build screenshot reviewed by a human ⚑. Then **0.4.4 juice pass** per DOSSIER-v1 §2.4 (state frames: crusher jaws, furnace glow, press ram; draft lock-in and all-shipped settle sounds; the event→sound→visual table into DESIGN.md) and **0.4.9 audio buses**. Later: GIF as the second clip format; `TipsPanel` to DOM. Human items unchanged: playtest (with the tutorial), installer on a clean machine, Docker build, CI perf baseline artifact, HiDPI on a real GPU, host the verifier (0.4.7 ⚑). Human-gated items (0.3.1 playtest, installer run, Docker build) still stand.

# Status — 2026-10-26 (external review of 0.2.0 addressed; routine paused during the fix, re-enabled after)

## External code review of v0.2.0 — response (2026-10-26)
An independent reviewer (OpenAI Codex "Astra Ultra") reviewed commit `f3de10b` against docs/REVIEW-PROMPT.md and would not ship 0.2.0 as-is. Every finding was reproduced by them; every fix below is pinned by a named test (see CHANGELOG "Unreleased" for the full list). Verified here: `npm run typecheck` clean, `npm test` **44/44** in 24 s.

| Severity | Finding | Fix | Test |
|---|---|---|---|
| High | Malformed URL (`GET //[`) crashed the verifier | URL parse guarded (400), handlers wrapped (500), `clientError` → 400 | malformed_url_does_not_kill_verifier |
| High | Drag in progress when the round starts could edit the authoritative layout (visual $38, awarded $0) | `startRun` cancels the drag; drag/drop handlers and `act()` refuse layout edits outside build mode | starting_round_cancels_active_drag (e2e) |
| High | Results of a watched replay cleared the player's own save | `clearSave()` only for the player's own run | watched_replay_preserves_existing_save (e2e) |
| High | Board writes truncated the live file; memory changed before persistence | candidate board → temp file → rename; memory updated after; 503 + Retry-After on failure | failed_persistence_preserves_previous_board |
| Medium | Unbounded entries/seeds, limiter keys, negative `limit` bypassed caps | per-seed and total-seed caps, limiter cardinality cap, `clampInt` on every limit | bounds test |
| Medium | Rules-version checks inconsistent (old rows on the current board; client accepted missing versions; fetched replays skipped validation) | version-partitioned `rank/replay/size`; `validateReplayFile` shared by all entry points; `verifyReplay`/`replay()` require an explicit current version | old_rules_board_is_not_current_verified_board, all_replay_entry_points_require_explicit_version |
| Medium | Valid-JSON-wrong-shape localStorage crashed the title | field-by-field validators for settings, save, bests, submissions; unusable saves explained | malformed_storage_shapes_fall_back (unit + e2e) |
| Medium | Live play accepted runs replay rejected (65-char seed, >4000 actions); failed resume silently restarted | seed bound at `newRun` and in the UI, action budget with a reserve for finishing, resume notice | every_live_save_remains_resumable |
| Medium | 32-bit FNV replay id collided (legal run rejected as duplicate) | SHA-256 over canonical content; legacy ids kept | identity test |
| Medium | 130 % text / 64-char seed pushed HUD and title content off-canvas | HUD seed ellipsis with measured positions, note under the Continue button, wrapped results subtitle | large_text_layout_fits (e2e) |
| Medium | Hover state dropped dark-steel buttons to 3.10:1 | `hoverColor`: brighten under dark labels, darken under light; hover pairs in the audit | hover_colors_meet_AA |
| Medium | Bundle test ran esbuild's native binary through Node | esbuild JS API | bundle test |
| Medium | Docker copied host-built `server/dist` with its permissions | `.dockerignore` excludes it; `COPY --chmod=0644` | (reviewer built the image; still no Docker here) |
| Low | `window.__jdGame` exposed in production | gated by `devEnabled()` like `__jd` | existing e2e (uses `?dev=1`) |
| Quick wins | "$2 slag" copy; bundled default data path `server/server/data`; permissive personal-best assertion; submission vs rank messaging | all done | personal_best_equals_completed_score |

Also done from the review's maintainability list: `RULES.process` keyed by `ProcessorKind`; typed `hintText()` instead of private-field access; per-frame `Set` allocations removed. **Not done (follow-ups, in order of value):** extract a round/playback controller from `GameScene` (the drag race is fixed, but the phase transitions still live in one class); extract measured panel/HUD layout; SQLite behind a transactional interface once the board must be indexed or shared. The reviewer's perf numbers (p95 100 ms) came from a cloud host with software rendering and do not reproduce here (0 dropped frames on hardware, see the 0.2.0 baseline); profile on a low-end laptop before pooling.


## 0.2.0 release-candidate baseline — 2026-10-25 (this PC: Windows 11, Node 24, 240 Hz display)
Version bumped to 0.2.0 (`package.json`; title shows `build 0.2.0+<commit>`, verifier `/health` reports `version`); `CHANGELOG.md` written from the history since the 0.1.0 bundle; tag `v0.2.0`. Full battery, actual results:

| check | command | result |
|---|---|---|
| typecheck | `npm run typecheck` | clean |
| test suite | `npm test` | 32/32 in 21 s (sim 14, a11y 3, share 2, verifier 6, control-room 5, gameplay e2e 1, desktop smoke 1) |
| production build | `npm run build` | dist/main.js 1254 KiB |
| desktop | `npm run desktop:dist` | win-unpacked 359 MB; `Junkyard-Draft-Setup-0.2.0.exe` 122 MB (NSIS, per-user, unsigned); 31 s |
| packaged smoke | in `npm test` | launches, plays a round, no page errors |
| verifier bundle | `npm run verifier:build` | server/dist/verify.mjs, exports VERSION 0.2.0 |
| autoplayer | 20 seeds × 120 tries | min 1210 / p25 1594 / median 1697 / p75 1788 / max 2088 vs starter 228; dead-end seeds 2; no suspicious scores; press picked 4/120 |
| press balance | 40 seeds × 120 tries, 6 variants, 173 s | v2 press drafted 19/56 when offered, 0 seeds worse / 7 better vs refusing, +44 when taken — unchanged |
| colour audit | `tools/a11y-audit.ts` | 0 contrast failures, 0 CVD pair failures |
| frame budget | `tools/perf.ts` @4× | see below; all within budget |

| perf environment | p95 ms | dropped | CPU ms/frame | script ms/frame |
|---|---|---|---|---|
| chromium @4× | 16.7 | 0 | 9 | 0.64 |
| chromium cpu×4 @4× | 16.7 | 0 | 13.61 | 3.15 |
| electron packaged @4× | 4.3 | 0 | 0.33 | 0.23 |

Evidence summaries: `docs/baselines/0.2.0/{autoplay,balance,perf,a11y}.json`. Not covered by this pass (needs a human or another machine): a manual playtest, running the installer on a clean machine, building the Docker image.

**Remote (2026-10-25):** `origin` = https://github.com/blickz55/junkyard-draft (public) — `main` and tag `v0.2.0` pushed; `main` tracks `origin/main`. Scheduled cloud continuation is set up: routine "Junkyard Draft continuation" (weekdays 10:00 UTC, Sonnet 5.5, branch + pull request per run, never pushes to main) — details and the owner's review duty in docs/CONTINUE.md. First run: 2026-10-26 10:00 UTC.


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

## Previous next-task note (superseded above)
Follow `docs/PLAN-v1.md`, milestone v0.3 "First five minutes", in order, skipping ⚑ items (the three review follow-ups above — controller extraction, layout extraction, SQLite — are M-sized and can be taken after 0.3.3 if a run finds the scene too tangled to extend): **0.3.2 placement ghost with port arrows and a one-line rejection reason** (S) → **0.3.3 undo/redo in the build phase covering rotations** (S/M) → **0.3.5 live money heartbeat and stall indicator** (S) → 0.3.6 tips panel with live mini-simulations (M) → 0.3.7 opt-in first-session funnel events (S/M). Each has acceptance criteria in the plan; add tests as described there and keep RULES_VERSION at 2 (v0.3 and v0.4 change no rules). The human-gated items below still stand and 0.3.1 (manual playtest round one, with notes in `docs/PLAYTEST.md`) should happen before v0.3 closes: (1) **playtest** one full manual run of 0.2.0 (`npm run dev:all` or the packaged app) and write notes into `docs/PLAYTEST.md` — what confused, what felt flat, which draft offers were dead; (2) **run the installer** `release/Junkyard-Draft-Setup-0.2.0.exe` once on a clean Windows machine and note the SmartScreen prompt and install path; (3) ~~push to GitHub~~ done: https://github.com/blickz55/junkyard-draft; (4) **build the verifier image** where Docker exists. The next code task after the playtest: act on its notes (likely onboarding copy and a second tutorial seed).
