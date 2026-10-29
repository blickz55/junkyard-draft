# Changelog

All notable changes to Junkyard Draft. Dates are UTC. Rules changes bump `RULES_VERSION`, which invalidates
older replays and saves on purpose.

## Unreleased — rules-v3 branch (PLAN-v2 0.5.2 onward; merges as 0.5.0 with RULES_VERSION 3)

### Rules identity (PLAN-v2 §1)
- `RULES_VERSION` is 3 on this branch from its first commit. Version-2 replays and saves are refused with the version named; the v2 golden corpus is archived under `tests/golden/archive/v2/` and a test proves every archived replay is refused, while the v3 corpus is regenerated (same actions, same scores: no existing machine changed behaviour).
- Local records written before 0.5.0 always migrate into the rules-2 slot, whatever version runs at migration time (the first cut filed them under the current version, which would have mislabelled every upgrading device).

### Sieve measured and deferred (PLAN-v2 0.5.2)
- The Sieve exists in the simulation as an experimental kind (input from behind, raw scrap forward, processed materials right, a blocked exit waits and counts as a jam) with draft weight 0 and no card. On the same-inventory fixture the separated routes beat the Sieve line by 17 % ($338 vs $289), and still beat it if a dock paid double for ingots ($638 vs $577): the merge it sorts costs more throughput than the sorting saves, and eleven machines on 48 cells never force a merge. Decision and numbers in `docs/DESIGN.md`; the v0.5 decision machine becomes the Tuner (PLAN-v2 0.5.3 re-cut).

## Unreleased — 2026-10-29 (v0.5 foundations on main, PLAN-v2)

### Measurement tools generalised (PLAN-v2 0.5.1)
- `tools/balance.ts` measures any machine (`--machine`), with tuning variants given as dotted RULES paths in a JSON file, two search policies side by side (greedy as the control, neutral accepting plateau moves), paired per-seed deltas against the banned condition, metadata (rules version, build, budget, rng streams, derived sanity bound), every reported score re-simulated from its recorded actions before it counts, and `--gate` exiting 1 on a failed threshold. `tools/autoplay.ts` gains `--policy`, the plan's dead-end definition (no improving draft in any round) beside the earlier ≥ 4-flat-rounds heuristic, and a sanity bound derived from the rules instead of a guess. The library (`tools/balance-lib.ts`, `tools/autoplay-lib.ts`) is unit-tested, including byte-identical output across two runs.

### Local records partitioned by rules version (PLAN-v2 0.5.0)
- Bests and verified submissions are stored per rules version (`jd.bests.v2` / `jd.submissions.v2`: `{ byVersion: { "2": … } }`). The pre-0.5.0 keys migrate once into the rules-2 slot and are removed; settings, player name, onboarding, read tips and days played are untouched. Readers take the current version; bests kept under another version appear on the title as a collapsed "Under rules vN" block (kept, not comparable). This is the prerequisite for the rules-v3 work: after the bump an old best can no longer pose as the current target, and an old submission can no longer block a new result. No rules change.

## Unreleased — 2026-10-29 (pre-v0.5 stabilization from the independent review, docs/reviews/PRE-V05-REVIEW-2026-10-29.md)

### Verifier and collector integrity (F01–F03, F08, F12)
- A telemetry event without a `name` could throw inside the asynchronous request handler and terminate the verifier; validation is total and both body handlers are guarded (any surprise answers 500, never exits). The hook collector's redaction kept the token and appended `[redacted]`; patterns are split into whole-match and prefixed forms (`.claude/hooks/redact.mjs`, tested with synthetic tokens). Replay identity hashed the client's JSON key order, so a permuted copy of the same replay was a second board entry; actions are now rebuilt in canonical field order at every entry point (`canonicalAction`, `canonicalReplayJson`). An accepted submission rebuilt the board without its `pars`, deleting every cached bot par. A telemetry send that failed after opt-out restored its events and a later opt-in resent them; sends belong to a consent generation now.

