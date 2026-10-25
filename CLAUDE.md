# Junkyard Draft — project instructions

Two linked deliverables live in this repo:
1. **Junkyard Draft** — 2D factory score-attack game (TypeScript + Phaser 3.90 + esbuild). `game/`
2. **Workshop Control Room** — read-only live development dashboard fed by Claude Code hooks. `control-room/`, `.claude/hooks/`

Read `docs/STATUS.md` (what works, next task) and `docs/ROADMAP.md` (acceptance criteria) before changing anything. `docs/DESIGN.md` holds the rules; `docs/CONTINUE.md` is the resume recipe.

## Commands (verified)
- `npm run dev:all` — game dev server (http://127.0.0.1:5173) + Control Room (http://127.0.0.1:4310)
- `npm run dev` / `npm run control-room` — each alone
- `npm run typecheck` · `npm test` (node:test; sim + control-room + browser e2e; needs `PLAYWRIGHT_BROWSERS_PATH` if browsers are not in the default cache)
- `npm run build` — reproducible production bundle in `dist/` (served by the Control Room at `/verified/`)
- `node tools/playwright-shots.mjs <url> <name> --task <id> --note "..."` — screenshot + register in the Control Room
- `node control-room/emit.mjs objective|task|check|screenshot|build|checkpoint|note|selftest …` — structured status updates
- `node --import tsx tools/autoplay.ts --seeds 20 --tries 120` — score distribution / exploit sweep; `node --import tsx tools/balance.ts --seeds 40` — one machine's marginal value on identical offers (baseline vs banned vs tuning variants; ~4 min)

## Environment notes
- **Primary home (since 2026-10-25): the user's Windows 11 PC, `C:devjunkyard draft`** (Node 24, npm 11, git with autocrlf; `.gitattributes` forces LF). `npm install` works; Playwright's Chromium comes from `npx playwright install chromium` (default cache, no env var needed); Electron 45 is a devDependency and `npm run desktop` opens the built `dist/` (run `npm run build` first). `.claude/launch.json` has a `game` config (`npm run dev:all`, port 5173) and a `control-room` attach config (4310) for the desktop app's browser pane.
- Cloud sandbox (where the first session ran): the npm registry is unreachable, `node_modules/` is symlinked to preinstalled tools (esbuild 0.28, tsc 6.0, tsx, playwright 1.63 with Chromium at `/opt/pw-browsers`) and `vendor/phaser/` carries Phaser 3.90.0 with a default-export shim. On a normal machine the vendor copy is unused (tsconfig `paths` and node resolution prefer `node_modules/phaser`). The browser tests only set `PLAYWRIGHT_BROWSERS_PATH` when `/opt/pw-browsers` exists.
- `scripts/dev.mjs` and `scripts/build.mjs` use esbuild directly (Vite was not installable in the sandbox). Keep both scripts working; do not add a second build path. `.dev-build/` and `dist/` are build output and stay out of Git.

## Rules of the road
- Simulation (`game/src/sim/`) is pure, deterministic and browser-free. Rendering never influences outcomes. Bump `RULES_VERSION` when any rule or tuning value changes and keep replay verification tests green.
- Scores are local and unverified until a server re-simulates replays. Never label local bests as verified; never invent competitors.
- Dev-only hooks (`window.__jd`) exist for automated play. They apply rule-checked actions and carry no scoring authority.
- Every meaningful increment: implement → `npm test`/typecheck → launch and exercise in Chromium → look at the screenshot → commit → `emit.mjs checkpoint` → update `docs/STATUS.md`.
- Keep Control Room instrumentation alive: emit `objective` when the goal changes, `task` on stage changes, `check` only from actual results, `screenshot` for captures, `checkpoint` on commits. Raw telemetry (`.control-room/events.jsonl`, screenshots, reports) stays out of Git.
- Never fabricate test results or screenshot observations. If a check cannot run, say so in STATUS.
- Commit messages end with the Co-Authored-By / Claude-Session trailer used in the existing history.
