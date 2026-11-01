#!/usr/bin/env node
// The tester build, for paid playtests on a private link: the game with no server behind it, in dist-test/. The lessons, today's
// yard and practice yards all work; what needs a server stays out of sight (render/config.ts, isTestEdition). Search engines are
// told to stay away, and there is no service worker, so a fix reaches the next load. deploy/README.md says how it goes online.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDist } from './build-lib.mjs';

/** The same value as NO_SERVER in game/src/render/config.ts. */
export const NO_SERVER = 'https://verify.invalid';

/** Build it into `dist`. Exported for tests/test-edition-e2e.test.mjs. */
export async function buildTest({ root, dist, reports = false }) {
  const out = await buildDist({ root, dist, verifierUrl: NO_SERVER, reports });
  fs.appendFileSync(path.join(dist, '_headers'), '/*\n  X-Robots-Tag: noindex\n');
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.rmSync(path.join(dist, 'sw.js'), { force: true });
  return out;
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { size, commit, bundle } = await buildTest({ root: ROOT, dist: path.join(ROOT, 'dist-test') });
  console.log(`built dist-test/ (${bundle} ${(size / 1024).toFixed(0)} KiB, commit ${commit})`);
}
