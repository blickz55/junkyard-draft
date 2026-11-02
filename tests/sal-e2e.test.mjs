// What the third panel asked for, played in a browser: a lit spot takes one tap, a pick can be taken back, a machine can be moved on purpose,
// the end of a game names Sal, his recording comes back to your own results, and a try picks up at the first order missed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cellCenter } from './e2e/fixture.mjs';

const f = await fixture();
after(() => f.close());

/** The rest of a game through the dev API: the first card each shift, nothing built. */
const finish = async (page) => {
  const { api, mode, when } = page.jd;
  for (;;) {
    const s = await api('state');
    if (s.phase === 'draft') await api('pick', 0);
    await api('run');
    await mode('running');
    await api('finishRun');
    await mode('summary');
    if (s.round >= 6) break;
    await api('next');
    await when((r) => window.__jd.state().round === r, s.round + 1);
  }
  await api('next');
};

test('a tap on the lit spot puts the lit part in: nothing to take off the shelf first', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, frames, settled, at } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-lit-7'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  const worth = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-testid=offer-worth-${i}]`)?.textContent));
  await page.getByTestId(`offer-${worth.indexOf('Fits this line now')}`).click();
  await mode('build');
  await settled();
  const spot = await page.evaluate(() => document.querySelector('[data-spot^=cell]')?.dataset.spot);
  assert.ok(spot, 'a spot is lit');
  const [x, y] = spot.replace('cell:', '').split(',').map(Number);
  const before = (await api('state')).bin.length;
  const p = await at(cellCenter(x, y));
  await page.mouse.click(p.x, p.y);
  await frames(3);
  assert.ok(
    (await api('state')).bin.length <= before - 1 || (await api('state')).layout.machines.some((m) => m.x === x && m.y === y && m.kind !== 'conveyor'),
    'the part went in',
  );
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});

test('a kit: the part the coach lights is the one in hand, and a tap on its spot puts that one in', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, settled, at, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-kit'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  const offers = (await api('state')).offers;
  const i = offers.indexOf('hopper');
  if (i < 0) return void (await page.ctx.close()); // this yard deals no Hopper first: nothing to check
  await page.getByTestId(`offer-${i}`).click();
  await mode('build');
  await settled();
  const spot = await page.evaluate(() => document.querySelector('[data-spot^=cell]')?.dataset.spot);
  if (!spot) return void (await page.ctx.close());
  const hint = await api('hint');
  const named = /Scrap Hopper/.test(hint) ? 'hopper' : /Crusher/.test(hint) ? 'crusher' : null;
  assert.ok(named, hint);
  const [x, y] = spot.replace('cell:', '').split(',').map(Number);
  const p = await at(cellCenter(x, y));
  await page.mouse.click(p.x, p.y);
  await when(([cx, cy, k]) => window.__jd.state().layout.machines.some((m) => m.x === cx && m.y === cy && m.kind === k), [x, y, named]);
  await page.ctx.close();
});

