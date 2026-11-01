#!/usr/bin/env node
// The tester build, for paid playtests on a private link: the game with no game server behind it, in dist-test/. The lessons, today's
// yard and practice yards all work; what needs a server stays out of sight (render/config.ts, isTestEdition). Search engines are told to
// stay away, there is no service worker, so a fix reaches the next load, and a small worker keeps what testers did and said
// (deploy/test-link/worker.ts). `npm run deploy:test` puts it online.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildDist } from './build-lib.mjs';

/** The same value as NO_SERVER in game/src/render/config.ts. */
export const NO_SERVER = 'https://verify.invalid';

/** Build it into `dist`. Exported for tests/test-edition-e2e.test.mjs. */
export async function buildTest({ root, dist, reports = false }) {
  const out = await buildDist({ root, dist, verifierUrl: NO_SERVER, reports });
  // in the page-wide rule that is already there: a second /* rule replaces it on Cloudflare, security headers and all
  const headers = path.join(dist, '_headers');
  fs.writeFileSync(headers, fs.readFileSync(headers, 'utf8').replace(/^\/\*\n/m, '/*\n  X-Robots-Tag: noindex\n'));
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.rmSync(path.join(dist, 'sw.js'), { force: true });
  // what stands behind the link: only its two routes reach the worker, so the static game keeps its headers
  await build({
    entryPoints: [path.join(root, 'deploy', 'test-link', 'worker.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: path.join(dist, '_worker.js'),
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(dist, '_routes.json'), JSON.stringify({ version: 1, include: ['/events', '/feedback'], exclude: [] }));
  return out;
}

const SELF = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? '') === SELF) {
  const ROOT = path.resolve(path.dirname(SELF), '..');
  const { size, commit, bundle } = await buildTest({ root: ROOT, dist: path.join(ROOT, 'dist-test') });
  console.log(`built dist-test/ (${bundle} ${(size / 1024).toFixed(0)} KiB, commit ${commit})`);
}
