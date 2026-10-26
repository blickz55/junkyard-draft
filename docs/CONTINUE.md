# Resume recipe (fresh session)

1. `cat docs/STATUS.md docs/ROADMAP.md` — take the "Next task" unless STATUS lists a blocker.
2. Start the tools: `npm run dev:all` (if `node_modules/` is missing on a normal machine, `npm install` first; in the sandbox recreate the symlinks listed in CLAUDE.md). Export `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the sandbox.
3. Tell the Control Room what you are doing: `node control-room/emit.mjs objective --task <id> --title "…" --criterion "…" --stage implement --agent main --next "…"` and `emit.mjs task --id <id> --stage <stage> --status active`.
4. Work the increment; run `npm run typecheck` and the relevant `node --test …` file; capture `node tools/playwright-shots.mjs <url> <name> --task <id>` and look at the PNG.
5. Record only real results: `emit.mjs check … --result pass|fail`, `emit.mjs build …`.
6. `git add -A && git commit` (trailer as in history) then `emit.mjs checkpoint --commit <sha> --summary "…" --task <id>`; move the task to `checkpoint/done`.
7. Update `docs/STATUS.md` (verified commands, known issues, next task) and tick ROADMAP items only when verified.

Persistence: the repo lives at https://github.com/blickz55/junkyard-draft (`origin`; branch `main`, tags `v0.2.0`…). Commit and push at the end of every increment. Fresh machine: `git clone https://github.com/blickz55/junkyard-draft.git && cd junkyard-draft && npm install && npx playwright install chromium && npm run dev:all`.

Scheduling: a recurring cloud continuation is possible now that the repo is on GitHub; it still needs the user's cadence and the GitHub repo connected in claude.ai. Then create one scheduled task whose prompt is: "clone the repo, read docs/STATUS.md and docs/ROADMAP.md, do the Next task, run npm run typecheck and the relevant tests, commit, update STATUS, push" — one worker at a time on main.

Hooks: `.claude/settings.json` registers `.claude/hooks/collect.mjs` for all supported events. Claude Code 2.1.x picks settings changes up automatically; if `/hooks` does not list them, restart the session once.
