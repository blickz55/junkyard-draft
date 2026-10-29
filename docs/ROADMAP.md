# Roadmap

**0.2.0 release candidate cut 2026-10-25; 0.4.0 released 2026-10-29** (`CHANGELOG.md`, numbers in `docs/STATUS.md`). Open items below that need a human are marked ⚑.

**From v0.3 on, the plan of record is `docs/PLAN-v1.md`; v0.5 is re-cut in `docs/PLAN-v2.md`** (eight milestones v0.3 → v1.0 with numbered, sized features and acceptance criteria). The checklists below remain the verified-history record; new work is picked from PLAN-v1 in milestone order.

Checklist syntax feeds the Control Room milestone view: `[x]` done (verified), `[~]` in progress, `[ ]` open.

## M0 — Workshop Control Room v0
- [x] Project-local hooks capture session/tool/failure/subagent/stop events into sanitized JSONL
- [x] SSE server + dashboard: current work, pipeline, agents, feed with filters, game & verification, milestones
- [x] Real tool operation appears automatically (verified live in this session)
- [x] Instrumentation self-test records an intentional failure then a success
- [x] Events arrive without page refresh; reload restores history; disconnect is visible (browser test)
- [x] `npm run dev:all` starts game + dashboard and prints the dashboard URL
- [x] Genuine subagent lifecycle appears (SubagentStart/Stop with parent, task, result)
- [x] Gameplay screenshots and verification results keep flowing as development continues

## M1 — Playable vertical slice
- [x] Deterministic headless simulation with seeded draft, versioned rules, replay export/import/verify
- [x] Six machine types with meaningful interactions (crusher, furnace, splitter throughput, orientation)
- [x] Title screen, daily/random/custom seed, how-to-play panel
- [x] Draft → place/rotate/rearrange → run → scoring → round summary → results screen
- [x] Clear feedback: valid/invalid placement tint, live jams, transform flashes, `+$` floats, diagnostics
- [x] Interactive onboarding hints for the first run
- [x] Local personal bests (labelled local/unverified) and save/continue of an unfinished run
- [x] Replay export (copy/download) and import with verification before playback
- [x] Volume slider, mute, pause on Esc and on window blur
- [x] Reproducible production build (`npm run build` → `dist/`)
- [x] Browser e2e test: real drag, rotate, run, pause, save/continue, six rounds, results, no page errors
- [x] Autoplayer explores seeds (20 seeds: all reach ingots, no exploit; weak offers noted for M2)
- [ ] ⚑ Human-readable playtest notes from at least one full manual run (needs a human; nothing here substitutes for it)

## M2 — Readability, controls, depth
- [x] Per-machine stats after a round are shown as on-grid badges (tooltips not needed)
- [x] Keyboard-only placement (arrow keys + Enter, Tab, R, Delete, Esc) for accessibility — verified by an e2e step
- [x] Sell a drafted part from the bin for $10 so useless offers still matter
- [x] One new machine with a real decision: Plate Press (2 shards → 1 plate $8) behind RULES_VERSION 2
- [x] Round-end badges on every machine (out/blocked, made/waited, $/shipped) with diagnostics in the side panel
- [x] Balance pass driven by autoplayer score distributions per seed (`tools/balance.ts`; press kept as tuned in v2 — see DESIGN decisions and `docs/balance-press.json`)

## M3 — Desktop packaging
- [x] Electron shell launches (`npm run desktop`, Electron 45 pinned as a devDependency; window verified on Windows 2026-10-25)
- [x] Packaged build launched and screenshotted on at least one platform (Windows: `npm run desktop:pack` → `release/win-unpacked/Junkyard Draft.exe`, 2026-10-25)
- [x] NSIS installer (`npm run desktop:dist` → `release/Junkyard-Draft-Setup-0.1.0.exe`, 122 MB, per-user, unsigned) and a packaged-app smoke test (`tests/desktop-smoke.test.mjs`, part of `npm test`, skips without a build)
- [ ] ⚑ Code signing (certificate needed to avoid SmartScreen); macOS / Linux builds; auto-update; run the installer once on a clean machine

## M4 — Verification server & leaderboard
- [x] Local Node verifier service: accepts replay JSON, re-simulates, returns verified score (`npm run verifier`)
- [x] Results screen submits replays to the local verifier and shows the verified-only board separately from local bests
- [x] Daily seed board with identical offers/rules for everyone (`GET /daily` on the verifier + title-screen panel; seed = `daily-YYYY-MM-DD` UTC on both sides)
- [x] Player-facing verification: display name, verified rank after submitting, share text, own daily rank on the title (e2e-covered)
- [x] Playback controls for watched replays (REPLAY marker, original run's earnings, Stop / Esc) and verifier retention (replays kept for each seed's top 100; e2e + unit tested)
- [x] Verified replay viewer: `GET /replay?hash=`, clickable board entries on the results screen, "Watch #1" on the title's daily strip; replays are re-verified client-side before playback (e2e-covered)
- [~] Hosted verifier: service is deployable (HOST/PORT/DATA_DIR, per-IP rate limit, CORS origin, request log, single-file bundle, Dockerfile, `VERIFIER_URL` build define) — image not yet built (no Docker on the dev PC) and nothing deployed