test('the lit spots can be turned off on the job card, and stay off: the coach says to work it out', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, settled } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-lit-7'));
  await draft();
  assert.equal(await page.getByTestId('job-lights').textContent(), 'Lit spots: on', 'a first game: on, and not "always"');
  await page.getByTestId('job-lights').click();
  assert.equal(await page.getByTestId('job-lights').textContent(), 'Lit spots: when you ask');
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  const worth = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-testid=offer-worth-${i}]`)?.textContent));
  await page.getByTestId(`offer-${worth.indexOf('Fits this line now')}`).click();
  await mode('build');
  await settled();
  assert.equal(await page.locator('[data-spot^=cell]').count(), 0, 'no spot is lit');
  assert.match(await api('hint'), /where you think\. The pay shows if it helps\.$/);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.settings.v1'))).lights, false);
  // the spot is still one tap away
  await page.getByTestId('show-spot').click();
  await page.jd.when(() => !!document.querySelector('[data-spot^=cell]'));
  assert.equal(await page.getByTestId('show-spot').isVisible(), false, 'lit, there is nothing more to ask for');
  await page.ctx.close();
});

test('after a first game the spots wait to be asked for: "Show me" lights the card, and its lit spot takes a tap', { timeout: 60000 }, async () => {
  const at0 = '2026-11-01T12:00:00.000Z';
  const bests = {
    byVersion: { 8: { overall: { score: 900, seed: 'daily-2026-11-01', at: at0 }, bySeed: { 'daily-2026-11-01': { score: 900, at: at0 } }, runs: 1 } },
  };
  const page = await f.page(undefined, { init: { fn: (b) => localStorage.setItem('jd.bests.v2', b), arg: JSON.stringify(bests) } });
  const { api, draft, mode, settled, at, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-lit-7'));
  await draft();
  assert.equal(await page.getByTestId('job-lights').textContent(), 'Lit spots: when you ask', 'the job card says how it stands');
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  const worth = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-testid=offer-worth-${i}]`)?.textContent));
  await page.getByTestId(`offer-${worth.indexOf('Fits this line now')}`).click();
  await mode('build');
  await settled();
  assert.equal(await page.locator('[data-spot^=cell]').count(), 0, 'no spot is lit');
  await page.getByTestId('show-spot').click();
  await when(() => !!document.querySelector('[data-spot^=cell]'));
  const spot = await page.evaluate(() => document.querySelector('[data-spot^=cell]')?.dataset.spot);
  const [x, y] = spot.replace('cell:', '').split(',').map(Number);
  const p = await at(cellCenter(x, y));
  await page.mouse.click(p.x, p.y);
  await when(([cx, cy]) => window.__jd.state().layout.machines.some((m) => m.x === cx && m.y === cy), [x, y]);
  assert.ok((await api('state')).layout.machines.some((m) => m.x === x && m.y === y));
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});

test('a pick can be taken back until the shift starts: the same three cards come back', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-undo'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  const offers = (await api('state')).offers;
  await page.getByTestId('offer-1').click();
  await mode('build');
  await when(() => window.__jd.phase() === 'build');
  assert.equal(await page.getByTestId('undo').textContent(), 'Undo pick');
  await page.getByTestId('undo').click();
  await when(() => window.__jd.phase() === 'draft');
  assert.deepEqual((await api('state')).offers, offers);
  assert.equal((await api('state')).bin.filter((m) => m.kind !== 'conveyor').length, 0, 'and its parts have gone back');
  await page.ctx.close();
});

test('Move puts a machine in hand: the next tap is where it goes, and a stray tap on the yard moves nothing', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, frames, settled, at, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=classic-move'));
  await draft();
  await api('pick', 0);
  await mode('build');
  await api('act', { t: 'sell', id: (await api('state')).bin[0].id });
  await settled();
  const belt = (await api('state')).layout.machines.find((m) => m.kind === 'conveyor');
  const p = await at(cellCenter(belt.x, belt.y));
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector('[data-testid=move]');
  // the card says which way it sends, in words, and Turn changes them
  const before = await page.getByTestId('sends').textContent();
  assert.match(before, /^Sends (to the right|down|to the left|up)$/);
  await page.getByTestId('rotate').click();
  await when((was) => document.querySelector('[data-testid=sends]')?.textContent !== was, before);
  await page.getByTestId('rotate').click();
  await page.getByTestId('rotate').click();
  await page.getByTestId('rotate').click();
  await when((was) => document.querySelector('[data-testid=sends]')?.textContent === was, before);
  const empty = await at(cellCenter(6, 0));
  await page.mouse.click(empty.x, empty.y);
  await frames(2);
  assert.ok(
    (await api('state')).layout.machines.some((m) => m.id === belt.id && m.x === belt.x),
    'a tap on empty yard only lets go',
  );
  await page.mouse.click(p.x, p.y);
  await page.getByTestId('move').click();
  await when(() => /where the Conveyor should go/.test(window.__jd.hint?.() ?? document.querySelector('[data-testid=hint]')?.textContent ?? ''));
  await page.mouse.click(empty.x, empty.y);
  await when((id) => window.__jd.state().layout.machines.some((m) => m.id === id && m.x === 6 && m.y === 0), belt.id);
  await page.ctx.close();
});