### Desktop, input and provenance (F04, F05, F09–F11, F14–F16)
- `window.prompt`/`alert` do not exist in Electron, so player name, custom seed, replay import, the first submission's name and the clipboard fallback failed in the packaged app; they are DOM dialogs (`dialog`, `promptText`, `alertText`, `showText` in `ui/dom.ts`), and a cancelled, busy, unreachable or rejected submission leaves Submit usable. Gameplay keys were captured globally: Enter on a focused offer did nothing, Tab on a focused button took a bin part, Space with Tips open started the run; shortcuts now stand down for focused DOM controls, Tips and dialogs, nothing is captured, and Tips manages focus (Close focused on open, Tab trapped, focus restored). While watching a replay, Space on a summary advanced the phase on top of the queue's own `next`; playback owns advancement and stale scheduled callbacks are dropped. Clip and GIF footers said "verified replay" for local runs; they say so only for this run's accepted replay. Results showed this device's stored best-submission standing beside a different run; standing is bound to this exact run's canonical hash, an earlier attempt is labelled as such, and late histogram responses are ignored. Seeds named `__proto__`/`constructor`/`toString` collided with inherited properties; seed dictionaries are null-prototype with own-property checks. The dock's ship pulse ignored the HiDPI base scale. **Full Grid is renamed All Hands** (every owned machine on the grid at the end, nothing sold): no legal run could fill 48 cells with at most 11 machines.

### Deployment readiness (F06, F07, CI)
- The Docker image lacked `game/src/telemetry` and `tools/autoplay-lib.ts`, so it could not build the verifier; the Dockerfile copies them and a test rebuilds the bundle from exactly the Dockerfile's layout. Bot-par work admitted by public reads is bounded (queue cap, today's seed first, expiring capped failure memory, cached pars capped). New `ci.yml`: typecheck, full suite, both bundles, a real image build with health, submission and restart persistence (`tools/image-smoke.ts`), and a Windows packaging job on tags. The perf gate has `--strict` (empty or unmatched evidence fails) and an explicit CI baseline path. The Control Room bounds tool-call history, answers malformed escapes with 400 and contains file serving by path boundary. The Electron clip sink validates sender, type and size; in-window navigation is blocked.

### Compatibility statement corrected (F13)
- 0.4.0's "every v0.2 replay still verifies" was too broad: `tutorial-*` seeds became scripted scenarios in 0.3 under rules version 2, so a v0.2 replay on a tutorial-prefixed seed no longer replays. Ordinary seeds are unaffected. From now on scenario semantics are versioned with `RULES_VERSION`, and a golden replay corpus (`tests/golden/`, 8 replays: autoplayer lines, a sold part, a press line, undo-style churn, the tutorial, a tutorial-looking ordinary name, a daily label) pins existing behaviour in `npm test`.

## 0.4.0 — 2026-10-29

**For players.** The run is now the show. Results open on the verified score histogram with your bar highlighted and a percentile, plus a bot par for every seed so there is a target on day one. Share a spoiler-free glyph grid (or the detailed line), export your best round as a looping WebM or GIF, and earn Clean / Minimalist / Full Grid badges that are never ranked (Full Grid became All Hands in the stabilization pass: it could not be earned). The build phase has undo/redo, a money heartbeat and a stall marker; a tutorial seed and a tips panel with live demos teach the rules; every screen is real text that scales to 130 % and passes the contrast audit. The art is an authored SVG atlas (sharp on HiDPI), machines show their state with frames instead of wobbles, and the audio has three buses with per-bus volume, a throughput hum that follows the line, two authored impact samples and a reduced-audio mode. Rules are unchanged (RULES_VERSION 2): every v0.2 replay on an ordinary seed still verifies (the `tutorial-*` namespace became a scripted scenario in 0.3; see the stabilization note above).

**For operators.** The verifier adds `/histogram`, bot par in a worker, `/events` for the opt-in funnel and 30-day retention; `tools/perf.ts` has device presets and a CI gate; `tools/a11y-audit.ts` covers the DOM stylesheet; the desktop app saves clips through the preload bridge. Details follow, newest first, grouped by the slice they shipped in.

### 2026-10-29 (v0.4: histogram-first results, PLAN-v1 0.4.1)

