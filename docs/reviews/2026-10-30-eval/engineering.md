# Junkyard Draft — engineering assessment (read-only, 2026-10-30)

Repository: `C:\dev\junkyard draft` at `091a60d` (main, clean before and after this evaluation; `git status --porcelain` empty). Version 0.7.0, `RULES_VERSION` 3, verifier protocol 2. Nothing in the repo was edited; all build/test output went to git-ignored paths (`dist/`, `.control-room/reports/`, `tools/scratch-*`).

## 0. Measured results (this machine: Windows 11, Node 24, npm 11)

| Check | Result |
|---|---|
| `npm run typecheck` | **pass**, exit 0, no diagnostics (tsc 6.0.3, `strict: true`) |
| `npm test` | **149 tests, 149 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled**; `duration_ms 73952` (wall 1 m 14.6 s). The desktop smoke ran (a packaged build exists in `release/win-unpacked`); it would be *skipped* on a machine without one (`tests/desktop-smoke.test.mjs:14`). No flaky or retried test printed. Slowest: game e2e 73.2 s, render e2e 52.8 s, tutorial autoplay 33.0 s, bot-par test 19.1 s, balance determinism 10.6 s. The e2e log line "bot par for e2e-seed arrived after 9.1 s" shows the par-race fix from `091a60d` working. |
| `npm run build` | **pass**; `dist/main.js` 1,416,768 B raw (1384 KiB) / **397,781 B gzip (388 KiB)**; whole `dist/` 1,466,783 B; esbuild `Done in 171ms`. Metafile: Phaser = 1,209,570 B of 1,410,336 B of module bytes = **85.8 %** of the bundle; own code 200,766 B; largest own inputs GameScene 29 KB, GamePanel 18 KB, ResultsScreen 17 KB, TitleScreen 13 KB, dom.ts 11 KB, `policy.json` 8.4 KB (bundled as data). Other dist files: 31 SVGs (146–2413 B each), two WAVs (8.0 KB + 6.2 KB), `policy.json` 9.7 KB, `index.html` 589 B, `build.json` 146 B. |
| `npm audit` | **found 0 vulnerabilities** (7 devDependencies, no runtime dependencies). `npm outdated`: electron 45.0.0→45.1.0, playwright 1.63.0→1.64.1, tsx 4.23.12→4.23.15, typescript 6.0.3→7.0.2 (major), phaser 3.90.0→4.2.1 (major). |
| Verifier bundle | `server/dist/verify.mjs` 127,251 B (built 0.7.0) |

### Size and hygiene counts

| Metric | Value |
|---|---|
| Source lines (tracked .ts/.mjs/.cjs/.js) | `game/src` 5,623 (sim 1,021 · render 2,987 · ui 1,343 · telemetry 88 · identity 71 · daily 66 · main 47) · `server` 1,326 · `tests` 4,430 · `tools` 1,802 · `control-room` 643 · `.claude/hooks` 149 · `scripts` 105 · `desktop` 49 |
| Largest files | `server/verify.ts` 1,124 · `GameScene.ts` 718 · `GamePanel.ts` 307 · `clip.ts` 263 · `ResultsScreen.ts` 259 · `dom.ts` 258 · `sim/run.ts` 233 · `RoundController.ts` 210 |
| Test files / cases | 34 files (28 `.test.ts`, 6 `.test.mjs`); 141 literal `test(` call sites, 149 tests at runtime (golden corpus loops); 0 `describe` blocks |
| `as any` | **0** in `game/src`, `server`, `tools`, `tests` (9 `as unknown as`, all for Phaser prototype patching / window globals) |
| `@ts-ignore` / `@ts-expect-error` | **0** |
| `TODO|FIXME|HACK|XXX` | **0** (plans live in docs, not in code) |
| Empty `catch {}` | 1 regex hit; but **55 `catch` sites in `game/src`** of which ~40 swallow to a fallback (`return null`, `/* ignore */`, `/* decoration */`) and 46 in `server` — see §2 |
| `console.*` in shipped game code | 1 (`GameScene.ts:552`, DEV-only determinism mismatch) |
| Non-null assertions `!.` | 1 in `game/src`+`server` |
| Lines > 200 chars | **310 of 6,902** source lines in `game/src`+`server` (4.5 %); `verify.ts` has 21 lines > 300 chars, `ResultsScreen.ts` 13, `TitleScreen.ts` 12 |
| Lint / format / coverage tooling | **none** (no ESLint, Prettier, Biome, c8/nyc, husky, editorconfig; nothing in `package.json`) |
| Tracked files | 262; `vendor/phaser/` 15 MB tracked (phaser.esm.js 7.9 MB, phaser.d.ts 6.2 MB) for the cloud sandbox only |
| Root docs | no `README.md`, no `LICENSE`; `CLAUDE.md` is the de-facto contributor guide; `docs/STATUS.md` 460 lines / 133 KB of session logs; `CHANGELOG.md` 60 KB |

