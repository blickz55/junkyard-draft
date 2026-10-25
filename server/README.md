# Replay verifier (server/)

The trusted side of scoring: it re-simulates submitted replays with the same rules as the client and
keeps only verified scores. One Node process, a JSON file for storage, no database.

## Endpoints
| Method | Path | Returns |
|---|---|---|
| POST | `/verify` `{ replay, player? }` | `{ ok, score, entry }` or `{ ok: false, error }` (422 rejected, 429 rate-limited, 413 too large) |
| GET | `/board?seed=…&limit=20` | verified entries for a seed |
| GET | `/daily?limit=10` | today's UTC daily seed + its verified board |
| GET | `/replay?hash=…` | the stored actions of a **verified** entry `{ ok, hash, seed, player, score, rulesVersion, actions, verifiedAt }` (404 otherwise) |
| GET | `/health` | `{ ok, rulesVersion, entries, uptimeSec }` |

## Run
```
npm run verifier                       # dev: tsx, 127.0.0.1:4400, board in server/data/board.json
npm run verifier:build                 # esbuild → server/dist/verify.mjs (single file, Node ≥ 20, no tsx)
node server/dist/verify.mjs --host 0.0.0.0 --port 4400 --data-dir /data --cors-origin https://your.site --rate-limit 60
```
Env vars with the same meaning: `HOST`, `PORT`, `DATA_DIR` (or `BOARD_FILE`), `CORS_ORIGIN`, `RATE_LIMIT`
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

## Operational notes
- Rate limiting is a fixed window per process; behind several replicas use the proxy's limiter instead.
- The board file is rewritten on every accepted submission and now also holds each verified replay's actions (≤ 4000 actions, bounded at verification); keep it on a persistent volume. Boards written before replay storage simply have no replays (`replayAvailable: false`).
- Retention: stored replay actions are kept only for each seed's top 100 entries (the `/board` cap); lower entries keep their score but lose their replay (`replayAvailable: false`). Pruning happens on every write.
- Rules version mismatches are rejected, so deploy the verifier from the same commit as the game.
- Nothing authenticates players: `player` is a display name only. Abuse controls = rate limit + duplicate replay hash.
