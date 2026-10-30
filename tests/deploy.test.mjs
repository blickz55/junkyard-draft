// Production roadmap 0.8.5, deploy preparation: the header file the build renders for Cloudflare Pages, the compose and
// Caddy files, and a local rehearsal of the hosted acceptance: a real production build served from a header-aware static
// server (tools/headers-lib.mjs applies dist/_headers the way Pages does) with a real verifier whose CORS_ORIGIN is the
// site, checked end to end by tools/hosted-check.ts including a legal daily submission.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { parseHeaders, headersFor, patternToRegExp } = await import('../tools/headers-lib.mjs');
const { renderHeaders, cspFor } = await import('../scripts/esbuild-config.mjs');
const { buildDist } = await import('../scripts/build-lib.mjs');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('deploy: _headers template renders the CSP header (with frame-ancestors) and the immutable rule for the hashed bundle', () => {
  const template = read('deploy/_headers');
  assert.ok(template.includes('__CSP__') && template.includes('__BUNDLE__'), 'template placeholders');
  const text = renderHeaders(template, { verifierUrl: 'https://verify.example.com', bundle: 'main-ABCDEFGH.js' });
  assert.ok(!text.includes('__CSP__') && !text.includes('__BUNDLE__'), 'every placeholder rendered');
  const rules = parseHeaders(text);
  const root = headersFor(rules, '/');
  assert.equal(root['Content-Security-Policy'], cspFor({ dev: false, verifierUrl: 'https://verify.example.com', header: true }));
  assert.match(root['Content-Security-Policy'], /; frame-ancestors 'none'$/, 'the header variant forbids framing (a meta policy cannot)');
  assert.match(root['Content-Security-Policy'], /connect-src 'self' https:\/\/verify\.example\.com;/, 'the same connect-src as the page');
  assert.equal(cspFor({ dev: false, verifierUrl: 'https://verify.example.com' }).includes('frame-ancestors'), false, 'the meta variant stays without it');
  assert.equal(root['Cache-Control'], 'no-cache'); assert.equal(root['X-Frame-Options'], 'DENY'); assert.equal(root['X-Content-Type-Options'], 'nosniff');
  assert.equal(headersFor(rules, '/index.html')['Cache-Control'], 'no-cache');
  assert.equal(headersFor(rules, '/build.json')['Cache-Control'], 'no-cache');
  assert.equal(headersFor(rules, '/policy.json')['Cache-Control'], 'no-cache');
  const js = headersFor(rules, '/main-ABCDEFGH.js');
  assert.equal(js['Cache-Control'], 'public, max-age=31536000, immutable'); assert.ok(js['Content-Security-Policy'], 'the /* rules apply to the bundle too');
  assert.equal(headersFor(rules, '/main-OTHERHSH.js')['Cache-Control'], undefined, 'only this build\'s bundle name is immutable');
  assert.equal(headersFor(rules, '/sfx/hit.wav')['Cache-Control'], 'public, max-age=86400');
  assert.equal(headersFor(rules, '/art/x/y.png')['Cache-Control'], 'public, max-age=86400', '* spans path segments');
  // the matcher: literal dots, * and :segment
  assert.equal(patternToRegExp('/build.json').test('/buildxjson'), false);
  assert.equal(patternToRegExp('/sfx/*').test('/sfx/a/b.wav'), true);
  assert.equal(patternToRegExp('/p/:id/x').test('/p/42/x'), true); assert.equal(patternToRegExp('/p/:id/x').test('/p/4/2/x'), false);
  assert.throws(() => renderHeaders(template, { verifierUrl: 'https://v', bundle: '' }), /bundle file name required/);
  // Cache-Control rules never overlap, so no rule's value depends on Cloudflare's merge order
  const cacheRules = rules.filter((r) => 'Cache-Control' in r.headers).map((r) => r.path);
  for (const p of ['/', '/index.html', '/build.json', '/policy.json', '/main-ABCDEFGH.js', '/sfx/hit.wav', '/art/a.png']) assert.equal(cacheRules.filter((cp) => patternToRegExp(cp).test(p)).length, 1, `exactly one Cache-Control rule for ${p}`);
});