---

## 1. Architecture and module boundaries

**Strong, and worth protecting.**
- `game/src/sim/` is genuinely pure: no DOM/Phaser imports; the only `Date` uses are the calendar modules (`sim/daily.ts`, `sim/weekly.ts`) and `exportReplay`'s `createdAt` (`sim/replay.ts:19`, metadata, not simulation). `rng.ts` is mulberry32 over a string hash; `sim.ts:155-163` fixes cell order for determinism. `RULES_VERSION` lives in `sim/types.ts:5`, gated by golden replays (`tests/golden/`, 11 files) and `tests/policy.test.ts`.
- `RoundController.ts` (210 lines, zero Phaser imports) owns the mode machine and the "layout frozen while running" invariant (`RoundController.ts:95-96`), unit-tested in Node (`tests/controller.test.ts`, 5 tests). This is the right seam.
- The verifier shares the sim by import (`server/verify.ts:65-84`), so client and server re-simulate the same code; `tests/verifier.test.ts` rebuilds the Docker layout to prove the image carries every import ("docker layout bundles" test).
- Replay identity is canonical SHA-256 (`sim/replay.ts:25-41`, `verify.ts:152`).

**Gaps.**
- **GameScene is a god object (P1, M).** 718 lines, 30 imports (`GameScene.ts:1-30`), 15 `keydown-*` bindings (`:285-302`), tutorial copy as a 27-line decision tree (`:494-521`), stall detection (`:668-687`), pop pooling (`:689-703`), belt/state-frame animation (`:586-600`), 8 `telemetry.track` sites, DOM dialog composition for reports (`:51-56`), fork start (`:44-49`). The controller extraction removed the state machine, but input handling, onboarding copy and juice are still fused with rendering. PLAN-v5 0.8.2 (action table) and 0.8.6 (strings) will each touch this file; without splitting first they will fight over it.
- **Presentation strings inside the sim namespace (P2, S).** `sim/rules.ts:46-56` (`MACHINE_INFO` names/blurbs), `sim/tips.ts` (83 lines), `sim/advice.ts` (71 lines) carry player-facing English. They ship in the verifier bundle via the shared import, and they make "externalise strings" (0.8.6) a sim-touching change. Move to `game/src/content/` or `ui/`.
- **Dead code (P3, S).** `GameScene.chainHasCrusher()` (`:525-527`, defined, never called); `render/ui.ts` `Button` class (0 call sites outside the file; only `hoverColor` is used, by `tools/a11y-audit.ts`); `verify.ts:201` computes `rank` and `void`s it inside the `around` map (and does an O(n) `indexOf` per element). `tools/scratch*` are git-ignored, not tracked (fine). `vendor/phaser` is 15 MB of tracked bytes that only the cloud sandbox used (`CLAUDE.md`, tsconfig `paths` fallback) — repo bloat for every clone.
- **UI layer design (P2, M).** `ui/dom.ts` is a sound, small DOM overlay (`h()` builder, `UiLayer`, focus-trapped `dialog()` at `:212-245`). But screens are 190–310-line closures (`TitleScreen.ts`, `ResultsScreen.ts`, `GamePanel.ts`) that fetch, format and mutate the DOM in place; state is scene fields (`ResultsScene.ts:18-28` holds `lastRank`, `lastPlayer`, `lastShareText`, `lastPercentile`, `lastN`, `lastMedal`, `verifiedHash`, `lastCard`, `lastClip`, `lastGif` — 10 mutable "last*" fields read by the e2e). There is no view-model; each screen re-reads `localStorage` on every render (`loadReadTips()` is called in `panelState()` at `GameScene.ts:463` on every side-panel render).
- **Duplication (P3, S).** Three near-identical fetch-with-timeout wrappers (`render/daily.ts:34-41`, `:61-70`, `render/challenge.ts:17-24`); three `JSON.parse(localStorage.getItem(KEY) ?? 'null')` readers (`identity.ts:17`, `groups.ts:13`, `daily.ts:29`) beside the validated `storage.ts` readers; `randomToken()`/`randomId()` duplicated (`identity.ts:11`, `telemetry.ts:25`); the verifier's five `req.on('data' … > 4096 …)` body readers (`verify.ts:963, 982, 1005, 1024, 1043, 1064`) are copy-paste.
- **State keyed by 16 `localStorage` keys** (`jd.*`, two of them legacy migrations): reasonable, validated (`storage.ts:32-89`), but the validator layer is partly bypassed by the three ad-hoc readers above.
- Naming is consistent and the one-paragraph module headers are excellent; comments reference the plan item that motivated each decision (good traceability, heavy density).

