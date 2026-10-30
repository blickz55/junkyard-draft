/**
 * Hosted acceptance check (production roadmap 0.8.5): the game as served from its public origin, the verifier it was built
 * against, and the two talking to each other.
 *   node --import tsx tools/hosted-check.ts https://junkyarddraft.com [--submit-daily] [--name "hosted check"] [--no-headers] [--json out.json]
 * Checks, in order:
 *   1. the site: / answers 200 with the Content-Security-Policy header (frame-ancestors included), nosniff, X-Frame-Options,
 *      Cache-Control no-cache; build.json names the bundle and the baked verifier; the bundle is served immutable (--no-headers
 *      skips the header assertions for a host that is not Cloudflare Pages, e.g. a plain static server);
 *   2. the verifier: /health ok with this checkout's rules version; a CORS preflight for the site origin is allowed;
 *   3. the page in Chromium (Playwright): the title loads from the real origin, the daily board line is filled from the
 *      verifier (so the baked URL, the CSP's connect-src and CORS agree), zero CSP violations and zero page errors;
 *      a screenshot goes to .control-room/screenshots/hosted-<date>.png;
 *   4. with --submit-daily: a legal run on today's minted daily seed (the same crusher line the gameplay e2e submits) is
 *      sent to POST /verify as `--name` and must verify. This writes a REAL entry on the live daily board under that name:
 *      run it once for the acceptance, not from a schedule.
 * Exit 0 when every check passes, 1 on a failed check, 2 on usage. The JSON report lists every check with its result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, newRun } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const site = args.find((a) => /^https?:\/\//.test(a));
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!site) {
  console.error('usage: hosted-check <site-url> [--submit-daily] [--name N] [--no-headers] [--json out]');
  process.exit(2);
}
const origin = new URL(site).origin;
const checkHeaders = !args.includes('--no-headers');
const submitDaily = args.includes('--submit-daily');
const playerName = flag('name') ?? 'hosted check';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  return ok;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dailyRun(seed: string) {
  const run = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    const i = run.offers.indexOf('crusher');
    apply(run, { t: 'pick', i: i >= 0 ? i : 0 });
    if (r === 1) {
      const conv = run.layout.machines.find((m) => m.x === 2 && m.y === 2)!;
      apply(run, { t: 'unplace', id: conv.id });
      apply(run, { t: 'place', id: run.bin[0].id, x: 2, y: 2, dir: 0 });
    }
    apply(run, { t: 'run' });
    apply(run, { t: 'next' });
  }
  return run;
}

async function main(): Promise<number> {
  // 1. the site
  const page = await fetch(`${origin}/`, { redirect: 'manual' });
  check('site: / answers 200', page.status === 200, `status ${page.status}`);
  for (const id of ['privacy', 'terms', 'guidelines']) {
    // 0.8.6: the legal pages are reachable from outside the game too
    try {
      const r = await fetch(`${origin}/legal/${id}.html`);
      const t = r.ok ? await r.text() : '';
      check(
        `site: legal/${id}.html served as a page`,
        r.ok && /text\/html/.test(r.headers.get('content-type') || '') && /<h1>/.test(t),
        `status ${r.status} ${r.headers.get('content-type') || ''}`,
      );
    } catch (e) {
      check(`site: legal/${id}.html served as a page`, false, String(e));
    }
  }
  const html = await page.text();
  const csp = page.headers.get('content-security-policy');
  if (checkHeaders) {
    check('site: Content-Security-Policy header present', !!csp, csp ? csp.slice(0, 80) + '...' : 'missing');
    check("site: CSP header carries frame-ancestors 'none'", /frame-ancestors 'none'/.test(csp || ''));
    check('site: X-Content-Type-Options nosniff', page.headers.get('x-content-type-options') === 'nosniff');
    check('site: X-Frame-Options DENY', (page.headers.get('x-frame-options') || '').toUpperCase() === 'DENY');
    check('site: page Cache-Control no-cache', /no-cache/.test(page.headers.get('cache-control') || ''), page.headers.get('cache-control') || 'missing');
  }
  const metaCsp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  check('site: CSP meta present in the page', !!metaCsp);
  const buildRes = await fetch(`${origin}/build.json`);
  const build = buildRes.ok ? ((await buildRes.json()) as { version?: string; commit?: string; verifierUrl?: string; bundle?: string }) : {};
  check(
    'site: build.json readable',
    buildRes.ok && !!build.bundle,
    buildRes.ok ? `${build.version}+${build.commit} ${build.bundle}` : `status ${buildRes.status}`,
  );
  const verifierUrl = build.verifierUrl || '';
  check(
    'site: baked verifier is https (or loopback)',
    /^https:\/\//.test(verifierUrl) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(verifierUrl),
    verifierUrl || 'none',
  );
  check('site: page references the built bundle', !!build.bundle && html.includes(`./${build.bundle}`), build.bundle);
  check('site: CSP connect-src names the baked verifier', !!metaCsp && new RegExp(`connect-src 'self' ${escapeRe(verifierUrl)}(;|$)`).test(metaCsp));
  if (build.bundle) {
    const js = await fetch(`${origin}/${build.bundle}`);
    check(
      'site: bundle served as JavaScript',
      js.ok && (js.headers.get('content-type') || '').includes('javascript'),
      `status ${js.status} ${js.headers.get('content-type')}`,
    );
    if (checkHeaders)
      check('site: bundle Cache-Control immutable', /immutable/.test(js.headers.get('cache-control') || ''), js.headers.get('cache-control') || 'missing');
  }
  // 2. the verifier
  let health: { ok?: boolean; rulesVersion?: number; protocol?: number; entries?: number } = {};
  try {
    const r = await fetch(`${verifierUrl}/health`);
    health = r.ok ? ((await r.json()) as typeof health) : {};
    check('verifier: /health ok', !!health.ok, `status ${r.status}, rules v${health.rulesVersion}, protocol ${health.protocol}, entries ${health.entries}`);
  } catch (e) {
    check('verifier: /health ok', false, String(e));
  }
  check('verifier: rules version matches this checkout', health.rulesVersion === RULES_VERSION, `${health.rulesVersion} vs ${RULES_VERSION}`);
  try {
    const pre = await fetch(`${verifierUrl}/verify`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' },
    });
    const allow = pre.headers.get('access-control-allow-origin');
    check(
      'verifier: CORS preflight allows the site origin',
      pre.status < 400 && (allow === '*' || allow === origin),
      `status ${pre.status}, allow-origin ${allow}`,
    );
  } catch (e) {
    check('verifier: CORS preflight allows the site origin', false, String(e));
  }
  // 3. the page in a browser
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1120, height: 700 } });
    await ctx.addInitScript(() => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    const p = await ctx.newPage();
    const errors: string[] = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await p.goto(`${origin}/`, { waitUntil: 'load' });
    let boardText = '';
    try {
      await p.waitForFunction(
        () => {
          const t = document.querySelector('[data-testid=daily-board]')?.textContent || '';
          return t !== '' && !/Checking/.test(t);
        },
        null,
        { timeout: 30000 },
      );
    } catch {
      /* reported below */
    }
    boardText =
      (await p
        .locator('[data-testid=daily-board]')
        .textContent({ timeout: 2000 })
        .catch(() => '')) || '';
    check(
      'page: daily board line filled from the verifier',
      boardText !== '' && !/Checking|unreachable|not reachable|offline|could not/i.test(boardText),
      boardText.slice(0, 120) || 'empty',
    );
    const violations = await p.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
    check('page: zero CSP violations', violations.length === 0, violations.slice(0, 3).join('; '));
    check('page: zero page errors', errors.length === 0, errors.slice(0, 3).join('; '));
    const shots = path.join(ROOT, '.control-room', 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    const shot = path.join(shots, `hosted-${new Date().toISOString().slice(0, 10)}.png`);
    await p.screenshot({ path: shot });
    console.log(`screenshot ${shot}`);
  } finally {
    await browser.close();
  }
  // 4. a real daily submission
  if (submitDaily) {
    try {
      const daily = (await (await fetch(`${verifierUrl}/daily`)).json()) as { seed: string; minted?: boolean; closesAt?: string };
      check('daily: minted seed issued', /^daily-\d{4}-\d{2}-\d{2}-[a-z2-7]{8}$/.test(daily.seed) && daily.minted === true, daily.seed);
      const run = dailyRun(daily.seed);
      const res = await fetch(`${verifierUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ replay: exportReplay(run), player: playerName }),
      });
      const body = (await res.json()) as { ok?: boolean; score?: number; recorded?: boolean; error?: string; code?: string; late?: boolean };
      const okOrDup = body.ok === true || body.code === 'duplicate';
      check(
        'daily: legal run verified by the hosted verifier',
        okOrDup,
        body.ok ? `score ${body.score}, recorded ${body.recorded}${body.late ? ' (late)' : ''}` : `${res.status} ${body.code ?? ''} ${body.error ?? ''}`,
      );
      if (body.ok) {
        const board = (await (await fetch(`${verifierUrl}/daily`)).json()) as { entries: { player: string; score: number }[] };
        check(
          'daily: the run is on the daily board',
          board.entries.some((e) => e.player.startsWith(playerName) && e.score === body.score),
          `${board.entries.length} entries`,
        );
      }
    } catch (e) {
      check('daily: legal run verified by the hosted verifier', false, String(e));
    }
  }
  const failed = checks.filter((c) => !c.ok);
  const report = { site: origin, verifierUrl, build, checkedAt: new Date().toISOString(), ok: failed.length === 0, checks };
  if (flag('json')) fs.writeFileSync(flag('json')!, JSON.stringify(report, null, 2) + '\n');
  console.log(failed.length ? `hosted check FAILED: ${failed.length} of ${checks.length}` : `hosted check OK: ${checks.length} checks`);
  return failed.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);
