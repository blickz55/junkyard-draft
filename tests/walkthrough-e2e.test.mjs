// docs/UX-STANDARD.md, how this is enforced: the lesson played by touching only what the game lights up. If the highlights do not
// lead to the end, the lesson is broken, however good each screen looks on its own. Then the audit of the five questions on the
// screens of a real yard, the inspector in every phase, the way out, and the things the playtest found.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS, settle, cellCenter, binSlotCenter } from './e2e/fixture.mjs';
import { salGame } from '../game/src/render/sal.ts';
import { LESSONS } from '../game/src/content/lessons.ts';

const f = await fixture();
after(() => f.close());

/** What the game has lit up right now: buttons and cards, rings on the yard and the shelf, a dialog's primary. */
const lit = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('.jd-modal .jd-btn-primary');
    if (dialog) return { dialog: dialog.dataset.testid };
    return {
      buttons: [...document.querySelectorAll('.jd-spot')].map((b) => b.dataset.testid),
      rings: [...document.querySelectorAll('[data-spot]')].map((r) => r.dataset.spot),
    };
  });
const ringPoint = async (page, spot) => {
  const [kind, at] = spot.split(':');
  return page.jd.at(kind === 'shelf' ? binSlotCenter(Number(at)) : cellCenter(...at.split(',').map(Number)));
};

for (const device of [
  { name: 'mouse', ctx: {}, drag: true },
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, drag: false },
])
  for (const lesson of LESSONS)
    test(`lesson ${lesson.n} by ${device.name}, touching only what is lit, reaches the end with the job done`, { timeout: 180000 }, async () => {
      const page = await f.page(device.ctx);
      const { api, title, when, frames, settled, drag } = page.jd;
      if (lesson.n === 1) {
        await page.goto(f.gameUrl());
        await title();
        await page.getByTestId('learn').click();
      } else await page.goto(f.gameUrl(`scene=game&seed=${lesson.seed}`));
      let actions = 0;
      const steps = [];
      for (; actions < 60; actions++) {
        await frames(2);
        await settled();
        await page.waitForTimeout(0);
        if (await page.locator('[data-testid=lesson-done]').count()) break;
        const l = await lit(page);
        const hint = await api('hint').catch(() => '');
        steps.push(hint);
        if (l.dialog) {
          await page.getByTestId(l.dialog).click();
          continue;
        }
        const tap = async (p) => (device.drag ? page.mouse.click(p.x, p.y) : page.touchscreen.tap(p.x, p.y));
        if (l.rings.length === 2) {
          // part and destination: the drag a mouse player makes, the two taps a thumb makes
          const [from, to] = await Promise.all(l.rings.map((s) => ringPoint(page, s)));
          if (device.drag) await drag(from, to);
          else {
            await tap(from);
            await frames(2);
            await tap(to);
          }
          continue;
        }
        if (l.rings.length === 1) {
          await tap(await ringPoint(page, l.rings[0]));
          continue;
        }
        assert.ok(l.buttons.length >= 1, `nothing is lit at step ${actions}: "${hint}"`);
        await page.getByTestId(l.buttons[0]).click();
        if (l.buttons[0] === 'run') {
          await when(() => window.__jd.mode() === 'running', null, 5000);
          await page.getByTestId('skip').click();
          await when(() => window.__jd.mode() === 'summary', null, 10000);
          // lesson 2's first shift is short of scrap: the yard says the Press waited for it, as Sal does, never that it held anything back
          if (lesson.n === 2 && (await api('state')).round === 1) {
            const badges = await page.evaluate(() => [...document.querySelectorAll('.jd-badge')].map((e) => e.textContent));
            assert.ok(badges.some((b) => b.includes('waiting for scrap')) && !badges.some((b) => b.includes('held you back')), badges.join(' | '));
          }
        }
      }
      await page.waitForSelector('[data-testid=lesson-done]', { timeout: 5000 });
      assert.ok(actions < 50, `lesson ${lesson.n} took ${actions} steps`);
      const st = await api('state');
      assert.equal(st.round, lesson.shifts.length, 'it ends on its last shift');
      assert.equal(await page.locator('.jd-job-star.on').count(), 3, 'following the lights finishes the job');
      assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.lessons.v1'))), [lesson.n]);
      assert.equal(await page.evaluate(() => localStorage.getItem('jd.onboarded.v1')), '1');
      assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'a finished lesson is not offered back');
      await page.screenshot({ path: path.join(SHOTS, `lesson-${lesson.n}-done-${device.name}-${Date.now()}.png`) });
      for (const line of steps) assert.ok(line.split(/\s+/).length <= 16, `one short instruction at a time: "${line}"`);
      assert.deepEqual(page.errors, [], 'no page errors');
      // the ways on: the next lesson first, and today's yard always there
      const next = LESSONS[lesson.n];
      assert.equal(await page.locator('[data-testid=lesson-next]').count(), next ? 1 : 0);
      assert.equal(await page.locator('[data-testid=lesson-daily]').count(), 1);
      assert.equal(await page.locator('[data-testid=lesson-stay]').count(), 0, 'nothing unguided is left to finish');
      if (next) {
        await page.getByTestId('lesson-next').click();
        await when((seed) => window.__jd?.state().seed === seed, next.seed, 10000);
        await page.waitForSelector('[data-testid=job-card]');
      }
      await page.ctx.close();
    });

