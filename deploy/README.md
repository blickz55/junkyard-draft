# Deploying Junkyard Draft (production roadmap 0.8.5)

From nothing to the first hosted end-to-end check. Two hosts: the **game** is static files on Cloudflare Pages at the apex
domain; the **verifier** is one Docker container behind Caddy on one small VPS, reachable as `verify.<domain>`. The repo's
part (these files, the workflow, the build) is done; the steps marked **⚑** are the owner's, done once, and the dated results
go into `docs/STATUS.md`.

```
players ──https──> junkyarddraft.com (Cloudflare Pages: dist/ with _headers)
                       │  fetch/XHR, CORS_ORIGIN = https://junkyarddraft.com
                       └─────> verify.junkyarddraft.com (Caddy: TLS, HSTS) ──> verifier container :4400 (loopback only)
                                                                                  └── volume junkyard_verifier-data (/data)
```

What is in this directory:

| File | Role |
|---|---|
| `docker-compose.yml` | the verifier (GHCR image, named volume, `TRUST_PROXY=1`, port on 127.0.0.1 only, rotated logs) and Caddy |
| `Caddyfile` | TLS for `verify.<DOMAIN>`, HSTS, `X-Real-IP`, 2 MB body cap, JSON access log |
| `.env.example` → `.env` | compose variables: `DOMAIN`, `ACME_EMAIL`, `VERIFIER_TAG` (the deploy workflow pins the tag here) |
| `verifier.env.example` → `verifier.env` | the container's secrets and settings: `DAILY_SECRET`, `MODERATION_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, `CORS_ORIGIN`, `DISCORD_WEBHOOK_URL`, and (0.10.4) `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` for the daily reminder (`npx web-push generate-vapid-keys`; empty keeps reminders off) |
| `_headers` | template for Cloudflare Pages; `npm run build` renders it into `dist/_headers` with the CSP header and the immutable rule for the content-hashed `main-<hash>.js` |
| `backup.cron` | nightly archive of the volume, nightly off-box copy, Sunday restore drill (0.8.3) |
| `../.github/workflows/deploy.yml` | after a green `ci` run: main → Pages; a `v*` tag → pull and restart the verifier over SSH, then `/health` and `tools/mint-check.ts` |

`.env` and `verifier.env` are ignored by Git. Nothing in this directory holds a secret.

## 1. Domain ⚑
1. **Wait for the name test** (`docs/ROADMAP.md`): the name decides the domain, so nothing is bought before it. Then register the domain at any registrar (`junkyarddraft.com` and `dayjobgame.com` were free on 2026-11-01) and point its nameservers at Cloudflare (free plan).
2. In Cloudflare DNS, nothing for the apex yet (Pages adds it in step 4); for the verifier add `A verify → <VPS IPv4>` and `AAAA verify → <VPS IPv6>` with the proxy **off** (grey cloud). Caddy must see the client directly to get its certificate and the real address.
3. Mailboxes (0.8.6): the privacy notice, the terms, the licence and the verifier's policy page print `contact@<domain>` and `moderation@<domain>` (`game/src/content/operator.ts`). Cloudflare Email Routing (free, the domain's Email tab) forwards both to your own address: add the two custom addresses, verify the destination, let it create the MX and SPF records. Send yourself a test mail to each. Then fill `OPERATOR.holder` with your legal name and `OPERATOR.jurisdiction` with where you live, run `npm run policy`, and commit: the data controller named in the notice has to be a person, not a handle.

## 2. VPS ⚑
A Hetzner CX23-class machine (2 vCPU, 4 GB) on Ubuntu 24.04 is plenty: the verifier re-simulates a replay in about a millisecond and the load baseline (`docs/baselines/0.8/load-0.8.2.json`) ran 357 submissions with a p95 of 8.7 ms.
```bash
# as root on the fresh machine
apt-get update && apt-get -y upgrade && apt-get -y install git curl ufw unattended-upgrades
curl -fsSL https://get.docker.com | sh          # Docker Engine + the compose plugin
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
adduser --disabled-password --gecos '' deploy && usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh   # then put the deploy key's public half in /home/deploy/.ssh/authorized_keys
git clone https://github.com/blickz55/junkyard-draft.git /opt/junkyard-draft && chown -R deploy:deploy /opt/junkyard-draft
```
Node is needed on the host only for the tools (`backup.ts`, `restore-drill.ts`, `moderate.ts`): install Node 24 (NodeSource or `apt`) and run `npm ci --ignore-scripts` in `/opt/junkyard-draft` as `deploy` (no browsers, no Electron binaries are downloaded).

