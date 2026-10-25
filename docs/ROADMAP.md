# Roadmap

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
- [ ] Human-readable playtest notes from at least one full manual run (needs a human; nothing here substitutes for it)

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
- [ ] Code signing (certificate needed to avoid SmartScreen); macOS / Linux builds; auto-update

## M4 — Verification server & leaderboard
- [x] Local Node verifier service: accepts replay JSON, re-simulates, returns verified score (`npm run verifier`)
- [x] Results screen submits replays to the local verifier and shows the verified-only board separately from local bests
- [x] Daily seed board with identical offers/rules for everyone (`GET /daily` on the verifier + title-screen panel; seed = `daily-YYYY-MM-DD` UTC on both sides)
- [~] Hosted verifier: service is deployable (HOST/PORT/DATA_DIR, per-IP rate limit, CORS origin, request log, single-file bundle, Dockerfile, `VERIFIER_URL` build define) — image not yet built (no Docker on the dev PC) and nothing deployed

## M5 — Release readiness
- [x] Accessibility: reduced motion (belts static, no flashes / pops / travel, items snap; follows the OS preference by default) and text size 100 / 115 / 130 % through the UI helpers — title-screen controls, persisted, e2e-covered
- [x] Accessibility audit: WCAG AA contrast on every text pair and CVD simulation of materials/semantic colours (`tools/a11y-audit.ts`, enforced by `tests/a11y.test.ts`; palette nudged, shapes already distinct)
- [ ] A scalable layout would need the fixed 1120×700 grid revisited
- [x] Performance budget: measured at 4× on the busiest autoplayer layout — 0 dropped frames in Chromium, Chromium with 4× CPU throttling, and the packaged app; game script ≤ 0.7 ms/frame on hardware (`tools/perf.ts`, `docs/perf-2026-10-25.json`)
- [ ] Re-measure on an actual low-end laptop when one is available
- [ ] Steam build pipeline (requires the user's Steamworks credentials — not a prerequisite earlier)