test('a lesson refuses what it is not asking for, says so at the spot, and the yard stays as it was', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, drag, when, frames } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=tutorial-2'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  assert.equal(await page.getByTestId('offer-1').isDisabled(), true, 'the card it does not want cannot be taken');
  await api('pick', 1);
  assert.equal((await api('state')).phase, 'draft');
  await page.getByTestId('offer-0').click();
  await page.jd.mode('build');
  assert.equal(await page.getByTestId('run').isDisabled(), true, 'the shift cannot start with the belt pointing the wrong way');
  await api('run');
  assert.equal(await api('mode'), 'build');
  const before = (await api('state')).layout.machines.length;
  await drag(await page.jd.at(binSlotCenter(0)), await page.jd.at(cellCenter(6, 0)));
  await frames(2);
  await when(() => window.__jd.toast()?.kind === 'refusal', null, 5000);
  assert.equal((await api('toast')).text, 'Not yet. Use the lit part, on the lit spot.');
  assert.equal((await api('state')).layout.machines.length, before, 'nothing moved');
  assert.deepEqual(page.errors, [], 'no page errors');
  await page.ctx.close();
});

test('the lessons on Home: progress shows, the next one is first in line, and every one can be taken again', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { title, when } = page.jd;
  await page.goto(f.gameUrl());
  await page.evaluate(() => {
    localStorage.setItem('jd.onboarded.v1', '1');
    localStorage.setItem('jd.lessons.v1', '[1]');
  });
  await page.reload();
  await title();
  assert.equal(await page.getByTestId('learn').textContent(), 'Lessons (1 of 3 done)');
  await page.getByTestId('learn').click();
  await page.waitForSelector('[data-testid=lessons-dialog]');
  assert.equal(await page.getByTestId('lesson-1').textContent(), '1. Your first line ✓');
  assert.equal(await page.getByTestId('lesson-2').evaluate((e) => e.classList.contains('jd-btn-primary')), true, 'the next one first');
  await page.getByTestId('lessons-back').click();
  await page.jd.noDialog('lessons-dialog');
  await page.getByTestId('learn').click();
  await page.getByTestId('lesson-3').click();
  await when(() => window.__jd?.state().seed === 'tutorial-3', null, 10000);
  await page.waitForSelector('[data-testid=job-card]');
  await page.ctx.close();
});

test('the lesson can be left at any moment, from the panel or the menu, and nothing asks twice', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { title, when } = page.jd;
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('learn').click();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  assert.equal(await page.getByTestId('skip-lesson').textContent(), 'Skip the lesson');
  await page.getByTestId('menu').click();
  assert.equal(await page.getByTestId('menu-skip').textContent(), 'Skip the lesson');
  await page.getByTestId('menu-resume').click();
  await page.jd.noDialog('menu-dialog');
  await page.getByTestId('skip-lesson').click();
  await title();
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.onboarded.v1')), '1');
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'the lesson game is not offered back');
  await when(() => document.querySelector('[data-testid=daily]')?.classList.contains('jd-btn-primary'));
  await page.ctx.close();
});

