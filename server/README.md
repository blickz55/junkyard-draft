# Replay verifier (server/)

The trusted side of scoring: it re-simulates submitted replays with the same rules as the client and
keeps only verified scores. One Node process, a JSON file for storage, no database.

## Endpoints
Protocol level 2 (PLAN-v3 §1, reported by `/health`): identity is additive. A client may send `Authorization: Bearer <32 hex>` (its random device token; the server only ever uses `player_id = SHA-256(token)` and never stores or logs the token; the game sends it only to https or loopback verifiers). Anonymous submissions keep working exactly as before and legacy entries are never claimable.

| Method | Path | Returns |
|---|---|---|
| POST | `/verify` `{ replay, player? }` (+ optional bearer) | `{ ok, score, entry, recorded, player }` or `{ ok: false, error }` (422 rejected, 429 rate-limited per IP and, with a bearer, `PLAYER_RATE_LIMIT` = 2/min per player, 413 too large). With a bearer the entry is stamped `playerId` and `name#tag`, and **one best entry per (seed, player)** is kept: a better run replaces the earlier entry and its replay, an equal or worse run is verified but answered with `recorded: false` and the kept entry. A run on a minted daily seed after its `closesAt` is still re-simulated and answered `{ ok: true, score, late: true, recorded: false, closesAt }`: visible to the player, never on the final board |
| POST | `/identity` `{ name }` (bearer required) | claim or rename the display name: normalised (NFKC, whitespace, control characters, ≤ 32), refused by a folded blocklist (422), renames at most once per 24 h (429 + Retry-After); `{ ok, playerId, name, tag, createdAt, renamedAt }`; the tag is 4 confusable-free characters derived from the player id; a rename follows the player onto the boards |
| GET | `/identity` (bearer) | the claimed record, or 404 with `{ playerId, tag }` before any claim |
| DELETE | `/me` (bearer) | forget the player: name removed, their entries anonymised as `deleted`, their replays dropped; `{ ok, anonymisedEntries }` |
| GET | `/board?seed=…&limit=20` | verified entries for a seed |
| GET | `/daily?limit=10[&date=YYYY-MM-DD]` | the **minted** daily (PLAN-v3 0.6.1): `{ ok, date, seed, commitment, issuedAt, closesAt, minted: true, verified: true, entries, previous: { date, seed, commitment }, botPar, tieBreak }`. `seed = daily-<date>-base32(HMAC-SHA256(DAILY_SECRET, date))[0:8]`, issued on the first request on or after 00:00 UTC and stored; `commitment = SHA-256(seed(date+1))`, so tomorrow's seed is fixed before anyone can play it (`tools/mint-check.ts` verifies yesterday's commitment against today's seed). A `date` that has not opened is **403**; a malformed one 400. Submissions on a minted seed are accepted only if this server issued it and `now < closesAt` (48 h after 00:00 UTC; 0.6.2 adds freeze and archive). The client's `daily-YYYY-MM-DD` is the unranked practice seed: an ordinary seed board that never reaches `/daily`. **Window (0.6.2):** `closesAt` = 48 h after 00:00 UTC of the date; from then on the response carries `final: true` and `frozenAt` (= `closesAt`, set when first observed, idempotent, persisted) and the board never changes; `now` is the server clock so clients can say "closes in 31 h" |
| GET | `/archive?from=&to=&limit=30` | closed days newest first (PLAN-v3 0.6.2): `{ ok, days: [{ date, seed, closesAt, frozenAt, n, botPar, medals, top: top five entries }], nextTo }`; `medals` (0.6.4) = `{ n, bronze, silver, gold }` set once at freeze from the final board as the 50th/80th/95th nearest-rank percentiles (`threshold(p) = sorted[ceil(p/100·n) − 1]`, ties earn the medal), or `null` below 5 runs; `/daily` carries the same field after freeze and `/histogram` returns it for a frozen daily seed; `nextTo` is the next older date to pass as `to` for the following page (null at the end); `from`/`to` must be `YYYY-MM-DD` (400); limit ≤ 100 |
| GET | `/histogram?seed=…&hash=…` (also `/board`, `/daily`: `botPar`) | verified score distribution for a seed: `{ n, step, bins[{from,to,count}], mine{score,rank,bin,percentile}?, around[] }` — the player's own entry located by replay hash, never by name |
| GET | `/replay?hash=…` | the stored actions of a **verified** entry `{ ok, hash, seed, player, score, rulesVersion, actions, verifiedAt }` (404 otherwise) |
| GET | `/health` | `{ ok, version, rulesVersion, protocol, entries, entriesAllVersions, uptimeSec }` |
| POST | `/events` `{ installId, consent: true, events[] }` | opt-in funnel events (PLAN-v1 0.3.7): only the fixed vocabulary in `game/src/telemetry/events.ts`, consent explicit, ≤ 100 events, 30 req/min/IP; appended to `events.jsonl` with a daily-salted IP hash (422 rejected, 429 limited, 503 storage) |
| GET | `/funnel` | unique installs per first-session step and event counts (what `npm run funnel` prints from the file) |

