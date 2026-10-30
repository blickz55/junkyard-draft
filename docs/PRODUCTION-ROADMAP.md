# Production roadmap — from 0.7.0 to a 1.0 anyone can play

*Written 2026-10-30 against commit `091a60d` (main, version 0.7.0, rules version 3, verifier protocol 2). This is the plan of record from here to 1.0. It supersedes `docs/PLAN-v5.md` (v0.8 as planned before the owner interview) and the v0.8–v1.0 sections of `docs/PLAN-v1.md`; the policies of PLAN-v2/v3/v4 still bind except where §4 says otherwise. It rests on two inputs made the same day: a five-part evaluation of the whole project (engineering, product, operations, premium comparables, daily/web comparables; digest in §2, full reports under `docs/reviews/2026-10-30-eval/`) and a four-round interview with the owner (§1). Sizes: S = one routine run and one PR, M = 2–4, L = 5+ or needs a human; ⚑ = needs a human; R = the nightly routine or a Claude session can do it unattended; H = the owner. Every increment has an acceptance line a test, a measurement or a recorded human observation can check.*

## 0. The one-page version

**What Junkyard Draft becomes at 1.0: the working man's daily factory.** A free web game, open on a phone at lunch or a laptop at night, that anyone can understand in one run: today's yard, six short rounds, draft a machine, put it down, watch the line pay out, see where you landed among everyone who played today. The same seed for everyone, every score checked by re-running the replay on the server, nothing hidden inside the run. Around that six-minute core sits a social layer that is the game's real depth: a thread for every day, reactions and comments on anyone's run, friends and groups, direct messages, a community hub, a foreman who talks to you in plain words, divisions at the day's close so a mid-table player still wins something, cosmetics and trophies you earn and never buy. Monetisation comes later and never touches the daily: a supporter tier, a paid desktop edition, tips.

