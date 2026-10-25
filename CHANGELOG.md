# Changelog

All notable changes to Junkyard Draft. Dates are UTC. Rules changes bump `RULES_VERSION`, which invalidates
older replays and saves on purpose.

## 0.2.0 — 2026-10-25 (release candidate)

Built on the user's Windows PC after restoring the 0.1.0 bundle. Rules v2.

### Gameplay
- **Plate Press** (rules v2): two shards → one $8 plate, 2-tick hold, input from behind; the first shard is absorbed
  (new `absorb` event, `RunResult.absorbed`); a shard left in a press at round end shows as "1 shard held" on its
  badge. Draft weight 10, conveyor 34 → 30. Balance pass kept it unchanged (34 % pick rate when offered, never a loss).
- **Keyboard-only placement**: arrow keys move a cursor (first press on the selected machine), Enter places the next
  bin part or picks up / drops a machine, Tab cycles bin parts, R rotates, Delete / Backspace return to the bin,
  Esc drops → deselects → hides.

### Verification and boards
- Verifier gained `GET /daily` (today's UTC seed + verified board), `GET /replay?hash=` (stored actions of verified
  entries), `/health` with entry count, uptime and version; host / port / data-dir settings, request log, per-IP
  rate limit on submissions (429 + Retry-After), CORS origin, `X-Forwarded-For` behind a trusted proxy; single-file
  bundle (`npm run verifier:build`), `Dockerfile`, `server/README.md`. Stored replays are kept for each seed's top 100.
- Title screen: "Today's verified board" strip (top 5, empty state, offline notice), your own daily rank by replay
  hash, "Watch #N" for the best entry with a stored replay, "Player: …" name button.
- Results screen: one-time player-name prompt, verified rank after submitting ("#N of M … as <name>"), "Copy share
  text", clickable board entries that fetch, re-verify locally and play back a verified replay.
- Watched replays: REPLAY marker, the original run's per-round earnings beside the live total, Stop (Esc returns to
  the title). Playback never records bests, never saves, never submits (the save bug was caught by the e2e).
- Game build bakes `VERIFIER_URL` (default `http://127.0.0.1:4400`); `?verifier=` still overrides.

### Accessibility
- Reduced motion (belts static, no flashes / pops / travel, items snap; defaults to the OS preference) and text size
  100 / 115 / 130 % on the title screen, persisted; layouts that used fixed offsets now measure their text.
- Colour audit: WCAG AA on every text pair, colour-vision-deficiency simulation of materials and semantic colours,
  enforced by `tests/a11y.test.ts`. Palette nudges: red, plate, build label, dedicated cursor tint.

### Desktop
- `npm run desktop:pack` (unpacked app) and `npm run desktop:dist` (NSIS installer, per-user, unsigned); app icon
  rendered from SVG; packaged-app smoke test in `npm test`; `JD_DEV_API=1` exposes the test hooks in the packaged app.

### Tooling and quality
- `tools/balance.ts` (a machine's marginal value on identical offers), `tools/perf.ts` (frame-time budget in Chromium,
  throttled Chromium and the packaged app), `tools/a11y-audit.ts`, `tools/make-icon.mjs`.
- Fresh-clone fixes: build no longer depends on git-ignored folders; browser tests no longer hang when the browser
  path differs; `.gitattributes` pins LF; `.dev-build/` untracked.
- Test suite grew from 20 to 32 (sim, verifier, control room, a11y, share, gameplay e2e, desktop smoke).

## 0.1.0 — 2026-10-25 (cloud session, delivered as `junkyard-draft.bundle`)

- Deterministic simulation core (rules v1), seeded draft, replay codec and verification.
- Playable vertical slice: title / game / results scenes, procedural art, synthesized audio, six machines, sell from
  the bin, on-grid round badges, save/continue, local bests, replay export/import.
- Workshop Control Room: hook collector, SSE dashboard, self-test, live browser test.
- Local replay verifier with a verified-only board and results-screen submission.
- Autoplayer seed exploration; Electron shell scaffold (unverified at the time).