#### Impact samples under the synth (DOSSIER-v1 0.4.13)
- Two tiny authored samples beneath the factory tones: a metallic clink when the dock ships and a dull thud when a press makes a plate (`game/public/sfx/ship.wav`, `press.wav`: mono 22 kHz 16-bit, 6 and 8 KB, rendered deterministically by `tools/make-sfx.ts`). They load with the boot loader like the art, decode once the audio context exists, play through the factory bus inside the tone's voice (so the polyphony caps and the bus slider cover both), and fall back silently to synth-only when a file is missing or undecodable. Reduced audio never uses them. The dev API reports `samples: { loaded, played, missing, failed }`.

#### Tips panel in the DOM (PLAN-v1 0.4.12)
- The tips & demos panel is a DOM dialog layered over the current screen (`game/src/ui/TipsPanel.ts`): tip list with unread dots and an active state, title and text in real type, Close (Esc), click outside to close. The live demo is a small 2D canvas stepped by the real simulation and drawn from the real textures (item slides between cells, reduced motion snaps). The last Phaser text/rectangle panel is gone, so the overlay no longer hides itself while tips are open and the text-size setting applies to tips too.

#### GIF clip format (PLAN-v1 0.4.11)
- "Save GIF" on the results screen beside "Export clip": the same best round, drawn offline by the clip painter at 1× and 10 fps as one pass plus a hold, encoded in the browser by a dependency-free GIF89a writer (`game/src/render/gif.ts`: one global 256-colour palette quantised from every frame, LZW, NETSCAPE2.0 loop). It needs no MediaRecorder, so it also works where video capture is unavailable, and posts where a video will not autoplay. Electron saves it to Downloads through the same bridge as the WebM. Measured on seed gif-seed (a 5-machine line, 80 ticks at 4×): 624×536, 38 frames, 3.8 s loop, 256 colours, 580 KB, drawn and encoded in 0.3–0.6 s; looked at in Chromium: belts, items, dock pops and the strip animate as in the video.

#### HiDPI art atlas (DOSSIER-v1 0.4.8b)
- The SVG atlas is rasterised and packed at `min(DPR, 2)` times the logical size, so on HiDPI screens the WebGL batch samples sharp pixels instead of upscaling 1× frames. Scenes keep their logical geometry through a per-key base scale (`baseScale`, `fit`, `setArt` in `atlas.ts`) applied at every image site in the game, title and tips panel; scale tweens multiply by it. A procedural fallback texture stays at 1× and is drawn at scale 1. The clip exporter, the DOM item images and the audit sheet already draw frames into logical-size rectangles, so their output is unchanged at 1× and sharper at 2×.

#### Throughput hum (DOSSIER-v1 0.4.10)
- A drone on the music bus from run start to the settle: two detuned triangle oscillators through a low-pass filter. The cutoff follows items in flight (0 → 300 Hz, 12+ → 2 kHz), a jam detunes it a quarter tone while it lasts, the last ten ticks rise an octave, and the settle glides it to the fanfare's root (C4). The round number picks the root up a major pentatonic scale from C3 (round 6 is the octave). Absent under reduced audio; nothing plays during build or on the title; leaving the scene stops it. The model is pure (`humRoot`, `humCutoff`, `humTarget` in `mixer.ts`) and the dev API reports `hum: { on, cutoff, detuned, freq, root, starts }`.

#### Audio buses, voice caps and reduced audio (DOSSIER-v1 0.4.9)
- Three buses (ui, factory, music) with per-bus levels in settings (title: "Audio buses" fold-out), master volume and mute as before. The factory bus plays one call per simulation tick: same-tick ships coalesce into one chord (distinct values, highest first, up to 8 voices with value priority), transforms keep the highest 4 tiers, jams are throttled; the fanfare ducks the factory bus −6 dB for 600 ms; a stall has its own low tone. Reduced audio plays at most one sound per tick (ship > transform > jam) and never a chord. The allocator is pure (`game/src/render/mixer.ts`) and unit-tested; the dev API exposes the synth's counters.