**Where we are.** 0.7.0 is an unusually solid pre-MVP: a pure deterministic simulation with a golden corpus, a zero-dependency verifier that re-simulates every submission, identity without passwords, daily and weekly seeds with commitments, groups, challenge links, replays, clips, share cards, moderation, 149 green tests, strict TypeScript, measured decisions. It has never been hosted and no human outside the author has played it. Its look reads as a very good prototype. Its depth is thin by design and will stay thin by decision (§1): the social layer carries the long game. Two P0 security holes exist today (a `?verifier=` link can steal a player's identity; one report hides any name instantly). The verifier re-simulates inline on the event loop and publishes nothing from CI.

**The five bets, in the order they pay off.**
1. **Host it and let people in (v0.8, November).** Everything verified so far was verified against localhost. The P0 security, privacy and operations items are the gate, then ten human playtests.
2. **Make it understandable by anyone (v0.9, December–January).** Plain-language strings through one table, the foreman, a results card that leads with percentile and personal best, onboarding that is seen, the bottleneck explained after every round.
3. **Put it on phones (v0.10, January–February).** A responsive portrait layout, touch, an installable web app, push for the daily. Safari and Firefox determinism proven first.
4. **Let people say something (v0.11, March–April).** Reactions, the daily thread, comments, friends, an inbox, direct messages and a community hub, behind a moderation pipeline (filter, AI triage, the owner reviews) and an optional email link for durable identity. Divisions at freeze, trophies and cosmetics.
5. **Finish it (v0.12 → 1.0, May–July).** Commissioned art and adaptive music, the foreman's face, share surfaces and a trailer, accessibility completion, verifier operations completion, an open beta, a content freeze and the exit criteria.

**Calendar.** Nine months at 10–15 owner hours a week plus the nightly routine: v0.8 ships by end of November 2026, v0.9 mid-January, v0.10 end of February, v0.11 end of April, v0.12 mid-June, 1.0 in July 2027. A six-month cut line is drawn in §7.

**Money.** Of the $2,000–10,000 available: art $3,000–4,500, music $1,200–2,500, everything else (domain, VPS, backups, email, AI triage, legal templates) under $40 a month. Steam fee and code signing wait for the desktop edition after 1.0.

## 1. Decisions from the owner interview (2026-10-30)

| Question | Decision | What it changes |
|---|---|---|
| Commercial shape at 1.0 | **Free web game, monetised later.** Supporter tier, paid Steam/desktop edition and tips are all acceptable later; ads are not. | Steam leaves the 1.0 window (PLAN-v1 1.0.1–1.0.3 and PLAN-v5 0.8.10 move to "after 1.0"). No signing, no Next Fest before 1.0. The web build is the product, not the demo. |
| Timeline and effort | **6–9 months, nights and weekends** (≈ 10–15 h/week plus the nightly routine). | Five milestones of 5–8 weeks; human items are the critical path, not code. |
| Budget | **$2,000–10,000**, spent on **art + adaptive music**. | Commission briefs in v0.9, delivery in v0.11, integration in v0.12 (§6). |
| First audience | **The daily-puzzle crowd.** | Wordle/Connections/Mini Motorways habits: short sessions, a share grid, forgiving streaks, friends' groups. Factory enthusiasts are welcome, not targeted. |
| Depth systems (contracts, weekly modifier rulesets, authored campaign, machines on a cadence) | **None of them.** "Understandable by the common man, by the working man"; depth comes from layering social features. | No new mechanics before 1.0. The only rules work allowed is a tuning pass against dead rounds (0.9.6) with a go/no-go gate. The content-volume gap the comparables research found (§2) is accepted as a known risk and answered socially, not mechanically. |
| Progression | **Earned cosmetics + mastery trophies.** Nothing gameplay-affecting. | Cosmetics and trophies become server-known so others see them (0.11.11–0.11.12). |
| Competition formats | **Divisions at freeze.** (Weekly ladders, friends leagues and live races were not chosen.) | Trackmania Cup-of-the-Day's division idea, asynchronous (0.11.11). The weekly seed keeps its board and gains nothing else. No live relay before 1.0. |
| Social surfaces | **All four: daily discussion thread, comments + reactions on runs, direct messages, forum / community hub.** | Overturns PLAN-v1's "no free text, ever" and DOSSIER §5's reactions-only stance. Free text ships only behind the moderation pipeline (0.11.2) and arrives in population order (0.11.3 → 0.11.10). |
| Moderation | **Filter + AI triage + the owner reviews**, with trusted community moderators later. Every action logged and appealable. | A classifier in the verifier, a queue UI, an SLA of 72 hours, transparency counts on the policy page (0.11.2). |
| Identity | **Device token + optional email link (magic link).** Playing never needs an account; posting, messaging and cross-device sync do. No passwords. | Overturns "no email collection on the web build" (PLAN-v1 0.9.5, DOSSIER §6). Email hash stored, privacy notice updated, a transactional email provider added (0.11.1). |
| "Seen feedback" | **Seen-by counts on your run, notifications, a friends activity feed.** (A full public profile was not chosen; a minimal author card is implied by comments and the hub.) | 0.11.4, 0.11.7, 0.11.8, 0.11.13. |
| Simplicity | **Plain-language everything.** (Quick daily, guided first week and hiding advanced options were not chosen.) | A glossary and a jargon lint on the string table (0.9.0). The full daily stays the only official mode. |
| Platforms in the 1.0 window | **Phone-friendly web (touch, portrait) + installable web app (PWA).** Steam/desktop and native stores after 1.0. | v0.10 is the phone milestone; the fixed 1120×700 canvas goes. |
| Tone | **A foreman character.** | Text first (0.9.1), face and lines with the art commission (0.12.2). The foreman opens every daily thread. |

## 2. Where we are: the evaluation digest

The five reports total about 60,000 words; the full texts are in `docs/reviews/2026-10-30-eval/` (`engineering.md`, `product.md`, `ops.md`, `market-premium.md`, `market-daily.md`). Numbers below are theirs; every one was measured or sourced, none estimated by this document.

### 2.1 Measured state at `091a60d`
- `npm run typecheck` passes; `npm test` 149/149 in 74 s wall (game e2e 73 s, render e2e 53 s dominate); `npm audit` 0 vulnerabilities, 7 devDependencies, no runtime dependencies.
- `dist/main.js` 1,416,768 B raw, 397,781 B gzip; Phaser is 85.8 % of it, own code 200 KB.
- Source: `game/src` 5,623 lines (sim 1,021, render 2,987, ui 1,343), `server` 1,326, `tests` 4,430, `tools` 1,802. Zero `as any`, zero suppressions, zero TODOs; 55 `catch` sites in the client of which about 40 swallow to a fallback; 310 lines over 200 characters; no ESLint, Prettier or coverage.
- GitHub: the latest `ci` and `perf` runs on main are green (STATUS said unverified; the ops report checked the API). The `v0.7.0` tag run failed, so no desktop artefact exists; CI pushes no image and publishes no release.

### 2.2 What is genuinely strong (protect it)
1. The pure, deterministic simulation with versioned rules, a golden corpus and a policy test; replays verify byte-for-byte on client and server; "no item is ever lost or duplicated" is pinned by a test.
2. The trust model: scores are never trusted from a client; the verifier re-simulates; the client re-verifies fetched replays before playback; reveal gate, keep-best, late-but-unranked and freeze are each pinned with fake clocks. No comparable in either market report verifies scores server-side; Zachtronics and Mini Metro moved to histograms precisely because top lists invite cheating. **This is the headline of the pitch.**
3. Verifier invariants under failure: atomic commits, 503-with-nothing-recorded, damaged file loads empty, bounded bodies, limits, limiter keys, seeds and replays.
4. Type discipline and runtime validators on every untrusted boundary.
5. Measured decisions: storage trigger with real numbers, balance and reroll studies with paired deltas, the WCAG + colour-vision audit in `npm test`, perf presets, a rehearsed rollback.
6. The two seams that make the UI testable and accessible: `RoundController` and the DOM overlay (`ui/dom.ts`).
7. The privacy posture: opt-in telemetry with a fixed vocabulary, salted daily IP hashes in events, token never logged, `DELETE /me`.

### 2.3 The gaps, by area (P0 blocks a public beta, P1 blocks 1.0)

**Security and privacy (ops report §4, §6).**
- P0 `?verifier=` is honoured in production builds in five places and `bearerAllowed` accepts any https origin; the title fetches `/identity` with the bearer on load; `challengeLink` propagates the parameter. One link steals the only secret a player has.
- P0 No Content-Security-Policy on the page or the Electron window while the token lives in `localStorage`.
- P0 Report-to-hide griefing: the first report hides a name instantly; identities are free; the planned 72-hour expiry is not implemented.
- P0 Raw client IPs and `?group=<code>` in the request log; 500s swallow the exception.
- P0 `X-Forwarded-For` takes the client-supplied first hop; `CORS_ORIGIN=*` by default.
- P1 Unbounded unauthenticated writes: `GET /daily?date=` mints any past date with a full-board commit; `POST /identity` has no per-IP limit and `players` is never capped; GETs are unlimited and each `/board` read sorts the whole board.
- P0 No privacy notice, no terms; `DELETE /me` exists server-side but no client UI calls it; cold replays survive deletion; IP-hash retention is 30 days in code and 7 in the plans; the appeal contact is a placeholder; the public repository has no LICENSE, no README and a copyright line with no holder.
- P0 No backups, no restore drill; `DAILY_SECRET` loss breaks the commitment chain once and a leak lets someone pre-play tomorrow undetected.

**Reliability and operations (engineering §7–8, ops §2–5).**
- P1 Each submission re-simulates three times inline on the event loop (`verify()`, `finalMachinesOf`, `roundsOf`); only the bot par runs in a worker.
- P1 No `headersTimeout`/`requestTimeout`, no SIGTERM drain, plain-text logs without request ids, `/health` does not report hot-file bytes or commit latency (the SQLite trigger's own inputs), no metrics, no uptime check, no alerting, no client error capture, no production source maps.
- P1 Capacity: hot file ≈ players × 30 × 310 B; crosses the 5 MB trigger at about 550 daily players; 1,000 players → 13.75 MB and 29–36 ms per synchronous commit on a 9950X3D (a 2-vCPU VPS is plausibly 2–4× slower); 10,000 players also hit the 1,000-entries-per-seed cap. SQLite (PLAN-v4 0.7.0b) is the scheduled answer; nothing here needs 100k.
- P1 CI publishes nothing: the image is built and smoke-tested, never pushed; the desktop job runs `desktop:pack`, never `desktop:dist`; no GitHub Release; perf gate unarmed; no Dependabot; no `concurrency:` groups; Chromium re-downloaded every run.

**Engineering quality (engineering §1–5).**
- P1 `GameScene.ts` is a 718-line god object (30 imports, 15 key bindings, tutorial copy, stall, pops, telemetry). Every input, strings and accessibility item lands in it.
- P1 Two monolithic single-`test()` e2e files (633 and 523 lines) with 62 fixed sleeps and fixed ports; CI was red 24 of 24 runs until two fixes and twice more on timing; no coverage measurement; `ui/*` (1,343 lines), `clip.ts` and the desktop IPC negatives are untested outside e2e.
- P1 Silent storage failure: quota errors are swallowed, onboarding is assumed done when storage fails, the device token can be lost silently with no message anywhere.
- P1 Developer copy shipped to players: "npm run verifier", "Submit to local verifier", "Verifier unreachable at …"; the results screen's board panel is an empty hole offline; nothing queues a submission for later.
- P2 Presentation strings live in `sim/` (`MACHINE_INFO`, tips, advice) and ship in the verifier bundle; 259 prose literals in the UI; no `Intl` anywhere; dates formatted by hand.
- P2 Electron: no CSP, no permission handler, unsigned, no auto-update, no crash reporter (all post-1.0 now that desktop is post-1.0, except CSP).

**Product (product report §2–7).**
- Depth: with 7 draftable kinds and one dominant line (crusher → furnace → tuner), a naive 7-machine run plateaued at $444–446 from round 3; three of six rounds were dead; the greedy bot's `flatRoundsTotal` is 29 of 120 (24 % of rounds change nothing); the seed moves the ceiling by ±40 % (min $1,138, median $1,748, max $2,470). A player has the whole strategy in about ten runs. **Accepted by decision; answered socially and by one tuning pass.**
- Look: an 80 %-empty 8×6 grid scaled up from 1120×700, programmer-art tiles, text-only grey buttons, no logo, no music, a static 1× run; 13 identical buttons on the results row; share card and clip inherit the empty frame. Coherent, legible, accessible, and not something people screenshot.
- Onboarding: the content of the hints is good; the channel is a two-line strip under the parts bin; refusals vanish in two seconds; the round-3 tutorial step is a 60-word paragraph; orientation (the whole puzzle) is signalled by a small arrow; nothing explains the hopper's 40-items-per-round cap or why rounds 4–6 did nothing.
- No profile or stats page, no cosmetics, no modes, no music, no touch, no localisation, no friends beyond a group code, no notification loop. No human has ever playtested (`docs/PLAYTEST.md` does not exist).

**Market (both market reports).**
- Junkyard Draft's verified histogram daily is ahead of the whole field; lead with it.
- Content volume is the gap that the comparables' store pages sell ("150 Jokers", "34 cities"); "limited content" is the top criticism of Cobalt Core and Dicey Dungeons. With depth systems declined, the countable things at 1.0 are days, divisions, trophies, cosmetics and community.
- The daily format's engine is one shared object per day plus a spoiler-free way to talk about it (Wordle: 90 → 300,000 players in two months on an emoji grid that did not even link back). The share grid must carry the "beat this" link.
- Lead the result card with percentile, par delta and personal best, not rank (Puzzmo's own reviewer on the "bottom 20 %"; Spelunky's top-8 churn measures luck).
- First attempt counts, later attempts are practice (Mini Motorways, Spelunky, Dead Cells). Replays attached to entries are the anti-cheat that also entertains (NecroDancer's boards lived; Slay the Spire's died).
- Groups by code are the only league at 10–300 daily players; random cohorts cannot fill and demotion zones are the most-cited league complaint. Divisions at freeze transplant Cup of the Day's "everyone has a bracket" without live servers.
- Monetise social and archive, never the daily; observed prices cluster at $3.99/month or $39.99/year (Puzzmo, NYT Games), $5/month (Trainwreck Club), $9.99/year (Squaredle); realistic conversion 1–3 % of day-30-retained players; at 300 DAU that is $20–40 a month, a signal not an income.
- Skip ads and portals: Poki blocks external requests by default and forbids email login; TETR.IO needed 600–750k impressions a day for ads to matter.
- Web is the demo, Steam is the collector's edition (shapez: 100–200k web MAU still drive 2,500–3,000 Steam sales a month). Open a Steam page when the desktop edition is decided; never tag the game "Puzzle".
- Announce a cadence and keep it: "abandoned" becomes the top review theme within 18 months for Loop Hero, Backpack Hero and Cobalt Core.
- Retention targets for a daily game (vendor medians, estimates): D1 ≥ 30 %, D7 ≥ 12 %, D30 ≥ 5 %, daily completion ≥ 60 %, share rate ≥ 15 % of completions.

## 3. The product at 1.0

### 3.1 A day in the life
A player opens `junkyarddraft.com` (or taps the icon on their phone's home screen). The foreman says what day it is and that the yard is open; the strip shows how many people have run it so far and the median. They play: six rounds, five to eight minutes, tap to place, tap to rotate, watch the line. After each round one plain sentence says what held the line back and what would fix it. At the end the card says "Better than 61 % of 412 runs today. $1,610. Par $1,480. Your best this month: $1,720. Division: Foundry 3, 2nd of 32." One tap shares the spoiler-free grid with a "beat this" link. The daily thread opens for them now: the foreman's post, forty comments, three replays pinned by reactions. They react to a friend's run, read a reply to yesterday's comment, see that two friends beat their challenge, and leave. Tomorrow a push notification (if they asked for one) says the yard is open.

### 3.2 The three first-ten-minute experiences, re-cut for the working man
A first-time player must (1) put a crusher behind the hopper and see scrap turn into shards with a sound, a flash and the foreman saying so, inside the first minute, with the flow arrow showing why the orientation worked; (2) finish a first run in under three minutes and see money tick; (3) see their bar on the histogram beside real people with a sentence in plain words, never an empty top ten and never a word they do not know. A returning player must (1) see a new day and an open yard the moment the page loads; (2) see what their friends did and what people said; (3) leave with something to post.

### 3.3 The social layer, in population order
Surfaces arrive in the order they work at ten players, not the order they impress:
1. **Reactions** on any run (eight emotes, counts only): works at ten players, nothing to moderate.
2. **Seen-by counts**: "watched 14 times by 9 players". Works at ten.
3. **The daily thread** with the foreman's opening and closing posts, readable after you submit or the day closes. The foreman guarantees it is never empty.
4. **Comments on runs**, the same component on a replay.
5. **Inbox and notifications**: replies, reactions (batched), beaten challenges, division results, moderation outcomes; push and a weekly email digest, both opt-in.
6. **Friends** (requests from groups, challenge links and comments), a friends view on the histogram, an activity feed.
7. **Direct messages** between friends.
8. **The community hub**: four categories as web pages and an in-game panel; threads embed verified runs by hash. Hub v1 opens with the pinned categories; user-created threads, search and author pages switch on at 50 weekly posters so the hub never looks dead.

Everything free-text goes through one pipeline (0.11.2). Reactions and seen-by need no account; writing needs a linked email.

### 3.4 Divisions, trophies, cosmetics
At freeze every day's verified players are bucketed by score into divisions of 16–64 (named after yard areas: Scrapline, Foundry, Pressroom, Dockside…; the top division is small, the rest even). Each division has a mini-board and a medal; medals and division placements accumulate into trophies that never decay; trophies and days played unlock cosmetics (yard themes, machine skins, a title badge next to the name) that others see on boards, in replays and in the hub. A line on the results card and the policy page states that none of it changes offers or scoring.

### 3.5 What 1.0 is not
No new machines, materials, grids, modifiers or campaign. No Steam, no installer, no native store apps. No ads. No live races or rooms. No leagues with demotion. No streak loss or urgency copy. No paid anything inside the daily. No real names, no birthdates, no passwords. No free text anywhere that the pipeline does not see.

## 4. Policies

Kept from PLAN-v2/v3/v4 and CLAUDE.md: the simulation stays pure and deterministic; every rule or tuning change bumps `RULES_VERSION` with a golden regeneration; a scenario namespace change is a rules change; scores are local and unverified until the server re-simulates; identical seeds give identical offers to everyone; nothing earned touches offers, weights, costs or targets; no dark patterns (the "Do not do" list of PLAN-v1 stands except where §1 overturns it); everything keyed by player id; one name filter for every user-written field, with the test that counts its call sites; reveal-gate consistency; the storage trigger (5 MB / 50 ms) decides SQLite for the board.

New or changed:
1. **Plain language is a build rule.** Every player-facing string lives in one table (0.9.0). A glossary (Appendix B) maps internal words to player words; a lint fails the suite when a banned word appears in the table or in a `sim/` presentation string. New strings are written for a reader with no gaming vocabulary; the foreman's voice is the house style.
2. **Free text exists, so moderation has an SLA.** No free-text surface ships before 0.11.2. Every post passes the filter at write time and the triage classifier asynchronously; anything hidden or removed carries a reason code the author sees and can appeal; the policy page publishes monthly counts (posts, hidden, removed, appeals, upheld). Target: queue items reviewed within 72 hours; during the owner's absence the classifier's auto-hide threshold tightens.
3. **Identity has two levels.** Level 0 (device token) plays, reacts, is counted. Level 1 (linked email) writes, messages, syncs and can be banned durably. Email hashes, not addresses, are stored with the player; the address lives only in the provider's logs and in our outbound queue for the minutes a link is valid. Playing never requires level 1.
4. **Mobile is a first-class target.** Every screen is designed at 390×844 portrait first and 1920×1080 second; the e2e viewport matrix (0.10.0) is a gate; perf preset D is in CI.
5. **Progression never touches play, and says so on screen.** Cosmetics, trophies and divisions are labels over verified entries. The results card and the policy page carry the sentence.
6. **One runtime dependency at a time, by decision.** The verifier and the client have none; `web-push` (0.10.4) is the first allowed, recorded in `server/README.md` with the reason. `node:sqlite` (built into Node 24) is preferred over a package.
7. **Budgets.** Perf gate armed in CI (0.8.4); `main.js` ≤ 300 KiB gzip after 0.10.2 (down from 388); first interactive on a 4G phone ≤ 4 s; verifier `/health` p95 < 100 ms under a 60-submissions-a-minute flood (0.8.2).
8. **Protocol discipline.** The verifier protocol stays 2 through v0.10; v0.11 bumps it to 3 (additive: community endpoints, reason codes, cosmetics, divisions). Old clients keep working; new fields are optional.
9. **Evidence as before.** Each increment lands with tests, a screenshot looked at, a STATUS block with real numbers, and never a fabricated result. Human items record who, when and what was observed.
10. **The content-volume risk is owned.** §1 declines depth systems. Each milestone's STATUS block records the autoplay `flatRoundsTotal`, the median human score band from the live histogram and the D7 retention, so the owner can revisit the decision with numbers rather than opinion.

## 5. The plan

Dependencies in brackets. "Accept" is the acceptance line.

### v0.8 — Real (weeks 1–5, by end of November 2026)
*Theme: host it safely, publish from CI, let ten people play. Rules version 3 unchanged; protocol 2 unchanged.*

**0.8.0 Client hardening** — S, R. The `?verifier=` override is honoured only in dev builds and on loopback origins; `challengeLink` stops propagating it; a CSP `<meta>` in `game/index.html` and the Electron window (`default-src 'self'; connect-src 'self' <verifier origin>; img-src 'self' data: blob:; media-src blob:`); a storage-failure banner ("Progress will not be saved on this device") from the `storage.ts` write path; `isOnboarded()` no longer returns true on failure; a global `error`/`unhandledrejection` handler that keeps the last ten errors with `build.json`'s commit in `localStorage` for a "copy diagnostics" button in settings. *Accept:* a production build opened with `?verifier=https://evil.invalid` sends no request there (e2e asserts the request log); CSP present in both; a forced `QuotaExceededError` shows the banner and the run still plays.

**0.8.1 Verifier hardening, first cut** — M, R. `TRUST_PROXY` takes the rightmost `X-Forwarded-For` hop (or `X-Real-IP`); per-IP limiters on `POST /identity`, `/groups*`, `/report` and a read limiter on GETs; `/daily?date=` and `/weekly?week=` bounded to the service's first issued day; a `players` cap with eviction of identities that never submitted; request log with a daily-salted IP hash and `group=` stripped; the exception logged on every 500; `headersTimeout`/`requestTimeout`; a SIGTERM drain (`server.close()`, announcer idle); JSON log lines with a request id; `/health` adds hot-file bytes, last commit ms, par queue depth, limiter cardinality; report-to-hide becomes: hide when two distinct reporters who each hold a verified entry older than seven days agree, or on moderator action, and any hide auto-expires after 72 hours unless a moderator confirms; `deletePlayer` also removes cold replays; events IP-hash retention set to 7 days to match the policy. *Accept:* a test per item in `tests/verifier.test.ts`; `tools/image-smoke.ts` asserts the log carries no raw IP and no `group=`; the policy regenerates (`npm run policy`).

**0.8.2 Re-simulation in a worker, single pass** — M, R [0.8.1]. One worker call returns `{score, finalMachines, rounds}` from one re-simulation (today three inline); a wall-clock cap per job and a small queue reusing the par service's pattern; a per-seed sorted index so `rank()` and `prune()` stop sorting the whole board; reason codes beside `error` on every refusal (additive). *Accept:* `tools/load.ts` (new) floods `/verify` at 60/min from three simulated IPs for two minutes while `/health` p95 stays under 100 ms on the dev PC; a 4,000-action replay verifies in a recorded time; every existing verifier test passes unchanged.

**0.8.3 Backups and the restore drill** — S, R + ⚑ for the off-box target. `tools/backup.ts` tars `DATA_DIR` (board, cold, `moderation.jsonl`, events, never the secret) to an off-box target through `rclone`/`rsync`; `tools/restore-drill.ts` restores to a temporary directory, starts the verifier there and compares `/health` counts and a sample of replays; a nightly cron on the VPS; the secret stored offline by the owner. *Accept:* the drill passes in CI against a fixture and once on the VPS, recorded in STATUS.

**0.8.4 Release pipeline** — S, R. On tags: push the image to GHCR, build the NSIS installer with `desktop:dist` and attach it to a GitHub Release with the SHA-256 of `dist/`; `concurrency:` groups; Playwright browser cache; Dependabot for npm and actions; `npm audit` step; `engines`, `license`, `repository` in `package.json`; the perf CI baseline committed (⚑ one download) so the gate is armed. *Accept:* a tag produces a Release with the installer and an image tag; a 30 % injected script-time regression fails `perf.yml`.

**0.8.5 Deploy** — M, H ⚑ with R preparing everything. `deploy/`: a Caddyfile (TLS, HSTS, the verifier on a subdomain, container port bound to localhost), `docker-compose.yml` (image from GHCR, named volume, env from a file, log rotation), `_headers` for Cloudflare Pages (cache-busted `main.js` with a content hash from `scripts/build.mjs`, CSP as a header too), `.github/workflows/deploy.yml` (build the web with `VERIFIER_URL` baked and publish to Pages on main; pull-and-restart the verifier over SSH on a tag). The owner registers the domain (`junkyarddraft.com` was free on 2026-10-29), stands up a Hetzner CX23-class VPS, provisions `DAILY_SECRET`, `MODERATION_TOKEN`, `CORS_ORIGIN`, `TRUST_PROXY`. *Accept:* `tools/image-smoke.ts`, `tools/mint-check.ts` and the game e2e's daily submission pass against the hosted URL, recorded in STATUS with the date (this closes ROADMAP 0.4.7/0.6.8/0.7.8 ⚑).

**0.8.6 Legal minimum** — S code, H ⚑ text. Privacy notice (controller and contact, what is stored, purposes, lawful bases, retention incl. logs, recipients incl. Discord and the hosting provider, rights, complaint route), terms (name rules, moderation and void powers, no uptime promise, the scope of "checked"), community guidelines v0; a real `APPEAL_CONTACT` on the domain; `LICENSE` (the owner decides: all-rights-reserved with source published for transparency, or MIT for the engine with name and art reserved) and a root `README.md` for players and contributors; the copyright holder's name; in-game "Delete my data" (calls `DELETE /me`) and "Download my data" (`GET /me/export`, new); links from title, results and the consent toggle. *Accept:* every page reachable from the game; deletion removes hot and cold replays and the name, verified by test; `npm run policy` clean.

**0.8.7 Player-facing copy and the offline state** — S, R. All developer copy gone ("npm run verifier" and friends); the results board panel shows this device's history for the seed when the verifier is away; a pending submission is stored and sent on the next title load, with the result shown then; the 13 results buttons grouped into Play / Share / Watch with one primary. *Accept:* e2e offline scenario: run, see the saved-and-waiting state, bring the verifier up, reload, see the verified result.

**0.8.8 The bottleneck line** — S, R. After each round one sentence built from `CellStats` names the machine that held the line and the two fixes that exist in the pool ("The furnace at row 3 was full for 38 of 80 seconds. A tuner beside it, or a second furnace behind a splitter, would clear it."); repeated as the hint in the next draft; the foreman will later say it (0.9.1). *Accept:* unit test over four canonical layouts (saturated furnace, blocked hopper, starved processor, slag line) produces the expected sentence; e2e sees it on the panel.

**0.8.9 Uptime, alerting, the Discord server** — S, H ⚑. A free uptime monitor on `/health` with an alert to the owner's phone; a Discord with four channels (announcements, general, bugs-and-feedback, grids) and a role-gated spoiler channel the webhook opens at freeze; `DISCORD_WEBHOOK_URL` set. *Accept:* an alert fired once on purpose; the webhook's first real post recorded.

**0.8.10 First human playtests** — L, H ⚑ [0.8.5, 0.8.7]. `docs/PLAYTEST.md` with the protocol (five testers, recorded think-aloud, the tutorial plus two dailies, no help from the owner, consent for the funnel), the findings table and the fixes they spawned. *Accept:* five sessions recorded; the funnel report for consenting testers in `docs/metrics/`; the v0.9 backlog cites the findings by tester.

**0.8.11 Determinism across engines** — M, R (was PLAN-v5 0.8.0). `tools/make-golden.ts` records per golden replay the SHA-256 of the final state and of every round's event stream (new corpus fields, no replay regenerated); `tests/engines-e2e.test.mjs` loads the sim bundle in Chromium, Firefox and WebKit and compares hashes with Node's; CI installs the three for that job; `tests/determinism-lint.test.ts` fails on `Math.random|sin|cos|tan|exp|pow|log|atan`, `Date`, `Intl`, `toLocale`, `performance.now` and comparator-less `sort(` inside `game/src/sim/` with the two calendar modules allowlisted. *Accept:* the three engines agree with Node on every corpus file; the lint fails on an injected `Math.sin` and a bare `sort()`.

**0.8.12 Single-step while paused** — S, R (was PLAN-v5 0.8.4). One control advances one tick while paused, in play and in replay; no effect on scoring. *Accept:* e2e steps three ticks and checks the tick counter; policy page lists it as allowed in the ranked daily.

**Exit v0.8.** The hosted URL has been played by at least ten people outside the author; the P0 list of the ops report is closed; a tag publishes an image and an installer; backups run nightly and a restore drill passed; the privacy notice, terms and licence are live.

### v0.9 — Clear (weeks 5–11, by mid-January 2027)
*Theme: understandable by anyone. Rules version 3 unless 0.9.6 passes its gate. Protocol 2.*

**0.9.0 The string table and the glossary** — M, R (was PLAN-v5 0.8.6, pulled forward). `game/src/content/strings.ts` holds every player-facing string with a key, a comment and ICU-style plural forms; presentation strings leave `sim/` (`MACHINE_INFO`, tips, advice) for `game/src/content/`; `Intl.DateTimeFormat`/`NumberFormat` everywhere a date or number is shown; a pseudo-locale (accented, 30 % longer) runs the render e2e in CI; `tests/strings.test.ts` fails on a banned word (Appendix B) and on a string literal in `game/src/ui` that is not from the table. The glossary is reviewed with the owner before the rewrite. *Accept:* zero prose literals outside the table (the test counts); the pseudo-locale e2e passes at 130 %; the a11y test still reads the CSS.

**0.9.1 The foreman, text only** — M, R + H for voice review. A character sheet (name, voice, what he never says); authored lines keyed by situation (welcome, first draft, each tutorial step, a refused placement, each bottleneck case, round end good/bad, results by percentile band, daily open, daily freeze, streak milestones, first share, first group) with three to five variants each, chosen deterministically from the day's seed so everyone sees the same line; a "less chatter" setting that keeps only the teaching lines; the foreman's lines are the daily thread's opening and closing posts later (0.11.5). *Accept:* a snapshot test pins the chosen line per (situation, seed); e2e sees the foreman's panel on title, draft, round end and results; the "less chatter" setting is persisted and respected.

**0.9.2 The results card** — M, R [0.9.0]. The first screen after a run leads with the sentence ("Better than 61 % of 412 runs today"), then money, par delta, personal-best delta, medal when it exists; rank and the top five below the fold; the histogram with your bar and, later, friends' bars; actions grouped (Play again / Share / Watch); the "what changed since yesterday" line; the offline state from 0.8.7. *Accept:* a 390-wide screenshot and a 1920-wide screenshot reviewed by the owner; e2e asserts the order of elements; the share text carries the "beat this" link by default (opt-out, not opt-in).

**0.9.3 Onboarding delivery** — M, R. Refusals and warnings as toasts anchored to the cell (persist until the next action, never two seconds); a translucent flow overlay in the build phase drawn from `inputTravelDirs`/`outputDirs` so the line's direction is visible; larger output arrows and input notches on "from behind only" machines; the tutorial's round-3 paragraph split into three bite-sized hints with a "show me" demo from the Tips demos; a first-draft hint that says which card to take and why. *Accept:* funnel targets on the next playtest round: median rejected placements before the first valid one ≤ 2, `first_run_complete / app_start` ≥ 80 %; e2e covers the toast and the overlay.

**0.9.4 GameScene split** — M, R. Extract `InputController` (keys, drag, cursor, held state), `TutorialGuide` (pure function of run state → hint), `StallMonitor`, `PopPool`, and a `GameTelemetry` observer on controller hooks; the scene maps sim events to sprites and nothing else. *Accept:* `GameScene.ts` under 350 lines; each extracted module has unit tests; every existing e2e passes unchanged.

**0.9.5 Test suite, lint, coverage** — M, R. `tests/e2e/fixture.mjs` starts the dev server and verifier on free ports once per file; the two monolithic e2e files become scenario suites (one `test()` per scenario, shared fixture, `waitForFunction` on `__jd` state instead of fixed sleeps, one full-run smoke kept); `--experimental-test-coverage` in `npm test` with a floor on `game/src/sim` and `server`; an ESLint flat config (typescript-eslint recommended, `no-unused-vars`, max line length 160) and Prettier, applied once in a formatting-only commit; dead code removed (`chainHasCrusher`, `render/ui.ts` `Button`, the voided `rank` in `verify.ts`); the test list in `package.json` becomes a glob; `vendor/phaser` leaves the repository (a documented restore step for the cloud sandbox). *Accept:* CI shows per-scenario results; no `await wait(` left in e2e except inside the fixture; lint and format run in CI; coverage printed.

**0.9.6 Dead rounds: a tuning pass, not a system** — M, R + H go/no-go. The only rules work before 1.0, allowed by §1 because it adds nothing a player must learn. Candidates measured with `tools/balance.ts` and `tools/autoplay.ts` on 40 seeds: (a) a seed-fair late-round guarantee (rounds 4 and 5 each include at least one of hopper or crusher when the (seed, round) draw would otherwise offer neither, the same for everyone like round 1's crusher); (b) sell value or slag value nudges; (c) hopper period or furnace hold adjustments. Gate: `flatRoundsTotal` under 12 of 120 (from 29), no seed worse on identical offers, every score replay-verified, the sanity bound unchanged. If a candidate passes, it ships as rules version 4 with a golden regeneration, a one-release notice and a void-free cutover (new dailies only); if none passes, the decision and the numbers go to DESIGN and the item closes. *Accept:* the study JSON under `docs/baselines/0.9/`; DESIGN's decision log entry; the owner's written go/no-go.

**0.9.7 Stats page, local** — S, R. Days played, streak history, medals, personal bests per seed, percentile trend, machines placed per kind; local data only (synced in 0.11.1). *Accept:* e2e opens it; the trend reads from local records; nothing leaves the device.

**0.9.8 Playtest round two** — L, H ⚑ [0.9.0–0.9.3]. Five fresh testers on the clear build; the same protocol; findings into v0.10/v0.11. *Accept:* `docs/PLAYTEST.md` round two; funnel report; the three biggest misunderstandings named and ticketed.

**Exit v0.9.** No banned word in the product; the foreman speaks on every screen; the results card leads with the sentence; GameScene is split; CI runs scenarios with lint and coverage; the dead-round decision is written down with numbers.

### v0.10 — Phone (weeks 10–17, by end of February 2027)
*Theme: the daily playable on the device the working man actually has. Rules unchanged. Protocol 2.*

**0.10.0 Responsive layout** — L, R + H review. The fixed 1120×700 goes. The canvas sizes to its container; the DOM shell lays out by media query: portrait phone (390–430 wide: the grid at 46–50 px cells on top, the draft and bin as a bottom sheet, the panel collapsed to a strip, the foreman as a toast), landscape phone, tablet, laptop (grid plus panel side by side, the backdrop fills the width), 1920×1080 (margins, not scaling). 44 px touch targets; the text-size presets per device class; the e2e viewport matrix (390×844, 412×915, 768×1024, 1280×800, 1920×1080) with clipping checks at 130 %. *Accept:* the matrix passes; a screenshot per viewport reviewed by the owner; the perf gate unchanged on preset B.

**0.10.1 Touch and the action table** — M, R [0.10.0] (absorbs PLAN-v5 0.8.2's table). One action table maps mouse, touch and keys to the same rule-checked actions: tap a bin part to hold, tap a cell to place, tap a placed machine to select, long-press to drag, a rotate button and a two-finger tap, drag to the bin to remove; audio unlock on the first tap; no hover-only affordance anywhere. *Accept:* the game e2e runs a full six-round game with touch events only (Playwright `hasTouch`); the table is the single source for the Tips key list.

**0.10.2 Weight and speed on weak phones** — M, R (absorbs PLAN-v5 0.8.9). The custom Phaser build (ESM entry, only the modules used), measured; DPR cap and the adaptive fallback kept; perf preset D (915×412, DPR 2.6, CPU ×4) added to CI with a budget; first-interactive on a 4G profile measured. *Accept:* `main.js` ≤ 300 KiB gzip (stretch 250); preset D p95 ≤ 33 ms at 1×; first interactive ≤ 4 s on the 4G profile; the a11y sheet and every e2e unchanged.

**0.10.3 Installable web app** — M, R. `manifest.webmanifest` (icons from `desktop/build/icon.svg`, portrait-any), a service worker that caches the shell and serves offline practice (the daily needs the verifier; offline says so plainly), an install prompt after the second completed run, an update flow ("A new version is ready" on the title, never mid-run), iOS add-to-home-screen guidance. *Accept:* Lighthouse PWA checks pass; the e2e simulates offline and completes a practice run from cache; an update rolls over between runs.

**0.10.4 Push for the daily, opt-in** — M, R + H for keys. Web Push with VAPID keys; `POST /push/subscribe` and `/push/unsubscribe` on the verifier (protocol stays 2: additive endpoints); one notification a day at the hour the player chose ("The yard is open"), nothing else until 0.11.7; `web-push` becomes the first runtime dependency, recorded. *Accept:* a subscription round-trips in a test with a mock push endpoint; the notification fires once per day per subscription in a fake-clock test; unsubscribe removes the row.

**0.10.5 Device run** — M, H ⚑. Three phones (iOS Safari, Android Chrome mid-range, a low-end Android) and one tablet: install, play the daily, share, watch a replay; `docs/perf/DEVICES.md` with the numbers and photos. *Accept:* the table filled; any blocker ticketed into v0.11.

**0.10.6 Share surfaces for phones** — S/M, R. The Web Share API with the image card when available; the spoiler-free grid plus the "beat this" link as the default text; a looping GIF of the final layout at 4× (the genre's signature artefact) exported from the replay with seed, score and the first eight characters of the hash in the strip. *Accept:* e2e exports the GIF under 4 MB and the card; the share text contains the link.

**Exit v0.10.** The daily plays end to end on three phones; the PWA installs; the bundle is under budget; Safari and Firefox replays verify (0.8.11 proven in CI); push works for those who asked.

### v0.11 — Say something (weeks 16–26, by end of April 2027)
*Theme: the social layer behind one moderation pipeline. Protocol 2 → 3 (additive). Rules unchanged.*

**0.11.0 The community store** — M, R. `server/community.ts` on `node:sqlite` (Node 24 built-in; `better-sqlite3` only if the built-in proves unstable, recorded): tables `accounts`, `email_links`, `threads`, `posts`, `reactions`, `views`, `friends`, `messages`, `notifications`, `push_subscriptions`, `reports`, `moderation_actions`, `divisions`, `trophies`, `cosmetics`; migrations as numbered SQL files applied at start; the board stays JSON until its own trigger fires; `tools/backup.ts` includes the database; `/health` reports its size. *Accept:* migration up/down test; the backup and restore drill cover it; a 100k-post fixture queries the thread page under 20 ms.

**0.11.1 Email link** — M, R + H ⚑ provider. `POST /link/start` sends a one-time link (15-minute validity, single use) through a transactional provider; `POST /link/verify` binds `SHA-256(email)` to the player id; a linked player can sign in on another device by email and gets their profile, settings, local bests and cosmetics synced; writing, messaging and the hub require a link; the privacy notice gains the provider as a recipient and the email hash as stored data; rate limits per IP and per address; unlink and delete paths. *Accept:* the full flow in a test with a mock provider; a second device restores the identity; `DELETE /me` removes the hash and the sync blob; the policy regenerates.

**0.11.2 The moderation pipeline** — L, R + H policy. Write-time filter (the existing name filter extended: blocklist, confusables, URLs stripped or refused, phone/email/address patterns, length and rate limits); asynchronous triage of every public post by a small, fast Claude model (Haiku 5.5 class) called from the verifier with a fixed rubric returning a category and a score; three bands (publish, queue, auto-hide pending) with thresholds the owner can set; reports hide after two established reporters or one trusted moderator; a queue page served by the verifier at `/moderation/` (token plus linked moderator accounts) with hide/unhide/delete/mute 24 h/mute 7 d/ban (player id + email hash)/clear and a free-text reason; appeals from the inbox with a form; every action in `moderation.jsonl` and the database; the SLA and the monthly counts on the policy page; community guidelines v1; "trusted moderator" as a role the owner grants. The classifier fails open to the queue, never to publish. *Accept:* a corpus of 200 labelled test strings (owner-reviewed) gives the expected band for each; the queue UI's actions are e2e-covered; appeals round-trip; the audit log pins the row shapes.

**0.11.3 Reactions on runs** — S, R [0.11.0]. Eight emotes, one per player per run, counts only; shown on board rows, the results card, the replay banner and the owner's inbox (batched). No account needed. *Accept:* the one-per-player rule in a test; counts render in e2e.

**0.11.4 Seen-by counts** — S, R [0.11.0]. Unique viewers per replay hash; "watched 14 times by 9 players" on the results card and the stats page. *Accept:* the same viewer twice counts once (test).

**0.11.5 The daily thread** — M, R [0.11.1, 0.11.2]. One thread per daily and weekly seed; readable only after you have submitted or the day has closed (the reveal gate extended to text); the foreman's opening post at open (neutral) and closing post at freeze (built from the board: runs, median, top three, the most-reacted replay); comments ≤ 280 characters, plain text, no links, edit for five minutes, delete your own; a run can be attached by hash; pinned in-game and at `/community/day/<date>`. *Accept:* the gate holds in a test (an unsubmitted player gets 403 on the open day and 200 after freeze); the foreman's posts are deterministic for a fixed board; e2e posts, edits, deletes and reports a comment.

**0.11.6 Comments on runs** — S/M, R [0.11.5]. The same comment component on any verified replay; the run's owner is notified; the thread of a run shows on the results card when the run is yours. *Accept:* e2e: comment on a replay, see it in the owner's inbox.

**0.11.7 Inbox and notifications** — M, R [0.10.4, 0.11.5]. An in-game inbox (reply, reaction batch, challenge beaten, group day closed, division result, moderation outcome, appeal result); push for replies and beaten challenges (opt-in per kind); a weekly email digest (opt-in, linked accounts: your week, your friends, next weekly seed). *Accept:* each event type produces one row (test); push and digest respect the per-kind opt-ins; unsubscribe from the digest in one click.

**0.11.8 Friends and the activity feed** — M, R [0.11.1]. Friend requests from a group, a challenge link or a comment; accept/decline/remove/block; the histogram shows friends' bars; the feed (runs, medals, comments, division results of friends and group members, newest first) with one-tap "beat this"; a cap per player. *Accept:* blocking hides both ways (test); the feed query is bounded; e2e adds a friend and sees their run.

**0.11.9 Direct messages** — M, R [0.11.8, 0.11.2]. Plain text between friends only; 90-day retention; block and report; the write-time filter applies; triage runs on report (not on every message) so private messages are not read by default, stated in the privacy notice. *Accept:* a non-friend cannot message (test); a report surfaces the conversation to the queue; expiry deletes rows in a fake-clock test.

**0.11.10 The community hub, v1** — M, R [0.11.5]. Four categories (Strategies, Show your yard, Help and bugs, Off-shift) as web pages served by the verifier at `/community/` and as an in-game panel; the daily threads listed under a fifth tab; posts embed verified runs by hash with the card; the owner and trusted moderators can pin and lock; hub v2 (user-created threads in every category, search, author pages) switches on by a flag when weekly posters ≥ 50. *Accept:* the pages render server-side with no client script required to read; the flag test; posting goes through the same pipeline.

**0.11.11 Divisions at freeze and trophies** — M, R [0.11.0]. At freeze the day's verified players are bucketed by score into divisions of 16–64 (the top division ≤ 16 when the population allows; the rest as even as possible; fewer than 16 players make one division); each division gets a name, a mini-board and a medal for its top three; placements and medals accumulate into trophies that never decay; a weekly summary in the digest; shown on the results card the next day, the stats page and the share text; computed once at freeze and stored (additive protocol fields). *Accept:* the bucketing is pure and unit-tested for 5, 17, 64, 65, 1,000 players; a fake-clock freeze test; the results card shows the division the morning after.

**0.11.12 Cosmetics** — M, R + art. Yard themes, machine skins and title badges unlocked by trophies, medals and days played; stored per player on the server and shown to others on boards, in replays, in the hub; a "never changes play" sentence on the results card and the policy page; the first set drawn from the commission (0.12.0), placeholder tints until then. *Accept:* unlock rules unit-tested; a replay renders with the author's skin; the sentence present.

**0.11.13 The author card** — S, R [0.11.1]. Name, badge, trophies, best runs, join month; shown from comments, boards and the hub; a privacy switch hides everything but the name. *Accept:* the switch is respected everywhere (test over the three surfaces).

**0.11.14 Playtest round three, social** — L, H ⚑. Five testers plus the Discord regulars on the social build; the moderation queue watched for a week; findings into v0.12. *Accept:* `docs/PLAYTEST.md` round three; the queue's first-week numbers in STATUS.

**Exit v0.11.** The daily thread has had a post every day for 14 days without an empty day; the moderation queue's median time to review is under 72 hours; no free text exists outside the pipeline (the enumeration test lists every writable field and pushes a blocked string through each); divisions have run at two freezes; friends, inbox, DMs and the hub are live.

### v0.12 — Finished (weeks 25–34, by mid-June 2027)
*Theme: the production look, the music, the remaining accessibility and operations, an open beta, the exit criteria.*

**0.12.0 Art integration** — L, R + H ⚑ commission (§6). The authored set replaces the exported SVGs through the existing atlas pipeline with the frame names unchanged: eight machines with two to four working frames each, five items, eight belt frames, state overlays, a yard backdrop in three aspect variants, the logo and wordmark, an icon set, panel and button textures, the first twelve cosmetic skins and three themes; the a11y audit re-run on the new palette (`--sheet`); the juice table extended for the new frames. *Accept:* texture-key snapshot unchanged; the audit passes; perf preset B and D unchanged within the gate; before/after screenshots reviewed by the owner.

**0.12.1 Adaptive music** — M, R + H ⚑ commission. Three stems (build, run, results) in two intensities each plus stings (round good/bad, personal best, medal), loop points, intensity driven by items in flight and round number, the throughput hum kept as a layer, ducking under the fanfare, reduced-audio drops the stems; lazy-loaded after the title. *Accept:* `tests/mixer.test.ts` covers stem selection and ducking; the e2e asserts the stem changes at run start and stops at the settle; total audio payload ≤ 2 MB.

**0.12.2 The foreman's face** — S, R + art. A portrait set (six expressions) and the lines from 0.9.1 bound to them; optional short voice-like blips in the UI bus. *Accept:* the right expression per situation (snapshot); reduced motion keeps the portrait still.

**0.12.3 Share surfaces, trailer, site** — M, R + H ⚑. The card, the GIF loop and the clip redesigned with the art; the one-page site on the domain (play, today's numbers, the hub, policy, privacy, press kit); a 45-second trailer cut from exported clips; six screenshots at 1920×1080 and 1170×2532. *Accept:* the kit published; the share image renders the new art in e2e.

**0.12.4 Accessibility completion** — M, R (was PLAN-v5 0.8.2 and 0.8.5). Full key remapping over the action table; a screen-reader mirror of the grid (a hidden list of cells with machine, facing and state, updated on change, with the foreman's lines as live regions); a contrast check of the new palette; a focus order audit of every screen at phone width. *Accept:* the remapping persists and an e2e plays a round with remapped keys; a screen-reader e2e (accessibility tree) reads the grid after a placement.

**0.12.5 Verifier operations completion** — M, R. SQLite for the board if `/health` crossed the trigger in any beta month (0.7.0b), otherwise the decision recorded again; `tools/void-day.ts` with the runbook line ("a day a bug compromised is voided and re-issued, never re-scored"); Assisted and Human boards (PLAN-v1 0.9.2: dev-API and autoplayer submissions tagged `origin: tool`); anomaly signals recorded for review (PLAN-v1 0.9.4); runbooks for incident, secret compromise, DSAR and restore; a metrics endpoint (OpenMetrics text) and a dashboard screenshot; Node and Electron patch cadence written down. *Accept:* each tool runs against a fixture; the runbooks are in `server/README.md`; the metrics endpoint is scraped once in CI.

**0.12.6 Open beta and the content freeze** — L, H ⚑ [everything above]. The beta opens publicly (the site, Reddit posts in the shapez spirit, a handful of creator emails with the "six-minute factory daily" pitch); `RULES_VERSION` frozen for 1.0 with a test that pins it until a dated exemption; the balance baseline for the frozen version committed; weekly STATUS blocks with the KPIs of §8. *Accept:* 30 consecutive days with the daily, weekly, freeze, divisions and the thread live and no voided day.

**0.12.7 1.0** — gate, H ⚑. All exit criteria of §8.3 met; version 1.0.0; the CHANGELOG's players-and-operators summary; the announcement pre-written; the cadence announced (§10). *Accept:* the exit table in STATUS with every row green and dated.

**Exit v0.12 / 1.0.** The product looks and sounds finished, plays on phones and laptops, is understandable without a glossary, has a living community behind a working moderation pipeline, and has run for a month in public without an incident that the runbooks did not cover.

## 6. Commissions and budget

### 6.1 Art ($3,000–4,500)
Brief written in v0.9 (week 8) from the product report's §5 and DOSSIER §2.2: keep the warm-industrial identity; silhouette first at 72 px and at 46 px; one light direction; state cues as overlays; items differ by shape; the yard as a place (piles, a crane, a fence, weather at the edges) so the frame is never empty; the foreman as a person the working man recognises, not a mascot. Deliverables (vector or 2× raster, layered sources, full rights assignment): 8 machines × 2–4 frames facing east; 5 items at 48 px; 8 belt frames; 3 state overlays; a backdrop at 16:9, 16:10 and 9:19.5; 6 foreman expressions plus a small idle loop; logo and wordmark; a 30-icon UI set; panel, button and toast textures; 12 machine skins and 3 yard themes for the cosmetic track; a 1920×1080 key image and the PWA icon set. Find the artist by portfolio (industrial or workshop subjects, flat vector or clean pixel), fixed price in three milestones (style frame, machines and items, everything else), two revision rounds each. Delivery in v0.11 (by week 22) so integration happens in v0.12.

### 6.2 Music and sound ($1,200–2,500)
Brief at the same time. Three loopable stems (build: sparse and warm; run: driving, machine-like, two intensities; results: resolving) at the game's 4-ticks-per-beat grid so the ship chimes fall on the beat; stings for round good/bad, personal best and medal; optional foreman blips; delivered as OGG and WAV with loop points, rights assigned. The hum and the synthesised cues stay.

### 6.3 Everything else
| Item | When | Cost |
|---|---|---|
| Domain (`junkyarddraft.com`, optionally `.io`) | v0.8 | ≈ $15–40 a year |
| VPS (Hetzner CX23 class) | v0.8 | ≈ €4 a month; €8–15 after 10k DAU |
| Off-box backup storage | v0.8 | ≈ €3–4 a month |
| Cloudflare Pages, uptime monitor, Discord, GHCR | v0.8 | €0 |
| Transactional email provider | v0.11 | €0–20 a month at beta volumes |
| AI triage API | v0.11 | expected under $20 a month at beta volumes; measured and reported in STATUS monthly |
| Legal templates or a one-hour review | v0.8 | $0–500 |
| Capsule/key art | included in 6.1 | — |
| Steam Direct fee, code signing, Apple developer program | after 1.0 | $100 one-off; ≈ $10 a month; $99 a year |
| Contingency | — | 15 % of the commissions |

Total to 1.0: about $5,000–8,000 plus under $40 a month. The desktop edition's costs begin only when it is decided (§10).

## 7. Calendar and capacity

| Month | Milestone | Owner's hours go to | Routine and Claude sessions do |
|---|---|---|---|
| Nov 2026 | v0.8 Real | domain, VPS, secrets, legal text, licence decision, Discord, the first five playtests | 0.8.0–0.8.4, 0.8.7, 0.8.8, 0.8.11, 0.8.12, deploy files |
| Dec 2026 – mid Jan 2027 | v0.9 Clear | glossary review, foreman's voice, screenshot reviews, the go/no-go on 0.9.6, art and music briefs, hiring | 0.9.0–0.9.7 |
| mid Jan – Feb 2027 | v0.10 Phone | viewport reviews, VAPID keys, the device run, artist milestone 1 review | 0.10.0–0.10.4, 0.10.6 |
| Mar – Apr 2027 | v0.11 Say something | provider accounts, the triage rubric and the 200-string corpus, guidelines, moderating the first weeks, playtest three, artist milestones 2–3, music review | 0.11.0–0.11.13 |
| May – mid Jun 2027 | v0.12 Finished | art and music sign-off, the site and trailer, beta outreach, weekly KPI blocks | 0.12.0–0.12.5 |
| mid Jun – Jul 2027 | Beta and 1.0 | the 30-day watch, the exit table, the announcement | fixes only |

Capacity check: 36 weeks × 12 h ≈ 430 owner hours. The human items above sum to roughly 250–300 hours (playtests 40, legal and admin 30, art and music direction 60, moderation and community 60, reviews and device runs 60, ops 30), leaving a margin for the unplanned. Code velocity is not the constraint: this project shipped v0.3 through v0.7 in days of Claude sessions. The constraint is the owner's review time and the external deliveries (art, music, email provider, testers).

**The six-month cut line.** If 1.0 must land by end of April 2027: v0.11 keeps 0.11.0–0.11.8 and 0.11.11 (reactions, thread, comments, inbox, friends, divisions) and moves DMs (0.11.9), the hub (0.11.10) and cosmetics beyond badges (0.11.12) to 1.1; v0.12 keeps art, music, the foreman's face, share surfaces and operations and moves the screen-reader mirror (0.12.4, half) to 1.1. The beta shortens to 21 days. Nothing in v0.8–v0.10 is cut.

## 8. Measurement and exit criteria

### 8.1 Instruments
The verified board is the richest telemetry and needs no client trust: runs per day, distinct players, claimed names, linked accounts, groups, friends, posts, reactions, division sizes, medal thresholds, late submissions. The opt-in funnel (`tools/funnel.ts`) covers first-session conversion for consenting installs. Add in v0.8: a weekly `tools/kpi.ts` that writes `docs/metrics/YYYY-WW.json` (counts from the board and the community store, Cloudflare's cookieless page views, D1/D7/D30 for consenting installs, the moderation counts) and a STATUS block that quotes it. Nothing third-party on the page.

### 8.2 Targets by milestone
| KPI | v0.8 beta | v0.10 | v0.12 open beta | Source of the number |
|---|---|---|---|---|
| Daily verified runs | ≥ 10 on a weekday | ≥ 50 | ≥ 300 | board |
| `first_run_complete / app_start` | measured | ≥ 80 % | ≥ 80 % | funnel (PLAN-v1 targets) |
| Median rejected placements before the first valid one | measured | ≤ 2 | ≤ 2 | funnel |
| D1 / D7 / D30 (consenting installs) | measured | ≥ 25 / 8 / 3 % | ≥ 30 / 12 / 5 % | funnel; targets from the daily-games report (vendor medians, estimates) |
| Daily completion (completed ÷ visitors who started) | measured | ≥ 50 % | ≥ 60 % | board + page views |
| Share rate (shares ÷ completions) | measured | ≥ 10 % | ≥ 15 % | funnel |
| Linked accounts ÷ D7-retained players | — | — | ≥ 30 % | store |
| Posts per day in the daily thread | — | — | ≥ 20 | store |
| Moderation median time to review | — | — | ≤ 72 h | store |
| `flatRoundsTotal` (autoplay 20 × 120) | 29 | ≤ 12 if 0.9.6 shipped | same | autoplay |
| Perf preset B / D p95 at 1× | gate armed | ≤ 16.7 / 33 ms | same | perf.yml |
| `/health` p95 under the 60/min flood | ≤ 100 ms | same | same | tools/load.ts |

### 8.3 Exit criteria for 1.0 (all of them)
1. Thirty consecutive days with the daily, weekly, freeze, divisions and the thread live and no voided day.
2. Zero "did not reproduce" rejections on valid replays across Chromium, Firefox and WebKit for 30 days.
3. The moderation queue reviewed within 72 hours for 30 days; the appeal path used at least once and documented.
4. The P0 and P1 lists of the ops report closed; a restore drill passed in the last 30 days; the metrics endpoint scraped; the runbooks present.
5. The v0.12 KPI targets met for two consecutive weeks, or a written exception per KPI.
6. Three playtest rounds recorded; the three biggest misunderstandings of round three fixed or accepted in writing.
7. The site, privacy notice, terms, guidelines, press kit and trailer live; the licence and copyright holder in the repository.
8. The post-1.0 cadence announced (§10).

## 9. Risks and mitigations

| Risk | Why it is real | Mitigation |
|---|---|---|
| **Thin depth shows before the social layer exists** (a player sees everything in ten runs; rounds 4–6 dead) | Product report §2; the owner declined depth systems | 0.8.8 and 0.9.1 turn the plateau into a goal; 0.9.6's tuning pass with a gate; the social milestones carry the long game; policy 10 keeps the numbers in front of the owner every milestone so the decision can be revisited |
| **Empty social surfaces** at 10–300 players make the product feel dead | Both market reports; "one active channel makes a server feel alive, several quiet ones make it feel dead" | Population order (§3.3); the foreman posts every day; hub v2 behind a 50-weekly-posters flag; reactions before words |
| **Free text draws abuse the owner cannot keep up with** | One person; previous plans forbade chat for this reason | The pipeline (0.11.2) with auto-hide bands that tighten in the owner's absence; trusted moderators; the SLA and the transparency counts; DMs only between friends |
| **The classifier gets it wrong** (false hides, missed abuse) | Any classifier | Fail open to the queue, never to publish; reason codes; appeals; the 200-string corpus reviewed by the owner and grown from real cases |
| **Email changes the privacy posture** | Overturns an earlier promise | Hash only, optional, deletable; the notice updated before 0.11.1 ships; the provider listed as a recipient |
| **Phone work breaks the desktop experience** | A fixed layout had zero slack at 130 % | The viewport matrix as a gate; the DOM shell already exists; screenshots per viewport reviewed |
| **Safari determinism** | Never tested; a valid replay called a cheat is the worst failure | 0.8.11 before phones; reason codes; the browser matrix on the site |
| **Commission slips** (art or music late, or wrong) | External deliveries | Briefs in v0.9; three paid milestones with style frames first; placeholders keep every increment shippable without the art |
| **Token theft or data loss before the beta** | Two P0s today; no backups | v0.8 closes them before the URL is public |
| **The single JSON board hits its trigger** | ≈ 550 daily players | `/health` reports the inputs; 0.12.5 decides SQLite with the measured month; the community store is SQLite from day one |
| **Owner burnout** | 10–15 h/week for nine months on top of a job | Human items are listed and sized; the six-month cut line exists; the routine carries S items; the beta is best-effort by the terms |
| **Content-volume criticism at 1.0** ("eight machines") | Store-page numbers sell comparables | The countable things are days, divisions, trophies, cosmetics and people; §1 records the decision; the post-1.0 cadence (§10) is the answer if the numbers say so |

## 10. After 1.0

Not scheduled, listed so nothing is lost. The owner found all three money paths acceptable; each starts only by a dated decision.
- **1.1 Supporter tier** (web): $3.99 a month or $29.99–39.99 a year through a merchant of record; perks that pass the fairness test (archive beyond the free window, extended stats, cosmetic themes, group size above the free cap, higher-resolution clips); a `supporter` flag by player id; never the daily, never attempts, never hints.
- **1.2 Desktop edition** on Steam (Windows and Linux for the Deck): open the store page the day the edition is decided to accumulate wishlists; price $9.99 rising to $14.99 as content grows; achievements, cloud saves, soundtrack, the archive, a sandbox; `steamworks.js` behind a build flag, ticket binding in the verifier, trusted-write board (PLAN-v5 0.8.10); signing; the installer from 0.8.4; tags Automation / Strategy / Score Attack, never Puzzle; Next Fest only with ≥ 5,000 wishlists.
- **Native wrappers** (Capacitor) for the stores once the PWA has numbers; premium, not free-to-play.
- **Live formats**: same-seed races and watch-together over a relay (DOSSIER §5.2) once daily submitters pass about 300.
- **Localisation**: the string table is ready; CJK first if the desktop edition ships (China was 48 % of Backpack Battles' and 32 % of Stacklands' sales).
- **Gamepad and the Linux build** (PLAN-v5 0.8.3, 0.8.8) with the desktop edition.
- **Depth, if the numbers ask for it**: the four declined systems remain fully specified in `docs/reviews/2026-10-30-eval/product.md` §9 and `market-premium.md` §5; each is a rules bump with a golden regeneration and a balance gate, and the version-pinned verifier makes such drops safer here than for any comparable.
- **Cadence**: one visible update every 6–8 weeks after 1.0 (a theme, a foreman season, a community feature, a tuning pass), announced on the site and in the hub, because "abandoned" is the review theme that kills comparables within 18 months.

## Appendix A — where PLAN-v5's items went

| PLAN-v5 | Here |
|---|---|
| 0.8.0 determinism across engines + lint | 0.8.11 |
| 0.8.1 handheld preset and scaling check | 0.10.0 (responsive layout) |
| 0.8.2 action table and remapping | 0.10.1 (table), 0.12.4 (remapping) |
| 0.8.3 gamepad | after 1.0, with the desktop edition |
| 0.8.4 single-step while paused | 0.8.12 |
| 0.8.5 screen-reader mirror | 0.12.4 |
| 0.8.6 externalised strings and pseudo-locale | 0.9.0 |
| 0.8.7 verifier hardening (reason codes, bounded re-simulation, void-day) | 0.8.1, 0.8.2, 0.12.5 |
| 0.8.8 Linux AppImage and touch | touch 0.10.1; AppImage after 1.0 |
| 0.8.9 custom Phaser build | 0.10.2 |
| 0.8.10 Steam plumbing | after 1.0 |
| PLAN-v1 0.9.1–0.9.7, 1.0.1–1.0.5 | playtests 0.8.10/0.9.8/0.11.14; Assisted boards and anomaly signals 0.12.5; privacy 0.8.6; Steam, pricing, review prompt and signing after 1.0; freeze and exit 0.12.6–0.12.7 |

## Appendix B — the plain-language glossary (draft for the owner's review in 0.9.0)

| Internal word | Player word | Note |
|---|---|---|
| seed, daily seed | today's yard, the yard of 12 March | the date is the name; the seed string stays in the URL and the share text |
| tick | second | 80 ticks become "80 seconds" of the yard's clock at 1×; the sim is unchanged |
| run (a round's simulation) | shift | "start the shift"; a full game is "the day" |
| verified, verifier | checked, the checker | "checked by our server" in one place on the policy page, "checked" everywhere else |
| replay | the recording | "watch the recording" |
| replay hash | the recording's code | shown as eight characters where needed |
| local best, unverified | your best on this device, not yet checked | |
| histogram | everyone today | "better than 61 % of everyone today" |
| percentile | better than N % | never the word |
| bot par | the foreman's mark | the shipped autoplayer's median, explained once |
| reroll | new offers ($40) | the button says what it costs |
| draft | pick | "pick a machine" |
| bin | the shelf | parts waiting to be placed |
| dock | shipping dock | kept; "sells what reaches it" |
| splitter, tuner, press | kept, with a one-sentence job each | names are fine; jobs must be plain |
| transform | (none) | shown, not named |
| freeze, closes at | results final at 00:00 UTC on … / the day closes | local time shown beside it |
| medal (nearest-rank 50/80/95) | bronze / silver / gold | the rule in one sentence on the policy page |
| division | your division (Scrapline, Foundry, Pressroom, Dockside…) | |
| group code | your crew's code | groups become "crews" |
| challenge link | "beat this" link | |
| fork from round N | try from round 3 | |
| protocol, rules version | (never shown) | policy page only |
| device token, recovery code | your key | "save your key to play as you on another device" |
| Assisted board | runs with tools | |

Banned in player-facing strings after 0.9.0: seed, tick, verifier, verified (except the policy page), replay, hash, histogram, percentile, RNG, protocol, rules version, local storage, bearer, token (except "your key"), npm, localhost.
