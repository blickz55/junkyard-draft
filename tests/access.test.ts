// Production roadmap 0.12.4: moving a key and reading the yard. Every slot is named and unique, a key press has a name Phaser fires, a key that does
// something else is refused, the pages that list the keys say what actually works, and the yard reads in words: where, what, which way, and
// whether its way out goes anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundKey, CONTROLS, controlRows, keyboardHelpList, keyLabel, slotId, type KeyMap } from '../game/src/content/controls';
import { KEY_SLOTS, keyNameOf, takenBy } from '../game/src/content/keymap';
import { STRING_KEYS } from '../game/src/content/strings';
import { MORE_STRINGS } from '../game/src/content/strings-more';
import { newRun, type RunState } from '../game/src/sim/run';
import { cellLine, yardLines } from '../game/src/render/mirror';
import type { Machine, MachineKind } from '../game/src/sim/types';

const slot = (id: string) => KEY_SLOTS.find((s) => s.id === id)!;

test('every key of every action is a slot of its own', () => {
  assert.equal(new Set(KEY_SLOTS.map((s) => s.id)).size, KEY_SLOTS.length);
  assert.equal(
    KEY_SLOTS.length,
    CONTROLS.reduce((n, c) => n + c.keys.length, 0),
  );
  assert.ok(slot('rotate.R'));
  assert.ok(slot('undo.ctrl+Z'));
  assert.ok(slot('redo.ctrl+shift+Z'));
  const rotate = CONTROLS.find((c) => c.id === 'rotate')!;
  assert.equal(slotId(rotate, rotate.keys[0]), 'rotate.R');
});

test('a key press has the name Phaser fires, and a key that cannot carry an action has none', () => {
  assert.equal(keyNameOf(70), 'F');
  assert.equal(keyNameOf(49), 'ONE');
  assert.equal(keyNameOf(48), 'ZERO');
  assert.equal(keyNameOf(38), 'UP');
  assert.equal(keyNameOf(32), 'SPACE');
  assert.equal(keyNameOf(190), 'PERIOD');
  assert.equal(keyNameOf(112), 'F1');
  assert.equal(keyNameOf(123), 'F12');
  for (const modifier of [16, 17, 18, 91, 20, 0]) assert.equal(keyNameOf(modifier), null, String(modifier));
  for (const c of CONTROLS) for (const b of c.keys) assert.ok(/^[A-Z_0-9]+$/.test(b.key), b.key);
  const codes = Array.from({ length: 256 }, (_, i) => keyNameOf(i)).filter(Boolean);
  for (const c of CONTROLS) for (const b of c.keys) assert.ok(codes.includes(b.key), `${b.key} can be moved back to by pressing it`);
});

test('a key reads as a player would say it', () => {
  assert.equal(keyLabel({ key: 'F' }), 'F');
  assert.equal(keyLabel({ key: 'ONE' }), '1');
  assert.equal(keyLabel({ key: 'SPACE' }), 'Space');
  assert.equal(keyLabel({ key: 'PERIOD' }), '.');
  assert.equal(keyLabel({ key: 'Z', ctrl: true }), 'Ctrl+Z');
  assert.equal(keyLabel({ key: 'Z', ctrl: true, shift: true }), 'Ctrl+Shift+Z');
  assert.equal(keyLabel({ key: 'UP', shift: true }), 'Shift+Up');
  assert.equal(keyLabel({ key: 'F7' }), 'F7');
});

test('a key that does something else is refused, by name; a chord is a key of its own; start and next may share', () => {
  const map: KeyMap = {};
  assert.equal(takenBy(map, slot('rotate.R'), { key: 'M' })?.id, 'mute.M');
  assert.equal(takenBy(map, slot('rotate.R'), { key: 'F' }), null);
  assert.equal(takenBy(map, slot('rotate.R'), { key: 'R' }), null, 'its own key is free');
  assert.equal(takenBy(map, slot('rotate.R'), { key: 'Z' }), null, 'Z alone is not Ctrl+Z');
  assert.equal(takenBy(map, slot('rotate.R'), { key: 'Z', ctrl: true })?.id, 'undo.ctrl+Z');
  assert.equal(takenBy(map, slot('start.SPACE'), { key: 'SPACE' }), null);
  assert.equal(takenBy(map, slot('next.SPACE'), { key: 'SPACE' }), null, 'a shift starts and the next one starts at different moments');
  assert.equal(takenBy(map, slot('rotate.R'), { key: 'SPACE' })?.control.id, 'start');
  const moved: KeyMap = { 'mute.M': { key: 'N' } };
  assert.equal(takenBy(moved, slot('rotate.R'), { key: 'M' }), null, 'a key that moved away is free');
  assert.equal(takenBy(moved, slot('rotate.R'), { key: 'N' })?.id, 'mute.M', 'and where it went is not');
});

