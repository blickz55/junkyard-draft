# Resume recipe (fresh session)

1. `cat docs/STATUS.md docs/ROADMAP.md` — take the "Next task" unless STATUS lists a blocker. The versioned plan is `docs/PLAN-v2.md` for v0.5 (it binds the rules-identity, migration and rollback policies; v0.6 onward stays in `docs/PLAN-v1.md` until PLAN-v3) with `docs/DOSSIER-v1.md` as the design dossier behind it: when STATUS's next task is done or needs a human, take the next unfinished feature of the current milestone (features are numbered 0.5.1, 0.5.2 …; sizes S/M/L; ⚑ = needs a human, skip it).
2. Start the tools: `npm run dev:all` (primary machine: the Windows PC described in CLAUDE.md; `npm install` and `npx playwright install chromium` once). In the cloud sandbox recreate the symlinks listed in CLAUDE.md and export `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. After editing `scripts/esbuild-config.mjs`, restart the dev server.
3. Tell the Control Room what you are doing: `node control-room/emit.mjs objective --task <id> --title "…" --criterion "…" --stage implement --agent main --next "…"` and `emit.mjs task --id <id> --stage <stage> --status active`.
4. Work the increment; run `npm run typecheck` and the relevant `node --test …` file; capture `node tools/playwright-shots.mjs <url> <name> --task <id>` and look at the PNG.
5. Record only real results: `emit.mjs check … --result pass|fail`, `emit.mjs build …`.
6. `git add -A && git commit` (trailer as in history) then `emit.mjs checkpoint --commit <sha> --summary "…" --task <id>`; move the task to `checkpoint/done`.
7. Update `docs/STATUS.md` (verified commands, known issues, next task) and tick ROADMAP items only when verified.

Persistence: the repo lives at https://github.com/blickz55/junkyard-draft (`origin`; branch `main`, tags `v0.2.0`, `v0.4.0`). Commit and push at the end of every increment. Fresh machine: `git clone https://github.com/blickz55/junkyard-draft.git && cd junkyard-draft && npm install && npx playwright install chromium && npm run dev:all`.

Scheduling: a recurring cloud routine exists — **"Junkyard Draft continuation"** (https://claude.ai/code/routines/trig_01QMLRc1rQZrrJaLFEBUsHSH), weekdays at 10:00 UTC (6 am New York in summer time, 5 am in winter), model claude-sonnet-5-5, created 2026-10-25.

What each run does: clone main, read CLAUDE.md / STATUS / ROADMAP / this file, continue an open `routine/*` pull request if one exists (one worker at a time), otherwise take STATUS's "Next task" (skipping anything that needs a human or another machine), work on a branch `routine/YYYY-MM-DD-<slug>`, run typecheck and the full test suite (Playwright Chromium installed per run; the desktop smoke test skips without a packaged build), update STATUS with real results and a new "Next task", commit with the usual trailer, push the branch and open a pull request against main. It never pushes to main, never changes rules without a RULES_VERSION bump explained in the PR, and opens a draft PR instead of hiding a failure.

Owner's part: review and merge (or close) the routine's pull requests; keep "Next task" in STATUS pointing at work a cloud agent can do; pause or edit the routine at the link above. Manage routines at https://claude.ai/code/routines. Then create one scheduled task whose prompt is: "clone the repo, read docs/STATUS.md and docs/ROADMAP.md, do the Next task, run npm run typecheck and the relevant tests, commit, update STATUS, push" — one worker at a time on main.

Hooks: `.claude/settings.json` registers `.claude/hooks/collect.mjs` for all supported events. Claude Code 2.1.x picks settings changes up automatically; if `/hooks` does not list them, restart the session once.