#### Juice pass bound to sim events (PLAN-v1 0.4.4)
- One sound and at most one visual per event, scaled by value, nothing shakes. New: a draft lock-in sound, a round-end settle (every machine eases 1 → 0.97 → 1 staggered by column, one soft tone), a 90 ms place settle and a 60 ms rotate snap. Machines show their state with frames instead of wobbles: crusher jaws alternate while holding (`m-crusher-1`), the press ram descends over its hold (`m-press-1`, `m-press-2`), the furnace keeps its warm tint; belts cycle 8 chevron frames (was 3) at the same speed. The clip exporter draws the same frames. Reduced motion keeps sounds and drops every tween and frame swap. The full event → sound → visual table is in `docs/DESIGN.md`.

#### Authored art pipeline and runtime atlas (DOSSIER-v1 0.4.8)
- The art now lives as 22 SVG files under `game/public/art/`, exported losslessly from the procedural generator by `tools/export-svg.ts` (a Phaser-Graphics-shaped recorder that emits SVG) and editable in any vector tool. At boot the SVGs load, pack into one 456×304 canvas texture, and every scene-facing key (`m-crusher`, `i-plate`, `belt-0`, `tile`…) becomes an alias whose single frame points into that shared texture: no scene code changed, and the factory draws with **1 draw call and ~3 texture binds per frame (was ~59 binds)**. A file that fails to load falls back to the procedural drawing for that key. The clip exporter and the colour-vision contact sheet read frames by their atlas cut. Frames stay at logical size; a HiDPI atlas needs a base-scale factor in the scenes and is a follow-up.

#### Non-ranked run badges (PLAN-v1 0.4.6)
- Clean (no item waited and no hopper was blocked for a tick in any round), Minimalist (at most 8 machines in the final round while still at or above the bot par) and Full Grid (every cell used in a round), computed from the finished run's own records in `game/src/sim/badges.ts`. Shown as pills on the results screen marked "not ranked", refreshed when the bot par arrives, and listed only in the detailed share text of a verified run. Never a board, never a ladder.

#### Spoiler-free share grid (PLAN-v1 0.4.3)
- The default share text is now `Junkyard Draft · Daily 2026-10-29 · $1234`, a line of six glyphs (one per round: ░ ≤ $100, ▒ ≤ $250, ▓ ≤ $400, █ above), your verified standing ("better than 61 % of 38 verified runs" once five runs exist, else the rank, else "local score, not yet verified") and "N days played". No URL unless "add link" is ticked, no per-round dollars, no layout. "Copy detailed" adds the per-round earnings and the rules version. Days played are counted per UTC date with a finished run (`jd.days.v1`).

#### Loop clip export (PLAN-v1 0.4.2)
- "Export clip" on the results screen re-simulates the best round with the real simulation and draws it with the real generated textures onto an offscreen canvas at 4× (grid plus a 24 px margin, a 56 px strip with seed or date, round earnings, running total, player and wordmark on every frame, capped at 720 p), two passes with a 300 ms hold so it loops, recorded live at 30 fps through `canvas.captureStream` + `MediaRecorder` (VP9 → VP8 → MP4 by support). Always full motion. Saved as `junkyard-<seed>-$<score>-r<round>.webm`: a browser download on the web, and straight into Downloads through the Electron bridge (`jdDesktop.saveClip`, no dialog; `JD_CLIP_DIR` overrides). Measured in headless Chromium on this PC: 690 KB VP9 WebM, 7.45 s, 446 frames at 624×536, exported in 7.5 s.

#### Bot par (PLAN-v1 0.4.5)
- The first time a seed is asked about, the verifier runs the shipped autoplayer in a worker thread (five searches × 40 tries on fixed rng streams, so the same number on every machine), wall-clock capped and never on the request path, and stores the median as `botPar`; `/board`, `/histogram` and `/daily` return it (null while computing; a failed job backs off ten minutes; `BOT_PAR=0` disables). The results histogram shows "Bot par $N · the shipped autoplayer's median on this seed (a target, never ranked)" and whether you beat it; the title's daily strip shows "bot par $N". It is never an entry on any board.

