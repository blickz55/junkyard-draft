# Code review brief — Junkyard Draft 0.2.0

Paste everything below the line into the reviewer. It is self-contained.

---

You are reviewing **Junkyard Draft**, a small but complete game project, at tag `v0.2.0` (branch `main`, commit `f3de10b`) in https://github.com/blickz55/junkyard-draft. Produce a rigorous, evidence-based code review with prioritized, concrete recommendations. Read the code; do not guess from the docs. Where you can run things, run them and report the real output. Where you cannot, say so plainly.

## What the project is

A 2D factory score-attack game: draft salvaged machines, place them on an 8×6 grid, run an 80-tick deterministic simulation, ship products for money, six rounds, one score. Competitive integrity rests on replays: a replay is a seed plus a list of rule-checked actions, and a verifier re-simulates it before any score is called verified.

Stack: TypeScript (strict), Phaser 3.90 for rendering, esbuild for dev server and production bundle (Vite was deliberately not used; do not recommend switching), `node:test` for tests, Playwright for browser end-to-end tests, Electron 45 + electron-builder for the desktop build, a dependency-free Node `http` service for the verifier, Node 24.

Layout:
- `game/src/sim/` — pure, browser-free simulation: `types.ts` (RULES_VERSION = 2), `rules.ts` (tuning, machine info, transforms), `sim.ts` (stepper), `run.ts` (draft, actions, validation, replay), `replay.ts` (file format, verification), `rng.ts` (mulberry32), `daily.ts` (UTC daily seed).
- `game/src/render/` — Phaser scenes (`scenes/TitleScene.ts`, `GameScene.ts`, `ResultsScene.ts`, `BootScene.ts`), `ui.ts`, `textures.ts` (procedural art), `audio.ts` (WebAudio synth), `storage.ts` (localStorage), `prefs.ts` (reduced motion, text size), `share.ts`, `verified.ts` (fetch + re-verify replays), `devapi.ts` (`window.__jd`, dev builds or `?dev=1` only).
- `server/verify.ts` — verifier: `POST /verify`, `GET /board`, `/daily`, `/replay`, `/health`; JSON file storage; per-IP rate limit; CORS; bundled by esbuild to `server/dist/verify.mjs`; `Dockerfile`.
- `control-room/` — a local development dashboard fed by Claude Code hooks (not shipped; lower priority for review).
- `desktop/` — Electron `main.cjs`, `preload.cjs`, icon; `JD_DEV_API=1` exposes the dev API in the packaged app.
- `tools/` — autoplayer, balance probe, perf probe, accessibility audit, icon renderer.
- `tests/` — sim, verifier, a11y, share, control-room, gameplay e2e, desktop smoke (32 tests).
- `docs/` — DESIGN.md (rules and decisions), ROADMAP.md, STATUS.md (verified results and next task), CONTINUE.md, CHANGELOG.md, baselines.

## How to set up and run (do this first)

```
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
node --import tsx tools/autoplay.ts --seeds 10 --tries 60
node --import tsx tools/a11y-audit.ts
```
`npm run dev:all` starts the game on http://127.0.0.1:5173 and the dashboard on :4310; `npm run verifier` starts the verifier on :4400. The desktop smoke test skips when no packaged build exists.

## Invariants the project claims — verify each, with file and line references

