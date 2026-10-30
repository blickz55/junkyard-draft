# Roadmap

**0.2.0 release candidate cut 2026-10-25; 0.4.0 released 2026-10-29** (`CHANGELOG.md`, numbers in `docs/STATUS.md`). Open items below that need a human are marked ⚑.

**From v0.3 on, the plan of record is `docs/PLAN-v1.md`; v0.5 is re-cut in `docs/PLAN-v2.md` (shipped as 0.5.0), v0.6 in `docs/PLAN-v3.md` (shipped as 0.6.0), v0.7 in `docs/PLAN-v4.md` (shipped as 0.7.0) and v0.8 in `docs/PLAN-v5.md` (superseded). From 2026-10-30 the plan of record for v0.8 → 1.0 is `docs/PRODUCTION-ROADMAP.md`**, written after the full-project evaluation (`docs/reviews/2026-10-30-eval/`) and the owner interview. The checklists below remain the verified-history record; new work is picked from the production roadmap in milestone order.

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
- [x] Commit the CI perf baseline to `docs/baselines/ci/perf-ci.json` from the perf workflow's artifact to arm the strict gate (0.8.4, session 50)
- [x] ⚑ First green run of `ci.yml` on GitHub: 091a60d (run 40986558629, 2026-10-30); the image job builds, smokes and (0.8.4) pushes on tags