## 2. Type safety and error handling

- `strict: true`, `noImplicitOverride`, zero `any`, zero suppressions: **excellent baseline**. `noUncheckedIndexedAccess` is explicitly off (`tsconfig.json:8`); turning it on would surface the ~40 indexed reads the sim does on `grid[cell]!`-style arrays (`sim.ts:122, 361, 362`).
- **Silent fallbacks are the dominant error style (P1, M).** `storage.ts:95` `write()` swallows `QuotaExceededError` → a save, best or identity write can vanish with no message; `storage.ts:186` `isOnboarded()` returns **true** on storage failure, hiding onboarding exactly when storage is blocked (private mode). `identity.ts:19` loses the device token silently ("lives for this session only") — the player then loses their claimed name and streak with no explanation. No UI anywhere mentions storage trouble (grep `quota|storage unavailable` in `game/src/ui`: 0 hits).
- **Verifier-offline states exist but read as developer copy (P1, S).** Shipped strings: "Submit to local verifier" (`ResultsScreen.ts:151`), "No local verifier running (optional: npm run verifier)" (`:127`), "Verifier unreachable at … (start it with: npm run verifier)" (`:163`), "Weekly offline" (`TitleScreen.ts:129`). A production player cannot act on `npm run verifier`.
- **WebGL context loss** is handled and e2e-covered (render e2e: "WebGL context loss"); adaptive quality (`quality.ts`) is unit-tested. Good.
- **No global error capture (P2, S).** No `window.onerror`/`unhandledrejection` handler in `game/src` (the single `onerror` hit is `MediaRecorder.onerror`, `clip.ts:154`); production builds have `sourcemap: false` (`scripts/build.mjs:20`) so even a console stack is unreadable. A client error is invisible to the operator.
- Verifier error paths are good: every handler guarded (`verify.ts:904`), `clientError` → 400 (`:1082`), `StorageError` → 503 + Retry-After with nothing recorded (`:566, 1054`), damaged board loads empty (`loadBoard`, `:762-786`). But `commit()` failure in *minting* paths is swallowed into memory-only state (`:297, 331, 638, 648`: `try { this.commit(next) } catch { this.data = next }`) — a disk outage can issue a daily seed that is never persisted; after restart the day re-mints identically (HMAC), so the seed is stable, but `issuedAt`/announcements/freeze state are lost. Acceptable, undocumented.

## 3. Test pyramid

- **Balance:** ~115 of 149 tests are fast Node unit/integration tests (sim 20, verifier 34, storage 8, controller 5, streak 5, share 5 …); 4 browser e2e (game, render, control-room live, desktop smoke) carry nearly all UI coverage. Unit ≈ 2 s total; the two Playwright e2e are 73 s + 53 s and dominate the 74 s wall time (they run in parallel under `node --test`).
- **Monolithic e2e (P1, M).** `tests/game-e2e.test.mjs` is **one `test()` of 633 lines**; `render-e2e` one of 523 lines. One assertion failing anywhere reports one red test and aborts the remaining ~40 scenarios; there is no per-scenario timing, retry or isolation. They also share browser state between scenarios by design (saves, identity), so ordering is load-bearing.
- **Timing risk (P2, S).** `await wait(ms)` fixed sleeps: 35 in game e2e, 27 in render e2e, 2 in control-room live, 1 in desktop smoke; plus `setTimeout(…, 1100)` for the per-player bucket (`game-e2e:596`). CI history proves the risk: `ci.yml` failed 24/24 runs on Ubuntu until `9c8205b/8ce64ee`, then twice more on the par wait (STATUS session 44); the latest fix raises budgets (120 s par, 300 s test) rather than removing the race.
- **Fixed ports** 5198 (render e2e), 5199 (game e2e), 4499 (e2e verifier), 4310 (control-room live) — two concurrent suite runs on one machine collide; no `port: 0` + discovery.
- **Untested or e2e-only:** `render/clip.ts` (263 lines WebM/GIF capture) and `render/gif.ts` only via one e2e step; `render/audio.ts` (174) / `mixer.ts` partly unit (mixer 4 tests) but the WebAudio graph only e2e; `render/textures.ts`, `atlas.ts`, `dpr.ts` e2e-only; `ui/*` panels (1,343 lines) have **no unit tests** — only e2e; `desktop/main.cjs` IPC hardening (sender check, extension allowlist, 64 MB cap at `main.cjs:13-17`) has **no negative test** (the smoke only calls the happy path, `desktop-smoke.test.mjs:28`); `scripts/dev.mjs`/`build.mjs` untested; `server/cold.ts` tested only through the verifier cold test; the `DELETE /me` + cold-board interaction is asserted, but no test covers a *corrupt* `cold/index.json` or a half-written month file; `RateLimiter` eviction under `maxKeys` pressure is tested once; no property/fuzz test on `apply()` despite it being the trust boundary (replays are untrusted input).
- **Determinism across engines** (PLAN-v5 0.8.0) is not tested: CI installs Chromium only (`ci.yml:23`).
- **No coverage measurement** at all; no idea which of the 6,902 source lines the 149 tests touch. `node --test --experimental-test-coverage` or `c8` would cost one script line.
- **No lint/format (P1, S).** Cost today: 310 lines > 200 chars, inconsistent one-line `if (…) { …; …; }` blocks, unused code (`chainHasCrusher`, `Button`) that `no-unused-vars`/`noUnusedLocals` would have flagged, and every reviewer (human or model) spending attention on layout instead of logic. `tsc` catches types, not these.

