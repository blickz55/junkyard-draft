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
| `verifier.env.example` → `verifier.env` | the container's secrets and settings: `DAILY_SECRET`, `MODERATION_TOKEN`, `CORS_ORIGIN`, `DISCORD_WEBHOOK_URL`, and (0.10.4) `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` for the daily reminder (`npx web-push generate-vapid-keys`; empty keeps reminders off) |
| `_headers` | template for Cloudflare Pages; `npm run build` renders it into `dist/_headers` with the CSP header and the immutable rule for the content-hashed `main-<hash>.js` |
| `backup.cron` | nightly archive of the volume, nightly off-box copy, Sunday restore drill (0.8.3) |
| `../.github/workflows/deploy.yml` | after a green `ci` run: main → Pages; a `v*` tag → pull and restart the verifier over SSH, then `/health` and `tools/mint-check.ts` |

`.env` and `verifier.env` are ignored by Git. Nothing in this directory holds a secret.

## 1. Domain ⚑
1. Register the domain (`junkyarddraft.com` was free on 2026-10-29) at any registrar; point its nameservers at Cloudflare (free plan).
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

## Releases, rollback and the rules version
- **Tag → verifier.** `git tag v0.8.0 && git push origin v0.8.0`: `ci` builds, smokes and pushes `ghcr.io/blickz55/junkyard-verifier:v0.8.0`, publishes the Release, and `deploy` then checks out the tag on the VPS, pins `VERIFIER_TAG=v0.8.0` in `.env`, pulls and restarts, waits for `/health` on the loopback, and checks the public `/health` and today's mint. Rollback: `Actions → deploy → Run workflow` with `verifier_tag` = the previous tag, or on the VPS `sed -i 's/^VERIFIER_TAG=.*/VERIFIER_TAG=v0.7.9/' .env && docker compose up -d`. Nothing in the data directory is deleted either way (`server/README.md`, rules-version runbook).
- **main → web.** Every green `ci` run of a push to `main` redeploys the web. Rollback: Pages → Deployments → Rollback (instant), or redeploy a commit by hand with `workflow_dispatch` from that ref.
- **A `RULES_VERSION` bump** must reach the verifier first (a new web build against an old verifier would be refused with `rules-version`). Push the tag before `main`: `git push origin v0.9.0` (the tag's `ci` + `deploy` roll the verifier), wait for the deploy job, then `git push origin main` (the web follows). The archived-bests block on the title tells players their old replays no longer verify.

## Alternative: no Cloudflare
Caddy can serve the game too. Add a second site block to the Caddyfile with `root * /srv/game`, `file_server`, `encode zstd gzip` and `header` lines copied from `dist/_headers` (the CSP line is the long one; `@bundle path /main-*.js` with `header @bundle Cache-Control "public, max-age=31536000, immutable"`), mount the unpacked `junkyard-draft-web-<version>.tar.gz` from the Release at `/srv/game`, and set `CORS_ORIGIN` to the apex as before. The deploy workflow's web job then does not apply; copy the bundle over SSH instead.

## Operations in one place
- Logs: `docker compose logs -f verifier` (JSON request lines, hashed addresses, no group codes; `tools/log-check.ts` proves it) and `docker compose logs -f caddy`.
- Moderation: `node --import tsx tools/moderate.ts http://127.0.0.1:4400 list --token "$MODERATION_TOKEN"` on the VPS (the token never leaves it).
- Health fields for the SQLite trigger (`hotFileBytes`, `lastCommitMs`): `curl -s https://verify.<domain>/health`.
- Updating Caddy: `docker compose pull caddy && docker compose up -d caddy`.