## Run
```
npm run verifier                       # dev: tsx, 127.0.0.1:4400, board in server/data/board.json
npm run verifier:build                 # esbuild → server/dist/verify.mjs (single file, Node ≥ 20, no tsx)
node server/dist/verify.mjs --host 0.0.0.0 --port 4400 --data-dir /data --cors-origin https://your.site --rate-limit 60
```
Bot par (PLAN-v1 0.4.5): the first request about a seed starts the shipped autoplayer in a worker thread (5 searches × 40 tries, fixed rng streams, so the same number on every machine); the median is stored as `botPar` and returned by `/board`, `/histogram` and `/daily` (null while computing). `BOT_PAR=0` disables it, `BOT_PAR_CAP_MS` (20000) caps a job; a failed or capped job backs off ten minutes. It is a target labelled as a bot, never an entry.

Env vars with the same meaning: `HOST`, `PORT`, `DATA_DIR` (or `BOARD_FILE`), `EVENTS_FILE` (default next to the board), `EVENTS_RETENTION_DAYS` (30), `CORS_ORIGIN`, `RATE_LIMIT`, `PLAYER_RATE_LIMIT` (2), `DAILY_SECRET` (or `--daily-secret`; without it the verifier generates one into `<data dir>/daily-secret` with mode 0600 and says so: **back it up**, the ranked daily seeds derive from it). Rotating the secret keeps every issued day (their seeds are stored) but the commitment published on the last day under the old secret will not match the first day under the new one; `tools/rehearse-rollback.ts` rehearses the rotation
(POST /verify per client IP per minute), `TRUST_PROXY=1` (use `X-Forwarded-For` behind a reverse proxy you
control), `VERIFIER_LOG=0` (silence the one-line-per-request log).

## Docker
```
docker build -t junkyard-verifier .
docker run -d --name verifier -p 4400:4400 -v verifier-data:/data -e CORS_ORIGIN=https://your.site junkyard-verifier
```
The image was written without Docker available on the dev machine and has **not been built yet**.

## Pointing the game at it
`VERIFIER_URL=https://verifier.your.site npm run build` bakes the URL into `dist/` (default
`http://127.0.0.1:4400`). A `?verifier=` query parameter still overrides it at runtime (used by tests).

## Guarantees (each pinned by a test in `tests/verifier.test.ts`)
- A malformed request never kills the process: unparsable URLs get 400, handler errors 500, socket-level garbage 400 via `clientError`.
- Nothing is recorded until it is on disk: the candidate board is written to a temp file in the same directory and renamed over
  `board.json`; a failed write leaves memory and disk unchanged and the client gets **503 + Retry-After** (the retry is not a duplicate).
