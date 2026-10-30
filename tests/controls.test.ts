// Production roadmap 0.10.1: the action table is the single source for key bindings, the Tips key list and the build panel's keyboard line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLS, controlRows, keyboardHelpList, LONG_PRESS_MS, TAP_SLOP_PX } from '../game/src/content/controls';
import { TIP_DEMOS } from '../game/src/sim/tips';

test('controls: ids are unique, every row has its four texts, every bound key is named in the keys text', () => {
  assert.equal(new Set(CONTROLS.map((c) => c.id)).size, CONTROLS.length, 'ids are unique');
  const rows = controlRows();
  assert.equal(rows.length, CONTROLS.length);
  const names: Record<string, RegExp> = {
    ONE: /1/,
    TWO: /2/,
    THREE: /3/,
    TAB: /Tab/,
    UP: /arrow/,
    DOWN: /arrow/,
    LEFT: /arrow/,
    RIGHT: /arrow/,
    ENTER: /Enter/,
    R: /\bR\b/,
    DELETE: /Delete/,
    BACKSPACE: /Delete/, // Backspace does what Delete does; the table names the one key
    Z: /Ctrl\+(Shift\+)?Z/,
    Y: /Ctrl\+Y/,
    SPACE: /Space/,
    ESC: /Esc/,
    PERIOD: /\. key/,
    M: /\bM\b/,
  };
  for (const c of CONTROLS) {
    const row = rows.find((r) => r.id === c.id)!;
    for (const part of ['label', 'keys', 'mouse', 'touch'] as const) assert.ok(row[part].length > 0, `${c.id}.${part} has text`);
    for (const b of c.keys) assert.match(row.keys, names[b.key], `${c.id}: the keys text names ${b.key}`);
  }
  // Space serves two moments (start, next); every other key maps to one control
  const byKey = new Map<string, string[]>();
  for (const c of CONTROLS)
    for (const b of c.keys) byKey.set(`${b.key}${b.ctrl ? '+ctrl' : ''}${b.shift ? '+shift' : ''}`, [...(byKey.get(b.key) ?? []), c.id]);
  for (const [k, ids] of byKey) if (k !== 'SPACE') assert.equal(ids.length, 1, `${k} binds one control (${ids.join(', ')})`);
});

test('controls: the keyboard line lists the placement actions with their keys; the touch constants are sane', () => {
  const line = keyboardHelpList();
  for (const c of CONTROLS.filter((x) => x.placement))
    assert.ok(line.includes(controlRows().find((r) => r.id === c.id)!.label), `${c.id} in the keyboard line`);
  assert.match(line, /Tab/);
  assert.match(line, /Enter/);
  assert.match(line, /\bR\b/);
  assert.match(line, /Delete/);
  assert.doesNotMatch(line, /Space|Ctrl/, 'the shift and history keys are not placement keys');
  assert.ok(LONG_PRESS_MS >= 150 && LONG_PRESS_MS <= 500, 'a long press is between a tap and a wait');
  assert.ok(TAP_SLOP_PX >= 4 && TAP_SLOP_PX <= 24);
});

test('controls: the Tips panel lists the table (a text-only tip named controls exists)', () => {
  const tip = TIP_DEMOS.find((d) => d.id === 'controls');
  assert.ok(tip && tip.layout === null && tip.machine === null, 'the controls tip is text-only and never suggested by a draft');
});
