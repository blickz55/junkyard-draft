# The improved Junkyard Draft — design and engineering dossier

*Written 2026-10-29 against commit `0df337b` (main), in answer to `docs/ASTRA-BRIEF.md`. Measurements in this document were taken on the author's Windows 11 PC with `tools/perf.ts`, the render probe (now part of , 0.3.8)`tools/render-probe.ts`, and the esbuild output in `dist/`; anything not measured is labelled inference. It extends `docs/PLAN-v1.md` (the plan of record) and disagrees with it in four places, listed in §7. The nightly routine has one open pull request, [blickz55/junkyard-draft#1](https://github.com/blickz55/junkyard-draft/pull/1) (PLAN-v1 0.3.2, placement reasons), which the delivery plan assumes is reviewed and merged first.*

## 1. The vision

**v1.0 is "the daily factory": six minutes you can share.** A player opens a link or the app, sees today's seed and a histogram of real verified runs, drafts six machines, arranges them on a grid that is readable at a glance, watches 80 ticks of their own machine pay out, and leaves with three artefacts: a verified place on a distribution, a seven-second looping clip of their best round, and a spoiler-free text block. Their friends see the block, open the same seed, and play the same board. Nobody is punished for missing a day; every past day is playable; every score on a board was re-simulated by a server. On Steam it is the same game with achievements, cloud saves and a trusted-write leaderboard, verified by the same server, playable on a Deck with a controller.

**v2.0, if it finds an audience, is "the factory club":** groups with seasons and weekly modifier seeds, authored puzzle seeds published by players and verified like dailies, same-seed races with a ready-up and a spectator URL that streamers put in their title, watch-together rooms where viewers re-simulate the host's replay locally so a room costs bytes per tick, and tournaments as brackets of races. None of it needs video, voice or free text: the replay is the medium, the verifier is the referee, and Discord is the lounge.

**Who plays it.** The Opus Magnum / Mini Motorways / Wordle overlap: adults who like a bounded daily puzzle with a build-and-watch payoff, on a laptop at lunch or a Deck on the sofa, in sessions of one to three runs (six to fifteen minutes). They talk about it through the share block and clips, in a Discord thread per day, and in "beat this" links. The PLAN-v1 research says this audience is retained by a forgiving daily and histograms, not by live play; nothing here changes that.

**The three first-ten-minute experiences.** A first-time player must (1) place a crusher behind a hopper and see scrap become shards with a sound and a visible transform, within the first minute, because orientation is the rule everyone trips on; (2) finish a first run in under three minutes and feel the money counter tick while +$ pops rise from the dock; (3) see their score on a histogram beside real people, with "better than 61 % of 38 runs", not an empty top ten. A returning player must (1) see a new seed and an open board the moment the title loads, with their streak counted but never threatened; (2) see yesterday's best or a friend's run as a ghost they can race; (3) leave with a clip or block they want to post. Everything in §§2–6 serves one of those six moments or the infrastructure beneath them.

## 2. Graphics direction and pipeline

### 2.1 What the renderer is actually doing today (measured)

| Measure (Chromium, dev server, seed auto-12 best layout, 10 machines) | Value |
|---|---|
| Boot: DOMContentLoaded / dev API live on the title (localhost) | 354 ms / 470 ms |
| Texture keys after boot (19 generated + Phaser defaults) | 53 |
| JS heap at title, in build, during the run | 45.2 MB throughout |
| Game objects in build phase (Image 51, Container 14, Text 7, Rectangle 5) | 77 |
| Game objects peak during a 4× run / on the round summary | 120 / 115 (31 Text, 10 Arc) |
| WebGL draw calls per frame: title / build / 4× run | 2 / 3 / 4.7 |
| `bindTexture` calls per frame: title / build / 4× run | 32 / 39 / 69 |
| Script ms per frame at 4× (from `docs/baselines/0.2.0/perf.json`): hardware / 4× CPU throttle | 0.64 / 3.15 |
| `dist/main.js`: raw / gzip / brotli | 1,284,578 / 355,314 / 285,608 bytes |
| of which Phaser 3.90 (`phaser.min.js`) raw / gzip | 1,196,122 / 316,203 bytes |

Two conclusions. First, draw submission is not the problem: Phaser 3.90's multi-texture batcher keeps the whole game under five draw calls, so a sprite atlas will not change frame time on any GPU made this decade (inference from the counts; the ~70 binds per frame cost microseconds on a desktop GPU and matter only on very old mobile drivers). Second, the real costs are elsewhere: every `+$` pop is a new `Text` object, which rasterises a canvas and uploads a texture (a 40-ship round makes 40 uploads plus 40 tween allocations), the side panel is rebuilt from scratch on each `renderSide()`, and Phaser itself is 89 % of the download. The optimisation plan in §4 follows from these numbers, not from folklore about draw calls.

### 2.2 Art direction

Keep the warm-industrial identity (charcoal floor, amber belts, rust hoppers, steel machines, green docks) and finish it in three ways:

- **Silhouette first.** Each machine gets one unmistakable outline at 72 px and at 36 px: hopper = funnel with a visible mouth, crusher = jaws, furnace = chimney and a glowing mouth, press = tall frame with a ram, splitter = Y plate, dock = crates on a bay, conveyor = a belt with chevrons. The current procedural drawings already have these; the authored versions keep them and add a 2 px dark outline and a single light direction (top-left) so the pieces read as one set.
- **State cues are overlays, not separate art.** Holding (press with one shard): a small shard icon in the machine's corner, already done as a badge. Jammed: the red `tile-bad` wash plus a pulsing border, as today, and a static "!" glyph for reduced motion. Starved (an unfed processor): a dashed grey input edge, which is the warning 0.3.2 introduces. Selling: the dock's crate lid lifts one frame on each `ship`. Overlays stay in the current palette, which already passes the audit; the audit test in `npm test` remains the gate for any new colour.
- **Items at half size.** Scrap, shard, plate, ingot and slag must differ by shape, not colour (the CVD audit demands it): blob, triangle, flat bar, brick with a top highlight, dark blob with a crack. The current 24 px icons already do this; the authored set is drawn at 48 px with the same shapes and downscaled.