## M5 — Release readiness
- [x] Accessibility: reduced motion (belts static, no flashes / pops / travel, items snap; follows the OS preference by default) and text size 100 / 115 / 130 % through the UI helpers — title-screen controls, persisted, e2e-covered
- [x] Accessibility audit: WCAG AA contrast on every text pair and CVD simulation of materials/semantic colours (`tools/a11y-audit.ts`, enforced by `tests/a11y.test.ts`; palette nudged, shapes already distinct)
- [ ] A scalable layout would need the fixed 1120×700 grid revisited
- [x] Performance budget: measured at 4× on the busiest autoplayer layout — 0 dropped frames in Chromium, Chromium with 4× CPU throttling, and the packaged app; game script ≤ 0.7 ms/frame on hardware (`tools/perf.ts`, `docs/perf-2026-10-25.json`)
- [ ] Re-measure on an actual low-end laptop when one is available
- [ ] Steam build pipeline (requires the user's Steamworks credentials — not a prerequisite earlier)

## M6 — v0.3 + v0.4: first five minutes, then the run is the show (PLAN-v1 / DOSSIER-v1, released as 0.4.0)
- [x] v0.3 first five minutes: onboarding rejections with reasons, undo/redo, money heartbeat + stall marker, tutorial seed, opt-in funnel events, tips with live demos (PLAN-v1 0.3.2–0.3.7; e2e in `tests/render-e2e.test.mjs`, `tests/undo.test.ts`, `tests/tips.test.ts`, `tests/telemetry.test.ts`)
- [x] Worst-machine foundation: render probe + device presets + CI perf gate, texture atlas, DPR-sized canvas with adaptive quality, Canvas fallback, context-loss recovery (DOSSIER-v1 0.3.8–0.3.10; `tools/perf.ts`, `.github/workflows/perf.yml`)
- [x] 0.4.0 DOM UI shell: title, results, game side panel, HUD, hint strip in real text; 130 % fits with zero slack (e2e geometry checks; a11y stylesheet audit)
- [x] 0.4.1 Histogram-first results and daily strip (`/histogram`; `tests/verifier.test.ts`, game e2e)
- [x] 0.4.2 Loop clip export (WebM, live recording; e2e ≥ 3 s, < 10 s) · 0.4.11 GIF variant (dependency-free GIF89a writer; `tests/gif.test.ts`, e2e 580 KB / 38 frames)
- [x] 0.4.3 Spoiler-free share grid, detailed variant, opt-in permalink, days played (`tests/share.test.ts`)
- [x] 0.4.4 Juice pass bound to sim events: state frames, 8 belt frames, lock-in and settle; event → sound → visual table in `docs/DESIGN.md`
- [x] 0.4.5 Bot par per seed in a verifier worker, deterministic, wall-clock capped (`tests/verifier.test.ts`)
- [x] 0.4.6 Non-ranked badges Clean / Minimalist / Full Grid (`tests/badges.test.ts`)
- [x] 0.4.8 Authored SVG art pipeline + one-texture atlas (draws 4.8 → 1, binds 59 → 3 per frame) · 0.4.8b HiDPI atlas at min(DPR, 2) with a per-key base scale (e2e at `?dpr=2`; perf A/B unchanged)
- [x] 0.4.9 Audio buses, voice caps, chords, ducking, reduced audio (`tests/mixer.test.ts`, e2e) · 0.4.10 Throughput hum · 0.4.13 Impact samples under the synth (`tests/samples.test.ts`, e2e)
- [x] 0.4.12 Tips panel in the DOM with a canvas demo; the last Phaser text panel removed (e2e incl. 130 % fit)
- [ ] ⚑ 0.4.7 Host the verifier (deployable bundle + Dockerfile exist; nothing deployed — see M4)

## M7 — Pre-v0.5 stabilization (independent review 2026-10-29, docs/reviews/)
- [x] A: verifier/collector integrity — total telemetry validation + guarded async handlers, redaction removes tokens, canonical replay identity, pars kept on submit, consent-generation telemetry sends (`tests/verifier.test.ts`, `tests/collector.test.mjs`, `tests/telemetry.test.ts`)
- [x] B: desktop/input/provenance — DOM dialogs replace prompt/alert (packaged smoke exercises them), grid-owned keyboard with no global capture and Tips focus management, playback-owned advancement, provenance-honest clip footers, run-bound results standing, null-prototype seed dictionaries, DPR-aware dock pulse, All Hands badge (`tests/render-e2e` 5c/5d, `tests/game-e2e`, `tests/controller.test.ts`, `tests/storage.test.ts`, `tests/badges.test.ts`)
- [x] C: deployment readiness — Dockerfile covers the verifier's source graph (layout-bundle test), bounded bot-par admission, `ci.yml` with a real image smoke and a Windows packaging job, strict perf gate with an explicit baseline path, Control Room bounds/containment, Electron IPC validation
- [x] D: compatibility — golden replay corpus pinned in `npm test`; the 0.4.0 compatibility claim corrected; scenario namespaces versioned with `RULES_VERSION` (`docs/DESIGN.md`)
- [ ] ⚑ Commit the CI perf baseline to `docs/baselines/ci/perf-ci.json` from the perf workflow's artifact to arm the strict gate
- [ ] ⚑ First green run of `ci.yml` on GitHub (the image job needs the hosted runner's Docker; nothing can build the image on the dev PC)