## 4. CI/CD and release process

`ci.yml` (on push to main, tags, PRs, manual): `test` job = `npm ci` → Playwright Chromium → typecheck → `npm test` → build → verifier build; `image` job (needs test) builds the Docker image, runs it on a volume, `tools/image-smoke.ts` + `tools/mint-check.ts`, restart-persistence check; `desktop` job (tags or manual only, windows-latest) `npm run desktop:pack` + smoke + uploads `release/win-unpacked` as a **7-day artifact**. `perf.yml`: measures preset B and gates **only if `docs/baselines/ci/perf-ci.json` exists — it does not** (`ls docs/baselines/ci` → no such directory), so perf is a warning, as ROADMAP M7 ⚑ says.

Gaps:
- **No release artefacts are published (P1, S).** `CHANGELOG.md` and STATUS claim "the Docker image and the Windows installer are built by CI on the tag"; in fact the image is built and smoke-tested but **never pushed to any registry**, and the desktop job runs `desktop:pack` (unpacked dir), **not `desktop:dist`**, so **no NSIS installer is produced in CI** and nothing is attached to a GitHub Release. A tag today yields a 7-day zip of an unpacked folder.
- No lint, no coverage upload, no `concurrency:` group (parallel pushes run duplicate 30-minute jobs), no Playwright browser cache (re-downloads Chromium every run), no Dependabot/Renovate (`.github/dependabot.yml` absent), no CODEOWNERS, no PR template, no branch protection visible from the repo (cannot be verified here: no `gh`, STATUS says the same).
- **Green CI never observed from this PC** (STATUS 44: "Not verified here: a green run on GitHub"). The project's own evidence loop is local; CI is a trailing indicator.
- Release process is a manual recipe in STATUS/CHANGELOG (version bump, autoplay sweep, rollback rehearsal, tag); the rollback rehearsal tool is real and good (`tools/rehearse-rollback.ts`), but there is no release checklist file, no `engines` field, no `.nvmrc`, and `package.json` has no `repository`/`license`.

## 5. Build and bundle

- esbuild single entry, ESM, target `es2022/chrome110/firefox110/safari16`, minified, **no production source maps**, no content hash (`entryNames: 'main'`, `esbuild-config.mjs:10`) → cache busting depends entirely on the host's headers; `dist/index.html` sets no `Cache-Control` and the only server that serves `dist/` (Control Room `/verified/`) is a dev tool. There is **no production static-host config** (no `_headers`, no `nginx.conf`, no Caddyfile) and **no CSP** meta/header anywhere (`grep Content-Security-Policy` → 0 in `desktop/*.cjs` and `index.html`).
- Bundle: 388 KiB gzip; Phaser 85.8 %. The game uses Images, Containers, Graphics, Text, Tweens, Input, Scale — no Physics, no Tilemaps, no Spine. A custom Phaser build (PLAN-v5 0.8.9) is the only lever that matters; code-splitting own code (200 KB raw) would save almost nothing. `policy.json` (8.4 KB) is bundled *and* copied to `dist/` (double shipped).
- No PWA/offline manifest or service worker, though the game is fully offline-capable (the desktop build proves it).
- Asset pipeline is good: authored SVGs → one runtime atlas (`atlas.ts`), two deterministic WAVs (`tools/make-sfx.ts`), `--sheet` CVD audit. `scripts/dev.mjs` is a hand-rolled proxy with a path check (`dev.mjs:26`), fine for dev.
- Reproducibility: `build.json` carries commit and `builtAt` (so two builds of one commit differ by a timestamp — "reproducible" only for `main.js`).

