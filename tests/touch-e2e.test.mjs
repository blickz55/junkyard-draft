// Production roadmap 0.10.1: a full six-round game with touch events only (Playwright hasTouch, CDP touch for the long
// press and the second finger) on a 390×844 phone: tap a card, tap a shelf part to take it in hand, tap a cell to place
// it, two fingers on the yard to rotate, a long press to drag, a drag onto the shelf to remove, the DOM buttons by tap.
// The first tap on the yard asks the audio context to start. The Tips panel lists the action table the game runs on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, settle, cellCenter, binSlotCenter, shelfPoint } from './e2e/fixture.mjs';

const { CONTROLS, LONG_PRESS_MS } = await import('../game/src/content/controls.ts');

const f = await fixture();
after(() => f.close());
const page = await f.page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const { api, frames, draft, mode, when, results, draftRound, at, settled } = page.jd;
const cdp = await page.ctx.newCDPSession(page);
/** raw touch points through the protocol (Playwright's tap cannot hold a finger down or put two down) */
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(({ x, y }) => ({ x, y })) });
const tapAt = async (p) => {
  const q = await at(p);
  await page.touchscreen.tap(q.x, q.y);
  await frames(2);
};
/** a finger rests on `from` past the long press, then slides to `to` and lifts */
const longDrag = async (from, to) => {
  const a = await at(from),
    b = await at(to);
  await touch('touchStart', [a]);
  await settle(LONG_PRESS_MS + 150, 'the long press that turns a touch into a drag');
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
  await touch('touchEnd', []);
  await frames(2);
  await settled();
};
const twoFingerTap = async (a, b) => {
  await touch('touchStart', [await at(a), await at(b)]);
  await touch('touchEnd', []);
  await frames(2);
};
const machines = async () => (await api('state')).layout.machines;
const find = async (id) => (await machines()).find((m) => m.id === id);

test(
  'round one by touch: tap a card, tap the shelf part, tap a cell, two fingers rotate, a long press drags, a drag to the shelf removes',
  { timeout: 90000 },
  async () => {
    await page.goto(f.gameUrl('scene=game&seed=touch-1'));
    await draft();
    const before = (await api('audio')).unlockAttempts;
    await page.getByTestId('offer-0').tap();
    await mode('build');
    await settled();
    const part = (await api('state')).bin[0];
    assert.ok(part, 'the picked part is on the shelf');
    // tap the shelf part: in hand (the amber frame moves to its slot)
    await tapAt(binSlotCenter(0));
    await when((id) => window.__jd.cursor().held === id, part.id, 5000);
    assert.ok((await api('audio')).unlockAttempts > before, 'the first tap on the yard asked the audio context to start');
    // tap an empty cell: placed
    await tapAt(cellCenter(3, 4));
    await when((id) => window.__jd.state().layout.machines.some((m) => m.id === id && m.x === 3 && m.y === 4), part.id, 5000);
    assert.equal((await api('cursor')).held, null, 'nothing in hand after the placement');
    // two fingers on the yard: the selected machine turns
    const dir0 = (await find(part.id)).dir;
    await twoFingerTap(cellCenter(0, 5), cellCenter(1, 5));
    await when(({ id, d }) => window.__jd.state().layout.machines.find((m) => m.id === id)?.dir !== d, { id: part.id, d: dir0 }, 5000);
    assert.equal((await find(part.id)).dir, (dir0 + 1) % 4, 'two fingers rotate once');
    // a long press, then a drag: the machine moves
    await longDrag(cellCenter(3, 4), cellCenter(3, 5));
    const moved = await find(part.id);
    assert.ok(moved && moved.x === 3 && moved.y === 5, `a long press drags: ${JSON.stringify(moved)}`);
    // a quick swipe is not a drag: nothing moves
    const a = await at(cellCenter(3, 5)),
      b = await at(cellCenter(4, 5));
    await touch('touchStart', [a]);
    for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 4, y: a.y }]);
    await touch('touchEnd', []);
    await frames(3);
    await settled();
    const still = await find(part.id);
    assert.ok(still.x === 3 && still.y === 5, 'a swipe shorter than the long press does not drag');
    // a long drag onto the shelf removes it
    await longDrag(cellCenter(3, 5), shelfPoint);
    await when((id) => window.__jd.state().bin.some((m) => m.id === id), part.id, 5000);
    // a tap on a placed machine selects it (the Rotate button then turns it); a tap on empty yard clears the selection
    const conveyor = (await machines()).find((m) => m.kind === 'conveyor');
    await tapAt(cellCenter(conveyor.x, conveyor.y));
    await when(() => !!document.querySelector('[data-testid=rotate]'), null, 5000);
    const cdir = conveyor.dir;
    await page.getByTestId('rotate').tap();
    await when(({ id, d }) => window.__jd.state().layout.machines.find((m) => m.id === id)?.dir !== d, { id: conveyor.id, d: cdir }, 5000);
    await page.getByTestId('rotate').tap();
    await page.getByTestId('rotate').tap();
    await page.getByTestId('rotate').tap(); // back to where it was
    await when(({ id, d }) => window.__jd.state().layout.machines.find((m) => m.id === id)?.dir === d, { id: conveyor.id, d: cdir }, 5000);
    await tapAt(cellCenter(7, 0));
    await when(() => !document.querySelector('[data-testid=rotate]'), null, 5000);
    // back in hand, placed on the free row, the shift by the big button, skipped, the summary's Next
    await tapAt(binSlotCenter(0));
    await when((id) => window.__jd.cursor().held === id, part.id, 5000);
    await tapAt(cellCenter(2, 4));
    await when((id) => window.__jd.state().layout.machines.some((m) => m.id === id && m.x === 2 && m.y === 4), part.id, 5000);
    await page.getByTestId('run').tap();
    await mode('running');
    await page.getByTestId('skip').tap();
    await mode('summary');
    await page.getByTestId('next').tap();
    await draftRound(2);
    assert.deepEqual(page.errors, [], 'no page errors');
  },
);

