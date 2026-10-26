# Brief for Astra — the improved Junkyard Draft (v0.3 → v1.0 and beyond)

Paste everything below the line into Astra. It is self-contained; the repository is public.

---

You are designing the **improved version of Junkyard Draft** and writing the engineering plan for it. You reviewed v0.2.0 (commit `f3de10b`) and every one of your findings was fixed at commit `0c907c8` on `main` of https://github.com/blickz55/junkyard-draft (your findings and the fixes are tabulated in `docs/STATUS.md`; the tests are named after your proposals; the suite is 44/44). Start from that commit.

Your output is a **design-and-engineering dossier** plus **one ready-to-paste implementation prompt for Claude**, which runs a nightly cloud routine that implements one bounded increment per pull request from `docs/STATUS.md`'s "Next task" and `docs/PLAN-v1.md`. Think extremely far forward about what this game can become, then bring it back to concrete, sized, testable steps. Be specific with file paths, numbers and acceptance criteria. Cite evidence when you make claims about players, platforms or hardware; label inference as inference.

## What exists today (so you do not re-plan it)

**The game.** A deterministic draft-and-build factory score-attack: six rounds; each round draft one of three machines, arrange them on an 8×6 grid (72 px cells, 1120×700 fixed canvas, FIT-scaled), run an 80-tick simulation, ship products for money; one score per run. Seven machines (hopper, conveyor, splitter, crusher, furnace, press, dock), five materials (scrap $1, shards $3, plate $8, ingot $12, slag $1). Rules v2; every tuning value lives in `game/src/sim/rules.ts` behind `RULES_VERSION`. Full keyboard placement, reduced motion, text size 100/115/130 %, WCAG-AA audited palette.

**Verification and social, as built.** Replays are seed + rule-checked actions. A dependency-free Node verifier (`server/verify.ts`, single-file bundle, Dockerfile) re-simulates submissions and keeps a verified-only board per seed with stored replays (SHA-256 identity, atomic writes, rules-version partitioning, per-IP rate limit, bounded retention). UTC daily seed derived identically on client and server; title strip with today's top five, your own rank by replay hash, "Watch #N"; results screen with verified rank, share text, clickable board entries that fetch, locally re-verify and play back a replay with playback controls. Player display name stored locally (no accounts). Nothing is hosted yet; the verifier runs on localhost.

**Presentation, as built.** Phaser 3.90 on WebGL. All art is **procedural vector drawn at boot** (`game/src/render/textures.ts`, 19 textures: 7 machines facing east and rotated by 90°, 3 belt frames, 5 item icons, 4 tiles, 2 UI dots). All audio is **synthesized WebAudio** (`game/src/render/audio.ts`, 9 tone/noise generators: click, place, rotate, invalid, ship chime scaled by value, transform, jam, round fanfare, run start). Palette in `palette.ts` (warm industrial: charcoal, amber, rust, steel, green). Fonts: Inter / system sans and a monospace stack. No sprite atlas, no asset pipeline, no music.

**Performance, as measured.** `tools/perf.ts` on the busiest legal layout at 4×: 0 dropped frames in Chromium, in Chromium with 4× CPU throttling, and in the packaged Electron app; game script ≈ 0.25–0.7 ms/frame on hardware. Not yet measured on any weak device. Bundle: `dist/main.js` 1.28 MB (Phaser dominates; the sim is a few KB). Electron 45 desktop build and NSIS installer exist (`npm run desktop:dist`), unsigned.

**Code shape (lines).** `game/src/sim` 622 (pure, browser-free, deterministic: no Math.random, Date, or object-order iteration in the scoring path) · `game/src/render` 1,535 (GameScene is the big one; a round/playback controller extraction and a measured-layout extraction are listed follow-ups) · `server` 278 · `tools` 666 (autoplayer, balance probe, perf probe, a11y audit, icon renderer) · `tests` 1,076 (44 tests: sim, verifier, storage, a11y, share, control-room, gameplay e2e in real Chromium, packaged-app smoke) · esbuild only (no Vite; do not propose switching without a migration plan and a reason).

**Plan of record.** `docs/PLAN-v1.md`: eight milestones v0.3 → v1.0 from seven research threads (compulsion loops, factory design, daily/async social, multiplayer formats, onboarding/accessibility, integrity, platforms), 229 citations. Its five bets: the 80-tick run is the show (clip export, histogram-first boards); the daily done right (server-minted seed, 48 h window, forgiving streak); depth one decision at a time behind rules bumps; the first five minutes; integrity by design (assisted board for bots, cross-engine golden replays). Read it before writing; **critique it where you disagree**, do not restate it.

**Constraints that stay.** Deterministic sim shared by client and server; replays and server re-simulation as the only source of verified scores; identical seeds for everyone, nothing that gives one player a different daily; no dark patterns (no fake urgency, no loss-aversion streaks, no pay-to-win); solo developer, near-zero budget, TypeScript; tests for everything that ships (unit for sim/server, e2e for anything visible).

## What to produce

### 1. The vision, one page
What the improved game is at v1.0 and what it could be at v2.0 if it finds an audience. Who plays it, for how long, how they talk about it. Name the three experiences a first-time player and a returning player must have in their first ten minutes.

