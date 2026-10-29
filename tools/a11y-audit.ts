/**
 * Colour accessibility audit of the game's palette:
 *   1. WCAG contrast for every text/background pair the UI uses (4.5:1 for body text, 3:1 for large/bold ≥ 18 px)
 *   2. Material and semantic colours under protanopia / deuteranopia / tritanopia (Machado 2009): pairwise ΔE
 *      and lightness difference; a pair fails when ΔE < 12 AND ΔL* < 15 under any simulation (colour nearly
 *      identical with no lightness cue — shapes are still distinct, but colour should not actively mislead)
 *   3. With --sheet and a running dev server: renders the real item/tile textures under each simulation into
 *      docs/a11y/materials-cvd.png as visual evidence.
 *
 *   node --import tsx tools/a11y-audit.ts [--sheet] [--url http://127.0.0.1:5173] [--json out.json]
 * Exit code 1 when anything fails (used by tests/a11y.test.ts through the exported functions).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, CSS } from '../game/src/render/palette';
import { contrast, deltaE, deltaL, hexToRgb, over, rgbToHex, shiftValue, simulate, type CvdKind, type RGB } from './a11y-lib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface TextPair { name: string; fg: RGB; bg: RGB; px: number; bold?: boolean }
export interface ContrastResult extends TextPair { ratio: number; required: number; ok: boolean; fgHex: string; bgHex: string }

const bgPanel = hexToRgb(P.panel), bgBg = hexToRgb(P.bg), bgFloor = hexToRgb(P.floor);
const badgeBg = over(hexToRgb(0x000000), 0.8, bgFloor); // badge rectangle: black at 0.8 over the floor tile
const hintBg = over(hexToRgb(P.panel), 0.95, bgBg);

/** Every text/background combination the scenes draw (sizes at the 100 % text setting). */
export const TEXT_PAIRS: TextPair[] = [
  { name: 'body text on panel', fg: hexToRgb(CSS.text), bg: bgPanel, px: 14 },
  { name: 'dim text on panel (notes, legend)', fg: hexToRgb(CSS.dim), bg: bgPanel, px: 12 },
  { name: 'amber headings on panel', fg: hexToRgb(CSS.amber), bg: bgPanel, px: 13, bold: true },
  { name: 'gold score on panel', fg: hexToRgb(CSS.gold), bg: bgPanel, px: 16, bold: true },
  { name: 'green diagnostics on panel', fg: hexToRgb(CSS.green), bg: bgPanel, px: 13 },
  { name: 'red diagnostics on panel', fg: hexToRgb(CSS.red), bg: bgPanel, px: 13 },
  { name: 'blue text on panel', fg: hexToRgb(CSS.blue), bg: bgPanel, px: 13 },
  { name: 'dim mono on page background (title)', fg: hexToRgb(CSS.dim), bg: bgBg, px: 12 },
  { name: 'build label on page background', fg: hexToRgb('#948a79'), bg: bgBg, px: 11 },
  { name: 'button label on amber', fg: hexToRgb('#1a1612'), bg: hexToRgb(P.amber), px: 16, bold: true },
  { name: 'button label on steel', fg: hexToRgb('#1a1612'), bg: hexToRgb(P.steel), px: 16, bold: true },
  { name: 'button label on steelDark', fg: hexToRgb(CSS.text), bg: hexToRgb(P.steelDark), px: 12, bold: true },
  // interaction states (ui.ts hoverColor: dark labels get a brighter button, light labels a darker one)
  { name: 'button label on amber (hover)', fg: hexToRgb('#1a1612'), bg: shiftValue(hexToRgb(P.amber), 12), px: 16, bold: true },
  { name: 'button label on steel (hover)', fg: hexToRgb('#1a1612'), bg: shiftValue(hexToRgb(P.steel), 12), px: 16, bold: true },
  { name: 'button label on steelDark (hover)', fg: hexToRgb(CSS.text), bg: shiftValue(hexToRgb(P.steelDark), -12), px: 12, bold: true },
  { name: 'badge text on badge', fg: hexToRgb(CSS.text), bg: badgeBg, px: 10, bold: true },
  { name: 'badge dim on badge', fg: hexToRgb(CSS.dim), bg: badgeBg, px: 10, bold: true },
  { name: 'badge red on badge', fg: hexToRgb(CSS.red), bg: badgeBg, px: 10, bold: true },
  { name: 'badge green on badge', fg: hexToRgb(CSS.green), bg: badgeBg, px: 10, bold: true },
  { name: 'hint text on hint box', fg: hexToRgb(CSS.text), bg: hintBg, px: 13 },
  { name: 'draft card blurb (dim) on floor card', fg: hexToRgb(CSS.dim), bg: bgFloor, px: 13 },
  { name: 'draft card title on floor card', fg: hexToRgb(CSS.text), bg: bgFloor, px: 17, bold: true },
  { name: 'offer index [n] dim on floor card', fg: hexToRgb(CSS.dim), bg: bgFloor, px: 12 },
];

