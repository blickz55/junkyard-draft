#!/usr/bin/env node
// The Steam build, edition 'steam' (scripts/esbuild-config.mjs), in dist-steam/: the same game as the web build with the Electron
// shell's Steam bridge module in (game/src/render/steam.ts, a chunk of its own; the web build never carries it). A Steam build goes
// into a depot and plays through the shell, so it bakes the hosted verifier: VERIFIER_URL must name it, and the loopback default
// is refused. There is no service worker (render/pwa.ts skips one on file:// anyway). The shell itself is unchanged: it reads the
// edition from dist/build.json (desktop/main.cjs), and steamworks.js is the owner's to install once an app id exists (desktop/README.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDist } from './build-lib.mjs';
import { DEFAULT_VERIFIER_URL } from './esbuild-config.mjs';

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i;

/** Build it into `dist`. `verifierUrl` defaults to VERIFIER_URL; unset, the loopback default or any loopback address is refused. Exported for tests/editions.test.mjs. */
export async function buildSteam({ root, dist, verifierUrl = process.env.VERIFIER_URL, reports = false }) {
  if (!verifierUrl || verifierUrl === DEFAULT_VERIFIER_URL || LOOPBACK.test(verifierUrl))
    throw new Error(
      `build-steam: a Steam build bakes the hosted verifier, so VERIFIER_URL must name it (got ${JSON.stringify(verifierUrl ?? '')}; the loopback default ${DEFAULT_VERIFIER_URL} is refused)`,
    );
  const out = await buildDist({ root, dist, verifierUrl, reports, edition: 'steam' });
  fs.rmSync(path.join(dist, 'sw.js'), { force: true });
  return out;
}

const SELF = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? '') === SELF) {
  const ROOT = path.resolve(path.dirname(SELF), '..');
  const { size, commit, bundle } = await buildSteam({ root: ROOT, dist: path.join(ROOT, 'dist-steam'), reports: true });
  console.log(`built dist-steam/ (${bundle} ${(size / 1024).toFixed(0)} KiB, commit ${commit}; edition steam, no service worker)`);
}
