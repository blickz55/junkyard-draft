// The production build as a function (production roadmap 0.8.0): `scripts/build.mjs` calls it for dist/, and
// tests/hardening-e2e.test.mjs calls it into a scratch directory to exercise a real hosted-style build. One build path.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildOptions, cspFor, renderHeaders, DEFAULT_VERIFIER_URL } from './esbuild-config.mjs';

/**
 * Bundle game/src/main.ts into `dist` as main-<content hash>.js (0.8.5: the hosted bundle is cached immutably and every build
 * changes the name) with the verifier URL and CSP baked in, copy index.html (rewritten to the hashed name) and game/public,
 * render deploy/_headers into dist/_headers (Cloudflare Pages), write build.json. Returns { size, commit, version, bundle }. `reports` (default true) also writes the esbuild metafile under
 * .control-room/reports/.
 */
export async function buildDist({ root, dist, verifierUrl = process.env.VERIFIER_URL || DEFAULT_VERIFIER_URL, reports = true }) {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {}
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const result = await build({
    ...buildOptions({ root, outdir: dist, dev: false, commit, version: pkg.version, verifierUrl, entryNames: 'main-[hash]' }),
    minify: true,
    sourcemap: false,
    metafile: true,
    logLevel: reports ? 'info' : 'warning',
  });
  const bundle = path.basename(Object.keys(result.metafile.outputs).find((k) => k.endsWith('.js') && result.metafile.outputs[k].entryPoint) || '');
  if (!/^main-[A-Z0-9]{8}.js$/.test(bundle)) throw new Error(`unexpected bundle name ${JSON.stringify(bundle)}`);
  if (reports) {
    const dir = path.join(root, '.control-room', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify(result.metafile, null, 1));
  }
  if (fs.existsSync(path.join(root, 'game', 'public'))) fs.cpSync(path.join(root, 'game', 'public'), dist, { recursive: true });
  const html = fs
    .readFileSync(path.join(root, 'game', 'index.html'), 'utf8')
    .replace('/src/main.ts', `./${bundle}`)
    .replace('__BUILD__', `${pkg.version}+${commit}`)
    .replace('__CSP__', cspFor({ dev: false, verifierUrl }));
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  fs.writeFileSync(path.join(dist, '_headers'), renderHeaders(fs.readFileSync(path.join(root, 'deploy', '_headers'), 'utf8'), { verifierUrl, bundle }));
  fs.writeFileSync(
    path.join(dist, 'build.json'),
    JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), dev: false, verifierUrl, bundle }, null, 2),
  );
  const size = fs.statSync(path.join(dist, bundle)).size;
  return { size, commit, version: pkg.version, bundle };
}