test('the menu pauses a running shift, says sound, saves and goes home, and home offers the game back', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, mode, title, frames, draft } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=classic-menu'));
  await draft();
  await api('pick', 0);
  await api('run');
  await mode('running');
  await page.getByTestId('menu').click();
  await mode('paused');
  await page.keyboard.press('Escape');
  await mode('running');
  await page.getByTestId('menu').click();
  await mode('paused');
  assert.equal(await page.getByTestId('menu-sound').textContent(), 'Sound: On');
  await page.getByTestId('menu-sound').click();
  assert.equal(await page.getByTestId('menu-sound').textContent(), 'Sound: Off');
  assert.equal(await page.getByTestId('mute').textContent(), 'Unmute', 'the HUD button follows');
  await page.getByTestId('menu-sound').click();
  await page.getByTestId('menu-home').click();
  await title();
  await frames();
  assert.ok(await page.locator('[data-testid=continue]').count(), 'home offers the game back');
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid=continue]').classList.contains('jd-btn-primary')), true);
  await page.ctx.close();
});

test(
  'any game can go back to its first shift: only once there is something to lose, it says what that costs, and a running shift waits for the answer',
  { timeout: 60000 },
  async () => {
    const page = await f.page();
    const { api, mode, when, draft, noDialog } = page.jd;
    await page.goto(f.gameUrl('scene=game&seed=classic-over'));
    await draft();
    const offers = (await api('state')).offers;
    await page.getByTestId('menu').click();
    assert.equal(await page.getByTestId('menu-start-over').count(), 0, 'nothing to lose yet');
    await page.getByTestId('menu-resume').click();
    await noDialog('menu-dialog');
    await api('pick', 0);
    await api('run');
    await mode('running');
    await page.getByTestId('menu').click();
    await mode('paused');
    assert.equal(await page.getByTestId('menu-start-over').textContent(), 'Start this yard over');
    await page.getByTestId('menu-start-over').click();
    assert.equal(await page.getByTestId('start-over-text').textContent(), 'Back to shift 1 with the same offers. This game is dropped.');
    await page.getByTestId('start-over-no').click();
    await mode('running');
    await page.getByTestId('menu').click();
    await mode('paused');
    await page.getByTestId('menu-start-over').click();
    await page.keyboard.press('Escape');
    await mode('running');
    await page.getByTestId('menu').click();
    await mode('paused');
    await page.getByTestId('menu-start-over').click();
    await page.getByTestId('start-over-yes').click();
    await when(() => window.__jd.state().actions === 0 && window.__jd.phase() === 'draft', null, 10000);
    const st = await api('state');
    assert.equal(st.round, 1);
    assert.deepEqual(st.offers, offers, 'the same offers: they come from the yard');
    assert.equal(await api('mode'), 'build', 'the new game is not paused');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test('the lesson can be started over from beside the skip, and it does not ask you to read the job again', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, title, when, noDialog } = page.jd;
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('learn').click();
  await page.getByTestId('job-start').click();
  await noDialog('job-card');
  assert.equal(await page.getByTestId('restart-lesson').count(), 0, 'nothing to lose yet');
  await api('act', { t: 'place', id: (await api('state')).bin[0].id, x: 4, y: 1, dir: 1 });
  await page.waitForSelector('[data-testid=restart-lesson]');
  assert.equal(await page.getByTestId('restart-lesson').textContent(), 'Start the lesson over');
  await page.getByTestId('restart-lesson').click();
  assert.equal(await page.getByTestId('start-over-text').textContent(), 'Back to the first step of the lesson.');
  await page.getByTestId('start-over-yes').click();
  await when(() => window.__jd.state().actions === 0, null, 10000);
  await page.waitForSelector('[data-testid=skip-lesson]');
  assert.equal(await page.locator('[data-testid=job-card]').count(), 0, 'a second go goes straight in');
  assert.deepEqual(page.errors, [], 'no page errors');
  await page.ctx.close();
});