test('deploy: compose, Caddyfile, env templates, cron and the deploy workflow say what the runbook promises', () => {
  const compose = read('deploy/docker-compose.yml');
  assert.match(compose, /^name: junkyard$/m, 'a fixed project name so the volume is junkyard_verifier-data');
  assert.match(compose, /image: ghcr\.io\/blickz55\/junkyard-verifier:\$\{VERIFIER_TAG:-latest\}/, 'the GHCR image, tag from .env');
  assert.match(compose, /env_file: \.\/verifier\.env/, 'secrets from a file');
  assert.match(compose, /TRUST_PROXY: "1"/, 'the verifier trusts the proxy it sits behind');
  assert.match(compose, /- "127\.0\.0\.1:4400:4400"/, 'the verifier port is bound to the loopback only');
  assert.match(compose, /- verifier-data:\/data/, 'a named volume for the board');
  assert.equal((compose.match(/max-size: "20m"/g) || []).length, 2, 'log rotation on both services');
  assert.match(compose, /condition: service_healthy/, 'Caddy waits for the verifier (the image has a HEALTHCHECK)');
  assert.match(compose, /- "443:443\/udp"/, 'HTTP/3');
  const caddy = read('deploy/Caddyfile');
  assert.match(caddy, /^verify\.\{\$DOMAIN\} \{/m, 'the verifier on a subdomain');
  assert.match(caddy, /Strict-Transport-Security "max-age=31536000; includeSubDomains"/);
  assert.match(caddy, /reverse_proxy verifier:4400 \{\s*header_up X-Real-IP \{remote_host\}/, 'the client address reaches the verifier as X-Real-IP');
  assert.match(caddy, /email \{\$ACME_EMAIL\}/); assert.match(caddy, /admin off/);
  assert.match(caddy, /format filter \{\s*wrap json\s*fields \{[^}]*request>remote_ip delete[^}]*request>client_ip delete[^}]*request>headers>X-Forwarded-For delete/, 'the access log drops the client address (0.8.6: the privacy notice promises no log stores it)');
  const env = read('deploy/.env.example'); for (const k of ['DOMAIN', 'ACME_EMAIL', 'VERIFIER_TAG']) assert.match(env, new RegExp(`^${k}=`, 'm'));
  const venv = read('deploy/verifier.env.example'); for (const k of ['DAILY_SECRET', 'MODERATION_TOKEN', 'CORS_ORIGIN', 'DISCORD_WEBHOOK_URL']) assert.match(venv, new RegExp(`^${k}=`, 'm'));
  assert.doesNotMatch(venv, /^DAILY_SECRET=.+/m, 'the template carries no secret value');
  const ignore = read('.gitignore'); assert.match(ignore, /^deploy\/\.env$/m); assert.match(ignore, /^deploy\/verifier\.env$/m);
  const cron = read('deploy/backup.cron'); assert.match(cron, /docker volume inspect -f '\{\{\.Mountpoint\}\}' junkyard_verifier-data/, 'backups read the compose volume'); assert.match(cron, /--live http:\/\/127\.0\.0\.1:4400/);
  const wf = read('.github/workflows/deploy.yml');
  assert.match(wf, /workflows: \[ci\]/, 'deploys follow a ci run'); assert.match(wf, /workflow_run\.conclusion == 'success'/, 'only a green one');
  assert.match(wf, /vars\.CF_PAGES_PROJECT != ''/); assert.match(wf, /vars\.DEPLOY_HOST != ''/); assert.match(wf, /vars\.VERIFIER_URL/);
  assert.match(wf, /cloudflare\/wrangler-action@v3/); assert.match(wf, /pages deploy dist --project-name=/);
  assert.match(wf, /docker compose pull --quiet verifier/); assert.match(wf, /StrictHostKeyChecking=yes/, 'host key pinned from a secret, never accepted blindly');
  assert.match(wf, /tools\/mint-check\.ts "\$VERIFIER_URL"/, 'the public verifier is checked after a deploy');
  assert.doesNotMatch(wf, /DAILY_SECRET|MODERATION_TOKEN/, 'the workflow never touches the verifier secrets');
  const ci = read('.github/workflows/ci.yml'); assert.match(ci, /docker compose -f deploy\/docker-compose\.yml --env-file deploy\/\.env\.example config --quiet/); assert.match(ci, /caddy validate --config \/etc\/caddy\/Caddyfile/);
});

test('deploy: hosted rehearsal: a production build behind the rendered headers, a verifier with CORS for the site, hosted-check passes with a daily submission', { timeout: 240000 }, async () => {
  const WEB = 5197, VPORT = 4498;
  const site = `http://127.0.0.1:${WEB}`, verifierUrl = `http://127.0.0.1:${VPORT}`;
  const scratch = fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-deploy-'));
  const dist = path.join(scratch, 'dist');
  const { bundle } = await buildDist({ root: ROOT, dist, verifierUrl, reports: false });
  const rules = parseHeaders(fs.readFileSync(path.join(dist, '_headers'), 'utf8'));
  assert.equal(headersFor(rules, `/${bundle}`)['Cache-Control'], 'public, max-age=31536000, immutable', 'the rendered file names this build\'s bundle');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.png': 'image/png' };
  // a static server that applies dist/_headers like Pages (and, like Pages, never serves the _headers file itself)
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, site);
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
    const file = path.join(dist, rel);
    if (rel === '_headers' || !file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...headersFor(rules, u.pathname) });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(WEB, '127.0.0.1', r));
  const verifier = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], { env: { ...process.env, PORT: String(VPORT), DATA_DIR: path.join(scratch, 'data'), CORS_ORIGIN: site, DAILY_SECRET: 'deploy-test-secret', BOT_PAR: '0', VERIFIER_LOG: '0' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${verifierUrl}/health`)).ok) break; } catch {} await wait(500); }
    const report = path.join(scratch, 'hosted.json');
    const out = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools/hosted-check.ts'), site, '--submit-daily', '--name', 'deploy test', '--json', report], { cwd: ROOT, env: process.env });
      let text = ''; p.stdout.on('data', (d) => { text += d; }); p.stderr.on('data', (d) => { text += d; });
      p.on('close', (code) => resolve({ code, text }));
    });
    assert.equal(out.code, 0, `hosted-check exit 0:\n${out.text}`);
    const r = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(r.ok, true); assert.equal(r.checks.filter((c) => !c.ok).length, 0);
    const names = r.checks.map((c) => c.name);
    for (const n of ['site: Content-Security-Policy header present', "site: CSP header carries frame-ancestors 'none'", 'site: bundle Cache-Control immutable', 'verifier: CORS preflight allows the site origin', 'page: daily board line filled from the verifier', 'page: zero CSP violations', 'daily: legal run verified by the hosted verifier', 'daily: the run is on the daily board']) assert.ok(names.includes(n), `check ran: ${n}`);
    assert.equal(r.build.bundle, bundle); assert.equal(r.verifierUrl, verifierUrl);
    const daily = await (await fetch(`${verifierUrl}/daily`)).json();
    assert.equal(daily.entries.length, 1); assert.match(daily.entries[0].player, /^deploy test/);
    // the header-aware server really sent the rules (not just the tool's reading of them)
    const res = await fetch(`${site}/${bundle}`); assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable'); assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await fetch(`${site}/_headers`)).status, 404, 'the header file itself is not served');
  } finally {
    verifier.kill(); server.close();
    await wait(300);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