## M12 — production roadmap v0.9 Clear (`docs/PRODUCTION-ROADMAP.md` §5; in progress)
- [x] 0.9.0 the string table and the glossary: `game/src/content/strings.ts` + `glossary.ts` + `format.ts` + `locale.ts`; sim text moved to `content/` (machines, tips, advice, badges, fork); `tools/strings-lint.ts`; the pseudo-locale and `tests/pseudo-e2e.test.mjs` at 130 % (`tests/strings.test.ts`) · ⚑ the owner reviews Appendix B's choices (crews, yard, a try, our server)
- [x] 0.9.1 the foreman, text only: `content/foreman.ts` + `foreman.*` lines in the table (31 situations × 3–5 variants, chosen per UTC day), the box on title / draft / round-end banner / results, `chatter` setting, `docs/FOREMAN.md` (`tests/foreman.test.ts` snapshot, `tests/foreman-e2e.test.mjs`) · ⚑ the owner reviews Sal's voice
- [x] 0.9.2 the results card: the standing sentence leads, then money, the deltas (foreman's mark, best on the yard, medal), "Since yesterday" on the daily; rank and the top five below the fold; the "Beat this" link in the share text by default (opt-out); the order asserted in `tests/game-e2e.test.mjs` · ⚑ the owner reviews the 390-wide and 1920-wide screenshots (the 390 one shows the fixed 1120×700 scaled down; reflow is 0.10.0)
- [ ] 0.9.3 onboarding delivery · [ ] 0.9.4 GameScene split · [ ] 0.9.5 test suite, lint, coverage · [ ] 0.9.6 dead rounds: a tuning pass (⚑ go/no-go) · [ ] 0.9.7 stats page · [ ] ⚑ 0.9.8 playtest round two

## M11 — production roadmap v0.8 Real (`docs/PRODUCTION-ROADMAP.md` §5; in progress)
- [x] 0.8.0 client hardening: `?verifier=` only in dev builds and on loopback pages, CSP in page and Electron, storage-failure banner, error log + Copy diagnostics (`tests/config.test.ts`, `tests/hardening-e2e.test.mjs`)
- [x] 0.8.1 verifier hardening, first cut: rightmost proxy hop, per-address read/write limits, 400-day history bound, identity cap, JSON log with hashed addresses and request ids, 500s logged, timeouts, SIGTERM drain, `/health` trigger inputs, two-reporter hide rule with 72 h lapse and moderator confirm, cold deletion, 7-day event hashes (`tests/verifier-hardening.test.ts`, `tools/log-check.ts` in CI)
- [x] 0.8.2 single-pass re-simulation in a worker: prepare → one run in a persistent worker with a 10 s cap and a bounded queue → record; reason codes on every refusal; per-seed sorted index; `tools/load.ts` baseline `docs/baselines/0.8/load-0.8.2.json` (357/357 answered 200, `/health` p95 1.7 ms) (`tests/verifier-resim.test.ts`)
- [x] 0.8.3 backups and the restore drill: `tools/backup.ts` (hash manifest, never the secret, local or rclone, pruned), `tools/restore-drill.ts` (unpack, verify, start, compare, sample), `deploy/backup.cron` (`tests/backup.test.ts`; the VPS drill waits for 0.8.5 ⚑)
- [x] 0.8.4 release pipeline: GHCR push and a GitHub Release with installer, web bundle, verifier bundle and checksums on tags; concurrency, Playwright cache, `npm audit`, Dependabot, package metadata; perf gate armed with `docs/baselines/ci/perf-ci.json` (rate-based dropped rule) (`tests/perf-gate.test.ts`)
- [x] 0.8.5 deploy, the routine's part: `deploy/` compose, Caddyfile, `_headers` template, env templates, runbook; content-hashed bundle with `dist/_headers` rendered by the build; `deploy.yml` (Pages on green main, verifier over SSH on green tags, inert until the variables exist); `tools/hosted-check.ts` (`tests/deploy.test.mjs`)
- [x] 0.8.6 legal minimum, the routine's part: privacy notice, terms, guidelines v0 generated from `tools/legal-lib.ts` + `game/src/content/operator.ts` into `legal.json` and `legal/*.html`; Privacy & data panel with Download (`GET /me/export`) and Delete (`DELETE /me`) my data; links from title, results and the consent note; real appeal contact on the domain; `LICENSE` (source-available) and root `README.md`; Caddy log without addresses (`tests/legal.test.ts`, `tests/legal-e2e.test.mjs`)
- [x] 0.8.7 player-facing copy and the offline state: no developer copy on the player's screens (lint test), the results board shows the device's history for the seed when offline (`jd.history.v1`), a submission made offline is kept (`jd.pending.v1`) and sent from the next title load with the result shown there (`render/pending.ts`), results actions grouped Play / Share / Watch with one primary (`tests/offline.test.ts`, `tests/offline-e2e.test.mjs`)
- [x] 0.8.8 the bottleneck line: `sim/bottleneck.ts` (jam attribution along outputs to the holding processor, dead end or merge; saturated / starved / balanced / slag / disconnected; pool-filtered fixes) + `content/bottleneck.ts` (the sentence) on the summary panel (`bottleneck`) and as the next draft's hint (`tests/bottleneck.test.ts`: four canonical layouts and four more; gameplay e2e)
- [x] 0.8.11 determinism across engines: `sim/digest.ts` (canonical JSON + integer SHA-256), corpus `stateHash`/`roundHashes` via `make-golden --digests`, `tests/engines-e2e.test.mjs` in Chromium, Firefox and WebKit against Node (CI `engines` job installs all three), `tools/determinism-lint.ts` + `tests/determinism-lint.test.ts`
- [x] 0.8.12 single-step while paused: `RoundController.stepTick` (paused only, one tick with onTick, phase left at 1, the round ends normally), the Step button and the `.` key, the veil's tick counter, the policy line (`tests/controller.test.ts`, gameplay e2e)
- [ ] ⚑ 0.8.5 deploy, the owner's half: domain, VPS, secrets, Pages project and GitHub variables, then image-smoke + mint-check + hosted-check against the hosted URLs recorded in STATUS (closes 0.4.7/0.6.8/0.7.8) · [ ] ⚑ 0.8.6 the owner's half: legal name and jurisdiction in `operator.ts`, the two mailboxes, a read of the three texts and the licence decision (source-available as written, or MIT for the engine) · [ ] ⚑ 0.8.9 uptime, alerting, Discord · [ ] ⚑ 0.8.10 first human playtests

## M10 — v0.7 Play with people (PLAN-v4, released as 0.7.0, protocol 2, rules version 3 unchanged)
- [x] 0.7.0 storage: hot/cold split and replay compaction (`server/cold.ts`, `HOT_DAYS` 30, top 10 replays per cold day, `docs/baselines/0.7/storage-split-*.json`); 0.7.0b SQLite scheduled only when a measured beta month crosses the 5 MB / 50 ms trigger
- [x] 0.7.1 challenge link with per-round earnings (`roundsOf` derived at verification, `GET /entry`, the challenge overlay and outcome on the results and share text)
- [x] 0.7.2 groups by code (`/groups`, `?group=` scope on boards, histogram, daily, weekly and archive; caps 5 per player, 50 members; names through the one filter)
- [x] 0.7.3 fork from round N into practice (`game/src/sim/fork.ts`, labelled, never submitted, separate fork bests)
- [x] 0.7.4 share card (`game/src/render/card.ts`, 1200×630, "verified" only from a re-simulated run)
- [x] 0.7.5 weekly seed without modifiers (`game/src/sim/weekly.ts`, `/weekly`, Friday 18:00 UTC, commitment chain, archive kind)
- [x] 0.7.6 Discord webhook from the verifier (`server/webhook.ts`, seed/lead/freeze, 429 honoured, fire-and-forget, dry run)
- [x] 0.7.7 name moderation first cut (`POST /report`, hidden as "player", `/moderation/*` + `tools/moderate.ts`, `moderation.jsonl`, every user-written field enumerated in one test)
- [x] 0.7.0 released: version bump, autoplay sweep and rollback rehearsal as evidence (`docs/baselines/0.7/autoplay-0.7.0.json`, `rollback-rehearsal-0.7.0.json`)
- [ ] ⚑ 0.7.8 host the verifier and open the web beta (this is 0.6.8 with `MODERATION_TOKEN`, a real `APPEAL_CONTACT` and optionally `DISCORD_WEBHOOK_URL` added; the e2e daily submission against the hosted URL recorded in STATUS)

## M9 — v0.6 The daily, done right (PLAN-v3, released as 0.6.0, protocol 2, rules version 3 unchanged)
- [x] 0.6.0 identity without passwords: device token, `player_id = SHA-256(token)`, `Name#TAG`, recovery code, `POST/GET /identity`, `DELETE /me`, keep-best per (seed, player), per-player bucket (`tests/identity.test.ts`, verifier +3, e2e claim/keep-best/recovery)
- [x] 0.6.1 server-minted daily seed with a published commitment (`server/mint.ts`, `DAILY_SECRET`, `/daily?date=`, practice seed fallback, `tools/mint-check.ts`, rehearsal step for secret rotation)
- [x] 0.6.2 48-hour window, freeze, late submissions verified but unranked, `GET /archive`, Archive dialog, provisional/final strip
- [x] 0.6.3 days played and streak with grace (`game/src/daily/streak.ts`, `tests/streak.test.ts`), detailed share line
- [x] 0.6.4 medals at freeze from the final board, nearest-rank 50/80/95, null below five (`tests/medals.test.ts`), on `/daily`, `/archive`, `/histogram`, archive rows and the detailed share
- [x] 0.6.5 fairness and verification policy generated from the code (`tools/make-policy.ts` → `game/public/policy.json`, `docs/POLICY.md`; `tests/policy.test.ts` diffs them), in-game panel
- [x] 0.6.6 reveal gate: other players' daily replays after you submit or the day closes, enforced on `GET /replay`; title-strip layout made deterministic at 130 % (instrumented e2e found two load-dependent flakes)
- [x] 0.6.7 storage measurement against the 5 MB / 50 ms trigger (`tools/storage-measure.ts`, `docs/baselines/0.6/storage*.json`); decision in `server/README.md`
- [x] 0.6.0 released: version bump, 20-seed sweep and rollback rehearsal as evidence (`docs/baselines/0.6/`), one-release rules notice retired from the title
- [ ] ⚑ 0.6.8 host the verifier and open the web beta (domain, VPS + Caddy + Docker image with `DAILY_SECRET` backed up, `VERIFIER_URL` in the builds, Cloudflare Pages, the e2e daily submission against the hosted URL recorded in STATUS)

## M8 — v0.5 Decisions (PLAN-v2, released as 0.5.0, rules version 3)
- [x] 0.5.0 local records partitioned by rules version with a one-time migration (`tests/fixtures/profile-v2.json`, render-e2e 5e)
- [x] 0.5.1 measurement tools generalised: any machine, variants by rules path, two search policies, paired deltas, replay-verified actions, executable gates (`tests/balance-tool.test.ts`)
- [x] 0.5.2 Sieve fixture → no-go (separated routes +17 %, also with an export dock); Sieve kept as an experimental kind (`tests/sieve-fixture.test.ts`, DESIGN decision)
- [x] 0.5.3 Tuner + round-tiered offers; balance allowed vs banned +$187 / 0 seeds worse / pick 59 % (band widened to 65 %, documented) (`docs/baselines/0.5/balance-tuner-greedy.json`)
- [x] 0.5.4 reroll as replay-authoritative state; study never vs greedy +$246, losses bounded by price, rate 32.9 % (band widened to 35 %, documented) (`docs/baselines/0.5/reroll-study-greedy.json`)
- [x] 0.5.5 tie-breaker derived server-side, one comparator, legacy derivation, rule printed under boards
- [x] 0.5.6 sweep (20 seeds: no dead ends, nothing suspicious), migration fixture, deploy/rollback rehearsal both directions (`docs/baselines/0.5/rollback-rehearsal.json`), runbook in `server/README.md`, golden corpus v3 (9 replays) + archived v2 refused, 0.5.0 released
- [ ] ⚑ 0.5.7 fresh-player session on the Tuner decision, the reroll price and the tutorial (`docs/PLAYTEST.md` v0.5 script)