1. **Determinism.** The simulation uses no randomness, no wall-clock, no floating-point accumulation that could differ across machines; the draft is seeded by a string; identical seed + actions ⇒ identical score on any machine. Look for `Math.random`, `Date`, iteration over objects with environment-dependent order, and any render-side state leaking into `sim/`.
2. **Rendering never influences outcomes.** `GameScene` runs a visual `SimState` for animation but the authoritative result comes from `apply({ t: 'run' })` in `run.ts`. Check the two cannot diverge silently (there is a DEV-only mismatch log), and that pause, speed, skip and reduced motion cannot change scoring.
3. **Replay soundness.** `verifyReplay` must reject tampered actions, wrong claimed scores, unfinished runs, oversized replays, wrong rules versions, and malformed JSON, both on the client and in the verifier. Look for any path where a replay is trusted without re-simulation (results screen, title screen, verifier `/replay` playback, imported replays).
4. **Dev API has no authority.** `window.__jd` only exists in dev builds or with `?dev=1` (and in the packaged app only with `JD_DEV_API=1`). Check it cannot be reached in a normal production build and that nothing it exposes can forge a verified score.
5. **Rules versioning.** Any change to tuning requires bumping `RULES_VERSION`; saves, replays and the verifier reject other versions. Check every tuning constant actually lives behind that gate and nothing is duplicated elsewhere (UI strings, autoplayer, docs).
6. **Verifier safety.** Input validation and size limits on `/verify`, rate limit correctness (fixed window per IP, `X-Forwarded-For` only when `TRUST_PROXY=1`), CORS configuration, path and query handling, JSON file write atomicity and corruption risk, retention pruning, no secrets, bounded memory. Treat it as a service that will be exposed on the public internet.
7. **Desktop hardening.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, minimal preload, `setWindowOpenHandler`, file loading via `loadFile`, the `JD_DEV_API` gate. Check for anything that would widen the renderer's reach.
8. **Storage robustness.** All `localStorage` access is wrapped and degrades without storage; settings written by different modules do not clobber each other; saves from other rules versions are ignored.
9. **Accessibility claims.** Reduced motion really removes motion everywhere it matters; text size scales all text without overlaps at 130 %; WCAG contrast and colour-vision checks in `tests/a11y.test.ts` cover the colours actually drawn.
10. **Test honesty.** Tests assert real behaviour rather than restating the implementation; the e2e does not depend on fragile timing more than necessary; nothing is skipped silently except the documented desktop smoke test.

## Also review

- **Code structure.** `GameScene.ts` has grown large (input, keyboard cursor, rendering, side panel, summary, replay playback). Recommend a split only if it pays for itself; be specific about seams.
- **Error handling and user-facing failure states** (verifier offline, fetch failures, clipboard blocked, corrupt save).
- **Performance.** Per-frame allocations, text re-rendering, container churn in `update()`, item sprite management; the project measured 0 dropped frames, but point out what would break first under a long conveyor-heavy layout.
- **Type safety.** Places that cast through `unknown`, `Record<string, number>` where a union would do, private-field access from tests via bracket notation.
- **Docs vs code drift.** DESIGN.md, server/README.md and CLAUDE.md commands against what the code does.
- **Dependency and supply-chain hygiene.** Pinned versions, lockfile, what ships in the asar, what the Dockerfile copies.

## Output format

1. **Executive summary** (≤ 10 lines): overall quality, the three most important findings, whether you would ship 0.2.0 to friends as-is.
2. **Findings table**, most severe first. Columns: severity (Critical / High / Medium / Low / Nit), location (`path:line`), what is wrong, concrete failure scenario (inputs → wrong outcome), recommended fix (code sketch where it helps). Mark each finding **Confirmed** (you reproduced or read the exact code path) or **Plausible** (you could not confirm). Do not pad: a short list of real issues beats a long list of style notes.
3. **Invariant checklist**: the ten invariants above, each marked Holds / Violated / Could not verify, with one line of evidence.
4. **Architecture and maintainability recommendations**: at most five, each with the payoff and the cost.
5. **Test gaps**: what is untested that matters, as proposed test names with a one-line assertion each.
6. **Quick wins** (≤ 1 hour each) versus **larger work**, as two lists.
7. **What not to change**: anything you looked at that is unusual but correct and should be left alone, so the owner does not "fix" it.

Rules for the review: cite code, not docs; prefer precise language ("the loop allocates a new Set per frame at GameScene.ts:NNN") over adjectives; never invent files, functions or results; if a command fails or a test cannot run in your environment, report that rather than assuming an outcome; keep the whole review under about 2,500 words plus the table.
