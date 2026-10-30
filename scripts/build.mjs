#!/usr/bin/env node
// Production build: bundles game/src/main.ts with esbuild into dist/ (static, reproducible).
// esbuild is the same bundler Vite uses for transforms; Vite itself is not installable in the
// current sandbox (npm registry blocked), so this script is the single build path. The work lives in
// build-lib.mjs so the hardening e2e can build into a scratch directory the same way.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDist } from './build-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { size, commit, bundle } = await buildDist({ root: ROOT, dist: path.join(ROOT, 'dist') });
console.log(`built dist/ (${bundle} ${(size / 1024).toFixed(0)} KiB, commit ${commit}; _headers rendered)`);
