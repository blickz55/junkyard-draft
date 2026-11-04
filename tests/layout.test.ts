// Production roadmap 0.10.0: the board fit is pure geometry. The phone slots of the matrix give 46–50 px cells, the fit is
// centred, the scale is capped, and the camera centre maps the board's centre onto its CSS position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitBoard,
  boardCameraCenter,
  BOARD_W,
  BOARD_H,
  GRID_X,
  GRID_Y,
  MAX_BOARD_SCALE,
  binSlotXY,
  GRID_W,
  BIN_Y,
  BIN_H,
  setShelf,
  slotOfBin,
  shelfSlots,
  shelfSlotsOf,
  slotXY,
} from '../game/src/render/layout';
import { CELL } from '../game/src/render/textures';

test('fitBoard: a 390-wide phone slot gives 46–50 px cells; 412 too; the fit is centred and never above the cap', () => {
  const phone390 = fitBoard(390 - 10, Math.round((390 - 10) * (BOARD_H / BOARD_W)));
  assert.ok(CELL * phone390.s >= 46 && CELL * phone390.s <= 50, `390: ${CELL * phone390.s}`);
  const phone412 = fitBoard(412 - 10, Math.round((412 - 10) * (BOARD_H / BOARD_W)));
  assert.ok(CELL * phone412.s >= 46 && CELL * phone412.s <= 51, `412: ${CELL * phone412.s}`);
  const tall = fitBoard(500, 2000); // width-bound (under the cap)
  assert.ok(Math.abs(tall.w - 500) < 1e-9 && tall.dx === 0 && tall.dy === Math.round((2000 - tall.h) / 2));
  const wide = fitBoard(2000, 400); // height-bound (under the cap)
  assert.ok(Math.abs(wide.h - 400) < 1e-9 && wide.dy === 0 && wide.dx === Math.round((2000 - wide.w) / 2));
  const laptop = fitBoard(840, 654); // a 1280×800 slot would allow 1.19: the cap holds the cell at CELL (perf preset B)
  assert.equal(laptop.s, 1);
  const huge = fitBoard(4000, 4000);
  assert.equal(huge.s, MAX_BOARD_SCALE, 'the cap holds on a huge slot');
  assert.equal(huge.w, BOARD_W * MAX_BOARD_SCALE);
  assert.ok(fitBoard(0, 0).s > 0, 'a zero slot still gives a positive scale');
});

test('boardCameraCenter: the board centre lands at its CSS position for any slot, canvas and scale', () => {
  const cases: [number, number, number, number, number, number][] = [
    [576, 548, 0, 0, 576, 548],
    [374, 356, 5, 62, 390, 844],
    [840, 654, 8, 64, 1280, 800],
    [720, 685, 340, 64, 1920, 1080],
  ];
  for (const [sw, sh, bx, by, cw, ch] of cases) {
    const f = fitBoard(sw, sh);
    const left = bx + f.dx,
      top = by + f.dy;
    const c = boardCameraCenter(f, left, top, cw, ch);
    // a world point maps to CSS px as (world - centre) * s + canvas centre
    const css = (wx: number, wy: number) => ({ x: (wx - c.x) * f.s + cw / 2, y: (wy - c.y) * f.s + ch / 2 });
    const centre = css(GRID_X + BOARD_W / 2, GRID_Y + BOARD_H / 2);
    assert.ok(
      Math.abs(centre.x - (left + f.w / 2)) < 1e-6 && Math.abs(centre.y - (top + f.h / 2)) < 1e-6,
      `centre ${JSON.stringify(centre)} for slot ${sw}x${sh}`,
    );
    const origin = css(GRID_X, GRID_Y);
    assert.ok(Math.abs(origin.x - left) < 1e-6 && Math.abs(origin.y - top) < 1e-6, 'the grid origin lands at the board top-left');
  }
  assert.equal(fitBoard(576, 548).s, 1, "a slot the board's own size is scale 1");
  assert.deepEqual(boardCameraCenter(fitBoard(576, 548), 0, 0, 576, 548), { x: GRID_X + BOARD_W / 2, y: GRID_Y + BOARD_H / 2 });
});

test('binSlotXY: seven shelf slots fit inside the shelf panel', () => {
  for (let i = 0; i < 7; i++) {
    const { px, py } = binSlotXY(i);
    assert.ok(px >= GRID_X && px + CELL <= GRID_X + GRID_W, `slot ${i} inside the shelf width`);
    assert.ok(py >= BIN_Y && py + CELL <= BIN_Y + BIN_H, `slot ${i} inside the shelf height`);
  }
});

test('the shelf: belts share the last slot, every other part has its own from the first; past seven slots they sit closer and the last stays in its frame', () => {
  const parts = (n: number) => Array.from({ length: n }, () => ({ kind: 'hopper' }));
  setShelf(parts(4));
  const seven = Array.from({ length: 7 }, (_, i) => slotXY(i).px);
  setShelf(parts(7));
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => binSlotXY(i).px),
    seven,
    'seven parts sit as they always did',
  );
  for (const n of [8, 10, 13]) {
    setShelf(parts(n));
    assert.equal(shelfSlots(), n);
    assert.ok(slotXY(n - 1).px + CELL <= GRID_X + GRID_W, `${n} parts: the last inside the frame`);
    assert.equal(slotXY(0).px, seven[0], 'the first stays put');
  }
  const bin = [{ kind: 'conveyor' }, { kind: 'conveyor' }, { kind: 'hopper' }, { kind: 'conveyor' }, { kind: 'crusher' }, { kind: 'dock' }];
  assert.deepEqual(shelfSlotsOf(bin), [6, 6, 0, 6, 1, 2], 'the machines from the first slot, the belts on one stack in the last');
  setShelf(bin);
  assert.equal(shelfSlots(), 7, 'four slots fit in the seven');
  assert.deepEqual(binSlotXY(3), binSlotXY(0), 'every belt sits on the one stack');
  const crowded = [...parts(7), { kind: 'conveyor' }];
  assert.deepEqual(shelfSlotsOf(crowded), [0, 1, 2, 3, 4, 5, 6, 7], 'seven machines and the belts: the stack still last');
  setShelf(crowded);
  assert.equal(shelfSlots(), 8);
  setShelf(parts(7));
});

test('a shelf part keeps its slot while it stays: one placed leaves a gap, the rest stay put, and a new part takes the first free slot', () => {
  const part = (id: number, kind: string) => ({ id, kind });
  setShelf([part(1, 'hopper'), part(2, 'crusher'), part(3, 'dock'), part(9, 'conveyor')]);
  assert.deepEqual([0, 1, 2, 3].map(slotOfBin), [0, 1, 2, 6]);
  setShelf([part(2, 'crusher'), part(3, 'dock'), part(9, 'conveyor')]); // the Hopper went onto the yard
  assert.deepEqual([0, 1, 2].map(slotOfBin), [1, 2, 6], 'the Crusher and the Dock did not move');
  setShelf([part(2, 'crusher'), part(3, 'dock'), part(9, 'conveyor'), part(4, 'furnace')]);
  assert.equal(slotOfBin(3), 0, 'a new part takes the first free slot');
  setShelf([]);
  setShelf([part(1, 'hopper')]);
  assert.equal(slotOfBin(0), 0, 'an empty shelf starts again from the first slot');
  setShelf(Array.from({ length: 7 }, () => ({ kind: 'hopper' })));
});