### 2. Graphics direction and pipeline
- An art direction that keeps the warm-industrial identity but reads as a finished product: machine silhouettes, item readability at 72 px and at half that on a laptop, state cues (holding, jammed, starved, selling), belt motion, a palette that still passes the a11y audit (`tools/a11y-audit.ts` enforces it in `npm test`).
- Decide between staying procedural (vector drawn at boot: resolution-independent, tiny, themeable) and moving to authored assets (sprite atlas, Aseprite/SVG pipeline, HiDPI variants). Give the trade-off with numbers (download size, draw calls, memory, authoring time) and recommend one, or a hybrid, with the asset list and the atlas layout.
- Animation and feedback plan tied strictly to sim events (`spawn`, `move`, `transform`, `absorb`, `ship`, `jam`, hopper blocked): what moves, how much, for how long, and what reduced motion removes. The research in PLAN-v1 says juice must echo mechanics and the most repeated interaction must feel best; apply that.
- UI: the side panel, badges, hint strip and results screen are hand-positioned Phaser text. Propose how layout should work at 100/115/130 % text, on 16:9, 16:10 and Steam Deck 1280×800, and whether UI should move to DOM over the canvas (accessibility, screen readers, localization) or stay in-canvas.
- A loop-clip export spec (WebM via `canvas.captureStream`, GIF second) that looks good in a social feed: framing, speed, overlay (seed, score, player), length.

### 3. Audio direction
- Keep synthesis, move to samples, or layer both? Decide with reasoning. Specify every sound with its trigger, pitch/intensity scaling rule and mix priority (ducking under the fanfare, polyphony caps for 40 items shipping per round).
- Music: a procedural or layered system driven by factory throughput and round number (the research cites Mini Metro's event-driven audio), or none. If music, specify stems, tempo, how it reacts to jams and to the last ten ticks of a round.
- Accessibility: visual equivalents for every audio cue, a reduced-audio mode, volume per bus.

### 4. Full optimization for the worst machines
- Define the target devices and budgets: e.g. 2017 Intel UHD 620 laptop, 4 GB Chromebook, Steam Deck at 1280×800, a mid-range Android phone in a browser; frame-time p95 and p99 targets at 1× and 4×; startup time to interactive on a 10 Mbit connection; memory ceiling; bundle size.
- A measurement protocol that extends `tools/perf.ts` (CDP throttling, device presets, Electron) and a CI gate that fails on regression.
- Prioritized optimizations with expected gains: Phaser renderer settings, sprite batching and atlases, pooled text and tweens, render-on-change for static panels, DPR capping, Canvas fallback, lazy fonts, Phaser tree-shaking or a custom minimal renderer for the grid (judge whether that is worth it for a 48-cell grid), WebGL context loss handling, mobile touch input. State what you expect to break first on each device class.

### 5. Player-to-player communication and social architecture (think furthest here)
Design how players meet, talk, challenge and spectate, from v0.3 to v2.0, under the constraints above. Cover:
- Asynchronous first: challenge links with live ghost overlay, groups/leagues by code, replay comments or reactions, "fork this layout", weekly modifier seeds, seasonal archives, a daily results share that spreads without links.
- Live, when population allows: presence, watch-together rooms, same-seed races with a ready-up, spectator mode for streamers, club events. Say what needs a WebSocket relay versus pure HTTP, and what the Node service must become (data model, endpoints, auth, moderation queue, rate limits, abuse cases, GDPR-minimal data).
- Identity without passwords first (device token, optional sign-in later, Steam ticket on desktop), name moderation, reporting, bans, appeals, and what is logged.
- Communication safety for a small game: no free text until moderation exists; what a reaction/emote system looks like; how Discord fits (webhooks for the daily, a bot that posts verified boards).
- Where creators fit: GIF/WebM export, spectator UI, a "race me" link in a stream title, shareable puzzle seeds.

### 6. Platform decision: website, Steam, or both, and when
- Weigh: a web build (zero-install daily, link sharing, portals like itch/Poki/CrazyGames with their restrictions, hosting cost, verifier adjacency) against a Steam release (leaderboards via trusted Web API writes, achievements, cloud saves, Deck, Next Fest, wishlists, review thresholds, pricing) against both with a shared daily and cross-platform boards. PLAN-v1 leans web-first with Steam later; argue for or against with evidence.
- If a website: propose two or three domain names and a brand check approach (do not spend long on the URL; it is one decision among many), the hosting shape (static game + verifier, TLS, CDN, cost per month), analytics with consent, and the legal minimum (privacy notice, age gate if any).
- If Steam: the integration path from Electron (Steamworks Web API with trusted writes, auth tickets, achievements, Steam Input for Deck), signing, pricing and discount calendar, the demo and the one Next Fest.
- Give a decision, a timeline and the first three actions.

### 7. Delivery plan mapped onto the existing milestones
Re-cut v0.3 → v1.0 from `docs/PLAN-v1.md` with your graphics, audio, performance, social and platform work folded in. Keep the numbering style (0.3.1, 0.3.2 …), sizes (S = one routine run and one PR, M = 2–4, L = 5+ or needs a human, marked ⚑), dependencies and acceptance criteria a test or a measurement can check. Call out what must wait for a hosted verifier, a human playtest, art assets or an account system.

### 8. The prompt for Claude
End with a single fenced block: a self-contained prompt that tells Claude exactly what to implement first from your dossier (one coherent slice that fits two to four nightly runs), including the files to touch, the tests to add (unit and e2e), the acceptance criteria, what not to change (sim purity, rules version discipline, esbuild, the audit), and how to record results in `docs/STATUS.md`. Claude will paste that prompt as the next task.

## How to work
Clone the repository and run it (`npm ci`, `npx playwright install chromium`, `npm test`, `npm run dev:all`, `npm run verifier`, `node --import tsx tools/perf.ts`). Read `docs/DESIGN.md`, `docs/PLAN-v1.md`, `docs/STATUS.md`, `CHANGELOG.md`, `game/src/render/textures.ts`, `audio.ts`, `scenes/GameScene.ts`, `server/verify.ts`. Where you can measure (bundle size, draw calls, frame times, download size of an atlas you specify), measure and report; where you cannot, say so. Keep the dossier under about 6,000 words plus tables and the final prompt; prefer decisions with reasons over menus of options.