#### Histogram-first results and daily strip
- Verifier `GET /histogram?seed=&hash=`: the verified score distribution in nice-width bins (1 / 2 / 2.5 / 5 × 10^k), N, and, when the caller's replay hash is on the board, its rank, bin, percentile (share of other verified runs with a strictly lower score; ties are not beaten) and up to five neighbours above and below. Empty when nobody has played: nothing is ever invented.
- Results screen: the distribution with the player's bin highlighted, "Better than X % of N verified runs · #R" once five or more runs exist, otherwise "N verified runs so far · you are #R", and an "around you" slice. The title's daily strip shows a miniature of today's distribution once a verified run exists.

### 2026-10-29 (v0.4 begins: DOM UI shell, DOSSIER-v1 0.4.0, slice 1)

#### DOM UI shell (title and results)
- The title and results screens are now real HTML laid over the canvas (`game/src/ui/dom.ts`, `TitleScreen.ts`, `ResultsScreen.ts`): text reflows at every text size (the title fits at 130 % with a saved run, which the hand-positioned version could not), buttons are focusable and screen-reader readable, layout is CSS. The overlay tracks the FIT-scaled canvas (`--k`) so sizes in em follow the canvas scale; `--text-scale` carries the text-size setting; reduced motion disables the score pop. The Phaser scenes keep the decorative belt, the tips panel (the DOM hides while it is open) and the bookkeeping. Material icons in the results come from the generated textures (`getBase64`), so DOM and canvas can never disagree.
- Every control carries `data-testid`; the e2e uses Playwright's DOM locators instead of Phaser object names. New checks: the overlay covers exactly the canvas at 1280×800 and 1920×1080 with no control outside it and no scrolling; the stylesheet's colour literals are all audited palette colours.
- **Slice 2 — the game scene's chrome**: HUD bar (seed with CSS ellipsis and the full seed as a tooltip, round, live total with a CSS pulse, local best, stall line), the side panel in all four states (draft cards, build with selection / undo / redo / run, running with progress and speed, round summary), the hint strip, the round-result banner and the per-machine badges over the grid, and the pause veil are DOM (`game/src/ui/GamePanel.ts`). The canvas keeps the grid, bin, machines, items, ghost, cursor, jam and stall marks and the pooled +$ pops. The panel rebuilds only when its inputs change; per-frame values update elements in place. Text objects created per busy round: 68 → 12; script ms/frame at 4× CPU throttle 2.43 ms (from 2.63). Pointer events pass through to the canvas everywhere except the controls.

### 2026-10-29 (worst-machine foundation, DOSSIER-v1 0.3.8–0.3.10; PLAN-v1 0.3.2 merged)

#### Onboarding (PLAN-v1 0.3.2, routine PR #1)
- Ghost arrows on the machine in hand (blue inputs, amber output) for mouse and keyboard; a refused drop explains itself in the hint strip for 2 s; a legal but unfed spot warns ("Heads up: …"). `game/src/sim/advice.ts` + `tests/advice.test.ts`.

#### Build phase (PLAN-v1 0.3.3)
- **Undo / redo**: Ctrl+Z removes the last layout edit of the current build phase (place, unplace, rotate, sell), Ctrl+Y or Ctrl+Shift+Z re-applies it; panel buttons "Undo (Ctrl+Z)" and "Redo" track availability. Undo re-derives the state from seed + remaining actions, so the replay stays a flat list of final actions and an undone rotation restores the exact previous facing; nothing is undone across a run or a draft pick. `game/src/sim/undo.ts`.

#### During the run (PLAN-v1 0.3.5)
- **Money heartbeat**: the HUD total counts up as items ship (re-rasterised at most every 100 ms, with a small pulse unless reduced motion).
- **Stall marker**: when nothing has shipped for 8 ticks while an item is jammed or a hopper is blocked, the HUD names the first blocking cell ("Stalled: Conveyor at 3,3 is waiting — nothing shipped for 8 ticks") and a red frame marks it (static under reduced motion). Clears when items flow again or the round ends. Dev API `stall()`.