test('what the pages say follows the keys: the usual words until one moves, then the keys that work', () => {
  const words = (map: KeyMap, id: string) => controlRows(map).find((r) => r.id === id)!.keys;
  assert.equal(words({}, 'rotate'), 'R');
  assert.equal(words({}, 'place'), 'arrow keys move the cursor, Enter places');
  assert.equal(words({}, 'move'), 'Enter picks it up at the cursor, Enter drops it');
  assert.equal(words({ 'rotate.R': { key: 'F' } }, 'rotate'), 'F');
  const wasd: KeyMap = {
    'place.UP': { key: 'W' },
    'place.DOWN': { key: 'S' },
    'place.LEFT': { key: 'A' },
    'place.RIGHT': { key: 'D' },
    'place.ENTER': { key: 'E' },
  };
  assert.equal(words(wasd, 'place'), 'W, S, A, D, E');
  assert.equal(words(wasd, 'move'), 'E picks it up at the cursor, E drops it', 'a row with no keys of its own names the one it borrows');
  assert.match(keyboardHelpList(wasd), /W, S, A, D, E/);
  assert.match(keyboardHelpList({}), /arrow keys/);
  const rotate = CONTROLS.find((c) => c.id === 'rotate')!;
  assert.deepEqual(boundKey(rotate, rotate.keys[0], {}), { key: 'R' });
  assert.deepEqual(boundKey(rotate, rotate.keys[0], { 'rotate.R': { key: 'F' } }), { key: 'F' });
});

test('every string the panel needs is in the table, on the side of the import it should be', () => {
  const first = new Set<string>(STRING_KEYS);
  for (const k of ['keys.head', 'keys.open', 'keys.space', 'mirror.head', 'mirror.machine']) assert.ok(first.has(k), k);
  for (const k of ['keys.lead', 'keys.press', 'keys.taken', 'keys.reset']) assert.ok(k in MORE_STRINGS, k);
});

/** A run with these machines on its yard, by hand: the words are what is under test here. */
function yard(machines: Omit<Machine, 'id'>[], rubble: number[] = [], bin: MachineKind[] = []): RunState {
  const run = newRun('classic-mirror');
  run.layout.machines = machines.map((m, i) => ({ ...m, id: i + 1 }));
  run.layout.rubble = rubble;
  run.bin = bin.map((kind, i) => ({ id: 100 + i, kind, x: -1, y: -1, dir: 0 }));
  return run;
}

test('the yard in words: where, what, which way, and whether its way out goes anywhere, row by row', () => {
  const run = yard(
    [
      { kind: 'conveyor', x: 2, y: 1, dir: 0 },
      { kind: 'hopper', x: 1, y: 1, dir: 0 },
      { kind: 'conveyor', x: 0, y: 0, dir: 1 },
    ],
    [12],
    ['crusher'],
  );
  const lines = yardLines(run);
  assert.match(lines[0], /^The yard is \d+ spots wide and \d+ spots deep\./);
  assert.equal(lines[1], 'Row 1, column 1: Conveyor, facing down, its way out goes nowhere');
  assert.equal(lines[2], 'Row 2, column 2: Scrap Hopper, facing right, joined to what comes next');
  assert.equal(lines[3], 'Row 2, column 3: Conveyor, facing right, its way out goes nowhere');
  assert.match(lines[4], /^Row \d+, column \d+: rubble, nothing can go here$/);
  assert.equal(lines[5], 'On the shelf: Crusher');
  assert.equal(lines.length, 6);
});

test('what the cursor is on, with what is in hand', () => {
  const run = yard([{ kind: 'conveyor', x: 2, y: 1, dir: 3 }], [0]);
  assert.equal(cellLine(run, 2, 1), 'Row 2, column 3: Conveyor, facing up, its way out goes nowhere');
  assert.equal(cellLine(run, 4, 3), 'Row 4, column 5: empty');
  assert.equal(cellLine(run, 0, 0), 'Row 1, column 1: rubble, nothing can go here');
  assert.equal(cellLine(run, 4, 3, 'crusher'), 'Row 4, column 5: empty. Holding Crusher');
});