## 3. Secrets and the first start ⚑
```bash
su - deploy && cd /opt/junkyard-draft/deploy
cp .env.example .env && cp verifier.env.example verifier.env && chmod 600 verifier.env
openssl rand -hex 32    # DAILY_SECRET
openssl rand -hex 32    # MODERATION_TOKEN
```
Fill `.env` (`DOMAIN`, `ACME_EMAIL`) and `verifier.env` (`DAILY_SECRET`, `MODERATION_TOKEN`, `CORS_ORIGIN=https://<domain>`). **Store both secrets in the password manager now**: the daily secret mints every ranked seed, it is never in a backup, and a restored service without it breaks the commitment chain (`server/README.md`, Secrets). Then:
```bash
docker compose pull && docker compose up -d && docker compose logs -f verifier
```
Expect `moderation: ... moderator endpoints on (X-Moderation-Token)` and no `daily secret generated` line (that line means `DAILY_SECRET` was empty). Checks:
```bash
curl -s http://127.0.0.1:4400/health | head -c 300        # on the VPS: the loopback port
curl -s https://verify.<domain>/health | head -c 300        # anywhere: through Caddy, with a certificate
```
From the dev PC, the two tools that CI runs against the image, now against the real host (the smoke posts one legal run on the `image-smoke` seed board):
```bash
node --import tsx tools/image-smoke.ts https://verify.<domain>
node --import tsx tools/mint-check.ts https://verify.<domain>
```

## 4. The game on Cloudflare Pages ⚑
1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Direct Upload**; name the project (for example `junkyard-draft`). Skip the first upload; the workflow does it.
2. Custom domains → add the apex; Cloudflare writes the DNS record. Add `www` too and give it a redirect to the apex (Rules → Redirect Rules, or leave `www` out).
3. An API token (My Profile → API Tokens) with **Account · Cloudflare Pages · Edit**; note the account id (Workers & Pages overview, right column).
4. In the GitHub repository → Settings → Secrets and variables → Actions:
   - variables: `VERIFIER_URL=https://verify.<domain>`, `CF_PAGES_PROJECT=<project name>`, `DEPLOY_HOST=<VPS address>`, `DEPLOY_USER=deploy`
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEPLOY_SSH_KEY` (the private half of an ed25519 key made for this: `ssh-keygen -t ed25519 -f deploy_key -N ''`), `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan <VPS address>`)
5. Actions → deploy → Run workflow (web = true). The job builds `dist/` with `VERIFIER_URL` baked in and uploads it. From then on every green `ci` run on `main` redeploys the web.

Why the `_headers` file matters: the page's own `<meta>` policy cannot carry `frame-ancestors`, and only a header can make the content-hashed bundle immutable while the page itself revalidates on every load. The build renders the template per build, so the header always names the bundle that build produced.

## 5. The hosted acceptance ⚑ (record the date and the output in `docs/STATUS.md`)
```bash
node --import tsx tools/hosted-check.ts https://<domain> --submit-daily --name "launch check" --json docs/baselines/0.8/hosted-check.json
```
It fetches the page from the real origin and checks the headers, reads `build.json`, asks the verifier's `/health` and a CORS preflight for the site origin, opens the page in Chromium and waits for the daily-board line to fill from the verifier with zero CSP violations (screenshot under `.control-room/screenshots/`), then submits one legal run on today's minted daily and checks it is on the board. `--submit-daily` writes a real entry under `--name`: do it once. Together with `image-smoke`, `mint-check` and a run of the game e2e against the hosted verifier this closes ROADMAP 0.4.7, 0.6.8 and 0.7.8. `tests/deploy.test.mjs` rehearses exactly this against a local build and verifier, so the tool is known to pass when the hosts are right.

## 6. Backups ⚑
Install `backup.cron` in root's crontab (`crontab -e`, paste, adjust the rclone remote). It reads the volume's host path from `docker volume inspect` and drills against the loopback port. Test it once by hand: run the 03:17 line, then `node --import tsx tools/restore-drill.ts /var/backups/junkyard/jd-backup-*.tar.gz --live http://127.0.0.1:4400`, and record the result in STATUS (0.8.3's VPS half). The archive holds the community database as a snapshot taken while the verifier runs, and the restore drill checks it.