test('the name on Home is a control: it asks, the box starts empty, and an empty answer changes nothing', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { title, noDialog, textMatches } = page.jd;
  await page.goto(f.gameUrl());
  await title();
  assert.equal(await page.getByTestId('player-name').evaluate((e) => e.tagName), 'BUTTON');
  assert.equal(await page.getByTestId('player-name').textContent(), 'Choose a name');
  await page.getByTestId('player-name').click();
  assert.equal(await page.getByTestId('dialog-input').inputValue(), '');
  await page.keyboard.press('Enter');
  await noDialog();
  assert.equal(await page.getByTestId('player-name').textContent(), 'Choose a name');
  assert.equal(await page.locator('[data-testid=player-note]').count(), 0, 'nothing to say');
  await page.getByTestId('player-name').click();
  await page.getByTestId('dialog-input').fill('Home Tester');
  await page.keyboard.press('Enter');
  await textMatches('player-name', /^Home Tester/, 5000);
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.player')), 'Home Tester');
  await textMatches('player-note', /^Saved on this device\./, 5000);
  await page.ctx.close();
});

test(
  'a belt can be bought while building: it costs what the button says, lands on the shelf, Undo gives the money back and the results say so',
  { timeout: 60000 },
  async () => {
    const page = await f.page();
    const { api, mode, draft, when, draftRound, results } = page.jd;
    await page.goto(f.gameUrl('scene=game&seed=classic-buy'));
    await draft();
    assert.equal(await page.locator('[data-testid=buy-belt]').count(), 0, 'not in the pick');
    await api('pick', 0);
    await mode('build');
    assert.equal(await page.getByTestId('buy-belt').textContent(), 'Buy a belt: $20');
    assert.equal(await page.getByTestId('buy-belt').isDisabled(), true, 'nothing earned yet');
    await api('run');
    await mode('running');
    await api('finishRun');
    await mode('summary');
    await api('next');
    await draftRound(2);
    await api('pick', 0);
    await mode('build');
    const before = await api('state');
    await page.getByTestId('buy-belt').click();
    await when((n) => window.__jd.state().belts === n, 1, 5000);
    const st = await api('state');
    assert.equal(st.score, before.score - 20);
    assert.equal(st.bin.at(-1).kind, 'conveyor');
    await page.getByTestId('undo').click();
    await when(() => window.__jd.state().belts === 0, null, 5000);
    assert.equal((await api('state')).score, before.score);
    await page.getByTestId('buy-belt').click();
    await when(() => window.__jd.state().belts === 1, null, 5000);
    for (let r = 2; r <= 6; r++) {
      if (r > 2) await api('pick', 0);
      await api('run');
      await mode('running');
      await api('finishRun');
      await mode('summary');
      await api('next');
      if (r < 6) await draftRound(r + 1);
    }
    await results();
    assert.equal(await page.getByTestId('belts-line').textContent(), '1 belt bought: $20 off your score');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test('a star says nothing the job bar does not: the first two are only stars, the third says the job is done', { timeout: 120000 }, async () => {
  const seed = 'star-9'; // Sal fills all six orders on this yard (rules 10)
  const { actions } = salGame(seed);
  const page = await f.page();
  const { api, mode, when, draft, noDialog } = page.jd;
  await page.goto(f.gameUrl(`scene=game&seed=${seed}`));
  await draft();
  await page.getByTestId('job-start').click();
  await noDialog('job-card');
  await page.evaluate(() => {
    window.__pops = [];
    new MutationObserver((changes) => {
      for (const c of changes)
        for (const n of c.addedNodes)
          if (n.dataset?.testid === 'star-pop') window.__pops.push({ text: n.textContent, quiet: n.classList.contains('jd-star-pop-quiet') });
    }).observe(document.querySelector('[data-testid=board-slot]'), { childList: true });
  });
  let shift = 0;
  for (const a of actions) {
    if (a.t === 'pick') await api('pick', a.i);
    else if (a.t === 'run') {
      await api('run');
      await mode('running');
      // the last shift is skipped: an order filled in a skipped shift, or in its last ticks on a slow machine, still gets its moment
      if (++shift === 6) await page.getByTestId('skip').click();
      else await page.getByTestId('speed-4').click();
      await mode('summary');
    } else if (a.t === 'next') {
      await api('next');
      await when(() => window.__jd.scene() !== 'Game' || window.__jd.mode() !== 'summary', null, 5000);
    } else assert.equal(await api('act', a), true, `${a.t} is legal`);
  }
  assert.deepEqual(await page.evaluate(() => window.__pops), [
    { text: '★', quiet: true },
    { text: '★★', quiet: true },
    { text: '★★★Job done.', quiet: false },
  ]);
  // every order filled: the results celebrate it (the seventh panel: "make winning feel like winning")
  await page.waitForSelector('[data-testid=cheer-rain]', { timeout: 10000 });
  await page.ctx.close();
});

test('a real yard: the job card, then every screen answers where am I, what is the point, what do I do, and how do I get out', { timeout: 90000 }, async () => {
  const page = await f.page();
  const { api, mode, when, frames, draft } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=audit-yard'));
  await draft();
  await page.waitForSelector('[data-testid=job-card]');
  assert.equal(await page.getByTestId('job-goal').textContent(), 'Fill six orders');
  assert.equal((await page.getByTestId('order-list').textContent()).split(' · ').length, 6, 'all six orders, in a row');
  assert.equal(
    await page.getByTestId('job-why').textContent(),
    'An order is money to make in one shift. Each one you fill raises every price for the rest of the job: ingots sell for $24, then $30, then $36.',
  );
  // rules v9: this yard opens with two Furnaces, and the card says so before the first pick
  assert.equal(await page.getByTestId('job-variant').textContent(), 'On this yard a second Furnace already stands, with its own Dock.');
  const stars = (await api('state')).job.stars;
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  const audit = async (what) => {
    const a = await page.evaluate(() => {
      const q = (t) => document.querySelector(`[data-testid=${t}]`);
      return {
        where: q('hud-round')?.textContent,
        point: q('job-line')?.textContent,
        now: q('hint')?.textContent,
        step: document.querySelector('[data-testid=steps] li.on')?.textContent,
        out: q('menu')?.textContent,
        words: (q('hint')?.textContent ?? '').split(/\s+/).length,
        primary: [...document.querySelectorAll('#ui .jd-btn-primary')].filter((b) => b.getBoundingClientRect().width > 0).length,
      };
    });
    assert.match(a.where ?? '', /^Shift \d of 6$/, `${what}: where am I`);
    assert.match(a.point ?? '', /^Order \$\d/, `${what}: what's the point`);
    assert.ok(a.now && a.words <= 14, `${what}: one short instruction: "${a.now}"`);
    assert.equal(a.out, 'Menu', `${what}: how do I get out`);
    assert.ok(a.primary <= 1, `${what}: at most one primary (${a.primary})`);
    return a;
  };
  assert.equal((await audit('the pick')).step, 'Pick');
  assert.equal(await page.locator('[data-testid^=offer-need-]').count(), 0, 'the line already runs, so no card is the one you must take');
  // the card that fits: on rules 9 the first good card moves from yard to yard, and this yard opens with two Furnaces
  const worth = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-testid=offer-worth-${i}]`)?.textContent));
  await page.getByTestId(`offer-${worth.indexOf('Fits this line now')}`).click();
  await mode('build');
  assert.equal((await audit('the build')).step, 'Build');
  assert.ok(await page.locator('[data-spot^=shelf]').count(), 'the new part is lit on the shelf');
  // in a game the yard is the player's to work out (the eighth panel); where it pays is one tap away
  assert.equal(await page.locator('[data-spot^=cell]').count(), 0, 'no spot on the yard is lit until asked for');
  await page.getByTestId('show-spot').click();
  await when(() => document.querySelectorAll('[data-spot^=cell]').length >= 1);
  await page.getByTestId('run').click();
  await mode('running');
  assert.equal((await audit('the shift')).step, 'Run');
  await page.getByTestId('skip').click();
  await mode('summary');
  await frames(2);
  await audit('the summary');
  assert.match(
    await page.getByTestId('job-pace').textContent(),
    /^(Order filled|Missed the order).* 1 of 6 orders filled|^Missed the order.* 0 of 6 orders filled/,
  );
  assert.ok(await page.evaluate(() => document.querySelector('[data-testid=next]').classList.contains('jd-spot')), 'next shift is lit');
  await page.getByTestId('next').click();
  await when(() => window.__jd.phase() === 'draft');
  await frames(2);
  // the advice stays through the pick and the build
  const advice = await page.getByTestId('last-shift').textContent();
  assert.ok(advice.startsWith('Last shift: '), advice);
  await api('pick', 0);
  await frames(2);
  assert.equal(await page.getByTestId('last-shift').textContent(), advice, 'the advice survives the pick');
  // a change to the line fades it and moves nothing under it: a button that jumps takes the next tap somewhere else (the fifth panel)
  const runTop = await page.evaluate(() => document.querySelector('[data-testid=run]').getBoundingClientRect().top);
  const part = (await api('state')).bin.find((m) => m.kind !== 'conveyor') ?? (await api('state')).bin[0];
  const st = await api('state');
  const spot = [...Array(st.layout.width * st.layout.height).keys()].find(
    (c) => !st.layout.machines.some((m) => m.y * st.layout.width + m.x === c) && !st.layout.rubble?.includes(c),
  );
  await api('act', { t: 'place', id: part.id, x: spot % st.layout.width, y: Math.floor(spot / st.layout.width), dir: 0 });
  await frames(2);
  assert.ok(await page.evaluate(() => document.querySelector('[data-testid=last-shift]').classList.contains('jd-advice-old')), 'faded');
  const runNow = await page.evaluate(() => document.querySelector('[data-testid=run]').getBoundingClientRect().top);
  assert.ok(Math.abs(runNow - runTop) < 10, `nothing jumped: ${runTop} then ${runNow} (the advice card is about 70 px)`); // a line of text may rewrap
  assert.ok(stars[0] < stars[1] && stars[1] < stars[2]);
  assert.deepEqual(page.errors, [], 'no page errors');
  await page.ctx.close();
});

test(
  'anything can be asked about, in every phase: a tap on a machine, a shelf part or a junk pile says what it is; a drag in the pick is told why not',
  { timeout: 60000 },
  async () => {
    const page = await f.page();
    const { api, mode, frames, draft, at } = page.jd;
    await page.goto(f.gameUrl('scene=game&seed=audit-yard-2'));
    await draft();
    await page.getByTestId('job-start').click();
    await page.jd.noDialog('job-card');
    const st = await api('state');
    const hopper = st.layout.machines.find((m) => m.kind === 'hopper');
    const point = await at(cellCenter(hopper.x, hopper.y));
    await page.mouse.click(point.x, point.y);
    await page.waitForSelector('[data-testid=inspector]');
    assert.equal(await page.getByTestId('inspector-name').textContent(), 'Scrap Hopper');
    assert.equal(await page.getByTestId('inspector-out').textContent(), 'Comes outscrap');
    assert.equal(await api('toast'), null, 'a click in the pick is a question, not a refused drag');
    await page.getByTestId('inspector-close').click();
    assert.equal(await page.locator('[data-testid=inspector]').count(), 0);
    // a junk pile
    const pile = st.layout.rubble[0];
    const pp = await at(cellCenter(pile % st.layout.width, Math.floor(pile / st.layout.width)));
    await page.mouse.click(pp.x, pp.y);
    await page.waitForSelector('[data-testid=inspector]');
    assert.equal(await page.getByTestId('inspector-name').textContent(), 'Junk pile');
    // a shelf part: the belts' stack, which stands in the shelf's last slot
    const shelf = await at(binSlotCenter((await page.evaluate(() => window.__jd.geometry().slots.length)) - 1));
    await page.mouse.click(shelf.x, shelf.y);
    await page.waitForFunction(() => document.querySelector('[data-testid=inspector-name]')?.textContent === 'Conveyor');
    // a real drag in the pick says what to do instead
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 40, { steps: 5 });
    await page.mouse.up();
    await frames(2);
    assert.match((await api('toast'))?.text ?? '', /^Pick a part first/);
    await page.keyboard.press('Digit1');
    await mode('build');
    // while the shift runs too
    await api('run');
    await mode('running');
    await page.mouse.click(point.x, point.y);
    await page.waitForSelector('[data-testid=inspector]');
    assert.equal(await page.getByTestId('inspector-name').textContent(), 'Scrap Hopper');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test('a junk pile refuses a part and says so at the spot, until the next action', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, drag, mode } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=audit-yard-3'));
  await draft();
  await page.getByTestId('job-start').click();
  await page.jd.noDialog('job-card');
  await api('pick', 0);
  await mode('build');
  await page.jd.settled();
  const st = await api('state');
  const pile = st.layout.rubble[0];
  const x = pile % st.layout.width,
    y = Math.floor(pile / st.layout.width);
  await drag(binSlotCenter(0), cellCenter(x, y));
  const toast = await api('toast');
  assert.ok(toast && toast.kind === 'refusal' && /junk pile/.test(toast.text) && toast.x === x && toast.y === y, JSON.stringify(toast));
  await settle(2200, 'a toast outlives the old timer');
  assert.match((await api('toast'))?.text ?? '', /junk pile/);
  await page.ctx.close();
});

test('the panel picture faces the way the machine faces, every turn', { timeout: 60000 }, async () => {
  const page = await f.page();
  const { api, draft, mode, when, at, settled, frames } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=classic-align'));
  await draft();
  await api('pick', (await api('state')).offers.indexOf('crusher'));
  await mode('build');
  await api('act', { t: 'sell', id: (await api('state')).bin[0].id }); // with the part gone no spot is lit, so a tap on the belt only selects it
  await settled();
  const belt = (await api('state')).layout.machines.find((m) => m.kind === 'conveyor');
  const p = await at(cellCenter(belt.x, belt.y));
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector('[data-testid=selected]');
  for (let d = 0; d < 4; d++) {
    const facing = await page.evaluate(() => document.querySelector('[data-testid=selected] img').style.transform);
    const dir = (await api('state')).layout.machines.find((m) => m.id === belt.id).dir;
    assert.equal(facing, `rotate(${dir * 90}deg)`, `the panel and the yard agree at ${dir}`);
    await settled();
    await page.mouse.click(p.x, p.y); // a second tap on the selected machine turns it
    await when(({ id, d0 }) => window.__jd.state().layout.machines.find((m) => m.id === id).dir !== d0, { id: belt.id, d0: dir }, 5000);
    await frames(2);
  }
  await page.ctx.close();
});

test('every random yard is a different yard: Practice opens a new layout each time', { timeout: 60000 }, async () => {
  const page = await f.page();
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    await page.goto(f.gameUrl());
    await page.jd.title();
    await page.evaluate(() => localStorage.setItem('jd.onboarded.v1', '1'));
    await page.reload();
    await page.jd.title();
    await page.getByTestId('random').click();
    await page.jd.draft();
    const st = await page.jd.api('state');
    seen.add(JSON.stringify(st.layout.machines.map((m) => [m.kind, m.x, m.y, m.dir])));
  }
  assert.ok(seen.size >= 3, `${seen.size} different layouts out of 4`);
  await page.ctx.close();
});

test('in a lesson the lit spot takes the lit part with nothing in hand, as a game does', { timeout: 60000 }, async () => {
  const page = await f.page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const { api, frames, settled, when } = page.jd;
  await page.goto(f.gameUrl(`scene=game&seed=${LESSONS[0].seed}`));
  // past any opening dialog to the first move: a part glowing on the shelf and its spot on the yard
  for (let i = 0; i < 6; i++) {
    await frames(2);
    await settled();
    const l = await lit(page);
    if (l.dialog) {
      await page.getByTestId(l.dialog).click();
      continue;
    }
    if (l.rings.length === 2) break;
  }
  const l = await lit(page);
  assert.equal(l.rings.length, 2, `the part and its spot are lit: ${JSON.stringify(l)}`);
  const spot = l.rings.find((r) => r.startsWith('cell:'));
  const [x, y] = spot.slice(5).split(',').map(Number);
  // the twelfth panel tapped the spot straight away, with the part glowing on the shelf, and the lesson let go instead
  const p = await ringPoint(page, spot);
  await page.touchscreen.tap(p.x, p.y);
  await when(([x, y]) => window.__jd.state().layout.machines.some((m) => m.x === x && m.y === y && m.kind === 'conveyor'), [x, y]);
  assert.ok(
    (await api('state')).layout.machines.some((m) => m.x === x && m.y === y),
    'the lit part is in',
  );
  await page.ctx.close();
});