test('the end of a game names Sal, his recording comes back to these results, and nothing is counted twice', { timeout: 120000 }, async () => {
  const page = await f.page();
  const { draft, results, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-results'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  await finish(page);
  await results();
  await page.waitForSelector('[data-testid=watch-sal]');
  assert.match(await page.getByTestId('delta-par').textContent(), /^(You beat Sal by \$[\d,]+|Sal beat you by \$[\d,]+|Level with Sal)$/);
  // nothing was built, so Sal won: the results say what his game cannot do, which is how to pass him
  assert.match(await page.getByTestId('delta-par').textContent(), /^Sal beat you/);
  assert.match(await page.getByTestId('sal-how').textContent(), /never moves a machine/);
  const score = await page.getByTestId('score').textContent();
  const games = () => page.evaluate(() => JSON.stringify(localStorage.getItem('jd.bests.v2')).length);
  const stored = await games();
  await page.getByTestId('watch-sal').click();
  await when(() => /Sal's game/.test(document.querySelector('[data-testid=hud-seed]')?.textContent ?? ''));
  await page.getByTestId('stop').click();
  await page.waitForSelector('[data-testid=watch-sal]');
  assert.equal(await page.getByTestId('score').textContent(), score, 'your own game, not his');
  assert.equal(await games(), stored, 'it was counted when it ended, and not again');
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});

test('a try picks up at the first order missed, and goes on no board', { timeout: 120000 }, async () => {
  const page = await f.page();
  const { draft, results, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-try'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  await finish(page);
  await results();
  await page.waitForSelector('[data-testid=try-from]');
  const n = Number((await page.getByTestId('try-from').textContent()).match(/shift (\d)/)[1]);
  await page.getByTestId('try-from').click();
  await when((r) => window.__jd.scene() === 'Game' && window.__jd.state().round === r, n);
  assert.match(await page.getByTestId('hud-seed').textContent(), /a try from your game/);
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});

test('a refusal at either edge of a phone-size yard stays on the screen, its arrow over the cell', { timeout: 60000 }, async () => {
  const page = await f.page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const { api, draft, mode, settled } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-edge'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  await api('pick', 0);
  await mode('build');
  await settled();
  const s = await api('state');
  const W = s.layout.width;
  for (const x of [0, W - 1]) {
    const y = [...Array(s.layout.height).keys()].find((r) => !s.layout.machines.some((m) => m.x === x && m.y === r) && !s.layout.rubble?.includes(r * W + x));
    const belts = (await api('state')).bin.filter((m) => m.kind === 'conveyor');
    assert.ok(await api('act', { t: 'place', id: belts[0].id, x, y, dir: 0 }), 'a belt goes in');
    assert.equal(await api('act', { t: 'place', id: belts[1].id, x, y, dir: 0 }), false, 'a second on the same spot is refused');
    const box = await page.getByTestId('toast').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `the note at column ${x} is on the screen: ${JSON.stringify(box)}`);
  }
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});

test('New offers with a card that fits asks first: keeping the cards costs nothing, paying deals three more', { timeout: 90000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, when } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=sal-offers'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  await api('pick', 0);
  await api('run');
  await mode('running');
  await api('finishRun');
  await mode('summary');
  await api('next');
  await when(() => window.__jd.state().round === 2 && window.__jd.state().phase === 'draft');
  const before = await api('state');
  const fits = await page.evaluate(() =>
    [0, 1, 2].some((i) => /Fits|Adds|room/.test(document.querySelector(`[data-testid=offer-worth-${i}]`)?.textContent ?? '')),
  );
  assert.ok(fits, "the Hopper fits on this yard's second deal");
  await page.getByTestId('reroll').click();
  await page.getByTestId('offers-keep').click();
  const kept = await api('state');
  assert.deepEqual([kept.offers, kept.score], [before.offers, before.score], 'kept: nothing paid, nothing dealt');
  await page.getByTestId('reroll').click();
  await page.getByTestId('offers-pay').click();
  await when((score) => window.__jd.state().score < score, before.score);
  assert.equal((await api('state')).score, before.score - 40);
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});