## 6. Electron / desktop

Good: `contextIsolation: true, nodeIntegration: false, sandbox: true` (`main.cjs:31`); preload exposes two values and one function (`preload.cjs:3-8`); IPC validates sender frame, extension allowlist, byte bounds (`main.cjs:13-17`); `will-navigate` blocks non-`file://` (`:38`); `setWindowOpenHandler` denies and shells out only `https://` (`:37`); no remote content; dev API only behind `JD_DEV_API=1`.

Gaps: **no CSP** (a `file://` page with no CSP; inline scripts allowed) (P2, S); **no `session.setPermissionRequestHandler`** (camera/mic/notifications would prompt or default-allow) (P2, S); **unsigned** (SmartScreen warning; ROADMAP M3 ⚑) (P1, L — needs a certificate/budget); **no auto-update** and no update check at all (P2, M); **no crash reporting** (`crashReporter` absent) and no renderer error capture (P2, S); the installer "has never been run on a clean machine" (`desktop/README.md`); macOS/Linux configs exist but have never been built (P3). The 359 MB on-disk footprint and 122 MB installer are Electron-normal.

## 7. Verifier service robustness

Architecture: one Node process, `http.createServer`, whole board in memory as an immutable-ish `Board` object, **every write rewrites the entire hot JSON file** pretty-printed (`JSON.stringify(candidate, null, 1)`, `verify.ts:366`) via temp+rename. Hot/cold split bounds the hot file by players (≈ players × 30 × 310 B; measured 4 MB at 100 players×365 days, 13.8 MB at 1,000). Measured and documented in `server/README.md` — exemplary.

- **Re-simulation runs inline on the request thread, three times per submission (P1, M).** `submit()` calls `verifyReplay(replay)` (`verify.ts:536`), then `finalMachinesOf(replay)` and `roundsOf(replay)` (`:550`) — each a full `replayRun` (6 rounds × 80 ticks + up to 4,000 actions). A 4,000-action replay with maximal layouts is cheap per run (~ms), but 60/min/IP × N IPs × 3 re-sims on the event loop with no per-request CPU budget is the obvious DoS surface. Only the bot par is in a worker (`computeParInWorker`, `:709-717`). PLAN-v5 0.8.7 names this; it should be P1, not an 0.8.x tail item.
- **Write amplification (P2, M).** `prune()` re-ranks every touched seed on every write (`:353-354`: `for (const s of touched) … this.rank(s, data)`) — O(seeds × entries) sorting per accepted submission; `rank()` itself filters+sorts the whole `entries` array per call (`:262`) and is called on every `/board`, `/histogram`, `/daily` read. Fine at 100 players; quadratic by 1,000.
- **Timeouts (P2, S).** No `server.headersTimeout`/`requestTimeout`/`keepAliveTimeout` set (grep: 0 hits) — Node 24 defaults apply (60 s headers, 300 s request), so slowloris is bounded but generous; body readers cap bytes per route (`:963-1064`) — good.
- **Graceful shutdown (P2, S).** No `SIGTERM`/`SIGINT` handler, no `server.close()`, no `announcer.idle()` drain; Docker's SIGTERM kills mid-request. Atomic writes make this safe for data, not for clients.
- **Rate limiting design.** Fixed-window per key, in-process `Map`, 10,000-key cap with eviction (`RateLimiter`, `:830-848`). Per-IP only on `/verify` and `/events`; per-player buckets on identity/groups/report/verify. **GETs are unlimited** (`/board`, `/histogram`, `/daily` trigger `rank()` sorts and `withPar` queue admission). `TRUST_PROXY=1` takes the *first* `X-Forwarded-For` hop (`:875`) — spoofable unless the proxy overwrites the header.
- **Identity:** bearer = random 32-hex device token, `player_id = SHA-256(token)`, never stored or logged (test-pinned). No rotation, no revocation except `DELETE /me`; recovery code = the token (`identity.ts:51`). Adequate for "no passwords", but a leaked token is a permanent identity.
- **CORS** default `*` (Dockerfile ENV line 23); `Authorization` header allowed from any origin. With `*`, a third-party site cannot read responses with credentials, but the client sends the bearer to any `?verifier=` URL that is https (`identity.ts:40`) — a phishing `?verifier=https://evil` link exfiltrates the token. Restrict the runtime override to same-origin or an allowlist in production builds (P1, S).
- **Logging:** one plain-text line per request with client IP, method, path, status, ms (`:901`); not JSON; IP in the clear (privacy posture note, since the events store hashes IPs deliberately). No request id.
- **Metrics/health:** `/health` returns counts and uptime; no Prometheus/OpenMetrics, no latency histograms, no alerting hooks. Discord webhook is product-facing, not ops.
- **Backup/restore:** none built in. `server/README.md` says "back it up" for `daily-secret`; no snapshot tool, no restore test, no `cold/` integrity check.
- **Schema migrations:** done by defensive `loadBoard()` (`:762-786`) with per-field defaults, plus startup backfills (`deriveTieBreaks`). No schema version field on the file; migrations are implicit.
- **Multi-instance:** impossible by construction (single writer of `board.json`, in-memory limiters and par queue). Documented ("behind several replicas use the proxy's limiter").
- **Abuse surfaces checked:** body ≤ 512 KB, ≤ 4,000 actions, seeds ≤ 64 chars, limits clamped, names normalised and blocklisted, group codes unguessable, reveal gate enforced server-side. Missing: a per-process CPU/time budget for re-simulation; per-IP limit on reads; `Retry-After` on 503 is static `5`.

