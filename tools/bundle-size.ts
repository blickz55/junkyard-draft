/**
 * Bundle weight gate (production roadmap 0.10.2): the production bundle named by dist/build.json, gzipped at level 9 (what a
 * CDN serves to a browser without brotli), must stay under the budget; brotli is reported too.
 *   node --import tsx tools/bundle-size.ts [--dist dist] [--max 300] [--json out.json]
 * Exit 1 over the budget (KiB). Run `npm run build` first.
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

export interface BundleWeight {
  bundle: string;
  bytes: number;
  gzipKiB: number;
  brotliKiB: number;
  maxKiB: number;
  ok: boolean;
}
/** Measure a bundle's weight against a gzip budget in KiB. */
export function weigh(file: string, maxKiB: number): BundleWeight {
  const buf = fs.readFileSync(file);
  const gzipKiB = zlib.gzipSync(buf, { level: 9 }).length / 1024;
  const brotliKiB = zlib.brotliCompressSync(buf).length / 1024;
  return { bundle: path.basename(file), bytes: buf.length, gzipKiB, brotliKiB, maxKiB, ok: gzipKiB <= maxKiB };
}

const isMain = process.argv[1] && /bundle-size\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const build = JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')) as { bundle: string };
  const w = weigh(path.join(dist, build.bundle), max);
  console.log(
    `${w.ok ? 'PASS' : 'FAIL'} ${w.bundle}: ${(w.bytes / 1024).toFixed(0)} KiB minified, ${w.gzipKiB.toFixed(1)} KiB gzip (budget ${max}), ${w.brotliKiB.toFixed(1)} KiB brotli`,
  );
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ ...w, at: new Date().toISOString() }, null, 2));
  process.exit(w.ok ? 0 : 1);
}
