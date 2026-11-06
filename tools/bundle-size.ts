/**
 * Bundle weight gate (production roadmap 0.10.2): the script a first visit loads, the bundle dist/build.json names plus the
 * chunks it imports statically, each gzipped at level 9 (what a CDN serves to a browser without brotli), must stay under the
 * budget; brotli is reported too. A chunk the game import()s on first use is not in it.
 *   node --import tsx tools/bundle-size.ts [--dist dist] [--max 300] [--forbid <regex>] [--json out.json]
 * Exit 1 over the budget (KiB). Run `npm run build` first.
 * `--forbid` scans every *.js under dist, the lazy chunks included, and fails on a match: what a web build must not carry
 * (the Steam bridge, `jdDesktop\??\.steam|steam-bridge` in perf.yml; the editions are in scripts/esbuild-config.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const dist = path.resolve(opt('dist', 'dist'));
const max = Number(opt('max', '300'));
const jsonOut = opt('json', '');
const forbid = opt('forbid', '');

export interface BundleWeight {
  bundle: string;
  bytes: number;
  gzipKiB: number;
  brotliKiB: number;
  maxKiB: number;
  ok: boolean;
}
/** Measure files served one by one against a gzip budget in KiB. The first names the weight. */
export function weigh(files: string[], maxKiB: number): BundleWeight {
  const bufs = files.map((f) => fs.readFileSync(f));
  const sum = (n: (b: Buffer) => number) => bufs.reduce((total, b) => total + n(b), 0);
  const gzipKiB = sum((b) => zlib.gzipSync(b, { level: 9 }).length) / 1024;
  const brotliKiB = sum((b) => zlib.brotliCompressSync(b).length) / 1024;
  return { bundle: path.basename(files[0]), bytes: sum((b) => b.length), gzipKiB, brotliKiB, maxKiB, ok: gzipKiB <= maxKiB };
}
/**
 * Every *.js under `dist` (not only what a first visit loads: a chunk behind an import() counts too) whose text matches `re`,
 * as posix paths relative to `dist`, sorted. Empty is the pass.
 */
export function forbidden(dist: string, re: RegExp): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        re.lastIndex = 0; // a global or sticky expression would otherwise carry its position from one file to the next
        if (re.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(dist, p).split(path.sep).join('/'));
      }
    }
  };
  walk(dist);
  return hits.sort();
}

const isMain = process.argv[1] && /bundle-size\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const build = JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')) as { bundle: string; initial: string[] };
  const w = weigh(
    build.initial.map((f) => path.join(dist, f)),
    max,
  );
  console.log(
    `${w.ok ? 'PASS' : 'FAIL'} ${w.bundle}: ${(w.bytes / 1024).toFixed(0)} KiB minified, ${w.gzipKiB.toFixed(1)} KiB gzip (budget ${max}), ${w.brotliKiB.toFixed(1)} KiB brotli`,
  );
  const hits = forbid ? forbidden(dist, new RegExp(forbid)) : [];
  if (forbid) console.log(hits.length ? `FAIL /${forbid}/ found in ${hits.join(', ')}` : `PASS nothing under ${path.basename(dist)}/ matches /${forbid}/`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ ...w, forbid: forbid || null, forbidden: hits, at: new Date().toISOString() }, null, 2));
  process.exit(w.ok && hits.length === 0 ? 0 : 1);
}