## 7. Email sign-in ⚑ (Resend)
Without it the game plays as before, and Settings says signing in is not available yet.
1. Create a Resend account and add the domain `send.<domain>`. A subdomain keeps sign-in mail apart from the mailboxes in §1, and its records cannot clash with theirs.
2. Add the records Resend lists to Cloudflare DNS, proxy **off**, and wait for it to say Verified.
3. Create an API key with sending access only. Put it in `verifier.env` as `RESEND_API_KEY` and in the password manager; `MAIL_FROM` is already set for `send.<domain>`. Restart the verifier: the log says `email sign-in: on` and `/health` says `"email": true`.
4. Sign in from the game with a Gmail, an Outlook and an iCloud address, and record in `docs/STATUS.md` whether each mail reached the inbox. If they land in spam, Postmark is the fallback: `server/link.ts` has one function to change.
The free plan sends 100 mails a day, and the only mail the game sends is a sign-in link, so it fits. If a launch day ever goes past that, it is the $20 plan.

## 8. Writing and moderation ⚑ (Anthropic)
Without it nothing can be written: `POST /posts` answers 503, `/health` says `"moderation": false` and the rest of the game is unaffected. It needs `MODERATION_TOKEN` from §3 as well, because a post nobody can review should not exist.
1. **Read what you are putting your name to.** The community guidelines (`game/public/legal/guidelines.html`), the rubric the classifier reads (`RUBRIC` in `server/moderation.ts`) and the 200 labelled strings in `tests/fixtures/moderation-corpus.json`. Every label is a draft. Change the ones you disagree with: they are your policy.
2. **Check the legal side.** The privacy notice names Anthropic as a recipient of post text. Read its current commercial terms and data processing terms, and take advice on what the notice says about them.
3. **Create the key.** In the Anthropic console, make a workspace for this and set a monthly spend limit on it: that limit is the real ceiling. Create an API key there. Put it in `verifier.env` as `ANTHROPIC_API_KEY` and in the password manager.
4. **Measure before opening.** Run this once. It makes about 140 calls and costs about 2 cents. It prints a table of where each string landed against its label:
   `ANTHROPIC_API_KEY=… node --import tsx tools/moderation-corpus.ts --live --json docs/baselines/0.11/moderation-corpus.json`
   Do not open writing with anything under "serious": a post labelled hide that stayed up, or one labelled publish that came down. Commit the result and record it in `docs/STATUS.md`.
5. **Turn it on.** Restart the verifier: the log says `writing: on` and `/health` says `"moderation": true`.
6. **Open the queue.** `https://verify.<domain>/moderation/`, with `MODERATION_TOKEN` typed in. Thresholds are at the bottom of the page: queue from 40, hide from 80, hide from 60 once the queue has been left alone for 48 hours, 5,000 classifier calls a day. Past that cap posts go straight to the queue unread. What you save there is stored and takes effect at once.
7. **Keep the promise.** The fairness page publishes the 72-hour target and the monthly counts, so a neglected queue is visible to everyone. To share the load, have someone sign in with email, then `node --import tsx tools/moderate.ts https://verify.<domain> trust <their player id>` or the form on the page. They sign in to the queue with their own key (the recovery code in the game) and can do everything but ban, answer an appeal against a ban, change the numbers, or decide anything about themselves.

Cost: Haiku 5.5 is $0.10 per million tokens in and $0.50 out, and one post is about 1,150 in and 40 out, so about $0.15 per thousand posts by estimate, less once the rubric is cached. The page shows the real tokens for the month. The default cap of 5,000 calls a day cannot pass about $20 a month.

If anything sexual involving a minor ever reaches the queue: remove it, do not copy it anywhere, and report it to the NCMEC CyberTipline (report.cybertip.org). US providers are required to by law. Take advice the same day.

