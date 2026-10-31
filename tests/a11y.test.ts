import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditContrast, auditCvd, MATERIALS, SPRITES } from '../tools/a11y-audit';
import { contrast, deltaE, hexToRgb, shiftValue, simulate } from '../tools/a11y-lib';

test('every text/background pair the UI draws meets WCAG AA contrast', () => {
  const results = auditContrast();
  const fails = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.ratio}:1 < ${r.required}:1`);
  assert.deepEqual(fails, []);
  assert.ok(results.length >= 18, 'the audit covers the known pairs');
});

test('materials and semantic colours stay apart under protanopia, deuteranopia and tritanopia', () => {
  const results = auditCvd();
  const fails = results.filter((r) => !r.ok).map((r) => `${r.group} ${r.a}/${r.b} @${r.kind}: ΔE ${r.deltaE}, ΔL* ${r.deltaL}`);
  assert.deepEqual(fails, []);
  // shards vs plate are the two light greys: keep them clearly apart in every simulation
  for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
    const d = deltaE(simulate(MATERIALS.shards, kind), simulate(MATERIALS.plate, kind));
    assert.ok(d >= 20, `shards vs plate under ${kind}: ΔE ${d.toFixed(1)} < 20`);
  }
});

test('the item sprites as drawn stay apart too: their measured mean colours pass the same rule, and each stays near its palette colour', () => {
  assert.deepEqual(Object.keys(SPRITES).sort(), Object.keys(MATERIALS).sort(), 'every material has a measured sprite');
  const results = auditCvd({ sprites: SPRITES });
  assert.deepEqual(
    results.filter((r) => !r.ok).map((r) => `${r.a}/${r.b} @${r.kind}: ΔE ${r.deltaE}, ΔL* ${r.deltaL}`),
    [],
  );
  for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
    const d = deltaE(simulate(SPRITES.shards, kind), simulate(SPRITES.plate, kind));
    assert.ok(d >= 20, `shards vs plate sprites under ${kind}: ΔE ${d.toFixed(1)} < 20`);
  }
  for (const m of Object.keys(SPRITES)) assert.ok(deltaE(SPRITES[m], MATERIALS[m]) < 25, `${m}: the sprite has drifted from its palette colour`);
});

test('hover_colors_meet_AA: button hover states keep their label contrast (the old brighten-everything hover dropped dark-steel to 3.1:1)', () => {
  const results = auditContrast();
  const hovers = results.filter((r) => / \(hover\)$/.test(r.name));
  assert.equal(hovers.length, 3, 'all three button colours have a hover pair in the audit');
  for (const h of hovers) assert.ok(h.ok, `${h.name}: ${h.ratio}:1 < ${h.required}:1`);
  const steelDarkHover = hovers.find((h) => h.name.startsWith('button label on steelDark'))!;
  assert.ok(steelDarkHover.ratio >= 4.5, `dark-steel hover is ${steelDarkHover.ratio}:1`);
  // the rejected design, for the record: brightening dark steel under light text fails AA
  const brightened = contrast(hexToRgb('#f1e8d8'), shiftValue(hexToRgb(0x5a6670), 12));
  assert.ok(brightened < 4.5, `brightened dark steel would be ${brightened.toFixed(2)}:1`);
});

test('colour math sanity: black/white contrast is 21:1, identity simulation is a no-op', () => {
  assert.equal(+contrast(hexToRgb('#000000'), hexToRgb('#ffffff')).toFixed(0), 21);
  const c = hexToRgb('#f0a830');
  assert.ok(deltaE(simulate(c, 'normal'), c) < 0.5);
});

test('dom_ui_uses_audited_colours: every colour literal in the DOM stylesheet is a palette colour the audit covers', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../game/src/ui/dom.ts', import.meta.url), 'utf8');
  const { CSS, P } = await import('../game/src/render/palette');
  const literals = [...src.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1].toLowerCase());
  assert.ok(literals.length >= 6, 'the stylesheet names colours');
  const known = new Set([...Object.values(CSS).map((c) => c.replace('#', '').toLowerCase()), ...Object.values(P).map((v) => v.toString(16).padStart(6, '0'))]);
  const unknown = literals.filter((c) => !known.has(c));
  assert.deepEqual([...new Set(unknown)], [], 'colours outside the palette: ' + unknown.join(','));
});