#### Tutorial seed (PLAN-v1 0.3.4)
- **`tutorial-1`**: rounds 1–3 offer exactly one machine each (crusher, furnace, splitter) and three spare conveyors start in the bin; rounds 4–6 are an ordinary draft from the seed's own stream. The hint strip is the only guidance: each hint is checked against the real layout (fed-ness via the placement advisor, flow via a 40-tick real simulation) and says what to do next; finishing round 3 marks the profile onboarded. Title: "Learn to play (3 min)" (highlighted for a new profile, Enter starts it) becomes "Learn (3 min)" afterwards; a new profile on another seed gets one hint pointing at it. Every other seed's offers are byte-identical (snapshot test), so no rules bump.

#### Opt-in funnel events (PLAN-v1 0.3.7)
- **Off by default.** A title-screen toggle "Share stats: Off/On" with a one-line explanation. When on: a random 128-bit install id is created; events from a fixed vocabulary (`game/src/telemetry/events.ts`: app_start, consent_set, tutorial steps, first_draft_pick, first_place_attempt/rejected, first_rotate, undo_used, first_run_start/complete, round_complete, game_complete, second_game_start, daily_start, daily_submit_result, share_copied, tip_opened, settings_changed, session_end…) are batched to the verifier's `POST /events`; once-per-install events are deduplicated locally; the unsent queue is persisted so a page navigation never loses a batch; a `seed` property is refused unless it is a `daily-*`/`tutorial-*` label. Turning it off deletes the install id and the queue.
- **Verifier**: `POST /events` (consent required, vocabulary enforced, 30/min/IP, 64 KB) appends to `events.jsonl` with a daily-salted IP hash; `GET /funnel` returns unique installs per step; rows older than 30 days are pruned at start and hourly. `npm run funnel` prints the step-conversion table and breakdowns.

#### Tips (PLAN-v1 0.3.6)
- **Tips panel with live mini-simulations**: six tips (crusher orientation, side-loading merge, splitter alternation, raw scrap in a furnace makes slag, a press needs two shards, sell unused parts), each demo a tiny real layout stepped by the real simulation and drawn with the real textures, looping every 24–30 ticks. Reachable from the title ("Tips & demos") and from the draft/build panel ("Tips"). Drafting a machine for the first time badges the button ("Tips ●"); opening the tip marks it read (`jd.tips.v1`) and it is never suggested again. Tips never write to the hint strip. `game/src/sim/tips.ts`, `game/src/render/TipsPanel.ts`.

#### Architecture
- **RoundController** extracted from GameScene (review follow-up): the mode machine, authoritative run state, tick pacing, frozen-layout rule, undo/redo and replay playback live in `game/src/render/RoundController.ts` (no Phaser or storage imports) behind hooks; the scene renders and routes input. Unit-tested in Node.

#### Rendering and performance
- **HiDPI**: the canvas is now device-pixel-ratio sized (capped at 2×) and each scene's camera zooms the fixed 1120×700 layout onto it; Text objects rasterise at the same resolution. Pointer handlers read world coordinates. `?dpr=` overrides.
- **Adaptive resolution**: the first run at high resolution samples 120 frames; a p95 over 20 ms stores `renderQuality: 'low'` so later starts render at 1×, with a hint and a title-screen "Resolution" button to switch back (applies on reload).
- **Canvas renderer switch**: `?renderer=canvas` forces Phaser's Canvas renderer (weak GPUs, perf presets).
- **Pooled +$ pops**: one pop per dock per tick from a 16-slot pool (same-tick ships coalesce); the side panel is rebuilt only when its inputs change and the VALUES legend is built once. Text objects created per busy round 208 → 68; script time at 4× CPU throttle −13 to −17 %.
- **Measurement**: `tools/perf.ts` reports draw calls, texture binds, display-list peak, Text objects created and heap, has `--device A|B|C|D` presets and `--renderer webgl|canvas|both`; `tools/perf-gate.ts` compares a report with a baseline; `.github/workflows/perf.yml` measures preset B on every push and PR (arms once `docs/baselines/<v>/perf-ci.json` is committed). Baselines under `docs/baselines/0.3.0/`.