test('rounds two to six by touch, then the results', { timeout: 120000 }, async () => {
  for (let r = 2; r <= 6; r++) {
    await draft();
    await page.getByTestId('offer-0').tap();
    await mode('build');
    await settled();
    const part = (await api('state')).bin[0];
    await tapAt(binSlotCenter(0));
    await when((id) => window.__jd.cursor().held === id, part.id, 5000);
    await tapAt(cellCenter(r + 1, 4));
    await when(({ id, x }) => window.__jd.state().layout.machines.some((m) => m.id === id && m.x === x && m.y === 4), { id: part.id, x: r + 1 }, 5000);
    await page.getByTestId('run').tap();
    await mode('running');
    await page.getByTestId('skip').tap();
    await mode('summary');
    await page.getByTestId('next').tap();
    if (r < 6) await draftRound(r + 1);
  }
  await results();
  await when(() => !!document.querySelector('[data-testid=headline]'), null, 5000);
  assert.deepEqual(page.errors, [], 'no page errors across a touch-only game');
});

test('the Tips panel lists the action table: one row per control, the same table the keys are bound from', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=touch-2'));
  await draft();
  await api('openTips', 'controls');
  await when(() => document.querySelector('[data-testid=tip-controls]')?.classList.contains('jd-active'), null, 5000);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=controls-table] tbody tr')].map((tr) => tr.dataset.testid));
  assert.deepEqual(
    rows,
    CONTROLS.map((c) => `control-${c.id}`),
    "the table has one row per control in the table's order",
  );
  const cells = await page.evaluate(() => [...document.querySelectorAll('[data-testid=control-rotate] td')].map((td) => td.textContent));
  assert.equal(cells.length, 4);
  assert.match(cells[1], /\bR\b/);
  assert.match(cells[3], /two fingers/);
  await api('closeTips');
  // the build help under a coarse pointer says tap, and the keyboard line is composed from the table
  await api('pick', 0);
  await mode('build');
  await tapAt(cellCenter(7, 0)); // empty yard: nothing selected, so the panel shows the help lines
  await when(() => !document.querySelector('[data-testid=rotate]'), null, 5000);
  const help = await page.evaluate(() => document.querySelector('#ui .jd-side')?.textContent ?? '');
  assert.match(help, /Tap a part on the shelf, then tap a cell/);
  assert.match(help, /Keyboard: .*Tab cycles the shelf/);
  assert.deepEqual(page.errors, []);
});
