#!/usr/bin/env node
// Production build: bundles game/src/main.ts with esbuild into dist/ (static, reproducible).
// esbuild is the same bundler Vite uses for transforms; Vite itself is not installable in the
// current sandbox (npm registry blocked), so this script is the single build path.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildOptions } from './esbuild-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
await build({ ...buildOptions({ root: ROOT, outdir: DIST, dev: false, commit, version: pkg.version }), minify: true, sourcemap: false, metafile: true }).then((r) => {
  const reports = path.join(ROOT, '.control-room', 'reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'build-meta.json'), JSON.stringify(r.metafile, null, 1));
});
fs.copyFileSync(path.join(ROOT, 'game', 'index.html'), path.join(DIST, 'index.html'));
if (fs.existsSync(path.join(ROOT, 'game', 'public'))) fs.cpSync(path.join(ROOT, 'game', 'public'), DIST, { recursive: true });
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace('/src/main.ts', './main.js').replace('__BUILD__', `${pkg.version}+${commit}`);
fs.writeFileSync(path.join(DIST, 'index.html'), html);
fs.writeFileSync(path.join(DIST, 'build.json'), JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), dev: false, verifierUrl: process.env.VERIFIER_URL || 'http://127.0.0.1:4400' }, null, 2));
const size = fs.statSync(path.join(DIST, 'main.js')).size;
console.log(`built dist/ (main.js ${(size / 1024).toFixed(0)} KiB, commit ${commit})`);