#### Tests (44 → 63)
advice (3); perf-gate; quality (adaptive decision); undo (2: place→rotate→undo→undo restores the pre-place state and the exported replay verifies; sell refund, run boundary, stale redo); render-e2e: hidpi_canvas_keeps_logical_coordinates, canvas_renderer_completes_a_round, webgl_context_loss_keeps_the_run, stall_marker_names_the_blocking_cell; game-e2e: pooled_pops_never_exceed_the_pool, undo_restores_facing (Ctrl+Z / Ctrl+Y with the panel buttons' enabled state); controller (4: full round through advance() with the layout frozen, pause/speed/undo/redo/reject, a watched replay driving itself to finished without persisting, damaged and mid-result saves); tips (2: every demo layout proves its claim, suggestion-once); render-e2e step first_draft_suggests_its_tip_once; telemetry (2: client consent/dedup/no-seed/persisted queue, vocabulary + batch validation); verifier events test (consent, vocabulary, seed refusal, hashed IP, /funnel, retention); game-e2e opt_in_funnel_events (toggle on the title, every funnel step reaches the test verifier once, no seed or address in the file); sim tutorial-seed test with the OFFERS_SNAPSHOT hash; tutorial autoplayer test (ingots by round 3 in 8/8 tries); render-e2e step tutorial_seed_teaches_one_rule_per_round (fresh profile → Learn highlighted; scripted lesson to round 4 in 21 actions; misoriented crusher, furnace and splitter-merge hints asserted; onboarded afterwards).

### 2026-10-26 (external code review response)

Fixes for every finding of an independent review of `f3de10b` / v0.2.0 (findings quoted in docs/STATUS.md).

#### Verifier
- A malformed URL no longer crashes the process (400; handler errors 500; socket-level garbage 400).
- Writes are atomic (temp file + rename) and memory changes only after the write succeeds; a failed write answers 503 + Retry-After and the retry is not a duplicate.
- Boards are partitioned by rules version: rows from another `RULES_VERSION` never rank, count or replay.
- Replay identity is SHA-256 over `{ rulesVersion, seed, actions }` (a 32-bit FNV collision had rejected a legal run as a duplicate); legacy ids still resolve.
- Bounds: query limits are finite integers clamped to [1, max]; rate-limiter keys capped; entries per seed and total seeds capped; damaged board files load empty.
- Default data directory is `<cwd>/server/data` for source and bundled runs; Dockerfile excludes host-built `server/dist` and copies the bundle world-readable.

#### Game
- Starting a round cancels an in-progress drag and freezes the layout: no drop, key or dev-API call can edit it once the simulation starts (this could show $38 visually and award $0).
- Finishing or stopping a watched replay no longer clears the player's own unfinished save.
- Every replay entry point (pasted file, verifier submission, fetched replay) goes through one structural validator; a missing rules version is rejected everywhere.
- Seeds obey the same 64-character bound at creation, in saves and in replays; an action budget stops layout edits before a run becomes unreplayable while always leaving room to finish.
- localStorage shapes are validated field by field (a `{"bySeed":null}` bests entry crashed the title); unusable saves are explained and dropped instead of silently starting over.
- Submission success and rank lookup are reported separately; 429/503 say nothing was recorded.
- `window.__jdGame` is gated like `window.__jd`; the tutorial no longer claims slag is $2.
- Layout: long seeds are shortened in the HUD with an ellipsis (full seed on title/results), the saved-run note sits under its button, the results subtitle wraps; button hover states keep AA contrast (dark labels brighten, light labels darken).
- Per-frame Set allocations removed from the render loop; `RULES.process` typed by processor kind; dev API no longer reaches into private fields.

#### Tests (32 → 44)
malformed_url_does_not_kill_verifier, failed_persistence_preserves_previous_board, old_rules_board_is_not_current_verified_board, bounds/limiter/loadBoard, SHA-256 identity + legacy ids, bundle test via the esbuild API; all_replay_entry_points_require_explicit_version, every_live_save_remains_resumable; malformed_storage_shapes_fall_back (new storage suite); hover_colors_meet_AA; e2e: starting_round_cancels_active_drag, watched_replay_preserves_existing_save, malformed storage at boot, personal_best_equals_completed_score, large_text_layout_fits (title at 130 % with a save, HUD with a 64-character seed).

## 0.2.0 — 2026-10-25 (release candidate)

Built on the user's Windows PC after restoring the 0.1.0 bundle. Rules v2.

### Gameplay
- **Plate Press** (rules v2): two shards → one $8 plate, 2-tick hold, input from behind; the first shard is absorbed
  (new `absorb` event, `RunResult.absorbed`); a shard left in a press at round end shows as "1 shard held" on its
  badge. Draft weight 10, conveyor 34 → 30. Balance pass kept it unchanged (34 % pick rate when offered, never a loss).
- **Keyboard-only placement**: arrow keys move a cursor (first press on the selected machine), Enter places the next
  bin part or picks up / drops a machine, Tab cycles bin parts, R rotates, Delete / Backspace return to the bin,
  Esc drops → deselects → hides.

### Verification and boards
- Verifier gained `GET /daily` (today's UTC seed + verified board), `GET /replay?hash=` (stored actions of verified
  entries), `/health` with entry count, uptime and version; host / port / data-dir settings, request log, per-IP
  rate limit on submissions (429 + Retry-After), CORS origin, `X-Forwarded-For` behind a trusted proxy; single-file
  bundle (`npm run verifier:build`), `Dockerfile`, `server/README.md`. Stored replays are kept for each seed's top 100.
- Title screen: "Today's verified board" strip (top 5, empty state, offline notice), your own daily rank by replay
  hash, "Watch #N" for the best entry with a stored replay, "Player: …" name button.
- Results screen: one-time player-name prompt, verified rank after submitting ("#N of M … as <name>"), "Copy share
  text", clickable board entries that fetch, re-verify locally and play back a verified replay.
- Watched replays: REPLAY marker, the original run's per-round earnings beside the live total, Stop (Esc returns to
  the title). Playback never records bests, never saves, never submits (the save bug was caught by the e2e).