## 8. Observability and supportability

- Server: stdout request log + `console.error` for cold-split/audit failures; `/health`; `moderation.jsonl` audit; opt-in funnel `events.jsonl` + `npm run funnel`. No structured logs, no metrics endpoint, no alerting, no dashboards for ops (the Control Room is a *development* dashboard fed by Claude Code hooks, localhost-only, read-only; 643 lines, 8 tests; `execFile('git', …)` for commit list — sensible and bounded).
- Client: **no error reporting pipeline**; no build/commit in error output; `build.json` exists but nothing reads it at runtime for support. A player saying "it broke" cannot be diagnosed.
- Supportability positives: deterministic replays mean any bug with a replay file is reproducible; `tools/sim-cli.ts`, `autoplay.ts`, `balance.ts` give operators real instruments.

## 9. Localisation and content readiness

- Rough count of user-facing literals (multi-word capitalised strings) in `game/src/ui/*.ts` + `GameScene.ts` + `share.ts`, `card.ts`, `sim/advice.ts`, `sim/tips.ts`: **168 string literals plus 91 template literals** containing prose (TitleScreen 37, ResultsScreen 33, GamePanel 24, tips 14, GameScene 12, GroupsPanel 11, identityDialog 10, advice 9, ArchivePanel 8). Verifier error strings are also user-visible (`setStatus(body.error)`), so English leaks from the server too.
- **No `Intl`, no `toLocaleString`** anywhere (0 hits). Dates are formatted by hand: `closesAt.replace('T', ' ').slice(0, 16) + ' UTC'` (`ResultsScreen.ts:166`, `webhook.ts:16`); currency is a hard-coded `$` glyph in ~60 places; plurals are `s`-suffix ternaries (`:97`). PLAN-v5 0.8.6 plans the string table; budget for `Intl.DateTimeFormat`/`NumberFormat` and plural rules at the same time.
- Dev-centric copy shipped (see §2). Placeholder `APPEAL_CONTACT = 'moderation@example.invalid'` (`verify.ts:135`) reaches the policy page.

## 10. Developer experience and docs

- **Setup time** (verified): `npm install` + `npx playwright install chromium` + `npm test` ≈ 5 min; no native deps; good.
- **No `README.md`, no `LICENSE`** at root — a new contributor lands on `CLAUDE.md` (7.4 KB, agent-oriented) and `docs/STATUS.md` (133 KB of session logs). The "resume recipe" `docs/CONTINUE.md` (19 lines) is the closest thing to onboarding.
- Docs volume: 2,025 lines of Markdown across 15 files plus `docs/baselines/` (1.4 MB `balance-tuner-greedy.json`, 548 KB reroll study — tracked JSON evidence). Plans are versioned (PLAN-v1…v5) and ROADMAP is a verified-history checklist with ⚑ for human-only items — unusually honest. But the *current truth* is spread across STATUS (session log), ROADMAP (checklist), CHANGELOG (release notes), CLAUDE.md (commands) and `server/README.md` (ops). A 100-line `docs/ARCHITECTURE.md` and a root README would halve ramp time.
- Scripts: 20 npm scripts, coherent; `test` is a 1,000-character explicit file list (`package.json:15`) that must be edited by hand for every new test file (a glob would do). `test:quick` exists but is undocumented in CLAUDE.md.

