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
- [ ] Balance pass driven by autoplayer score distributions per seed

## M3 — Desktop packaging
- [x] Electron shell launches (`npm run desktop`, Electron 45 pinned as a devDependency; window verified on Windows 2026-10-25)
- [ ] Packaged build launched and screenshotted on at least one platform

## M4 — Verification server & leaderboard
- [x] Local Node verifier service: accepts replay JSON, re-simulates, returns verified score (`npm run verifier`)
- [x] Results screen submits replays to the local verifier and shows the verified-only board separately from local bests
- [ ] Daily seed board with identical offers/rules for everyone

## M5 — Release readiness
- [ ] Accessibility: colour-blind safe material shapes, scalable UI, reduced motion
- [ ] Performance budget on a low-end laptop (60 fps during runs)
- [ ] Steam build pipeline (requires the user's Steamworks credentials — not a prerequisite earlier)