- Boards are partitioned by rules version: rows persisted under another `RULES_VERSION` stay in the file but never rank, count or replay.
- Replay identity is SHA-256 over `{ rulesVersion, seed, actions }`; legacy 8-hex ids from earlier boards still resolve for playback.
- Bounded resources: body ≤ 512 KB, query limits are finite integers clamped to [1, 100] (`/board`) and [1, 50] (`/daily`), rate-limiter
  cardinality ≤ 10,000 keys, replays kept for each seed's top 100, entries ≤ 1,000 per seed, ≤ 5,000 seeds (least recently active dropped).
- A damaged `board.json` loads as an empty board with bad rows dropped, rather than preventing startup.
- Medals (PLAN-v3 0.6.4): computed exactly once at freeze (days frozen before medals existed get them on the next observation), never while a day is open, null below five runs; the exact percentile math is pinned by `tests/medals.test.ts`.
- Daily window (PLAN-v3 0.6.2): freeze flips exactly at `closesAt` with a fake clock, is idempotent and survives a restart; late submissions answer `late` and stay off the board and out of the replay store; the archive lists frozen days only, newest first, paged by `limit`/`nextTo`; a day's bot par is never dropped by the par cap.
- Identity (PLAN-v3 0.6.0): the bearer token is hashed before any use and appears in no log line; tags are deterministic per player id; the rename cooldown, name refusals, keep-best replacement (entry and replay), the equal-run case, the per-player bucket and `DELETE /me` are each exercised over HTTP.

## Rules-version deployment and rollback (runbook, rehearsed by `tools/rehearse-rollback.ts`)
A rules bump (`RULES_VERSION`) changes what the verifier accepts; entries and replays of every version stay in the board file and only the current version ranks.
1. Merge the rules branch to `main`, tag the release, build the bundle (`npm run verifier:build`) and the web/desktop builds from the same commit.
2. Deploy the new bundle over the existing data directory. Expect: `/health` reports the new `rulesVersion`, `entries` 0 for seeds with no new-version runs and `entriesAllVersions` unchanged; old-version replays are refused with `rejected: rules version N not accepted (server has M)`; old entries keep their replays (pruning never drops another version's replays).
3. Publish the web build and the desktop installer the same hour; the title's archived-bests block tells upgrading players that old replays and saves no longer verify.
4. Rollback: redeploy the previous bundle over the same data. Expect: the old version ranks again with replays intact; new-version entries stay stored and refused. Nothing is deleted in either direction.
`node --import tsx tools/rehearse-rollback.ts` performs steps 2 and 4 against bundles built from `main` (previous version) and the working tree, on a temporary data directory, and writes `docs/baselines/0.5/rollback-rehearsal.json`; run it before every rules release.

## Operational notes
- The default data directory is `<cwd>/server/data` for both the source run and the bundled run; set `DATA_DIR` (or `--data-dir`) in production.
- Rate limiting is a fixed window per process; behind several replicas use the proxy's limiter instead.
- The board file is rewritten on every accepted submission and now also holds each verified replay's actions (≤ 4000 actions, bounded at verification); keep it on a persistent volume. Boards written before replay storage simply have no replays (`replayAvailable: false`).
- Retention: stored replay actions are kept only for each seed's top 100 entries (the `/board` cap); lower entries keep their score but lose their replay (`replayAvailable: false`). Pruning happens on every write.
- Rules version mismatches are rejected, so deploy the verifier from the same commit as the game.
- Nothing authenticates players: `player` is a display name only. Abuse controls = rate limit + duplicate replay hash.
- Funnel events (`events.jsonl`): one JSON line per event with `at`, `receivedAt`, `installId` (random, client-generated, deleted when the player opts out), `ip` (16-hex SHA-256 of a per-process salt + UTC date + address: one key per client per day, unlinkable across days or restarts), `name`, `props`. No seeds except `daily-*`/`tutorial-*` labels, no layouts, no names. Rows older than the retention are pruned at start and hourly. Report: `npm run funnel -- path/to/events.jsonl`.