---

## (a) Top 15 engineering gaps

| # | Gap | Evidence | Priority | Effort | Risk if ignored |
|---|---|---|---|---|---|
| 1 | Nothing is deployed and CI publishes no release artefact (image not pushed, installer not built, no GitHub Release) despite CHANGELOG claiming it | `ci.yml:54-72` (`desktop:pack`, 7-day artifact), `ci.yml:39-42` (local image only); ROADMAP M4/M7/M10 ⚑ | P0 | M | Every "verified" claim is local; no player has used the hosted path; release claims in docs are false |
| 2 | Replay re-simulation runs inline on the request thread, 3× per submission, with no CPU budget; GET reads unlimited | `verify.ts:536, 550`; `:262` sorts per read | P1 | M | A handful of hostile clients pin the single event loop; boards stall for everyone |
| 3 | `?verifier=` runtime override sends the bearer token to any https host | `identity.ts:40-41`, `BootScene.ts:23`, `GameScene.ts:53` | P1 | S | Identity theft by link; ranked names hijacked |
| 4 | Monolithic single-`test()` e2e files with 62 fixed sleeps and fixed ports | `game-e2e.test.mjs` (633 lines, 1 test, 35 `wait`), `render-e2e` (523, 1, 27); ports 5198/5199/4499 | P1 | M | CI flakiness already cost 26 red runs; one failure hides all other scenarios |
| 5 | No lint/format/unused-code tooling; 310 lines > 200 chars; dead code present | `package.json` devDeps; `GameScene.ts:525`, `render/ui.ts` Button, `verify.ts:201` | P1 | S | Review bandwidth burnt on style; dead paths rot; agents and humans diverge on conventions |
| 6 | Silent storage failure: quota/private-mode errors swallowed; onboarding assumed done on failure; identity token can be lost silently | `storage.ts:95, 186`, `identity.ts:19` | P1 | S | Players lose saves, streaks and names with no message; support cannot explain |
| 7 | Dev-centric copy shipped to players ("npm run verifier", "local verifier") and a placeholder appeal address | `ResultsScreen.ts:127, 151, 163`, `verify.ts:135` | P1 | S | First public impression says "unfinished" |
| 8 | GameScene god object (718 lines, 30 imports, input + copy + juice + telemetry) | `GameScene.ts` | P1 | M | Every 0.8.x item (action table, gamepad, strings, single-step) edits one file; merge pain and regressions |
| 9 | No client error reporting, no prod source maps, no global error handler | `build.mjs:20` `sourcemap: false`; 0 `window.onerror` | P2 | S | Production bugs invisible; cannot triage player reports |
| 10 | Verifier ops gaps: no graceful shutdown, no timeouts set, plain-text logs with IPs, no metrics, no backup/restore tool, implicit schema | `verify.ts` (no SIGTERM/`server.close`, no `headersTimeout`), `:901` | P2 | M | First outage is diagnosed blind; data-dir corruption has no rehearsed recovery |
| 11 | Perf gate not armed; perf CI is a warning | `perf.yml:40`, `docs/baselines/ci` missing | P2 | S | 4× frame budget regresses unnoticed until a device run |
| 12 | Electron: no CSP, no permission handler, unsigned, no auto-update, no crash reporter | `main.cjs:31-38`, `desktop/README.md` | P2 | M (signing L) | SmartScreen scares users; a renderer bug can request device permissions; no way to ship fixes |
| 13 | Presentation strings in `sim/` and no `Intl`; 259 prose literals; hand-formatted dates | `sim/rules.ts:46-56`, `sim/tips.ts`, `sim/advice.ts`, `ResultsScreen.ts:166` | P2 | M | 0.8.6 becomes a sim-touching change; non-English/non-US players get wrong formats |
| 14 | No coverage measurement; `ui/*` (1,343 lines), `clip.ts`, desktop IPC negatives untested | §3 | P2 | S | Refactors (#8) fly blind on the UI layer |
| 15 | No README/LICENSE/ARCHITECTURE; STATUS is 133 KB of logs; `vendor/phaser` 15 MB tracked; no Dependabot; test list hand-maintained | repo root, `package.json:15`, `.github/` | P3 | S | Contributor ramp is hours not minutes; dependency drift (TS 7, Phaser 4) arrives unplanned |

## (b) Genuinely strong — protect these

1. **Pure, deterministic simulation with a versioned rule set and a golden corpus** (`sim/*`, `tests/golden/`, `RULES_VERSION` + `tests/policy.test.ts` + `tools/make-golden.ts`). Replays verify byte-for-byte on client and server; `tests/sim.test.ts` pins "no item is ever lost or duplicated".
2. **Trust model:** scores are never trusted from the client; the verifier re-simulates; the client re-verifies fetched replays before playback (`verified.ts:19-21`); labels say "unverified" until proven. The reveal gate, keep-best, late-but-unranked and freeze semantics are each pinned by tests with fake clocks.
3. **Verifier invariants under failure:** atomic temp+rename commits, 503-with-nothing-recorded, damaged file loads empty, malformed URL/socket garbage survives, bounded everything (bodies, limits, limiter keys, seeds, replays) — all test-pinned ("Guarantees" block in `server/README.md`).
4. **Type discipline:** strict TS, zero `any`, zero suppressions, runtime validators on every untrusted boundary (`storage.ts:32-89`, `replay.ts:49-60`, `loadBoard`, `validateBatch`).
5. **Measured decisions:** storage trigger (5 MB / 50 ms) with real numbers, balance/reroll studies with paired deltas, a11y WCAG + CVD audit enforced in tests, perf tool with device presets, rollback rehearsal both directions. Decisions are recorded with evidence, not opinion.
6. **RoundController extraction** and the DOM overlay (`ui/dom.ts`) — the two seams that make the UI testable and accessible; keep every new screen DOM-first and every new game-state transition in the controller.
7. **Privacy posture:** opt-in telemetry with a fixed vocabulary, salted daily IP hashes, token never logged, `DELETE /me`, no third-party scripts.

## (c) Three refactors that pay off most before more features

1. **Split `GameScene` along the seams it already has (M).** Extract `InputController` (the 15 key bindings, drag handlers, cursor/held state: `GameScene.ts:238-306, 352-425`), `TutorialGuide` (`:470-521`, pure function of `RunState` → `{text, step}`, unit-testable), `StallMonitor` (`:668-687`) and `PopPool` (`:689-703`). Move the 8 `telemetry.track` calls into a single `GameTelemetry` observer on controller hooks. Result: a ~300-line scene that only maps sim events to sprites, and PLAN-v5 0.8.2/0.8.3/0.8.4/0.8.6 each land in one small module. Do this before 0.8.2.
2. **Make the verifier request path bounded and operable (M).** Move `verifyReplay`+`finalMachinesOf`+`roundsOf` into one worker call that returns `{score, finalMachines, rounds}` from a single re-simulation (today three), with a per-job wall-clock cap and a small queue (reuse `ParService`'s pattern); add `server.headersTimeout/requestTimeout`, a SIGTERM drain (`server.close()` + `announcer.idle()`), a per-IP read limiter, JSON log lines with a request id, and an index (`Map<seed, BoardEntry[]>` kept sorted) so `rank()`/`prune()` stop re-sorting the whole board. This is PLAN-v5 0.8.7 pulled forward to before hosting, where it belongs.
3. **Turn the e2e monoliths into a scenario suite with a shared fixture and real waits (M).** One `tests/e2e/fixture.mjs` that starts the dev server and verifier on `port: 0` (or discovers free ports) once per file, exposes `page`, `api`, `verifier` helpers; split the ~40 scenarios into separate `test()`s (or `describe` + `beforeEach` seeding `localStorage`); replace `await wait(n)` with `waitForFunction` on `__jd` state; keep one "full run" smoke. Add `--experimental-test-coverage` to `npm test` and an ESLint flat config with `typescript-eslint` recommended + `no-unused-vars` in the same PR so the refactors in (1) and (2) are measured. CI gains per-scenario red/green and loses the 26-red-run class of flake.

### Smaller, near-free fixes worth bundling
Content-hash `main.js` and emit a `_headers`/Caddy snippet; add a CSP meta to `index.html` and `session.setPermissionRequestHandler` in `main.cjs`; show a one-line "storage unavailable — progress will not be saved" banner from `storage.ts` write failures; restrict `?verifier=` bearer sending to the built-in `VERIFIER_URL` origin unless `?dev=1`; replace the three ad-hoc `localStorage` readers with `storage.ts` validators; delete `chainHasCrusher`, `render/ui.ts` `Button`, `verify.ts:201`'s `void rank`; add `engines`, `license`, `repository` to `package.json`; glob the test list; add Dependabot for npm + actions; commit the perf CI baseline to arm the gate; make the desktop job run `desktop:dist` and attach the installer and the Docker image (GHCR) to a GitHub Release on tags.