export function auditContrast(pairs = TEXT_PAIRS): ContrastResult[] {
  return pairs.map((p) => {
    const large = p.px >= 24 || (p.bold && p.px >= 18.66);
    const required = large ? 3 : 4.5;
    const ratio = +contrast(p.fg, p.bg).toFixed(2);
    return { ...p, ratio, required, ok: ratio >= required, fgHex: rgbToHex(p.fg), bgHex: rgbToHex(p.bg) };
  });
}

/** Colours that carry meaning on the grid. Shapes differ per material; colour must not actively mislead. */
export const MATERIALS: Record<string, RGB> = { scrap: hexToRgb(P.scrap), shards: hexToRgb(P.shards), plate: hexToRgb(P.plate), ingot: hexToRgb(P.ingot), slag: hexToRgb(P.slag) };
export const SEMANTIC: Record<string, RGB> = { ok: hexToRgb(P.ok), bad: hexToRgb(P.bad), amberSelect: hexToRgb(P.amber), cursorFrame: hexToRgb(P.cursor) };

export interface PairResult { group: string; a: string; b: string; kind: CvdKind; deltaE: number; deltaL: number; ok: boolean }
export function auditCvd(groups: Record<string, Record<string, RGB>> = { materials: MATERIALS, semantic: SEMANTIC }): PairResult[] {
  const out: PairResult[] = [];
  for (const [group, colors] of Object.entries(groups)) {
    const names = Object.keys(colors);
    for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as CvdKind[]) {
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const a = simulate(colors[names[i]], kind), b = simulate(colors[names[j]], kind);
        const dE = +deltaE(a, b).toFixed(1), dL = +deltaL(a, b).toFixed(1);
        out.push({ group, a: names[i], b: names[j], kind, deltaE: dE, deltaL: dL, ok: !(dE < 12 && dL < 15) });
      }
    }
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const contrastResults = auditContrast();
  const cvdResults = auditCvd();
  const failsC = contrastResults.filter((r) => !r.ok);
  const failsV = cvdResults.filter((r) => !r.ok);
  console.log('CONTRAST');
  for (const r of contrastResults) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(5)}:1 (need ${r.required}) ${r.name}  ${r.fgHex} on ${r.bgHex} @${r.px}px${r.bold ? ' bold' : ''}`);
  console.log('CVD (worst pair per group and simulation)');
  for (const group of ['materials', 'semantic']) for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as CvdKind[]) {
    const rows = cvdResults.filter((r) => r.group === group && r.kind === kind).sort((x, y) => x.deltaE - y.deltaE);
    const w = rows[0];
    console.log(`  ${w.ok ? 'ok  ' : 'FAIL'} ${group.padEnd(9)} ${kind.padEnd(13)} closest: ${w.a} vs ${w.b}  ΔE ${w.deltaE}  ΔL* ${w.deltaL}`);
  }
  const simulatedPalette = Object.fromEntries((['protanopia', 'deuteranopia', 'tritanopia'] as CvdKind[]).map((k) => [k, Object.fromEntries(Object.entries(MATERIALS).map(([n, c]) => [n, rgbToHex(simulate(c, k))]))]));
  const summary = { contrast: contrastResults, cvd: cvdResults, failures: { contrast: failsC.map((f) => f.name), cvd: failsV.map((f) => `${f.group}:${f.a}/${f.b}@${f.kind}`) }, simulatedPalette, at: new Date().toISOString() };
  const jsonOut = opt('json', '');
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 1) + '\n');

  if (args.includes('--sheet')) {
    const { chromium } = await import('playwright');
    const url = opt('url', 'http://127.0.0.1:5173');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
    await page.goto(`${url}/?dev=1`);
    await page.waitForFunction("!!window.__jdGame && window.__jdGame.textures.exists('i-plate')", null, { timeout: 15000 });
    const matrices = JSON.stringify((await import('./a11y-lib')).CVD);
    const dataUrl = (await page.evaluate(`((CVD) => {
      const keys = ['i-scrap', 'i-shards', 'i-plate', 'i-ingot', 'i-slag', 'tile-ok', 'tile-bad', 'tile-sel', 'tile-cursor', 'm-press', 'm-furnace', 'm-crusher'];
      const kinds = Object.keys(CVD);
      const cell = 72, pad = 10, labelW = 110;
      const c = document.createElement('canvas'); c.width = labelW + keys.length * (cell + pad) + pad; c.height = kinds.length * (cell + pad) + pad + 24; const g = c.getContext('2d');
      g.fillStyle = '#2a241d'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#f1e8d8'; g.font = '12px sans-serif';
      keys.forEach((k, i) => g.fillText(k.replace(/^(i|m|tile)-/, ''), labelW + i * (cell + pad) + 4, 16));
      const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      const srgb = (v) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      kinds.forEach((kind, row) => {
        const y = 24 + pad + row * (cell + pad);
        g.fillStyle = '#f1e8d8'; g.fillText(kind, 8, y + cell / 2 + 4);
        keys.forEach((k, col) => {
          const x = labelW + col * (cell + pad);
          const f = window.__jdGame.textures.getFrame(k); const src = f.source.image; // frame-aware: keys live in one atlas
          const t = document.createElement('canvas'); t.width = cell; t.height = cell; const tg = t.getContext('2d');
          tg.fillStyle = '#2a241d'; tg.fillRect(0, 0, cell, cell);
          const s = Math.min(cell / f.cutWidth, cell / f.cutHeight); tg.drawImage(src, f.cutX, f.cutY, f.cutWidth, f.cutHeight, (cell - f.cutWidth * s) / 2, (cell - f.cutHeight * s) / 2, f.cutWidth * s, f.cutHeight * s);
          const img = tg.getImageData(0, 0, cell, cell); const d = img.data; const m = CVD[kind];
          for (let p = 0; p < d.length; p += 4) { const r = lin(d[p] / 255), gg = lin(d[p + 1] / 255), b = lin(d[p + 2] / 255);
            const o = [0, 1, 2].map((i) => Math.max(0, Math.min(1, m[i][0] * r + m[i][1] * gg + m[i][2] * b)));
            d[p] = Math.round(srgb(o[0]) * 255); d[p + 1] = Math.round(srgb(o[1]) * 255); d[p + 2] = Math.round(srgb(o[2]) * 255); }
          tg.putImageData(img, 0, 0); g.drawImage(t, x, y);
        });
      });
      return c.toDataURL('image/png');
    })(${matrices})`)) as string;
    const outDir = path.join(ROOT, 'docs', 'a11y'); fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, opt('sheet-name', 'materials-cvd.png'));
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('contact sheet →', path.relative(ROOT, file));
    await browser.close();
  }
  console.log(`\n${failsC.length} contrast failure(s), ${failsV.length} CVD pair failure(s)`);
  process.exit(failsC.length + failsV.length ? 1 : 0);
}