### 2.3 Procedural versus authored: a hybrid, and SVG is the authoring format

| Option | Download | Draw calls / binds | Memory | Authoring | HiDPI | Themes |
|---|---|---|---|---|---|---|
| Procedural (today) | 0 bytes | 5 / 69 per frame | 19 small textures (~0.5 MB VRAM) | code only; each tweak is a commit and a boot | fixed 72 px, blurry above DPR 1 | trivial (palette constants) |
| Authored PNG atlas (Aseprite) | 1024² RGBA PNG ≈ 150–300 KB (inference) for 7 machines × states + items + UI at 1× and 2× | 5 / ~6 per frame | 4 MB VRAM at 2× | needs pixel-art time; HiDPI means a second atlas | 2 fixed scales | per-atlas |
| **Hybrid: SVG sources rasterised at boot into one runtime atlas** | ~20 SVGs ≈ 40–80 KB (inference; vector files are small) | 5 / ~6 per frame | one 1024² or 2048² dynamic texture | any free vector editor (Inkscape); diffable text files; the current drawings can be exported as the first versions | any DPR: rasterise at `min(devicePixelRatio, 2)` | palette by CSS variables inside the SVG, or tint |

Recommendation: the hybrid. Phaser loads SVG natively (`this.load.svg(key, url, { scale })`), so the pipeline is: `game/assets/svg/*.svg` → loaded in `BootScene.preload` at the chosen scale → copied into one `DynamicTexture` atlas with frames named exactly as today (`m-crusher`, `i-plate`, `belt-0`…) so no scene code changes → `textures.ts` keeps generating the UI dots and tiles procedurally and becomes the fallback if an SVG fails to load (offline Electron never fails; the web build gets a bundled fallback). Asset list (30 files): 7 machines (east-facing; rotation stays at runtime), 8 belt frames (up from 3 for smoother motion at 1×), 5 items, 3 state overlays (jam border, starved edge, crate lid), 4 tiles, 3 UI (cursor, selection, badge plate). Atlas layout: 2048×2048 at DPR 2 (72 px cells become 144 px frames; 30 frames fit with room for animation frames), 1024×1024 at DPR 1. Authoring time for a solo developer with no art budget: inference, two to four evenings for the first full set if the current procedural drawings are exported as SVG first (a one-off script that replays `textures.ts` into an SVG writer is a day's work and makes the migration lossless).

### 2.4 Animation and feedback, bound to sim events

The rule from PLAN-v1 stands: one sound and at most one visual per event, intensity scales with value, nothing shakes the screen. The most repeated interaction is placing and rotating a machine, so it gets the best feel: a 90 ms settle (scale 1.06 → 1.0, ease out) on place, a 60 ms snap on rotate, and the ghost's port arrows (0.3.2) animate nothing.

| Sim event | Visual (full motion) | Duration | Reduced motion |
|---|---|---|---|
| `spawn` (hopper emits) | item appears at the hopper mouth at scale 0.6 → 1.0 | 80 ms | appears at 1.0 |
| `move` | item tweens one cell; belt chevrons advance one frame per tick | tick length | item snaps; belts static (as today) |
| `transform` | item swaps texture; one expanding ring in the output colour (as today) | 300 ms | texture swap only |
| `absorb` (press takes a shard) | shard shrinks into the press; ram descends one frame | 220 ms | badge updates only |
| `ship` | +$ pop rises 38 px and fades; dock lid frame; counter ticks | 700 ms | pop fades in place (as today) |
| `jam` | red wash + 1 px border pulse on the jammed cell | while jammed | static wash + "!" |
| hopper blocked | hopper mouth overlay turns grey; stall marker (0.3.5) | while blocked | same, no pulse |
| round end, all shipped | 120 ms settle across the grid (every machine 1.0 → 0.97 → 1.0, staggered by column) | 400 ms | none |
| draft lock-in | the chosen card slides into the bin | 180 ms | card appears in the bin |

Crusher jaws (2 frames), furnace glow (tint oscillation), press ram (3 frames) animate only while an item is inside; idle machines are still. That keeps a 48-cell grid quiet when nothing is happening, which is what makes a jam visible.

### 2.5 UI: move the chrome to the DOM, keep the factory in the canvas

Today the side panel, badges, hint strip, title and results are hand-positioned Phaser `Text` objects. Three facts argue for moving them: text size 100/115/130 % and a 64-character seed already needed measured layouts and ellipsis code to stop overflow; every HUD update re-rasterises a text texture; and a screen reader cannot read a canvas, which is why PLAN-v1 0.8.4 plans a parallel hidden DOM. If the panel *is* DOM, 0.8.4 shrinks to labelling the grid and the mirror of the grid alone, and 0.8.6 (externalised strings) becomes ordinary HTML templating.

Decision: a DOM overlay (`game/src/ui/`, plain TypeScript + CSS, no framework) for the title, results, settings, side panel, hint strip and replay banner; the canvas keeps the grid, bin, items, badges, ghost and cursor. Layout: CSS grid with the canvas as a fixed-aspect centre column and the panel as a flex column that wraps at 16:10 and stacks under the grid below 900 px wide (Deck at 1280×800 shows grid + panel side by side at the 115 % preset; 16:9 at 1080p gets whitespace margins, not stretched text). Text scaling becomes a `font-size` on `:root`. The Phaser `getByName` anchors that the e2e suite uses become `data-testid` attributes with the same names, so the tests change by one helper. This is the one large refactor in the dossier (M to L) and §7 schedules it before the histogram (0.4.1), because a histogram is far easier to build and test in DOM than in Phaser graphics.

### 2.6 Loop-clip export spec

- **Source**: re-simulate the chosen round (default: highest-earning) through the real renderer into an offscreen canvas at the device's DPR, cropped to the grid plus a 24 px margin (576×432 logical → 1152×864 at DPR 2, scaled to fit 720p if larger).
- **Speed and length**: 4× (80 ticks ≈ 3.4 s), played twice with a 300 ms hold on the final state, total ≈ 7 s; loops cleanly because the second pass starts from the same state.
- **Overlay**: a 56 px bottom strip in the UI font: seed label (date for dailies), `$score`, player name, a wordmark; first and last frames carry the same strip so a paused thumbnail still identifies the run. Full motion always, regardless of the reduced-motion setting.
- **Format**: WebM VP9 via `canvas.captureStream(30)` + `MediaRecorder` where `MediaRecorder.isTypeSupported('video/webm;codecs=vp9')`, else VP8, else MP4/H.264 (Safari supports MP4 only, and a 2021 WebKit bug produced blank canvas recordings on macOS, so Safari is tested, not assumed: [WebKit MediaRecorder post](https://webkit.org/blog/11353/mediarecorder-api/), [WebKit bug 229611](https://bugs.webkit.org/show_bug.cgi?id=229611)). GIF second: `gifenc` (MIT, ~5 KB) at 576×432, 20 fps, 128-colour palette quantised from the game palette, target ≤ 4 MB.
- **Delivery**: download via a blob URL on the web; through the preload bridge to a save dialog in Electron; "Copy clip" uses the Clipboard API where video is allowed and falls back to download.

## 3. Audio direction

### 3.1 Synthesis, samples, or both: both, with synthesis as the engine

Keep `audio.ts` as the engine because it is deterministic, tiny and already scales pitch by value. Replace waveforms with one-shot samples only where a square wave cannot convince: crusher impact, furnace whoosh, press thud, dock chime, draft lock-in. Fifteen mono OGG/MP3 one-shots under 120 ms each cost about 250 KB (inference from typical 44.1 kHz mono encodes) and load lazily after the title, so the first interaction never waits for audio. Synthesis keeps the UI clicks, the invalid buzz, the round fanfare and the hum below.

| Sound | Trigger | Scaling rule | Bus | Priority / cap |
|---|---|---|---|---|
| click | any button | fixed | ui | lowest; 1 per 50 ms |
| place / rotate / invalid | build actions | fixed; invalid never louder than place | ui | 1 per 50 ms |
| draft lock-in | offer chosen | fixed | ui | — |
| hopper emit | `spawn` | −6 dB; none at 4× | factory | 1 per tick |
| crusher / furnace / press | `transform`, `absorb` | pitch +2 semitones per output tier (shard < plate < ingot); slag gets a dull variant | factory | 4 voices; drop lowest tier first |
| ship chime | `ship` | base note by value (as today: 440/660/880 Hz), ingot adds a fifth; same-tick ships coalesce into one chord | factory | 8 voices; value priority |
| jam | `jam` first tick | fixed, throttled 400 ms (as today) | factory | 1 per 400 ms |
| stall | 8 ticks without a ship while blocked (0.3.5) | one low tone, once per stall | factory | 1 per stall |
| round fanfare / settle | round end | good/bad as today; ducks factory −6 dB for 600 ms | music | top |
| run start | `run` | fixed | music | — |

### 3.2 Music: a throughput hum, not a track

A six-round run is about 20 s of simulation at 4× and a few minutes of silent building. Linear music would be chopped at every round boundary and costs money to commission. Mini Metro's answer, event-driven procedural audio where the network plays itself, fits a factory exactly (PLAN-v1 cites the postmortem). Specification: one drone (two detuned triangle oscillators through a low-pass filter) starts at `run` and stops at the settle; filter cutoff maps to items in flight (0 → 300 Hz, 12+ → 2 kHz); ship chimes are quantised to the tick so they fall on a 4-ticks-per-beat grid (ticks are already discrete; at 1× that is 80 BPM, at 4× 320 BPM, which reads as a fast arpeggio); a jam detunes the drone by a quarter tone while it lasts; the last ten ticks of a round raise the drone an octave over 10 ticks and the settle resolves to the fanfare's root. Round number selects the root (rounds 1–6 walk up a pentatonic scale) so a full run has a rising shape without any composed material. No music during build; no title music. Total cost: zero assets, ~120 lines.

### 3.3 Accessibility

Every audio cue has a visual in the §2.4 table (that table is the contract; `docs/DESIGN.md` gets it). Three buses (ui, factory, music) with sliders in settings; mute per bus; a **reduced-audio** mode: no hum, at most one sound per tick, no coalesced chords; a **visual-only** mode leaves the +$ counter and the stall marker as the only feedback. The e2e reduced-motion step gains a reduced-audio assertion (the synth exposes a voice count through the dev API).

## 4. Full optimisation for the worst machines

### 4.1 Targets and budgets

| Class | Device | Viewport / DPR | Budget at 1× and 4× (frame p95 / p99) | Startup | Memory |
|---|---|---|---|---|---|
| A | 2017 ultrabook, Intel UHD 620, 8 GB, Chrome or Firefox | 1920×1080 / 1.0–1.5 | 16.7 / 25 ms (0 dropped) | title interactive ≤ 2.5 s on 10 Mbit | JS heap ≤ 80 MB |
| B | 4 GB Chromebook, Celeron N4000-class, Chrome, WebGL possibly blocked | 1366×768 / 1.0 | 33 / 50 ms (30 fps floor) | ≤ 4 s | ≤ 80 MB |
| C | Steam Deck, 1280×800, native Linux Electron build | 1280×800 / 1.0 | 16.7 / 25 ms | ≤ 2 s (local) | ≤ 150 MB (Electron) |
| D | mid-range Android (Snapdragon 6xx), Chrome, landscape | 915×412 CSS / 2.6 | 33 / 50 ms | ≤ 5 s on 4G | tab ≤ 200 MB |
| E | Firefox on Windows, any of the above | — | same as the class | — | — |

Bundle budget: ≤ 400 KB gzip for `main.js` (today 355 KB) until the custom Phaser build lands, then ≤ 220 KB (inference). Texture generation at boot ≤ 150 ms. Steam Deck Verified needs the smallest glyph ≥ 9 px with 12 px recommended (PLAN-v1 cites the Steamworks compatibility page); the DOM UI's handheld preset enforces 12 px. 1920×1080 is still the most common Steam primary resolution at about 50 % ([tech-insider, August 2026 survey](https://tech-insider.org/steam-hardware-survey-august-2026/)); the share of integrated Intel GPUs was not found in that search and is left unquantified.

### 4.2 Measurement protocol and CI gate

Extend `tools/perf.ts` with `--device A|B|C|D` presets (CPU throttle 1×/4×/6×, viewport and DPR via `Emulation.setDeviceMetricsOverride`, `--renderer canvas` through a `?renderer=` query that `main.ts` honours), fold in `tools/render-probe.ts` (draw calls, binds, object counts, heap, boot time), and add a Firefox run through Playwright (no CDP metrics there, so rAF deltas only). Add a GitHub Actions job that runs the throttled Chromium preset on every pull request and fails when dropped frames > 0 or `scriptMsPerFrame` regresses more than 25 % against `docs/baselines/<version>/perf.json`. Real devices cannot be emulated: `docs/perf/DEVICES.md` records human runs of the packaged app (date, device, preset, numbers), and the Deck and a Chromebook run are ⚑ items.

### 4.3 Prioritised optimisations (expected gains are inference unless measured)

1. **Pool the pop texts and tweens** (S). Pre-create 16 `Text` objects for `+$` pops and recycle them with `setText`; cap pops at 16 per frame and coalesce same-tick ships at one dock into one pop. Expected: removes 40 texture uploads and 40 allocations per busy round; the 3.15 ms script time at 4× throttle should drop by a third. Measured before/after with the gate.
2. **DPR-aware canvas with a cap and an adaptive fallback** (S/M). Render at `min(devicePixelRatio, 2)` (Phaser: `width: W*dpr, height: H*dpr, zoom: 1/dpr`, logical coordinates unchanged), which fixes the blurry upscale on every HiDPI laptop; fill cost grows with DPR², so when the first 120 frames of a run show p95 > 20 ms, fall back to DPR 1 for the session and say so in settings. Expected: sharper art on class A, no change on B/C, protects D.
3. **Render-on-change for the side panel** (S now, moot after the DOM UI). `renderSide()` only when a value changed; a dirty flag per section. Expected: eliminates the summary-screen rebuild cost (115 objects, 31 texts) on round end.
4. **Custom Phaser build** (M). Phaser 3.60+ supports tree-shakeable ESM entry points (`phaser/src`) and a custom-build template; this game uses Image, Text, Container, Rectangle, Arc, Graphics (boot only), tweens, pointer and keyboard input, Scale FIT and the WebGL/Canvas renderers. Expected 1.2 MB → 0.5–0.6 MB raw, ~150–180 KB gzip (inference from Phaser's own custom-build figures; measure). This is the lever for the 10 Mbit startup budget, not the atlas.
5. **SVG atlas** (M, §2.3). Binds 69 → ~6 per frame; no measurable frame-time change expected on A–C, a small one on D's older drivers; the gain is art quality and HiDPI.
6. **Canvas renderer switch** (S). `?renderer=canvas` and a settings toggle; `Phaser.AUTO` already falls back when WebGL is absent, but on Chromebooks and old Android, WebGL exists and is slow. Community reports of Canvas beating WebGL on weak GPUs are old and anecdotal ([Phaser forum](https://phaser.discourse.group/t/phaser-3-low-performance-with-integrated-gpu/13433), [html5gamedevs](https://www.html5gamedevs.com/topic/26175-game-works-better-in-canvas-than-in-webgl/)), so the toggle ships and the perf preset measures both; the adaptive rule from item 2 may switch to Canvas automatically on class B when the Canvas measurement is better.
7. **WebGL context loss** (S). Phaser 3.90 installs `webglcontextlost`/`webglcontextrestored` handlers (`WebGLRenderer.js` lines 1005–1006); the generated textures must be regenerated after restore. Add an e2e step that forces loss with `WEBGL_lose_context` and asserts the grid redraws and the sim state is unchanged (the sim never lived in the renderer, so this is a renderer test only).
8. **Mobile touch** (M, class D). Tap-to-select then tap-to-place, drag after a 150 ms press, 44 px targets, audio unlock on first tap, landscape layout where the DOM panel collapses to a bottom sheet. Phones are a v2 target; this item keeps tablets working.
9. **Custom minimal grid renderer**: not worth it. Draw calls are already under five and script time under 1 ms on hardware; the risks are text, allocation and fill rate, which items 1, 2 and 4 address. Revisit only if the custom build cannot get under 250 KB gzip.
10. **Fonts**: the stack is system fonts (`Inter, "Segoe UI", system-ui`); keep it. No webfont download. A wordmark, if wanted, is an SVG.

**What breaks first, by class.** A: nothing until a 4K monitor at DPR 2 (fill), fixed by the cap. B: WebGL blocked or software-rendered (Canvas toggle), then text rasterisation (pooling), then memory (Chrome discards tabs under pressure; the 45 MB heap is fine). C: Electron under Proton performs badly (PLAN-v1 cites the Boson authors), so the Deck needs a native Linux Electron build and Steam Input; a 12 px glyph floor. D: the viewport (grid is 576 px wide; needs landscape or scale 0.7), touch, the audio unlock, DPR 2.6 fill (cap), and Chrome's tab memory limit.

## 5. Player-to-player communication and social architecture

The constraint that shapes everything: a replay is a seed plus a rule-checked action list, the verifier re-simulates it, and every client has the sim. Therefore any social feature that consumes recorded play needs only HTTP, and any live feature needs to carry only actions and tick numbers, never video or scores. Three horizons.

### 5.1 Horizon 1 (v0.6–v0.7): asynchronous, HTTP only

- **Identity**: a random 128-bit device token in local storage / Electron userData; `player_id = SHA-256(token)`; the verifier maps `player_id → display_name#tag`; a recovery code exports the token; names stay non-unique labels (PLAN-v1 0.6.1).
- **Challenge link with a ghost**: `https://<domain>/?seed=<seed>&ghost=<replay_hash>`; the recipient's build phase shows the challenger's per-round earnings (already in the viewer) and, new, a toggle that overlays the challenger's *layout* at 30 % alpha during the build so the recipient can study and diverge; results land on a two-row board and a share line. Replays on an open daily stay hidden until the viewer has submitted (0.7.6), so a ghost on today's seed is only the challenger's money, never their layout, until the day closes.
- **Groups by code**: 8-character base32 codes (40 bits, join rate-limited to 10/min/IP) scope the daily strip, histogram and board; no chat.
- **Reactions on replays**: a fixed set of eight emotes (fire, applause, mind-blown, brain, recycle, turtle, puzzle, factory) stored as counts per `(replay_hash, player_id)`, one per player per replay, shown on board rows and on the results screen as "12 reactions". Counts only, so there is nothing to moderate.
- **Pre-set phrases** (the second tier, after reactions): a localisable list of twelve ("Nice route", "How did you feed the press?", "Rematch?", "Try the splitter on round 2"…) attachable to a challenge link or a reaction; no free text anywhere in-game, ever, until moderation tooling exists, and probably not after.
- **Fork from round N**, **weekly modifier seed**, **seasonal archive**, **Discord webhook** as in PLAN-v1 0.7.3–0.7.5; the webhook respects rate-limit headers and 429 `Retry-After` rather than a hardcoded rate, because the documented per-webhook limits disagree across sources ([Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-discord-webhooks-features-and-best-practices.md), [Cybrancee](https://cybrancee.com/blog/discord-webhooks-explained-what-they-can-and-cant-do/)).
- **The daily results share that spreads without links**: the spoiler-free block (0.4.3) plus, new, a 2×3 glyph grid of the final layout's *machine kinds* only (no positions, no facings), which hints at the build without giving it away.

**Data model** (SQLite behind the existing transactional interface; PLAN-v1 0.8.7 moves it): `players(player_id, name, tag, created_at, recovery_hash)`, `entries(seed, player_id, score, replay_hash, rules_version, origin, received_at, client_build)`, `replays(replay_hash, actions_blob, kept_until)`, `daily_seeds(date, seed, commitment, issued_at, closes_at, frozen_at)`, `bot_par(seed, median, tries)`, `groups(code, name, owner_id, created_at)`, `memberships(code, player_id)`, `reactions(replay_hash, player_id, emote)`, `challenges(id, seed, from_player, replay_hash, phrase_id)`, `reports(id, kind, target, reporter_id, reason, state)`, `moderation_log(id, actor, action, target, reason_code, at)`, `events(install_id, name, props, at)` (consented funnel only), `ip_buckets(salted_hash, window, count)`.

**Endpoints** (additions to the five that exist): `POST /identity` (claim name, returns tag), `POST /identity/recover`, `GET /histogram?seed=`, `GET /archive?from=&to=`, `POST /groups`, `POST /groups/:code/join`, `DELETE /groups/:code/members/me`, `GET /board?seed=&group=`, `POST /reactions`, `GET /reactions?hash=`, `POST /challenges`, `GET /challenges/:id`, `POST /reports`, `POST /events`, `DELETE /me` (GDPR deletion: name and replays removed, scores anonymised). All POSTs carry the bearer device token; per-player buckets (2 submissions/min, 30 reactions/min) sit beside the per-IP limiter.

**Abuse cases and answers**: name abuse → server-side blocklist with confusable and leetspeak normalisation at claim time, rename cooldown, report-then-hide (PLAN-v1 0.9.3); replay spam → per-player bucket plus duplicate-hash rejection; group-code enumeration → 40-bit codes and join rate limits; reaction brigading → one reaction per player per replay, counts only, no feed; report abuse → reports cap per player per day, hidden-pending state expires after 72 h if unreviewed; seed precomputation → server-minted seeds with commitments (0.6.2); bots → Assisted board with equal prominence (0.9.2). **GDPR-minimal**: stored personal data is the name, the hashed id, replays, scores, consented events and a daily-salted IP hash kept 7 days; the privacy page (0.9.5) lists all of it; no email, no birthdate, no cookies.

### 5.2 Horizon 2 (v0.8–v1.0): one relay for live presence, races and watching together

What needs a WebSocket versus HTTP:

| Feature | Transport | What travels | Why it is cheap |
|---|---|---|---|
| Presence ("14 people building today's seed") | HTTP poll every 30 s, or the relay's room count | one integer | — |
| Watch-together room | WebSocket | host's tick index and speed; viewers re-simulate the replay locally | bytes per tick, no video |
| Same-seed race with ready-up | WebSocket | ready flags, a synchronised start, each racer's actions as they happen | the sim is on every client; the verifier still scores the submitted replays, so the relay has no authority |
| Spectator URL for streamers | WebSocket or SSE (read-only) | the streamer's actions | same |
| Club events | HTTP (a group-scoped weekly) | — | — |

Relay options: Cloudflare Durable Objects with WebSocket hibernation (free tier 100,000 requests/day and 13,000 GB-s/day; incoming messages billed 20:1; hibernated objects accrue no duration charge: [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)) or a 200-line `ws` process beside the verifier on the same VPS. Start with the VPS process (no new vendor; one deploy), move to Durable Objects only if rooms outgrow one box. The relay never computes a score and never stores a replay; everything it forwards is re-verified through `/verify` when the race ends. Rooms are capped (8 racers, 50 viewers) and expire after 30 minutes idle.

### 5.3 Horizon 3 (v2.0): creators, clubs, tournaments, optional sign-in

Creator seeds generalise the tutorial's constrained offer table: a player publishes a puzzle seed (fixed offers per round, a target score) that is verified like a daily and listed in a browsable library with its histogram; clubs are groups with seasons (a 10-week archive and a season medal); tournaments are brackets of races scheduled by a club owner through the relay; a "race me" link in a stream title opens a room keyed to the streamer; a spectator overlay (large text, no name prompt, a QR to the seed) is a URL parameter. Identity gains an optional sign-in (Steam ticket on desktop, a magic-link email on the web) only for cross-device continuity; the device token remains the default. Voice and free text stay in Discord, where moderation exists.

## 6. Platform decision: web first, Steam at 1.0, one verifier for both

**Web first** because the daily's growth mechanism is a link and a text block that anyone can act on in ten seconds, because the verifier is already adjacent to the web build, and because portal builds are a poor fit (Poki blocks external requests, CrazyGames caps the first download at 50 MB and restricts monetisation, per PLAN-v1's sources), so the home is a site the project controls plus an itch mirror for discovery. **Steam at 1.0** because the Steam Direct fee is $100 per app, recoupable after $1,000 of adjusted gross revenue ([Steamworks app fee](https://partner.steamgames.com/doc/gettingstarted/appfee)), because trusted-write leaderboards turn the verifier into the anti-cheat story (PLAN-v1 0.8.8), and because the Deck is the handheld this game is shaped for. Both share the daily seed, the verifier and the histogram; the Steam build adds achievements, Auto-Cloud and the Steam board as a mirror of the verified board, written by the server.

**Domain.** Checked on 2026-10-29 through registry RDAP (a 404 means unregistered): `junkyarddraft.com` free, `junkyarddraft.io` free, `playjunkyard.com` free, `scrapdraft.com` free; the `.gg` registry's RDAP did not answer, so `junkyard.gg` is unchecked. Recommendation: register `junkyarddraft.com` now (and `.io` defensively if it is under $40/year), do a ten-minute brand check (USPTO and EUIPO trademark search for "junkyard draft" in classes 9 and 41, a Steam and itch search, the Discord server name and a social handle), and stop thinking about the URL.

**Hosting shape and cost.** Static game on Cloudflare Pages (free tier, unmetered bandwidth, 500 builds/month per third-party comparisons: [bootstrap.build](https://bootstrap.build/articles/netlify-alternatives/)); the verifier (and later the relay) on one Hetzner CX23 VPS (2 vCPU, 4 GB, €3.99/month after the April 2026 price change: [solodevstack](https://solodevstack.com/blog/flyio-vs-hetzner-solo-developers)) running the Docker image behind Caddy for automatic TLS, with `DATA_DIR` on the VPS disk and a nightly `rsync` of the board file to the dev PC; Fly.io is the alternative if a managed deploy is worth a few dollars more. Total: about €4–6 per month plus the domain. Analytics: none third-party; the consented funnel events only; no cookies, so no banner. Legal minimum: the privacy page (0.9.5), a terms page, no age gate (no accounts, no chat, no purchases on the web build), and no email collection anywhere.

**Steam path** (unchanged from PLAN-v1 0.8.8, 0.9.6, 1.0.1–1.0.3): Electron + `steamworks.js` behind a build flag, ticket validation in the verifier, trusted-write board, Azure Trusted Signing for the Windows installer, a native Linux Electron build for the Deck, $9.99–$14.99, one Next Fest with the demo submitted five weeks ahead.

**Timeline and first three actions.** Web beta when v0.6 lands (hosted verifier at 0.4.7 ⚑ is the gate); Steam page at v0.8 to accumulate wishlists; Next Fest during v0.9; Steam launch at 1.0. Actions this week: (1) register the domain; (2) stand up the VPS with Caddy and the verifier image (0.4.7 ⚑) and point `VERIFIER_URL` at it; (3) deploy the web build to Cloudflare Pages and run the e2e daily submission against the hosted URL, recorded in STATUS.

## 7. Delivery plan, re-cut

Four disagreements with PLAN-v1, then the milestones. (a) The DOM UI shell moves from implicit-in-v0.8 to the start of v0.4, because the histogram, the archive and the settings are DOM problems and the screen-reader mirror shrinks once the chrome is HTML. (b) Performance foundation work (pooling, DPR, renderer toggle, CI gate) is pulled into v0.3 as 0.3.8–0.3.10 because it touches no gameplay files, can run in parallel with 0.3.3–0.3.7, and the art pipeline depends on the DPR change. (c) Art and audio get their own items in v0.4 (0.4.8–0.4.10) rather than being folded into the juice pass. (d) Reactions and pre-set phrases are added to v0.6/v0.7 and the relay to v0.8, where PLAN-v1 had no live features at all; PLAN-v1's "no live multiplayer" rule stands for *gameplay* (no shared world, no elimination), while races and rooms are synchronised *solo* runs over a relay with no authority.

Sizes: S = one routine run and one PR, M = 2–4, L = 5+ or human ⚑. Dependencies in brackets. Acceptance criteria are a test or a measurement.

### v0.3 — First five minutes (no rules change)
0.3.1 ⚑ playtest; **0.3.2 placement reasons — in review as PR #1**; 0.3.3 undo/redo (S/M); 0.3.4 tutorial seed (M); 0.3.5 heartbeat and stall marker (S); 0.3.6 tips (M); 0.3.7 funnel events (S/M) — all as in PLAN-v1.
**0.3.8 Render probe, device presets and the CI perf gate** (S). `tools/render-probe.ts` (added with this dossier) folded into `tools/perf.ts`; `--device` presets; a GitHub Actions job on the throttled preset; baselines under `docs/baselines/0.3.0/`. *Accept:* the job fails on an injected 30 ms `busy-wait` in the update loop and passes on main.
**0.3.9 Pooled pops and render-on-change** (S) [0.3.8]. *Accept:* the probe shows ≤ 16 `Text` objects created during a 40-ship round; `scriptMsPerFrame` at 4× throttle ≤ 2.4 ms (from 3.15).
**0.3.10 DPR-aware canvas, cap, adaptive fallback, renderer toggle, context-loss test** (S/M) [0.3.8]. *Accept:* e2e at DPR 2 asserts the canvas backing store is 2240×1400 and logical coordinates unchanged; `?renderer=canvas` boots and completes a round; the context-loss step passes; perf preset B is recorded for both renderers.

### v0.4 — The run is the show (no rules change)
**0.4.0 DOM UI shell** (M/L) [0.3.10]. Title, results, settings, side panel, hint strip and replay banner move to `game/src/ui/`; `data-testid` replaces `getByName` in e2e through one helper; text scale and the handheld preset become CSS. *Accept:* every existing e2e passes; a 1280×800 and a 1920×1080 viewport screenshot show no clipping; the a11y test reads the CSS colours.
0.4.1 histogram (M) [0.4.0]; 0.4.2 clip export per §2.6 (M + M) [0.3.10]; 0.4.3 share block with the machine-kind grid (S); 0.4.4 juice pass per the §2.4 table (M) [0.4.8]; 0.4.5 bot par (S); 0.4.6 badges (S); 0.4.7 ⚑ host the verifier (L).
**0.4.8 SVG art pipeline and runtime atlas** (M) [0.3.10]. The export script from `textures.ts`, 30 SVGs, `BootScene` loader at `min(DPR, 2)`, one dynamic atlas, procedural fallback. *Accept:* frame names unchanged (snapshot of texture keys); binds per frame ≤ 8 in the probe; a11y sheet regenerated from the live textures passes; visual diff of a build screenshot reviewed by a human ⚑.
**0.4.9 Audio buses, samples, caps** (M). Three buses, fifteen one-shots loaded after the title, polyphony caps and value priority, reduced-audio mode. *Accept:* unit test of the voice allocator (priority and caps) run in Node with a stubbed context; e2e reduced-audio assertion.
**0.4.10 Throughput hum** (S) [0.4.9]. *Accept:* the hum starts at `run`, stops at the settle, and is absent in reduced-audio mode (dev API voice count).

### v0.5 — Decisions (rules 2 → 3)
As PLAN-v1 0.5.1–0.5.5 (Sieve, reroll, tiered pool, tie-breaker, balance gate). No change.

### v0.6 — The daily, done right
0.6.1–0.6.6 as PLAN-v1, with the data model of §5.1 and **0.8.7's SQLite migration pulled forward to 0.6.0** (M) because identity, groups and reactions need indexes. **0.6.7 Reactions on replays** (S/M) [0.6.1]. *Accept:* one reaction per player per replay enforced in a verifier test; counts appear on board rows in e2e.

### v0.7 — Play with people
0.7.1 challenge link **with the layout-overlay ghost** (M); 0.7.2 groups; 0.7.3 fork; 0.7.4 weekly modifier; 0.7.5 webhook (rate-limit headers honoured); 0.7.6 reveal gate; **0.7.7 pre-set phrases** (S) [0.7.1]: twelve strings in the string table, attachable to challenges, filtered by id not text. *Accept:* a challenge carries a phrase id and renders localised text.

### v0.8 — Everywhere it should run
0.8.1 golden replays; 0.8.2 scalable canvas becomes **the handheld preset in CSS** (S, mostly done by 0.4.0); 0.8.3 gamepad; 0.8.4 screen-reader mirror **of the grid only** (M, smaller than planned); 0.8.5 remapping; 0.8.6 strings (M, now HTML templating); 0.8.7 verifier hardening (workers, timeouts, reason codes; SQLite already done); 0.8.8 ⚑ Steam plumbing; **0.8.9 Relay: presence, watch-together, races with ready-up, spectator URL** (L) [0.6.1, 0.4.7]. *Accept:* two Playwright contexts race one seed through the relay and both results verify through `/verify`; a third context watches and ends on the same tick; rooms expire. **0.8.10 Native Linux Electron build for the Deck** (M ⚑ for the device run). **0.8.11 Custom Phaser build** (M). *Accept:* `main.js` ≤ 220 KB gzip; all tests pass; the probe shows identical draw counts. **0.8.12 Touch input and the tablet layout** (M).

### v0.9 — Beta
As PLAN-v1 0.9.1–0.9.7, plus **0.9.8 Web launch on the domain** (S ⚑): Cloudflare Pages deploy from `main`, `VERIFIER_URL` baked, the itch mirror, the Discord server with the five channels.

### v1.0 — Launch
As PLAN-v1 1.0.1–1.0.5. **v2.0 candidates** (not scheduled): creator seeds, clubs with seasons, tournaments, optional sign-in, phone layout.

**What waits on what.** Everything from 0.4.1 onward that involves a population waits on 0.4.7 ⚑ (hosted verifier). 0.4.8's visual result and 0.8.10's Deck numbers wait on a human. 0.6.7, 0.7.x and 0.8.9 wait on identity (0.6.1). The art pipeline (0.4.8) waits on the DPR change (0.3.10); the juice pass (0.4.4) waits on the art (0.4.8). Nothing in v0.3 waits on anything but the merge of PR #1.

## 8. The prompt for Claude

```
You are continuing Junkyard Draft (https://github.com/blickz55/junkyard-draft). Read CLAUDE.md, docs/STATUS.md, docs/DOSSIER-v1.md §2.1 and §4, docs/PLAN-v1.md v0.3, tools/perf.ts, tools/render-probe.ts, game/src/main.ts and game/src/render/scenes/GameScene.ts before changing anything. Start from main after pull request #1 (routine/2026-10-26-placement-reasons) is merged; if it is still open, branch from that branch's tip instead and say so in your PR.

Implement the "worst-machine foundation" slice from the dossier, three bounded increments, one PR each, in this order:

1. 0.3.8 Render probe, device presets and the CI perf gate.
   - Fold tools/render-probe.ts into tools/perf.ts: every sample also reports drawsPerFrame, bindsPerFrame, maxObjects, textObjectsCreated (count scene.add.text calls during the run via a dev-API counter) and heapMB.
   - Add --device A|B|C|D presets to perf.ts (A: 1920x1080 DPR 1.5 no throttle; B: 1366x768 DPR 1 CPU x6; C: 1280x800 DPR 1 CPU x2; D: 915x412 DPR 2.6 CPU x4) using CDP Emulation.setDeviceMetricsOverride and setCPUThrottlingRate, and --renderer webgl|canvas passed through as ?renderer= (main.ts honours it: Phaser.CANVAS when 'canvas').
   - Add .github/workflows/perf.yml: on pull_request, npm ci, npx playwright install chromium, start the dev server, run perf.ts --device B --skip-electron --json, and fail if dropped > 0 or scriptMsPerFrame exceeds docs/baselines/0.3.0/perf.json by more than 25 %. Commit the baseline from your own run under docs/baselines/0.3.0/.
   - Test: tests/perf-gate.test.ts runs the gate's comparison function on a fixture that regresses by 30 % (fails) and by 10 % (passes).

2. 0.3.9 Pooled pops and render-on-change.
   - In GameScene.onTickEvents, replace this.add.text for +$ pops with a pool of 16 reusable Text objects (setText/setPosition/setAlpha, tween reuse); coalesce ships at the same dock in the same tick into one pop showing the summed value; keep reduced-motion behaviour identical.
   - Make renderSide() rebuild only when its inputs changed (a dirty flag or a hash of the values it renders).
   - Acceptance: perf.ts textObjectsCreated <= 16 during the busiest round of seed auto-12 (was ~40 per round), and scriptMsPerFrame on --device B at 4x is at least 20 % below the 0.3.0 baseline; the existing e2e (reduced motion, personal best, drag cancel) still passes; add an e2e step that runs a round and asserts the number of pop texts alive never exceeds 16.

3. 0.3.10 DPR-aware canvas, cap, adaptive fallback, renderer toggle, context-loss test.
   - In main.ts render at dpr = min(window.devicePixelRatio || 1, 2): width W*dpr, height H*dpr, scale.zoom 1/dpr, keeping every logical coordinate (W, H, CELL, GRID_X...) unchanged; expose the effective dpr on the dev API.
   - Adaptive fallback: during the first 120 frames of the first run, if the rAF p95 exceeds 20 ms, persist renderQuality: 'low' in jd.settings.v1 (validated like the other fields) and reload at dpr 1; show a one-line notice in settings ("Running at standard resolution for smoother play") with a button to try high resolution again.
   - Context loss: in an e2e step, obtain WEBGL_lose_context from the Phaser canvas, lose and restore the context mid-build, and assert the grid redraws (a machine image is visible) and window.__jd.state() is unchanged.
   - Acceptance: e2e at deviceScaleFactor 2 asserts canvas.width == 2240 and that placing at a logical cell still lands on that cell; ?renderer=canvas boots and completes a round in e2e; perf.ts --device B reports both renderers in docs/baselines/0.3.0/perf.json.

Do not change: anything under game/src/sim (no sim changes, RULES_VERSION stays 2); scripts/esbuild-config.mjs defines (add a new define only if you also document the dev-server restart in CLAUDE.md); the a11y audit and its palette; the verifier. Do not add runtime dependencies. Keep esbuild as the only build path.

For every increment: npm run typecheck, npm test (must stay green; add the tests named above), run the game in Chromium and look at a screenshot, commit with the Co-Authored-By trailer used in the history, open a PR against main titled "<id> <title> (DOSSIER-v1)", and update docs/STATUS.md: the session block (what was measured, numbers before/after, what could not run), the review table if a finding applies, and set "Next task" to the next increment of this slice, then to 0.3.3 undo/redo when the slice is done. If a measurement cannot be made (no packaged app in CI, no CDP in Firefox), say so in STATUS rather than skipping silently.
```
