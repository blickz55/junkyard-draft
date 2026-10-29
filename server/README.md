# Replay verifier (server/)

The trusted side of scoring: it re-simulates submitted replays with the same rules as the client and
keeps only verified scores. One Node process, a JSON file for storage, no database.

## Endpoints
| Method | Path | Returns |
|---|---|---|
| POST | `/verify` `{ replay, player? }` | `{ ok, score, entry }` or `{ ok: false, error }` (422 rejected, 429 rate-limited, 413 too large) |
| GET | `/board?seed=…&limit=20` | verified entries for a seed |
| GET | `/daily?limit=10` | today's UTC daily seed + its verified board |
| GET | `/histogram?seed=…&hash=…` | verified score distribution for a seed: `{ n, step, bins[{from,to,count}], mine{score,rank,bin,percentile}?, around[] }` — the player's own entry located by replay hash, never by name |
| GET | `/replay?hash=…` | the stored actions of a **verified** entry `{ ok, hash, seed, player, score, rulesVersion, actions, verifiedAt }` (404 otherwise) |
| GET | `/health` | `{ ok, rulesVersion, entries, uptimeSec }` |
| POST | `/events` `{ installId, consent: true, events[] }` | opt-in funnel events (PLAN-v1 0.3.7): only the fixed vocabulary in `game/src/telemetry/events.ts`, consent explicit, ≤ 100 events, 30 req/min/IP; appended to `events.jsonl` with a daily-salted IP hash (422 rejected, 429 limited, 503 storage) |
| GET | `/funnel` | unique installs per first-session step and event counts (what `npm run funnel` prints from the file) |

## Run
```
npm run verifier                       # dev: tsx, 127.0.0.1:4400, board in server/data/board.json
npm run verifier:build                 # esbuild → server/dist/verify.mjs (single file, Node ≥ 20, no tsx)
node server/dist/verify.mjs --host 0.0.0.0 --port 4400 --data-dir /data --cors-origin https://your.site --rate-limit 60
```
Env vars with the same meaning: `HOST`, `PORT`, `DATA_DIR` (or `BOARD_FILE`), `EVENTS_FILE` (default next to the board), `EVENTS_RETENTION_DAYS` (30), `CORS_ORIGIN`, `RATE_LIMIT`
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

## Operational notes
- The default data directory is `<cwd>/server/data` for both the source run and the bundled run; set `DATA_DIR` (or `--data-dir`) in production.
- Rate limiting is a fixed window per process; behind several replicas use the proxy's limiter instead.
- The board file is rewritten on every accepted submission and now also holds each verified replay's actions (≤ 4000 actions, bounded at verification); keep it on a persistent volume. Boards written before replay storage simply have no replays (`replayAvailable: false`).
- Retention: stored replay actions are kept only for each seed's top 100 entries (the `/board` cap); lower entries keep their score but lose their replay (`replayAvailable: false`). Pruning happens on every write.
- Rules version mismatches are rejected, so deploy the verifier from the same commit as the game.
- Nothing authenticates players: `player` is a display name only. Abuse controls = rate limit + duplicate replay hash.
- Funnel events (`events.jsonl`): one JSON line per event with `at`, `receivedAt`, `installId` (random, client-generated, deleted when the player opts out), `ip` (16-hex SHA-256 of a per-process salt + UTC date + address: one key per client per day, unlinkable across days or restarts), `name`, `props`. No seeds except `daily-*`/`tutorial-*` labels, no layouts, no names. Rows older than the retention are pruned at start and hourly. Report: `npm run funnel -- path/to/events.jsonl`.
