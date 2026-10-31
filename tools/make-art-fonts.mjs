#!/usr/bin/env node
/**
 * The bundled fonts (docs/ART.md): Inter for the interface and Barlow Condensed for the display face, both SIL OFL 1.1, taken
 * from the npm @fontsource packages into game/public/fonts/ so that every platform lays the game out with the same metrics.
 * The packages are not dependencies of the project: this fetches them into a temporary folder, copies the Latin files and the
 * licences, and cuts two small subsets holding only what the pseudo-locale uses beyond Latin-1. The result is committed; run
 * this again only to change a version or a face.
 *
 *   node tools/make-art-fonts.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'game', 'public', 'fonts');
const INTER = '@fontsource-variable/inter@5.3.0';
const INTER_STATIC = '@fontsource/inter@5.3.0';
const BARLOW = '@fontsource/barlow-condensed@5.3.0';
/** Every accented letter of game/src/content/locale.ts beyond Latin-1, and the pad character. */
const PSEUDO = 'ĆćĎďĚěĞğĤĥĴĵĶķĹĺŃńŔŕŚśŠšŤťŴŵŹźŽžƁƑƒɓɗḿṀṁṼṽẊẋẍꝖꝗąęįǫųḡ≈';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-fonts-'));
const run = (cmd, cwd = tmp) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
/** Fetch one package tarball and unpack it into a folder of its own; returns that folder. */
function unpack(spec) {
  const tgz = run(`npm pack ${spec} --silent`).trim().split('\n').pop();
  const dir = path.join(tmp, tgz.replace(/\.tgz$/, ''));
  fs.mkdirSync(dir);
  run(`tar -xzf "../${tgz}"`, dir); // a relative path: tar on Windows reads "C:" as a remote host
  return path.join(dir, 'package');
}
try {
  fs.mkdirSync(OUT, { recursive: true });
  const inter = unpack(INTER);
  const interStatic = unpack(INTER_STATIC);
  const barlow = unpack(BARLOW);
  fs.copyFileSync(path.join(inter, 'files', 'inter-latin-wght-normal.woff2'), path.join(OUT, 'inter-latin-wght-normal.woff2'));
  fs.copyFileSync(path.join(barlow, 'files', 'barlow-condensed-latin-700-normal.woff2'), path.join(OUT, 'barlow-condensed-latin-700-normal.woff2'));
  fs.copyFileSync(path.join(inter, 'LICENSE'), path.join(OUT, 'OFL-Inter.txt'));
  fs.copyFileSync(path.join(barlow, 'LICENSE'), path.join(OUT, 'OFL-BarlowCondensed.txt'));
  // the subsetter stays in the temporary folder too
  const sub = path.join(tmp, 'subset');
  fs.mkdirSync(sub);
  run('npm init -y --silent', sub);
  run('npm i subset-font@2.9.0 --ignore-scripts --no-audit --no-fund --silent', sub);
  const { default: subsetFont } = await import(pathToFileURL(path.join(sub, 'node_modules', 'subset-font', 'index.js')));
  for (const [from, to] of [
    [path.join(interStatic, 'files', 'inter-latin-ext-400-normal.woff2'), 'inter-pseudo.woff2'],
    [path.join(barlow, 'files', 'barlow-condensed-latin-ext-700-normal.woff2'), 'barlow-condensed-pseudo.woff2'],
  ])
    fs.writeFileSync(path.join(OUT, to), await subsetFont(fs.readFileSync(from), PSEUDO, { targetFormat: 'woff2' }));
  for (const f of fs.readdirSync(OUT)) console.log(`${f}  ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KiB`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