## Releases, rollback and the rules version
- **Tag → verifier.** `git tag v0.8.0 && git push origin v0.8.0`: `ci` builds, smokes and pushes `ghcr.io/blickz55/junkyard-verifier:v0.8.0`, publishes the Release, and `deploy` then checks out the tag on the VPS, pins `VERIFIER_TAG=v0.8.0` in `.env`, pulls and restarts, waits for `/health` on the loopback, and checks the public `/health` and today's mint. Rollback: `Actions → deploy → Run workflow` with `verifier_tag` = the previous tag, or on the VPS `sed -i 's/^VERIFIER_TAG=.*/VERIFIER_TAG=v0.7.9/' .env && docker compose up -d`. Nothing in the data directory is deleted either way (`server/README.md`, rules-version runbook).
- **main → web.** Every green `ci` run of a push to `main` redeploys the web. Rollback: Pages → Deployments → Rollback (instant), or redeploy a commit by hand with `workflow_dispatch` from that ref.
- **A `RULES_VERSION` bump** must reach the verifier first (a new web build against an old verifier would be refused with `rules-version`). Push the tag before `main`: `git push origin v0.9.0` (the tag's `ci` + `deploy` roll the verifier), wait for the deploy job, then `git push origin main` (the web follows). The archived-bests block on the title tells players their old replays no longer verify.

## Alternative: no Cloudflare
Caddy can serve the game too. Add a second site block to the Caddyfile with `root * /srv/game`, `file_server`, `encode zstd gzip` and `header` lines copied from `dist/_headers` (the CSP line is the long one; `@bundle path /main-*.js` with `header @bundle Cache-Control "public, max-age=31536000, immutable"`), mount the unpacked `junkyard-draft-web-<version>.tar.gz` from the Release at `/srv/game`, and set `CORS_ORIGIN` to the apex as before. The deploy workflow's web job then does not apply; copy the bundle over SSH instead.

## Operations in one place
- Runbooks for an incident, a leaked secret, a request about someone's data and a restore, and the patch cadence, are in `server/README.md`.
- A scraper reads `/metrics` with `METRICS_TOKEN` (`deploy/verifier.env`): the numbers `/health` gives, in OpenMetrics text. A dashboard over it is yours to choose ⚑; nothing here depends on one.
- Logs: `docker compose logs -f verifier` (JSON request lines, hashed addresses, no group codes; `tools/log-check.ts` proves it) and `docker compose logs -f caddy`.
- Moderation: `node --import tsx tools/moderate.ts http://127.0.0.1:4400 list --token "$MODERATION_TOKEN"` on the VPS (the token never leaves it).
- Health fields for the SQLite trigger (`hotFileBytes`, `lastCommitMs`): `curl -s https://verify.<domain>/health`.
- Updating Caddy: `docker compose pull caddy && docker compose up -d caddy`.

## A private test link for paid playtests

A tester build needs no game server, no domain and no secrets, so it can go out long before the rest of this page. `npm run build:test` writes `dist-test/`: the lessons, today's yard and practice yards, with everything that needs a server out of sight, and `noindex` so search engines stay away. A small worker (`deploy/test-link/worker.ts`) and a D1 database stand behind it and keep two things: anonymous play data from the game's fixed list, and a one-minute survey that ends in a completion code a tester pastes back where they signed up. There is no leaderboard and no talk.

The first time, from an empty folder outside this repository:

    npx wrangler@3 pages project create <project> --production-branch main
    npx wrangler@3 d1 create <database>
    npx wrangler@3 d1 execute <database> --remote --file <this repository>/deploy/test-link/schema.sql

Then write `.test-link.json` at the top of this repository, which Git ignores:

    { "project": "<project>", "database": "<database>", "databaseId": "<the id d1 create printed>" }

After that one command builds it and puts it online, and a fix reaches a tester on their next load, because this build has no service worker:

    npm run deploy:test

Use wrangler version 3, and run it outside this repository; the script does both. Since 2026, version 4 turns `pages project create` into a Workers deployment: it writes `wrangler.jsonc`, adds itself to `package.json` and publishes `dist/` on the account's `workers.dev` address, which also carries the name of the account's other project.

Send testers the address. A service that gives each person an id can add it as `?tester=<id>`, and it is stored with their answers.

    npm run playtest:report

prints how far testers got, where they stopped, which lesson steps held them up, and every survey answer with its code and what that person played, so a code from someone who never played shows up as one. It reads the database with the Cloudflare login on this machine.

The game tells testers that none of this outlives the test. When the test is over, save what you want (`reports/` is not in Git) and delete every row:

    npm run playtest:report -- --json reports/playtest.json --wipe

The address is unlisted, not protected: anyone who has it can play, and can write rows. Keep it out of this repository, which is public. To take it down, delete the project and the database in the Cloudflare dashboard.
