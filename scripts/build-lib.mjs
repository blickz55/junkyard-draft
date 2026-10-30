// The production build as a function (production roadmap 0.8.0): `scripts/build.mjs` calls it for dist/, and
// tests/hardening-e2e.test.mjs calls it into a scratch directory to exercise a real hosted-style build. One build path.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildOptions, cspFor, DEFAULT_VERIFIER_URL } from './esbuild-config.mjs';

/**
 * Bundle game/src/main.ts into `dist` with the verifier URL and CSP baked in, copy index.html (rewritten) and game/public,
 * write build.json. Returns { size, commit, version }. `reports` (default true) also writes the esbuild metafile under
 * .control-room/reports/.
 */
export async function buildDist({ root, dist, verifierUrl = process.env.VERIFIER_URL || DEFAULT_VERIFIER_URL, reports = true }) {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const result = await build({ ...buildOptions({ root, outdir: dist, dev: false, commit, version: pkg.version, verifierUrl }), minify: true, sourcemap: false, metafile: true, logLevel: reports ? 'info' : 'warning' });
  if (reports) {
    const dir = path.join(root, '.control-room', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify(result.metafile, null, 1));
  }
  if (fs.existsSync(path.join(root, 'game', 'public'))) fs.cpSync(path.join(root, 'game', 'public'), dist, { recursive: true });
  const html = fs.readFileSync(path.join(root, 'game', 'index.html'), 'utf8')
    .replace('/src/main.ts', './main.js')
    .replace('__BUILD__', `${pkg.version}+${commit}`)
    .replace('__CSP__', cspFor({ dev: false, verifierUrl }));
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  fs.writeFileSync(path.join(dist, 'build.json'), JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), dev: false, verifierUrl }, null, 2));
  const size = fs.statSync(path.join(dist, 'main.js')).size;
  return { size, commit, version: pkg.version };
}
