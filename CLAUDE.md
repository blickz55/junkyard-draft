# Junkyard Draft — project instructions

Two linked deliverables live in this repo:
1. **Junkyard Draft** — 2D factory score-attack game (TypeScript + Phaser 3.90 + esbuild). `game/`
2. **Workshop Control Room** — read-only live development dashboard fed by Claude Code hooks. `control-room/`, `.claude/hooks/`

Read `docs/STATUS.md` (what works, next task) and `docs/ROADMAP.md` (acceptance criteria) before changing anything. `docs/DESIGN.md` holds the rules; `docs/CONTINUE.md` is the resume recipe.

## Commands (verified)
- `npm run dev:all` — game dev server (http://127.0.0.1:5173) + Control Room (http://127.0.0.1:4310)
- `npm run dev` / `npm run control-room` — each alone
- `npm run typecheck` · `npm test` (node:test; sim + control-room + browser e2e; needs `PLAYWRIGHT_BROWSERS_PATH` if browsers are not in the default cache)
- `npm run verifier` (dev, tsx) · `npm run verifier:build` → `server/dist/verify.mjs` · `node server/dist/verify.mjs --host 0.0.0.0 --data-dir /data` (prod; see `server/README.md`, `Dockerfile`) · `VERIFIER_URL=https://… npm run build` bakes the default verifier into `dist/`
- `npm run build` — reproducible production bundle in `dist/` (served by the Control Room at `/verified/`)
- `npm run desktop` — Electron window over `dist/`; `npm run desktop:pack` — build + unpacked desktop app in `release/win-unpacked/` (electron-builder, config under package.json `build`); `npm run desktop:icon` — re-render the icon PNG from `desktop/build/icon.svg`; `npm run desktop:dist` — unpacked app + NSIS installer in `release/`; `npm run test:desktop` — packaged-app smoke test (also part of `npm test`, skipped when no build exists)
- `node tools/playwright-shots.mjs <url> <name> --task <id> --note "..."` — screenshot + register in the Control Room
- `node --import tsx tools/make-sfx.ts` — re-render the two impact samples (`game/public/sfx/*.wav`, deterministic)
- `node --import tsx tools/make-golden.ts` — regenerate the golden replay corpus under `tests/golden/` (only after a deliberate `RULES_VERSION` bump; `tests/golden.test.ts` re-simulates every file) · `node --import tsx tools/image-smoke.ts <verifier-url> [--expect-entries N]` — health + legal submission + board check against a running verifier (CI runs it against the Docker image) · `node --import tsx tools/mint-check.ts <verifier-url> [--date D] [--secret S]` — today's minted daily seed verified against yesterday's published commitment, and this week's weekly against the previous week's (PLAN-v3 0.6.1, PLAN-v4 0.7.5; CI runs it too)
- `node --import tsx tools/storage-measure.ts [--players 100,1000,10000] [--days 30] [--out …]` — board.json size and commit latency for synthetic boards at the retention caps, against the SQLite trigger (5 MB / 50 ms); baselines in `docs/baselines/0.6/storage*.json` (PLAN-v3 0.6.7); `--split` also moves closed days older than 30 to cold storage and reports the hot file (PLAN-v4 0.7.0, `docs/baselines/0.7/`)
- `npm run policy` — regenerate `game/public/policy.json` and `docs/POLICY.md` from the rules module and the verifier's constants (PLAN-v3 0.6.5; `npm run policy:check` exits 1 when stale, and `tests/policy.test.ts` fails the suite); rerun it after touching `rules.ts`, the verifier's limits or the identity/medal constants
- `node control-room/emit.mjs objective|task|check|screenshot|build|checkpoint|note|selftest …` — structured status updates
- `node --import tsx tools/autoplay.ts --seeds 20 --tries 120` — score distribution / exploit sweep; `node --import tsx tools/balance.ts --machine press --seeds 40 [--policy both] [--variants f.json] [--json docs/baselines/0.5/…] [--gate]` — one machine's marginal value on identical offers (paired per-seed deltas vs banned and tuning variants, greedy and neutral search, replay-verified action lists, executable gate; ~4 min); `node --import tsx tools/perf.ts` — frame-time budget at 4× in Chromium, throttled Chromium and the packaged app (dev server must be running; packaged app needs `npm run desktop:pack`); `node --import tsx tools/a11y-audit.ts [--sheet]` — WCAG contrast + colour-vision-deficiency audit of the palette (the same checks run in `npm test`; `--sheet` renders `docs/a11y/materials-cvd.png` from the live textures)

## Environment notes
- **Primary home (since 2026-10-25): the user's Windows 11 PC, `C:devjunkyard draft`** (Node 24, npm 11, git with autocrlf; `.gitattributes` forces LF). `npm install` works; Playwright's Chromium comes from `npx playwright install chromium` (default cache, no env var needed); Electron 45 is a devDependency and `npm run desktop` opens the built `dist/` (run `npm run build` first). `.claude/launch.json` has a `game` config (`npm run dev:all`, port 5173) and a `control-room` attach config (4310) for the desktop app's browser pane.
- Cloud sandbox (where the first session ran): the npm registry is unreachable, `node_modules/` is symlinked to preinstalled tools (esbuild 0.28, tsc 6.0, tsx, playwright 1.63 with Chromium at `/opt/pw-browsers`) and `vendor/phaser/` carries Phaser 3.90.0 with a default-export shim. On a normal machine the vendor copy is unused (tsconfig `paths` and node resolution prefer `node_modules/phaser`). The browser tests only set `PLAYWRIGHT_BROWSERS_PATH` when `/opt/pw-browsers` exists.
- `scripts/dev.mjs` and `scripts/build.mjs` use esbuild directly (Vite was not installable in the sandbox). Keep both scripts working; do not add a second build path. `.dev-build/` and `dist/` are build output and stay out of Git. After editing `scripts/esbuild-config.mjs` (defines such as `import.meta.env.VERIFIER_URL`) restart the dev server: a running watcher keeps the define map it started with.

## Rules of the road
- Simulation (`game/src/sim/`) is pure, deterministic and browser-free. Rendering never influences outcomes. Bump `RULES_VERSION` when any rule or tuning value changes and keep replay verification tests green. Scenario namespaces (`tutorial-*`) are part of the rules: a change to what a reserved seed does is a rules change too (review F13). The golden corpus in `tests/golden/` pins existing replays; it is regenerated only together with a version bump.
- Scores are local and unverified until a server re-simulates replays. Never label local bests as verified; never invent competitors.
- Dev-only hooks (`window.__jd`) exist for automated play. They apply rule-checked actions and carry no scoring authority.
- Every meaningful increment: implement → `npm test`/typecheck → launch and exercise in Chromium → look at the screenshot → commit → `emit.mjs checkpoint` → update `docs/STATUS.md`.
- Keep Control Room instrumentation alive: emit `objective` when the goal changes, `task` on stage changes, `check` only from actual results, `screenshot` for captures, `checkpoint` on commits. Raw telemetry (`.control-room/events.jsonl`, screenshots, reports) stays out of Git.
- Never fabricate test results or screenshot observations. If a check cannot run, say so in STATUS.
- Commit messages end with the Co-Authored-By / Claude-Session trailer used in the existing history.