- Game build bakes `VERIFIER_URL` (default `http://127.0.0.1:4400`); `?verifier=` still overrides.

### Accessibility
- Reduced motion (belts static, no flashes / pops / travel, items snap; defaults to the OS preference) and text size
  100 / 115 / 130 % on the title screen, persisted; layouts that used fixed offsets now measure their text.
- Colour audit: WCAG AA on every text pair, colour-vision-deficiency simulation of materials and semantic colours,
  enforced by `tests/a11y.test.ts`. Palette nudges: red, plate, build label, dedicated cursor tint.

### Desktop
- `npm run desktop:pack` (unpacked app) and `npm run desktop:dist` (NSIS installer, per-user, unsigned); app icon
  rendered from SVG; packaged-app smoke test in `npm test`; `JD_DEV_API=1` exposes the test hooks in the packaged app.

### Tooling and quality
- `tools/balance.ts` (a machine's marginal value on identical offers), `tools/perf.ts` (frame-time budget in Chromium,
  throttled Chromium and the packaged app), `tools/a11y-audit.ts`, `tools/make-icon.mjs`.
- Fresh-clone fixes: build no longer depends on git-ignored folders; browser tests no longer hang when the browser
  path differs; `.gitattributes` pins LF; `.dev-build/` untracked.
- Test suite grew from 20 to 32 (sim, verifier, control room, a11y, share, gameplay e2e, desktop smoke).

## 0.1.0 — 2026-10-25 (cloud session, delivered as `junkyard-draft.bundle`)

- Deterministic simulation core (rules v1), seeded draft, replay codec and verification.
- Playable vertical slice: title / game / results scenes, procedural art, synthesized audio, six machines, sell from
  the bin, on-grid round badges, save/continue, local bests, replay export/import.
- Workshop Control Room: hook collector, SSE dashboard, self-test, live browser test.
- Local replay verifier with a verified-only board and results-screen submission.
- Autoplayer seed exploration; Electron shell scaffold (unverified at the time).
