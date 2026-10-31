// docs/UX-STANDARD.md, how this is enforced: the lesson played by touching only what the game lights up. If the highlights do not
// lead to the end, the lesson is broken, however good each screen looks on its own. Then the audit of the five questions on the
// screens of a real yard, the inspector in every phase, the way out, and the things the playtest found.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS, settle, cellCenter, binSlotCenter } from './e2e/fixture.mjs';

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
]) {
  test(`the lesson by ${device.name}, touching only what is lit, reaches the end with a working line`, { timeout: 120000 }, async () => {
    const page = await f.page(device.ctx);
    const { api, title, when, frames, settled, drag } = page.jd;
    await page.goto(f.gameUrl());
    await title();
    await page.getByTestId('learn').click();
    let actions = 0;
    const steps = [];
    for (; actions < 40; actions++) {
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
      if (l.rings.length === 2) {
        // part and destination: the drag a mouse player makes, the two taps a thumb makes
        const [from, to] = await Promise.all(l.rings.map((s) => ringPoint(page, s)));
        if (device.drag) await drag(from, to);
        else {
          await page.touchscreen.tap(from.x, from.y);
          await frames(2);
          await page.touchscreen.tap(to.x, to.y);
        }
        continue;
      }
      if (l.rings.length === 1) {
        const p = await ringPoint(page, l.rings[0]);
        await page.mouse.click(p.x, p.y);
        continue;
      }
      assert.ok(l.buttons.length >= 1, `nothing is lit at step ${actions}: "${hint}"`);
      await page.getByTestId(l.buttons[0]).click();
      if (l.buttons[0] === 'run') {
        await when(() => window.__jd.mode() === 'running', null, 5000);
        await page.getByTestId('skip').click();
        await when(() => window.__jd.mode() === 'summary', null, 10000);
      }
    }
    await page.waitForSelector('[data-testid=lesson-done]', { timeout: 5000 });
    assert.ok(actions < 30, `the lesson took ${actions} steps`);
    const st = await api('state');
    assert.equal(st.round, 4, 'the lesson ends after the fourth shift');
    assert.ok(
      st.rounds.some((r) => r.shipped.ingot > 0),
      'following the lights ships ingots',
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.onboarded.v1')), '1');
    await page.screenshot({ path: path.join(SHOTS, `lesson-done-${device.name}-${Date.now()}.png`) });
    for (const line of steps) assert.ok(line.split(/\s+/).length <= 16, `one short instruction at a time: "${line}"`);
    assert.deepEqual(page.errors, [], 'no page errors');
    // the three ways on: stay, and the lesson is over but the game is not
    await page.getByTestId('lesson-stay').click();
    await page.jd.noDialog('lesson-done');
    assert.equal(await page.locator('[data-testid=skip-lesson]').count(), 0, 'no skip button once the lesson is over');
    await page.ctx.close();
  });
}

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

test('a real yard: the job card, then every screen answers where am I, what is the point, what do I do, and how do I get out', { timeout: 90000 }, async () => {
  const page = await f.page();
  const { api, mode, when, frames, draft } = page.jd;
  await page.goto(f.gameUrl('scene=game&seed=audit-yard'));
  await draft();
  await page.waitForSelector('[data-testid=job-card]');
  assert.match(await page.getByTestId('job-goal').textContent(), /^Ship \d+ (ingots|plates)$/);
  assert.match(await page.getByTestId('job-why').textContent(), /This job pays \$24 for each one\. Reach a mark to earn its star\./);
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
    assert.match(a.point ?? '', /^Ship \d+/, `${what}: what's the point`);
    assert.ok(a.now && a.words <= 14, `${what}: one short instruction: "${a.now}"`);
    assert.equal(a.out, 'Menu', `${what}: how do I get out`);
    assert.ok(a.primary <= 1, `${what}: at most one primary (${a.primary})`);
    return a;
  };
  assert.equal((await audit('the pick')).step, 'Pick');
  assert.equal(await page.locator('[data-testid^=offer-need-]').count(), 1, 'one card is marked as needed: picking it costs nothing the job wants');
  const i = (await api('state')).offers.indexOf('crusher');
  await page.getByTestId(`offer-${i}`).click();
  await mode('build');
  assert.equal((await audit('the build')).step, 'Build');
  assert.ok(await page.locator('[data-spot^=shelf]').count(), 'the new part is lit on the shelf');
  assert.ok((await page.locator('[data-spot^=cell]').count()) >= 1, 'and so are the belt pieces it could take');
  await page.getByTestId('run').click();
  await mode('running');
  assert.equal((await audit('the shift')).step, 'Run');
  await page.getByTestId('skip').click();
  await mode('summary');
  await frames(2);
  await audit('the summary');
  assert.match(await page.getByTestId('job-pace').textContent(), /\d+ (ingots|plates) this shift/);
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
    // a shelf part
    const shelf = await at(binSlotCenter(0));
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
