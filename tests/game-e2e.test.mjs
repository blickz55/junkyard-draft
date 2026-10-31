// End-to-end gameplay in Chromium (production roadmap 0.9.5: one scenario per test, the fixture shared by the file): storage
// fallbacks and the telemetry toggle, the first draft, a real pointer drag with the refusal toast and the flow overlay, keyboard
// placement with undo, the frozen layout once the shift runs, pause and single steps, save and continue with the text-size
// settings, the remaining rounds through the dev API, the results card, a checked submission with its board and share texts,
// the exports, provenance, watching the checked recording and a try from it, the minted daily and its reveal gate, streaks,
// the archive, the weekly, a challenge link, crews, name moderation, keep-best, the HUD at 130 % and the funnel. The scenarios
// run in order on one page and build on each other, as a session does.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fixture, settle, until, SHOTS, cellCenter, binSlotCenter, shelfPoint } from './e2e/fixture.mjs';

const { RULES_VERSION } = await import('../game/src/sim/types.ts');
const { newRun, apply } = await import('../game/src/sim/run.ts');
const { exportReplay } = await import('../game/src/sim/replay.ts');
const { dailySeed } = await import('../game/src/sim/daily.ts');
const { RULES } = await import('../game/src/sim/rules.ts');
const { dropOnLine } = await import('./e2e/line.ts');
const V = String(RULES_VERSION); // records are partitioned by rules version (PLAN-v2 0.5.0)

const f = await fixture({
  verifier: true,
  verifierEnv: {
    PLAYER_RATE_LIMIT: '100',
    DAILY_SECRET: 'e2e-daily-secret',
    MODERATION_TOKEN: 'e2e-moderator',
    BOT_PAR_CAP_MS: '120000',
    REPORT_HIDE_REPORTERS: '1',
    REPORTER_ESTABLISHED_DAYS: '0',
  },
});
after(() => f.close());
const page = await f.page(); // string predicates below are polled with eval; the CSP itself is tested by tests/hardening-e2e.test.mjs
const { api, frames, when, title, draft, results, mode, draftRound, tick, textMatches, overlaySynced, drag, dismissCopyDialog, settled, at } = page.jd;
const VURL = f.vurl;
const vjson = (p, init) => f.verifier.json(p, init);
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}-${Date.now()}.png`) });
/** six rounds through the dev API: the last offer, run, skip, next */
const playThrough = async (rounds = 6) => {
  for (let r = 0; r < rounds; r++) {
    const round = (await api('state')).round;
    await page.evaluate(() => {
      const j = window.__jd;
      const st = j.state();
      j.pick(st.offers.length - 1);
      j.run();
    });
    await mode('running', 10000);
    await api('finishRun');
    await mode('summary', 10000);
    await api('next');
    await draftRound(round + 1, 10000);
  }
};
/** a legal six-round replay on a seed: a crusher first, in the belt, then the first offers */
const crusherRun = (seed) => {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    const ci = s.offers.indexOf('crusher');
    apply(s, { t: 'pick', i: ci >= 0 ? ci : 0 });
    if (r === 1) dropOnLine(s, 'crusher');
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
};
const verify = (run, player, headers = {}) =>
  vjson('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(player ? { replay: exportReplay(run), player } : { replay: exportReplay(run) }),
  });

/** Open the Settings dialog on the home screen; close it and wait for the screen that follows. */
const openSettings = async (p = page) => {
  await p.getByTestId('settings').click();
  await p.waitForSelector('[data-testid=settings-dialog]', { timeout: 5000 });
};
/** The links behind More on the home screen. */
const openMore = async (p = page) => {
  await p.getByTestId('more').click();
  await p.waitForSelector('[data-testid=more-dialog]', { timeout: 5000 });
};
/** The ways to share behind one line on the results. */
const openShare = async () => {
  await page.locator('[data-testid=share-more] summary').click();
};
const closeSettings = async (p = page) => {
  await p.getByTestId('settings-close').click();
  await p.jd.noDialog('settings-dialog');
  await p.jd.frames(3);
};
// shared across the scenarios (each one leaves the page where the next expects it)
let board, sub, dinfo, identity, plantedSave, groupCode, buddyToken, bsub, shared, detailed, kbConv;

test('boot: damaged storage shapes fall back, the telemetry toggle records consent', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl());
  await title();
  // malformed_storage_shapes_fall_back: valid JSON with the wrong shape must not crash boot or the title
  await page.evaluate(() => {
    localStorage.setItem('jd.bests.v1', JSON.stringify({ bySeed: null }));
    localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 'loud', textScale: 9, reducedMotion: 'maybe' }));
    localStorage.setItem('jd.submissions.v1', '"junk"');
  });
  await page.reload();
  await title();
  assert.deepEqual(page.errors, [], 'damaged storage shapes produced no page errors');
  await openSettings();
  assert.equal(await page.getByTestId('textscale').textContent(), '100%', 'an invalid text scale falls back to 100%');
  await closeSettings();
  await page.evaluate(() => {
    localStorage.removeItem('jd.bests.v1');
    localStorage.removeItem('jd.bests.v2');
    localStorage.removeItem('jd.settings.v1');
    localStorage.removeItem('jd.submissions.v1');
    localStorage.removeItem('jd.submissions.v2');
  });
  // player name for the verified board (set here so the results screen does not prompt)
  await page.evaluate(() => localStorage.setItem('jd.player', 'e2e player'));
  // play data (the owner's decision, 2026-10-31): on until the player turns it off; the Settings switch says so
  await openSettings();
  assert.equal(await page.getByTestId('telemetry').textContent(), 'Share play data: On');
  await page.getByTestId('telemetry').click();
  await when(() => JSON.parse(localStorage.getItem('jd.settings.v1') || '{}').telemetry === false);
  assert.equal(await page.getByTestId('telemetry').textContent(), 'Share play data: Off');
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.telemetry.v1')), null, 'off deletes the install id and the queue');
  await page.getByTestId('telemetry').click();
  await when(() => JSON.parse(localStorage.getItem('jd.settings.v1') || '{}').telemetry === true);
  assert.match(await page.evaluate(() => localStorage.getItem('jd.telemetry.v1') || ''), /"installId":"[0-9a-f]{32}"/, 'on again: a new random install id');
  await closeSettings();
});

test('first draft: the coach says pick one; a key picks it', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-e2e-seed'));
  await draft();
  const st0 = await api('state');
  assert.equal(st0.round, 1);
  assert.ok(st0.offers.includes('crusher'), 'round 1 offers a crusher');
  assert.match(await api('hint'), /^Pick ONE part\. The other two go back on the truck\.$/);
  await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][st0.offers.indexOf('crusher')]);
  await when(() => window.__jd.phase() === 'build');
  const st = await api('state');
  assert.equal(st.bin.length, 1);
  assert.equal(st.bin[0].kind, 'crusher');
});

test(
  'pointer drag: a part dropped on the belt swaps in, a refusal toasts at the cell and outlives two seconds, the flow overlay shows the belt, R and right-click rotate',
  { timeout: 60000 },
  async () => {
    // real drag: the crusher lands on the belt piece at (2,2) and takes its place; the belt piece goes to the shelf (docs/UX-STANDARD.md: the obvious move works)
    await drag(binSlotCenter(0), cellCenter(2, 2));
    const st = await api('state');
    assert.deepEqual(
      st.bin.map((m) => m.kind),
      ['conveyor'],
      'the belt piece went to the shelf',
    );
    const crusher = st.layout.machines.find((m) => m.kind === 'crusher');
    assert.ok(crusher && crusher.x === 2 && crusher.y === 2 && crusher.dir === 0, 'the crusher took its place, facing the way the line runs');
    {
      const flow = await api('flow');
      assert.ok(flow.visible && flow.links >= 3, `the flow overlay shows the starter belt's links in the build phase: ${JSON.stringify(flow)}`);
    }
    // a refusal says why at the place it happened and stays until the next action, not on a timer
    assert.equal(await api('act', { t: 'place', id: st.bin[0].id, x: 2, y: 2, dir: 0 }), false, 'the rules still refuse an occupied spot');
    {
      const toast = await api('toast');
      assert.ok(toast && toast.kind === 'refusal' && /^Something is already there/.test(toast.text) && toast.x === 2 && toast.y === 2, JSON.stringify(toast));
    }
    assert.doesNotMatch(await api('hint'), /^Something is already there/, 'the coach keeps its own instruction');
    await settle(2500, 'the toast must outlive the old two-second hint takeover: it goes with the next action, not with time');
    assert.match((await api('toast'))?.text ?? '', /^Something is already there/, 'the toast is still there after 2.5 s');
    assert.ok(
      (await api('act', { t: 'rotate', id: crusher.id })) &&
        (await api('act', { t: 'rotate', id: crusher.id })) &&
        (await api('act', { t: 'rotate', id: crusher.id })) &&
        (await api('act', { t: 'rotate', id: crusher.id })),
      'four turns: back where it was',
    );
    assert.equal(await api('toast'), null, 'the next action clears the toast');
    // rotate with R (selected after drag), once more with a right-click (a deliberate press and release, as a hand does it), then R twice more to face east again
    const crusherDir = () => page.evaluate(() => window.__jd.state().layout.machines.find((m) => m.kind === 'crusher').dir);
    const rotatedFrom = (d) => when((dd) => window.__jd.state().layout.machines.find((m) => m.kind === 'crusher').dir !== dd, d, 5000);
    await page.keyboard.press('r');
    await rotatedFrom(0);
    assert.equal(await crusherDir(), 1, 'R rotates');
    await settled(); // the sprite glides into its cell for 120 ms after a drop or a turn; a right-click on a gliding sprite misses it
    const c = await at(cellCenter(2, 2));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: 'right' });
    await frames();
    await page.mouse.up({ button: 'right' });
    await rotatedFrom(1);
    assert.equal(await crusherDir(), 2, 'right-click rotates');
    const crusherId = (await api('state')).layout.machines.find((m) => m.kind === 'crusher').id;
    assert.ok((await api('act', { t: 'rotate', id: crusherId })) && (await api('act', { t: 'rotate', id: crusherId })), 'two more turns through the dev API');
    assert.equal(await crusherDir(), 0, 'back to east');
    await shot('e2e-build');
  },
);

test(
  'keyboard placement: arrows, Enter, R, Ctrl+Z / Ctrl+Y with the panel buttons, a refusal toast at the cursor, a warning toast on an unfed spot, Delete, Escape',
  { timeout: 60000 },
  async () => {
    const cur = () => api('cursor');
    assert.equal((await cur()).visible, false, 'cursor hidden until an arrow key is pressed');
    await page.keyboard.press('ArrowRight');
    await frames();
    assert.deepEqual([(await cur()).x, (await cur()).y], [2, 2], 'first arrow press reveals the cursor on the selected crusher');
    await page.keyboard.press('ArrowDown');
    await frames();
    assert.deepEqual([(await cur()).x, (await cur()).y], [2, 3]);
    assert.equal((await api('state')).bin.length, 1, 'the conveyor waits in the bin');
    await page.keyboard.press('Enter');
    await frames();
    let st = await api('state');
    kbConv = st.layout.machines.find((mm) => mm.x === 2 && mm.y === 3);
    assert.ok(kbConv && kbConv.kind === 'conveyor', 'Enter placed the bin conveyor at the cursor');
    assert.equal(st.bin.length, 0);
    await page.keyboard.press('r');
    await frames();
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id).dir, 1, 'R rotates the machine just placed');
    // undo_restores_facing (PLAN-v1 0.3.3): Ctrl+Z undoes the rotation, Ctrl+Y re-applies it, the panel buttons track it
    const undoBtn = () =>
      page.evaluate(() => {
        const q = (n) => document.querySelector('[data-testid=' + n + ']');
        const a = (el) => (el ? (el.disabled ? 0.4 : 1) : undefined);
        return { undo: a(q('undo')), redo: a(q('redo')) };
      });
    assert.deepEqual(await undoBtn(), { undo: 1, redo: 0.4 }, 'Undo enabled after an edit, Redo disabled');
    await page.keyboard.press('Control+z');
    await when((id) => window.__jd.state().layout.machines.find((mm) => mm.id === id)?.dir === 0, kbConv.id, 5000);
    await frames(3); // the next shortcut must land more than 30 ms after this one: the controller drops a repeated modifier chord
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id).dir, 0, 'Ctrl+Z restores the previous facing');
    assert.deepEqual(await undoBtn(), { undo: 1, redo: 1 }, 'Redo enabled after an undo');
    await page.keyboard.press('Control+z');
    await when((id) => window.__jd.state().bin.some((mm) => mm.id === id), kbConv.id, 5000);
    await frames(3);
    assert.ok(
      (await api('state')).bin.some((mm) => mm.id === kbConv.id),
      'a second Ctrl+Z undoes the placement: the conveyor is back in the bin',
    );
    await page.keyboard.press('Control+y');
    await when((id) => window.__jd.state().layout.machines.some((mm) => mm.id === id), kbConv.id, 5000);
    await frames(3);
    await page.keyboard.press('Control+y');
    await when((id) => window.__jd.state().layout.machines.find((mm) => mm.id === id)?.dir === 1, kbConv.id, 5000);
    await frames(3);
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id)?.dir, 1, 'two Ctrl+Y re-place and re-rotate it');
    assert.deepEqual(await undoBtn(), { undo: 1, redo: 0.4 });
    await page.keyboard.press('Enter');
    await frames();
    assert.equal((await cur()).held, kbConv.id, 'Enter on a machine picks it up');
    await page.keyboard.press('ArrowUp');
    await frames();
    await page.keyboard.press('Enter');
    await frames();
    st = await api('state');
    assert.equal(st.layout.machines.find((mm) => mm.id === kbConv.id).y, 2, 'dropped on the crusher, the two swap places');
    assert.equal(st.layout.machines.find((mm) => mm.kind === 'crusher').y, 3);
    assert.equal((await cur()).held, null);
    await page.keyboard.press('Control+z');
    await when(() => window.__jd.state().layout.machines.find((mm) => mm.kind === 'crusher').y === 2, null, 5000);
    await frames(3);
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id).y, 3, 'one undo takes the whole swap back');
    await page.keyboard.press('ArrowDown');
    await frames();
    await page.keyboard.press('Enter');
    await frames();
    assert.equal((await cur()).held, kbConv.id, 'picked up again');
    await page.keyboard.press('ArrowRight');
    await frames();
    {
      const w = await api('toast');
      assert.ok(w && w.kind === 'warning' && /Nothing feeds/.test(w.text), `a legal but unfed spot warns in a toast instead of refusing: ${JSON.stringify(w)}`);
    }
    await shot('e2e-ghost-arrows');
    await page.keyboard.press('Enter');
    await frames();
    assert.equal((await api('toast'))?.kind, 'warning', 'the placed machine keeps its warning at the cell until the next action');
    st = await api('state');
    kbConv = st.layout.machines.find((mm) => mm.id === kbConv.id);
    assert.deepEqual([kbConv.x, kbConv.y, (await cur()).held], [3, 3, null], 'moved by keyboard and dropped');
    await page.keyboard.press('Delete');
    await frames();
    st = await api('state');
    assert.equal(st.bin.length, 1, 'Delete sent the machine under the cursor back to the bin');
    assert.ok(!st.layout.machines.some((mm) => mm.x === 3 && mm.y === 3));
    await page.keyboard.press('Escape');
    await frames();
    assert.equal((await cur()).visible, false, 'Escape hides the cursor (Delete already let the machine go)');
    await shot('e2e-keyboard');
  },
);

test(
  'the shift: a drag in progress snaps back when the round starts, the layout is frozen, pause, three steps and the . key, no overlay, the summary',
  { timeout: 90000 },
  async () => {
    // starting_round_cancels_active_drag: a machine under the pointer when the round starts snaps back; the drop edits nothing
    const hopperCell = await at(cellCenter(1, 2));
    const before = JSON.stringify((await api('state')).layout.machines);
    await page.mouse.move(hopperCell.x, hopperCell.y);
    await page.mouse.down();
    await page.mouse.move(hopperCell.x + 24, hopperCell.y + 24, { steps: 4 });
    await page.keyboard.press('Space');
    await mode('running');
    const shelf = await at(shelfPoint);
    await page.mouse.move(shelf.x, shelf.y, { steps: 8 });
    await page.mouse.up();
    await frames();
    let st = await api('state');
    assert.equal(JSON.stringify(st.layout.machines), before, 'the authoritative layout is frozen once the round starts');
    assert.equal(st.bin.length, 1, 'the dropped hopper did not land in the bin');
    assert.equal(await api('act', { t: 'unplace', id: st.layout.machines[0].id }), false, 'layout edits through the dev API are refused while running too');
    assert.equal(JSON.stringify((await api('state')).layout.machines), before);
    // the round is running (Space is ignored while running); watch a couple of ticks of animation, then pause
    await page.keyboard.press('Space');
    await mode('running');
    await tick(2);
    await shot('e2e-running');
    await page.keyboard.press('Escape');
    await mode('paused');
    {
      // single step while paused (0.8.12): the Step button three times, then the . key once; the tick counter follows and the mode stays paused
      const t0 = (await api('stall')).tick;
      for (let i = 0; i < 3; i++) await page.getByTestId('step').click();
      assert.equal((await api('stall')).tick, t0 + 3, 'three steps advance exactly three ticks');
      assert.match(
        await page.getByTestId('paused-veil').textContent(),
        new RegExp(`Second ${t0 + 3} of 80`),
        "the veil shows the tick as a second of the yard's clock",
      );
      await page.keyboard.press('Period');
      await when((t) => window.__jd.stall().tick === t, t0 + 4);
      assert.equal(await api('mode'), 'paused', 'the . key steps one tick and stays paused');
    }
    await frames(3); // a frame boundary between the . key and Esc: the harness can press faster than a hand, and both keys land in one Phaser update otherwise
    await page.keyboard.press('Escape');
    await mode('running');
    assert.equal((await api('flow')).visible, false, 'no flow overlay while the shift runs');
    await api('finishRun');
    await mode('summary');
    st = await api('state');
    assert.equal(st.rounds.length, 1);
    assert.ok(st.rounds[0].shipped.shards > 0, 'crusher chain shipped shards');
    assert.ok(st.rounds[0].earned > 38, `round 1 earned ${st.rounds[0].earned} > starter 38`);
    await shot('e2e-summary');
  },
);

test(
  'save and continue: the title offers the saved run, reduced motion and text size persist and scale the labels, the title fits at 130 %',
  { timeout: 90000 },
  async () => {
    await page.goto(f.gameUrl());
    await title();
    assert.ok(await page.evaluate(() => !!localStorage.getItem('jd.save.v1')), 'run saved to localStorage');
    // today's verified board on the title screen (verifier spawned by this file; no entries for today yet)
    await textMatches('daily-board', /No scores yet today/);
    // accessibility settings: reduced motion and text size persist, re-render the title, and apply in-game
    const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('jd.settings.v1') || '{}'));
    await openSettings();
    await page.getByTestId('motion').click();
    await textMatches('motion', /^Reduced$/);
    assert.equal((await settings()).reducedMotion, true, 'reduced motion persisted');
    await page.getByTestId('textscale').click();
    await textMatches('textscale', /^115%$/);
    assert.equal((await settings()).textScale, 1.15, 'text size persisted');
    assert.equal((await settings()).reducedMotion, true, 'text size change kept the motion setting');
    await closeSettings();
    await overlaySynced();
    const linePx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid=today-line]')).fontSize));
    assert.ok(Math.abs(linePx - 13 * 1.15) < 0.6, `labels scale with text size (13px × 1.15 ≈ ${linePx.toFixed(2)}px)`);
    await openSettings();
    await page.getByTestId('textscale').click();
    await textMatches('textscale', /^130%$/);
    await closeSettings();
    // the text-size change restarts the home scene; under load the overlay can lag the canvas for a frame or two, so measure only once
    // the overlay box equals the canvas box and its scale variable matches (every element is measured against the overlay)
    await overlaySynced();
    await frames(2);
    // large_text_layout_fits (title, 130 %, with a saved run present): nothing overlaps or leaves the canvas
    const titleLayout = await page.evaluate(() => {
      const g = (n) => document.querySelector('[data-testid=' + n + ']')?.getBoundingClientRect();
      const ui = document.getElementById('ui').getBoundingClientRect();
      const all = [...document.querySelectorAll('#ui [data-testid]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.testid, inside: r.left >= ui.left - 1 && r.right <= ui.right + 1 && r.top >= ui.top - 1 && r.bottom <= ui.bottom + 1 };
      });
      return {
        note: g('continue-note'),
        daily: g('daily'),
        ui,
        outside: all.filter((a) => !a.inside).map((a) => a.id),
        scrollH: document.querySelector('#ui .jd-screen').scrollHeight,
        clientH: document.querySelector('#ui .jd-screen').clientHeight,
      };
    });
    assert.ok(
      titleLayout.note.bottom <= titleLayout.daily.top + 1,
      `continue note (${titleLayout.note.bottom}) clears the buttons below (${titleLayout.daily.top})`,
    );
    assert.deepEqual(titleLayout.outside, [], 'every control stays inside the overlay at 130 %');
    assert.ok(titleLayout.scrollH <= titleLayout.clientH + 1, `the title does not need to scroll at 130 % (${titleLayout.scrollH} vs ${titleLayout.clientH})`);
    await openSettings();
    await page.getByTestId('textscale').click();
    await textMatches('textscale', /^100%$/);
    assert.equal((await settings()).textScale, 1);
    await closeSettings();
    await page.keyboard.press('Enter'); // continue
    await when(() => !!window.__jd && window.__jd.phase() === 'result');
    const st = await api('state');
    assert.equal(st.rounds.length, 1);
    assert.ok(st.score > 38, 'score restored');
  },
);

test(
  'rounds 2 to 6 through the dev API: the sell bonus, the bottleneck line and its repeat as the next hint, pooled pops, static belts under reduced motion, the results, the bests',
  { timeout: 120000 },
  async () => {
    await api('next');
    let lastBottleneck = '';
    for (let r = 2; r <= 6; r++) {
      await when((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
      if (r === 3)
        assert.ok((await page.getByTestId('last-shift').textContent()).includes(lastBottleneck), "the last shift's advice stays on screen through the pick");
      await api('pick', 0);
      if (r === 3) assert.ok((await page.getByTestId('last-shift').textContent()).includes(lastBottleneck), 'and through the build');
      if (r === 2) {
        const before = (await api('state')).score;
        const binPart = (await api('state')).bin.find((m) => m.x < 0);
        assert.ok(await api('act', { t: 'sell', id: binPart.id }), 'sell accepted');
        assert.equal((await api('state')).score, before + 10, 'sell bonus added');
      }
      await api('run');
      if (r === 3) {
        // pooled_pops_never_exceed_the_pool: let the round run live for a couple of ticks (finishRun skips the visuals), then check the pool
        await tick(2);
        const liveEarned = await page.evaluate(() => window.__jdGame.scene.getScene('Game').sim?.earned ?? 0);
        const live = await api('counters');
        if (liveEarned > 0) assert.ok(live.popsPeak >= 1, `a round that has earned $${liveEarned} so far showed at least one pop`);
        assert.ok(live.popsPeak <= live.poolMax && live.poolSize <= live.poolMax, `pops peaked at ${live.popsPeak}, pool ${live.poolSize}/${live.poolMax}`);
      }
      if (r === 2) {
        // reduced motion (set on the title screen above) keeps conveyor belts on frame 0 while running
        await tick(1);
        assert.equal((await api('prefs')).reducedMotion, true);
        const belts = await page.evaluate(() =>
          window.__jdGame.scene
            .getScene('Game')
            .children.list.flatMap((o) => (o.list ? o.list : [o]))
            .filter((o) => o.texture && /^belt-/.test(o.texture.key))
            .map((o) => o.texture.key),
        );
        assert.ok(belts.length > 0 && belts.every((k) => k === 'belt-0'), `belts static under reduced motion: ${belts.join(',')}`);
      }
      await api('finishRun');
      await mode('summary');
      // the bottleneck line (0.8.8): one sentence on the summary naming what held the line, repeated as the next draft's hint
      const bottleneck = await page.getByTestId('bottleneck').textContent();
      assert.match(
        bottleneck,
        /^(The (hopper|conveyor|crusher|furnace|press|splitter) (held|is a dead end|was stuck)|This conveyor held|Not enough scrap|Nothing held you back|Nothing reached a dock)/,
        `round ${r} bottleneck line: ${bottleneck}`,
      );
      if (r === 2) lastBottleneck = bottleneck;
      if (r >= 3) {
        // pooled_pops_never_exceed_the_pool: finishRun ships a whole round in one frame; the +$ pops come from a 16-slot pool
        const ctr = await api('counters');
        assert.ok(ctr.popsPeak <= ctr.poolMax, `pops alive peaked at ${ctr.popsPeak} (pool ${ctr.poolMax})`);
        assert.ok(ctr.poolSize <= ctr.poolMax, 'the pool never grows past its cap');
      }
      await api('next');
    }
    await results();
    await shot('e2e-results');
    const completed = (await api('state')).score; // the Game scene's run object holds the finished run
    const bests = await page.evaluate((v) => JSON.parse(localStorage.getItem('jd.bests.v2')).byVersion[v], V);
    assert.equal(bests.overall?.score, completed, 'personal_best_equals_completed_score (overall)');
    assert.equal(bests.bySeed['classic-e2e-seed']?.score, completed, 'personal_best_equals_completed_score (seed)');
    assert.equal(bests.runs, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'save cleared after finishing');
  },
);

test(
  "a checked submission: the status, the chart, the foreman's mark, the claimed name and tag, the tie rule, the results card's order and deltas, the screenshots for the owner",
  { timeout: 200000 },
  async () => {
    await page.getByTestId('submit').click();
    await textMatches('status', /^Checked: \$\d+\. You are #1 of 1 on the board as e2e player#[2-9A-HJKMNP-TV-Z]{4}\./);
    // histogram_first (PLAN-v1 0.4.1): the only verified run is highlighted and the text says so without inventing a population
    await textMatches('percentile', /^1 game so far · you are #1$/, 10000);
    // the board re-renders after the submission; on a loaded runner the bins can land a frame after the percentile text (CI on 083c883 read 0 bins)
    await when(() => document.querySelectorAll('[data-testid=histogram] .jd-hist-bin').length >= 1, null, 10000);
    const hist = await page.evaluate(() => ({
      bins: document.querySelectorAll('[data-testid=histogram] .jd-hist-bin').length,
      mine: document.querySelectorAll('[data-testid=histogram] .jd-hist-mine').length,
      mineCount: document.querySelector('[data-testid=histogram] .jd-hist-mine .jd-hist-count')?.textContent,
    }));
    assert.ok(hist.bins >= 1 && hist.mine === 1 && hist.mineCount === '1', `histogram shows the player's bin: ${JSON.stringify(hist)}`);
    // bot_par_is_a_target_not_an_entry (PLAN-v1 0.4.5): the test verifier computed the autoplayer's par for this seed in a worker; it shows as a bot line and the board still has one entry
    // the par job competes for cores with the other test files on a 4-vCPU CI runner: wait for the verifier's par first (long budget, timing logged), then for the results screen, which keeps asking for ~90 s
    const parT0 = Date.now();
    board = await until(
      async () => {
        const b = await vjson('/board?seed=classic-e2e-seed');
        return typeof b.botPar === 'number' ? b : null;
      },
      { timeout: 120000, every: 1000, what: 'the bot par for classic-e2e-seed' },
    );
    console.log(`bot par for classic-e2e-seed arrived after ${((Date.now() - parT0) / 1000).toFixed(1)} s`);
    await textMatches('bot-par', /^Sal's mark: \$\d+\. A target to beat/, 30000);
    assert.ok(board.botPar > 0, 'the board carries a numeric bot par');
    assert.equal(board.entries.length, 1, 'one verified entry');
    assert.match(
      board.entries[0].player,
      /^e2e player#[2-9A-HJKMNP-TV-Z]{4}$/,
      'the local name was claimed on first submission and the entry carries name#tag (PLAN-v3 0.6.0)',
    );
    identity = JSON.parse(await page.evaluate(() => localStorage.getItem('jd.identity.v1')));
    assert.match(identity.token, /^[0-9a-f]{32}$/);
    assert.equal(
      board.entries[0].playerId,
      createHash('sha256').update(identity.token).digest('hex'),
      'the entry is stamped with SHA-256(token) of the device token the page holds',
    );
    assert.equal(identity.playerId, board.entries[0].playerId, 'the page cached the player id the verifier confirmed');
    assert.equal(`${identity.name}#${identity.tag}`, board.entries[0].player, 'the claimed name and tag are cached on the device');
    assert.equal(typeof board.entries[0].finalMachines, 'number', 'the verifier derived the tie-break field');
    assert.equal(await page.locator('[data-testid=tie-rule]').count(), 0, 'the tie rule speaks only when two scores tie; the fair play page always has it');
    // the results card (production roadmap 0.9.2): the standing sentence leads, then the money, then the deltas; round bars, the board and the Play / Share / Watch rows follow in that order
    await textMatches('headline', /^#1 of 1 game on this yard$/, 10000);
    assert.match(await page.getByTestId('delta-par').textContent(), /^(\+\$\d+ over|−\$\d+ under|exactly) Sal's mark$/, "Sal's mark delta");
    assert.equal(await page.getByTestId('delta-best').textContent(), 'your first game on this yard');
    const order = await page.evaluate(() =>
      ['score', 'headline', 'deltas', 'actions-play', 'round-bars', 'board', 'actions-share', 'actions-watch']
        .map((id) => document.querySelector(`[data-testid=${id}]`))
        .map((el, i, arr) => !!el && (i === 0 || (arr[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)),
    );
    assert.deepEqual(order, Array(8).fill(true), 'the card reads money, standing, deltas, what to do next, shift bars, the board, Share, Watch');
    for (const [w, hh] of [
      [390, 844],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: w, height: hh });
      await overlaySynced();
      await page.screenshot({ path: path.join(SHOTS, `results-${w}-${Date.now()}.png`), fullPage: true });
    } // for the owner's review (0.9.2 acceptance)
    await page.setViewportSize({ width: 1120, height: 700 });
    await overlaySynced();
  },
);

test(
  'share texts: spoiler-free with the "Beat this" link by default, the detailed variant, the opt-out, badges, the local record',
  { timeout: 60000 },
  async () => {
    await page.getByTestId('share').click();
    await when(() => !!window.__jdGame.scene.getScene('Results').lastShareText, null, 5000); // clipboard availability varies in headless runs; the text itself is what matters
    shared = await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText); // headless clipboard contents are not reliably readable
    // spoiler_free_share (PLAN-v1 0.4.3): label · score, six glyphs, the standing, days played; no per-round dollars, no layout; the link (0.9.2)
    assert.match(
      shared,
      /^Junkyard Draft · yard classic-e2e-seed · \$\d+\n[░▒▓█]{6}\n#1 of 1 on the board as e2e player#[2-9A-HJKMNP-TV-Z]{4}\n1 day played\nhttp:\/\/127\.0\.0\.1:\d+\/\?challenge=[0-9a-f]+(&verifier=[^\n]+)?$/,
      `default share text (0.9.2: the "Beat this" link of the checked game by default): ${JSON.stringify(shared)}`,
    );
    assert.doesNotMatch(shared, /shifts \$|hopper|conveyor|crusher|seed=/);
    await dismissCopyDialog();
    await openShare();
    await page.getByTestId('share-link').check();
    await page.getByTestId('share-detailed').click();
    await when(() => /shifts \$/.test(window.__jdGame.scene.getScene('Results').lastShareText), null, 5000);
    detailed = await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText);
    assert.match(
      detailed,
      new RegExp(
        `\\nshifts \\$\\d+ · \\$\\d+ · \\$\\d+ · \\$\\d+ · \\$\\d+ · \\$\\d+\\nchecked by the Junkyard Draft server(\\nbadges: [^\\n]+)?\\n1 day played\\nhttp:\\/\\/127\\.0\\.0\\.1:\\d+\\/\\?challenge=[0-9a-f]+(&verifier=[^\\n]+)?$`,
      ),
      `detailed share text with link: ${JSON.stringify(detailed)}`,
    );
    await dismissCopyDialog();
    await page.getByTestId('share-link').uncheck(); // opt-out (0.9.2): unticked, no link at all
    await page.getByTestId('share').click();
    await when(() => !/https?:/.test(window.__jdGame.scene.getScene('Results').lastShareText), null, 5000);
    assert.match(
      await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText),
      /\n1 day played$/,
      'unticked: the share text ends without a link',
    );
    await dismissCopyDialog();
    // non_ranked_badges (PLAN-v1 0.4.6): pills are known badges and the detailed verified text lists exactly them
    const pills = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid=badges] .jd-badge-pill')].map((p) => ({ id: p.dataset.testid, title: p.textContent })),
    );
    for (const p of pills) assert.ok(['badge-clean', 'badge-minimalist', 'badge-full-grid'].includes(p.id), `known badge: ${p.id}`);
    const badgeLine = detailed.split('\n').find((l) => l.startsWith('badges: '));
    if (pills.length) assert.equal(badgeLine, 'badges: ' + pills.map((p) => p.title).join(' · '));
    else assert.equal(badgeLine, undefined, 'no badges, no line');
    assert.doesNotMatch(shared, /badges/, 'the spoiler-free grid never lists badges');
    const subs = await page.evaluate((v) => JSON.parse(localStorage.getItem('jd.submissions.v2')).byVersion[v], V);
    assert.equal(subs['classic-e2e-seed'].replayHash, board.entries[0].replayHash, 'submission recorded locally by replay hash');
  },
);

test('exports: the share card, the loop clip and the GIF say checked for this checked run', { timeout: 90000 }, async () => {
  // share card (PLAN-v4 0.7.4): a 1200×630 PNG whose footer says verified only for this verified run
  const card = await page.evaluate(() =>
    window.__jdGame.scene
      .getScene('Results')
      .exportCard()
      .then((c) => ({ ...c })),
  );
  assert.deepEqual([card.width, card.height], [1200, 630]);
  assert.ok(card.size > 10_000, `card has bytes (${card.size})`);
  assert.match(card.filename, /^junkyard-classic-e2e-seed-\$\d+-card\.png$/);
  assert.match(card.footer, /^junkyard draft · checked · build /);
  assert.match(card.standing, /^#1 of 1 on the board/);
  assert.deepEqual(card.extras, [], 'no group, no medal, no challenge, no link: nothing invented');
  // loop_clip_exports (PLAN-v1 0.4.2): the best round is re-simulated and recorded live in Chromium; the clip is non-empty, at least 3 s, and takes under 10 s to make
  const clip = await page.evaluate(() =>
    window.__jdGame.scene
      .getScene('Results')
      .exportClip()
      .then((c) => ({ ...c })),
  );
  assert.ok(clip.size > 0, `clip has bytes (${clip.size})`);
  assert.ok(clip.ms >= 3000, `clip recorded for at least 3 s (${clip.ms} ms)`);
  assert.ok(clip.elapsedMs <= 15000, `export finished in under 15 s (${clip.elapsedMs} ms)`); // 3 s of real-time capture plus encoding; a loaded 4-vCPU runner took 10.1 s (083c883)
  assert.match(clip.mime, /^video\/(webm|mp4)/);
  assert.match(clip.filename, /^junkyard-classic-e2e-seed-\$\d+-r\d\.(webm|mp4)$/);
  assert.ok(clip.frames >= 60 && clip.width >= 624 && clip.height >= 536, `frames ${clip.frames}, ${clip.width}x${clip.height}`);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid=export-clip]')?.disabled), false, 'the export button is usable again');
  assert.equal(clip.footer, 'junkyard draft · checked recording', 'this run was accepted by the verifier above, so its clip may say so (review F10)');
  // gif_clip_exports (PLAN-v1 0.4.11): the same round as a GIF89a drawn offline at 1x and 10 fps: real header, logical size,
  // a one-pass loop with a hold, ≤ 256 colours, under the 2 MB budget, in a few seconds
  const gif = await page.evaluate(() =>
    window.__jdGame.scene
      .getScene('Results')
      .exportGif()
      .then((g) => ({ ...g })),
  );
  assert.equal(gif.magic, 'GIF89a');
  assert.ok(gif.size > 10_000 && gif.size <= 2 * 1024 * 1024, `GIF size within budget (${gif.size} bytes)`);
  assert.ok(gif.frames >= 30 && gif.frames <= 60 && gif.ms >= 3000, `${gif.frames} frames over ${gif.ms} ms`);
  assert.ok(gif.colours > 8 && gif.colours <= 256, `palette of ${gif.colours} colours`);
  assert.ok(gif.width >= 624 && gif.height >= 536, `${gif.width}x${gif.height}`);
  assert.ok(gif.elapsedMs <= 15000, `GIF drawn and encoded in under 15 s (${gif.elapsedMs} ms)`);
  assert.match(gif.filename, /^junkyard-classic-e2e-seed-\$\d+-r\d\.gif$/);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid=export-gif]')?.disabled), false, 'the GIF button is usable again');
  assert.equal(gif.footer, 'junkyard draft · checked recording');
  // 0.10.6: the GIF is the final layout, and its strip names the yard, the score and the checked hash's first eight characters
  assert.equal(gif.round, 6, 'the final layout by default');
  assert.match(gif.strip, /classic-e2e-seed · \$\d+ · [0-9a-f]{8}$/, `the strip: ${gif.strip}`);
  const hasShareSheet = await page.evaluate(() => typeof navigator.share === 'function');
  assert.equal(await page.locator('[data-testid=share-native]').count(), hasShareSheet ? 1 : 0, 'the share-sheet button only where the browser has one');
});

test('provenance: a different, unsubmitted attempt on the same yard claims no standing and its exports say local', { timeout: 90000 }, async () => {
  // results_provenance (review F11): a different, unsubmitted attempt on the same seed shows no rank for itself, names the earlier verified attempt as a different one, and its exports say local
  await page.evaluate(() => window.__jdGame.scene.start('Game', { seed: 'classic-e2e-seed', fresh: true }));
  await when(() => !!window.__jd && window.__jd.phase() === 'draft' && window.__jd.state().round === 1 && window.__jd.state().rounds.length === 0);
  await playThrough();
  await results();
  await page.waitForSelector('[data-testid=prior-best]', { timeout: 10000 });
  const prov = await page.evaluate(() => ({
    prior: document.querySelector('[data-testid=prior-best]')?.textContent,
    pct: document.querySelector('[data-testid=percentile]')?.textContent,
    mine: document.querySelectorAll('[data-testid=histogram] .jd-hist-mine').length,
    verifiedHash: window.__jdGame.scene.getScene('Results').verifiedHash,
  }));
  assert.match(prov.prior ?? '', /^Your checked game on this yard: \$\d+\. This one counts only once it is on the board\.$/, JSON.stringify(prov));
  assert.doesNotMatch(prov.pct ?? '', /you are #|Better than/, 'no standing is claimed for an unverified attempt');
  assert.equal(prov.mine, 0, 'no bin is highlighted as this run');
  assert.equal(prov.verifiedHash, null);
  const localCard = await page.evaluate(() =>
    window.__jdGame.scene
      .getScene('Results')
      .exportCard()
      .then((c) => ({ footer: c.footer, standing: c.standing, extras: c.extras })),
  );
  assert.equal(localCard.footer, 'junkyard draft · this device · not yet checked');
  assert.equal(localCard.standing, 'score on this device, not yet checked');
  assert.doesNotMatch(
    [localCard.footer, localCard.standing, ...localCard.extras].join('\n'),
    /\bverified\b/,
    'a local card never claims verification (PLAN-v4 0.7.4)',
  );
  const localGif = await page.evaluate(() =>
    window.__jdGame.scene
      .getScene('Results')
      .exportGif()
      .then((g) => ({ footer: g.footer })),
  );
  assert.equal(localGif.footer, 'junkyard draft · this device · not yet checked', 'a local export never claims a check');
});

test(
  'watching the checked recording: fetched by hash, labelled, never a best; a try from after round 2; Esc stops a recording',
  { timeout: 120000 },
  async () => {
    const bestsBefore = await page.evaluate(() => localStorage.getItem('jd.bests.v2'));
    // watched_replay_preserves_existing_save: plant an unrelated unfinished run; it must survive playback byte for byte
    plantedSave = JSON.stringify({ rulesVersion: Number(V), seed: 'other-seed', actions: [{ t: 'pick', i: 0 }], savedAt: '2026-10-26T00:00:00.000Z' });
    await page.evaluate((s) => localStorage.setItem('jd.save.v1', s), plantedSave);
    await page.waitForSelector('[data-testid=board-entry-0]:not([disabled])', { timeout: 10000 });
    await page.getByTestId('board-entry-0').click();
    await when(
      () =>
        window.__jdGame.scene.isActive('Game') &&
        !!window.__jd &&
        /recording by e2e player/.test(document.querySelector('[data-testid=hud-seed]')?.textContent || ''),
    );
    // playback controls: REPLAY marker, the original run's earnings next to the live total, a Stop button
    assert.ok(await page.evaluate(() => !!document.querySelector('[data-testid=replay-banner]')), 'REPLAY marker shown while watching');
    await mode('running');
    const sideTexts = await page.evaluate(() => ({
      orig: document.querySelector('[data-testid=replay-original]')?.textContent,
      stop: document.querySelector('[data-testid=stop]')?.textContent,
    }));
    assert.match(sideTexts.orig || '', /^Their game: \$\d+ this shift · \$\d+ after shift 1 · \$\d+ final$/);
    assert.equal(sideTexts.stop, 'Stop watching');
    for (let r = 1; r <= 6; r++) {
      await mode('running');
      await api('finishRun'); // playback uses the real run loop; skip the animation of each round
      await mode('summary');
    }
    await when(
      () =>
        window.__jdGame.scene.isActive('Results') &&
        /recording by e2e player/.test(document.querySelector('[data-testid=results-subtitle]')?.textContent || ''),
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.bests.v2')), bestsBefore, 'watching a replay does not change local bests');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), plantedSave, 'finishing a watched replay leaves the unrelated save untouched');
    assert.equal(
      await page.evaluate(() => Number(document.querySelector('[data-testid=score]').textContent.slice(1))),
      board.entries[0].score,
      'playback reproduces the verified score',
    );
    // fork from round N (PLAN-v4 0.7.3): the watched replay's results offer forks; a fork is labelled, plays on from the next round, and never gets submit/export controls or touches the bests
    assert.equal(await page.locator('[data-testid=fork-row] button').count(), 5, 'one fork button per non-final round');
    await page.getByTestId('fork-2').click();
    await when(
      () =>
        window.__jdGame.scene.isActive('Game') &&
        !!window.__jd &&
        window.__jd.phase() === 'draft' &&
        window.__jd.state().round === 3 &&
        window.__jd.state().rounds.length === 2,
    );
    assert.match(await page.getByTestId('hud-seed').textContent(), /^Yard classic-e2e-seed · a try from e2e player(#[A-Z2-9]{4})? after shift 2 · practice$/);
    assert.equal(await page.locator('[data-testid=replay-banner]').count(), 0, 'a fork is live play, not playback');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), plantedSave, "a fork never becomes the player's save");
    await playThrough(4);
    await results();
    assert.match(
      await page.getByTestId('results-subtitle').textContent(),
      /a try from e2e player(#[A-Z2-9]{4})? after shift 2 · practice \(a try: doesn't go on the board\)/,
    );
    assert.equal(await page.locator('[data-testid=submit]').count(), 0, 'no submit control on a fork');
    assert.equal(await page.locator('[data-testid=export]').count(), 0);
    assert.equal(await page.locator('[data-testid=download]').count(), 0);
    assert.match(await page.getByTestId('fork-best').textContent(), /^New best for this try: \$\d+$/);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.bests.v2')), bestsBefore, 'a fork never touches the local bests');
    assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.forkbests.v1')))['classic-e2e-seed'], 'fork bests live in their own bucket');
    await page.getByTestId('share').click();
    await when(() => !!window.__jdGame.scene.getScene('Results').lastShareText, null, 5000);
    assert.match(
      await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText),
      /\na try from e2e player(#[A-Z2-9]{4})?'s game, from shift 3 · not on the board\n/,
    );
    await dismissCopyDialog();
    // Esc stops a watched replay mid-run and returns to the title (instead of pausing)
    await page.waitForSelector('[data-testid=board-entry-0]:not([disabled])', { timeout: 10000 });
    await page.getByTestId('board-entry-0').click();
    await when(() => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.mode() === 'running');
    await page.keyboard.press('Escape');
    await title(10000);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), plantedSave, 'stopping a replay leaves the unrelated save untouched too');
    await page.evaluate(() => localStorage.removeItem('jd.save.v1'));
  },
);

test(
  "the minted daily: a checked daily run, the practice seed stays off the daily board, the reveal gate opens after this device's own checked game, streak with grace",
  { timeout: 120000 },
  async () => {
    // minted daily (PLAN-v3 0.6.1): the ranked seed comes from the verifier, never from the client's date
    dinfo = await vjson('/daily');
    assert.match(dinfo.seed, /^daily-\d{4}-\d{2}-\d{2}-[a-z2-7]{8}$/, `minted seed: ${dinfo.seed}`);
    assert.equal(dinfo.minted, true);
    assert.match(dinfo.commitment, /^[0-9a-f]{64}$/, 'a commitment to tomorrow is published');
    sub = await verify(crusherRun(dinfo.seed), 'e2e player');
    assert.equal(sub.ok, true, 'daily replay verified');
    // a run on the practice seed verifies as an ordinary seed board and never reaches the daily board
    const psub = await verify(crusherRun(dailySeed()), 'practice player');
    assert.equal(psub.ok, true, 'the practice seed is an ordinary seed board');
    const dboard = await vjson('/daily');
    assert.deepEqual(
      dboard.entries.map((e) => e.replayHash),
      [sub.entry.replayHash],
      'only the minted-seed run is on the daily board',
    );
    // reveal gate (PLAN-v3 0.6.6): before this device has a verified entry for the open daily, the best replay is not watchable (button and endpoint); afterwards it is
    await page.goto(f.gameUrl());
    await page.waitForSelector('[data-testid=daily-watch][disabled]', { timeout: 15000 });
    assert.equal(await page.getByTestId('daily-watch').textContent(), 'Watch #1 (once your score is in)');
    assert.match(await page.getByTestId('daily-watch').getAttribute('title'), /open once your score is on the board/);
    const gated = await fetch(`${VURL}/replay?hash=${sub.entry.replayHash}`);
    assert.equal(gated.status, 403);
    assert.match((await gated.json()).error, /revealed after you submit/);
    await page.evaluate(({ seed, s, v }) => localStorage.setItem('jd.submissions.v2', JSON.stringify({ byVersion: { [v]: { [seed]: s } } })), {
      v: V,
      seed: dinfo.seed,
      s: { score: sub.score, replayHash: sub.entry.replayHash, verifiedAt: sub.entry.verifiedAt, player: 'e2e player' },
    });
    await page.goto(f.gameUrl());
    await when(() => {
      const t = document.querySelector('[data-testid=daily-board]')?.textContent || '';
      return /^You: #1 of 1, \$\d+/.test(t) && /1\. \$\d+ e2e player/.test(t);
    });
    assert.match(await page.getByTestId('daily-mode').textContent(), /^open · \d+ (hour|hours|minute|minutes) left$/);
    assert.equal(await page.getByTestId('today-card').getAttribute('data-seed'), dinfo.seed);
    await page.waitForSelector('[data-testid=daily-watch]:not([disabled])', { timeout: 10000 });
    assert.equal(await page.getByTestId('daily-watch').textContent(), 'Watch #1', 'with a verified entry for the day on this device the replay opens up');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.daily.v1'))).seed, dinfo.seed, 'the minted seed is cached for the day');
    // streak with grace (PLAN-v3 0.6.3): the title line counts consecutive verified dailies ending today or yesterday; a broken chain just shows the plain count
    const dayBack = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await page.evaluate((ds) => localStorage.setItem('jd.dailystreak.v1', JSON.stringify(ds)), [dayBack(1), dayBack(2), dayBack(4)]);
    await page.reload();
    await title();
    assert.match(
      await page.getByTestId('today-line').textContent(),
      / · 1 day played · 2 in a row$/,
      'yesterday and the day before: alive through the grace window, the gap before does not count',
    );
    await page.evaluate((ds) => localStorage.setItem('jd.dailystreak.v1', JSON.stringify(ds)), [dayBack(2), dayBack(3)]);
    await page.reload();
    await title();
    assert.match(
      await page.getByTestId('today-line').textContent(),
      / · 1 day played$/,
      'a chain that ended two days back shows the plain count, no loss copy',
    );
    await page.evaluate(() => localStorage.removeItem('jd.dailystreak.v1'));
  },
);

test(
  'window, freeze, archive and the weekly: a closed day is final and a late run never ranks; the archive lists days and the previous week; the weekly seed plays and lands on its own board',
  { timeout: 120000 },
  async () => {
    // window, freeze, archive (PLAN-v3 0.6.2): a day two days back closed at 00:00 UTC today: final, a run on it verifies as late and never ranks, the archive lists it
    const twoBack = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const old = await vjson(`/daily?date=${twoBack}`);
    assert.equal(old.final, true);
    assert.equal(old.frozenAt, old.closesAt);
    const lateRun = crusherRun(old.seed);
    const lsub = await verify(lateRun, 'late player');
    assert.equal(lsub.ok, true);
    assert.equal(lsub.late, true);
    assert.equal(lsub.recorded, false);
    assert.equal(lsub.score, lateRun.score, 'late runs are still re-simulated');
    const arch = await vjson('/archive');
    assert.deepEqual(arch.days[0], { ...arch.days[0], date: twoBack, n: 0 }, 'the archive lists the closed day without the late run');
    assert.ok(
      arch.days.every((x) => x.frozenAt && x.n === 0),
      JSON.stringify(arch.days),
    );
    await openMore();
    await page.getByTestId('archive').click();
    await when(
      (d) => [...document.querySelectorAll('[data-testid=archive-row]')].some((r) => r.dataset.date === d && /final/.test(r.textContent)),
      twoBack,
      10000,
    );
    assert.match(await page.getByTestId('archive-row').first().textContent(), /^\d{1,2} [A-Z][a-z]{2} \d{4} · final · 0 games/);
    assert.equal(arch.days[0].medals, null, 'fewer than five runs: no medals on the day');
    assert.equal(await page.locator('[data-testid=archive-medals]').count(), 0, 'the client draws medals only when the server sent thresholds (PLAN-v3 0.6.4)');
    await page.getByTestId('archive-play').first().click();
    await when((seed) => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.state().seed === seed, old.seed);
    assert.match(await page.getByTestId('hud-seed').textContent(), /^The yard of .+ · past day, practice$/);
    // weekly seed (PLAN-v4 0.7.5): the strip's Weekly button names the open week from the spawned verifier; clicking it plays the minted weekly seed; a run on it lands on /weekly and never on /daily
    const winfo = await vjson('/weekly');
    assert.equal(winfo.ok, true);
    assert.match(winfo.seed, /^weekly-\d{4}-W\d{2}-[a-z2-7]{8}$/);
    assert.equal(winfo.final, false);
    assert.ok(winfo.previous && winfo.previous.week, 'the previous week is minted alongside for the commitment chain');
    await page.goto(f.gameUrl());
    await page.waitForSelector('[data-testid=weekly]:not([disabled])', { timeout: 15000 });
    assert.match(await page.getByTestId('weekly').textContent(), /^This week's yard: \d+ (day|days|hour|hours|minute|minutes) left$/);
    assert.equal(await page.getByTestId('weekly').getAttribute('data-seed'), winfo.seed);
    await page.getByTestId('weekly').click();
    await when((seed) => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.state().seed === seed, winfo.seed);
    assert.equal(await page.getByTestId('hud-seed').textContent(), `The week's yard (${winfo.week.slice(5)})`);
    const wsub = await verify(crusherRun(winfo.seed), 'weekly player');
    assert.equal(wsub.ok, true, wsub.error);
    assert.equal(wsub.recorded, true);
    const wboard = await vjson('/weekly');
    assert.deepEqual(
      wboard.entries.map((e) => e.replayHash),
      [wsub.entry.replayHash],
      'the run is on the weekly board',
    );
    assert.deepEqual(
      (await vjson('/daily')).entries.map((e) => e.replayHash),
      [sub.entry.replayHash],
      'and not on the daily one',
    );
    // the previous week was minted alongside for the commitment chain and has already closed: the archive lists it with its kind and week id among the dailies, and the panel names it as a week
    const warch = await vjson('/archive');
    const wdays = warch.days.filter((d) => d.kind === 'weekly');
    assert.equal(wdays.length, 1);
    assert.equal(wdays[0].key, winfo.previous.week);
    assert.equal(wdays[0].seed, winfo.previous.seed);
    assert.equal(wdays[0].n, 0);
    assert.ok(warch.days.filter((d) => d.kind === 'daily').every((d) => d.key === d.date));
    assert.equal(warch.days[0].date, twoBack, 'the newest daily still comes first');
    await page.goto(f.gameUrl());
    await title();
    await openMore();
    await page.getByTestId('archive').click();
    await when(
      (w) =>
        [...document.querySelectorAll('[data-testid=archive-row]')].some(
          (r) => r.dataset.kind === 'weekly' && r.textContent.startsWith(`Week ${w} · final · 0 games`),
        ),
      winfo.previous.week,
      10000,
    );
  },
);

test(
  "a challenge link: the entry's earnings only, the overlay while playing, the two-row result and share line, the recipient's own checked run can be challenged in turn",
  { timeout: 120000 },
  async () => {
    // challenge link (PLAN-v4 0.7.1): the e2e player's daily entry becomes a link; opening it plays that seed with the earnings overlaid, finishing shows the two-row result and the detailed share line; the run verifies independently
    const entry = await vjson(`/entry?hash=${sub.entry.replayHash}`);
    assert.equal(entry.ok, true);
    assert.equal(entry.seed, dinfo.seed);
    assert.equal(entry.rounds.length, RULES.rounds);
    assert.equal(
      entry.rounds.reduce((a, b) => a + b, 0),
      sub.score,
    );
    assert.ok(!('actions' in entry), 'earnings only');
    await page.goto(f.gameUrl(`challenge=${sub.entry.replayHash}`));
    await when((seed) => window.__jdGame && window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.state().seed === seed, dinfo.seed);
    assert.match(
      await page.getByTestId('challenge-line').textContent(),
      new RegExp(`^Beat e2e player: they made \\$${entry.rounds[0]} in shift 1, \\$${entry.rounds[0]} so far\\. You have \\$0\\.$`),
    );
    await playThrough();
    await results();
    const cr = await page.getByTestId('challenge-result').textContent();
    assert.match(
      cr,
      new RegExp(
        `^Challenge · you \\$\\d+ · e2e player \\$${sub.score} · (beat e2e player's \\$${sub.score} by \\$\\d+|short of e2e player's \\$${sub.score} by \\$\\d+|tied e2e player's \\$${sub.score})$`,
      ),
      cr,
    );
    await openShare();
    await page.getByTestId('share-detailed').click();
    await when(() => /shifts \$/.test(window.__jdGame.scene.getScene('Results').lastShareText), null, 5000);
    assert.match(
      await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText),
      new RegExp(`\\n(beat|short of|tied) e2e player's \\$${sub.score}`),
      'the detailed share says how the challenge went',
    );
    await dismissCopyDialog();
    assert.equal(await page.getByTestId('challenge-link').isDisabled(), true, 'no verified entry of its own yet: no link');
    await page.getByTestId('submit').click();
    await textMatches('status', /^Checked: /);
    assert.equal(await page.getByTestId('challenge-link').isDisabled(), false, "the recipient's own verified run can be challenged in turn");
    const dboard2 = await vjson('/daily');
    assert.equal(dboard2.entries.length, 2, 'the challenge run landed on the daily board through the normal path (two players, two entries)');
  },
);

test(
  "crews: a crew is created and used here, a second context joins by code and submits; the crew board holds the members only and needs a member's key",
  { timeout: 120000 },
  async () => {
    await page.goto(f.gameUrl());
    await title();
    // groups (PLAN-v4 0.7.2): this context creates a group, a second context joins by code and submits a run; the group daily board shows the two members and a different standing than the global board
    await page.getByTestId('groups').click();
    await when(() => /^Everyone · in use$/.test(document.querySelector('[data-testid=group-list] > div')?.textContent || ''), null, 10000);
    await page.getByTestId('group-name').fill('Lunch Crew');
    await page.getByTestId('group-create').click();
    await page.waitForSelector('[data-testid=group-code]', { timeout: 10000 });
    groupCode = await page.getByTestId('group-code').textContent();
    assert.match(groupCode, /^[a-z2-7]{8}$/);
    assert.match(await page.getByTestId('group-row').textContent(), /^Lunch Crew · code [a-z2-7]{8} · 1 member · yours/);
    await page.getByTestId('group-use').click();
    await textMatches('group-row', / · in use/);
    await page.getByTestId('groups-close').click();
    await textMatches('daily-mode', /· crew Lunch Crew$/);
    {
      const p2 = await f.page();
      await p2.goto(f.gameUrl());
      await p2.jd.title();
      await openSettings(p2);
      await p2.getByTestId('player').click();
      await p2.getByTestId('dialog-input').fill('Buddy');
      await p2.keyboard.press('Enter');
      await p2.jd.textMatches('player', /^Buddy#/, 10000);
      await closeSettings(p2);
      await p2.getByTestId('groups').click();
      await p2.waitForSelector('[data-testid=group-join-code]', { timeout: 10000 });
      await p2.getByTestId('group-join-code').fill(groupCode);
      await p2.getByTestId('group-join').click();
      await p2.jd.textMatches('group-row', /Lunch Crew · code [a-z2-7]{8} · 2 members/, 10000);
      await p2.getByTestId('group-use').click();
      await p2.getByTestId('groups-close').click();
      await p2.jd.textMatches('daily-mode', /· crew Lunch Crew$/);
      buddyToken = JSON.parse(await p2.evaluate(() => localStorage.getItem('jd.identity.v1'))).token;
      await p2.ctx.close();
    }
    // Buddy submits a different run on today's daily; the group board has two entries, the global board three
    const buddyRun = newRun(dinfo.seed);
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(buddyRun, { t: 'pick', i: 0 });
      if (r === 1) apply(buddyRun, { t: 'rotate', id: buddyRun.bin[0].id });
      apply(buddyRun, { t: 'run' });
      apply(buddyRun, { t: 'next' });
    }
    bsub = await verify(buddyRun, null, { Authorization: `Bearer ${buddyToken}` });
    assert.equal(bsub.ok, true, JSON.stringify(bsub));
    const everyone = await vjson('/daily');
    assert.equal(everyone.entries.length, 3, 'anonymous + this player + Buddy');
    const scoped = await vjson(`/daily?group=${groupCode}`, { headers: { Authorization: `Bearer ${buddyToken}` } });
    assert.equal(scoped.entries.length, 2, 'the group board holds the two members only');
    assert.deepEqual(scoped.group, { code: groupCode, name: 'Lunch Crew' });
    assert.equal((await fetch(`${VURL}/daily?group=${groupCode}`)).status, 401, "a group board needs a member's token");
    // this device's locally recorded submission on the daily is the anonymous one planted above (the local record keeps the higher score), so the group view honestly says 'beyond the top 2'
    await page.reload();
    await textMatches('daily-board', /^You: (#\d of 2|beyond the top 2), \$\d+/);
    assert.match(await page.getByTestId('daily-mode').textContent(), /· crew Lunch Crew$/);
    await page.getByTestId('groups').click();
    await page.waitForSelector('[data-testid=group-use-everyone]', { timeout: 10000 });
    await page.getByTestId('group-use-everyone').click();
    await page.getByTestId('groups-close').click();
    await textMatches('daily-board', /^You: (#\d of 3|beyond the top 3), \$\d+/);
    await page.goto(f.gameUrl());
    await title();
    assert.match(await page.getByTestId('player-name').textContent(), /^e2e player#[2-9A-HJKMNP-TV-Z]{4}$/);
  },
);

test(
  "name moderation: a report hides the name on the strip, the moderator's clear restores it, scores never move, one audit row per action",
  { timeout: 90000 },
  async () => {
    // name moderation (PLAN-v4 0.7.7): this player reports Buddy's name by the hash of Buddy's verified daily run; the title strip then reads "player"; the moderator's clear restores it; scores never move
    const strip = async () => {
      await page.goto(f.gameUrl());
      await textMatches('daily-board', /\d\. \$\d+ /);
      return page.getByTestId('daily-board').innerText();
    };
    assert.match(await strip(), /\$\d+ Buddy#[2-9A-HJKMNP-TV-Z]{4}/, 'Buddy is named on the strip before the report');
    const bearer = { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' };
    const rep = await vjson('/report', { method: 'POST', headers: bearer, body: JSON.stringify({ hash: bsub.entry.replayHash, reason: 'offensive' }) });
    assert.deepEqual(rep, { ok: true, playerId: bsub.entry.playerId, hidden: true, duplicate: false });
    const hiddenStrip = await strip();
    assert.doesNotMatch(hiddenStrip, /Buddy/, 'the reported name is gone from the strip');
    assert.match(hiddenStrip, /\$\d+ player(\s|$)/, 'the reported name reads "player" on the title strip');
    const after = await vjson('/daily');
    const hiddenEntry = after.entries.find((e) => e.replayHash === bsub.entry.replayHash);
    assert.equal(hiddenEntry.score, bsub.entry.score, 'the score is untouched');
    assert.equal(hiddenEntry.player, 'player');
    const buddyView = await vjson('/identity', { headers: { Authorization: `Bearer ${buddyToken}` } });
    assert.equal(buddyView.hidden, true, 'Buddy is told');
    assert.equal(buddyView.name, 'Buddy');
    const mod = { 'X-Moderation-Token': 'e2e-moderator', 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${VURL}/moderation/reports`)).status, 401, 'no token, no list');
    const list = await vjson('/moderation/reports', { headers: mod });
    assert.equal(list.reports.length, 1);
    assert.equal(list.reports[0].name, 'Buddy');
    assert.equal(list.reports[0].hidden, true);
    assert.equal(
      (await fetch(`${VURL}/moderation/clear`, { method: 'POST', headers: mod, body: JSON.stringify({ playerId: bsub.entry.playerId }) })).status,
      200,
    );
    assert.match(await strip(), /\$\d+ Buddy#[2-9A-HJKMNP-TV-Z]{4}/, 'cleared: the name is back on the strip');
    const audit = fs
      .readFileSync(path.join(f.verifier.dataDir, 'moderation.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      audit.map((r) => r.action),
      ['report', 'clear'],
      'one audit row per action next to the board',
    );
  },
);

test('keep-best per player: a better run replaces the entry, an equal one is checked but not recorded', { timeout: 60000 }, async () => {
  // keep_best_per_player (PLAN-v3 0.6.0): with the page's bearer, a better run on a seed replaces the entry, an equal one is verified but not recorded
  const bearer = { Authorization: `Bearer ${identity.token}` };
  const park = [
    [6, 0],
    [6, 5],
  ];
  const mk = (extra, twist = false) => {
    const s = newRun('classic-kb-e2e');
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: 0 });
      if (r === RULES.rounds) for (let k = 0; k < extra; k++) apply(s, { t: 'place', id: s.bin[k].id, x: park[k][0], y: park[k][1], dir: 0 });
      if (twist && r === 1) apply(s, { t: 'rotate', id: s.bin[0].id });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    return s;
  };
  const first = await verify(mk(2), null, bearer);
  assert.equal(first.recorded, true);
  assert.equal(first.player, board.entries[0].player);
  await settle(
    1100,
    'the per-player bucket is 2/min in production; the test verifier runs with PLAYER_RATE_LIMIT=100, and a second of spacing keeps the verifiedAt order unambiguous',
  );
  const better = await verify(mk(0), null, bearer);
  assert.equal(better.recorded, true, 'fewer round-6 machines at the same score is better');
  const equal = await verify(mk(0, true), null, bearer);
  assert.equal(equal.ok, true);
  assert.equal(equal.recorded, false, 'an equal run is verified but not recorded');
  const kb = await vjson('/board?seed=classic-kb-e2e');
  assert.equal(kb.entries.length, 1, 'one entry per player per seed');
  assert.equal(kb.entries[0].replayHash, better.entry.replayHash);
});

test(
  "the title's daily button plays the minted seed; the HUD fits a 64-character yard at 130 %; the funnel reached the verifier without a seed or an address",
  { timeout: 90000 },
  async () => {
    await page.waitForSelector('[data-testid=daily-hist] .jd-hist-bar', { timeout: 10000 });
    assert.ok((await page.locator('[data-testid=daily-hist] .jd-hist-bar').count()) >= 1, 'the daily strip shows a mini histogram once a verified run exists');
    // the title's button plays the minted seed, and the HUD names it (PLAN-v3 0.6.1)
    await page.getByTestId('daily').click();
    await when((seed) => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.state().seed === seed, dinfo.seed);
    assert.equal(await page.getByTestId('hud-seed').textContent(), "Today's yard");
    // large_text_layout_fits (HUD): a maximum-length seed at 130 % keeps round, score and local-best on the canvas
    await page.evaluate(() => localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 0.7, muted: false, reducedMotion: true, textScale: 1.3 })));
    await page.goto(f.gameUrl(`scene=game&seed=classic-${'m'.repeat(56)}`));
    await draft();
    const hud = await page.evaluate(() => {
      const q = (n) => document.querySelector('[data-testid=' + n + ']');
      const seed = q('hud-seed');
      const r = (el) => el.getBoundingClientRect();
      return {
        seedTruncated: seed.scrollWidth > seed.clientWidth + 1 && getComputedStyle(seed).textOverflow === 'ellipsis',
        seedText: seed.textContent,
        scoreRight: r(q('hud-score').parentElement).right,
        muteLeft: r(q('mute')).left,
        roundRight: r(q('hud-round')).right,
        scoreLeft: r(q('hud-score')).left,
        uiRight: document.getElementById('ui').getBoundingClientRect().right,
        state: window.__jd.state().seed.length,
      };
    });
    assert.equal(hud.state, 64, 'the full 64-character name is the run seed');
    assert.ok(
      hud.seedTruncated && hud.seedText.includes('m'.repeat(56)),
      'the HUD shortens the seed label visually (ellipsis) while keeping the full seed in the text',
    );
    assert.ok(
      hud.scoreRight <= hud.muteLeft && hud.roundRight <= hud.scoreLeft && hud.scoreRight <= hud.uiRight,
      `HUD fits: round→${hud.roundRight} score→${hud.scoreLeft}..${hud.scoreRight} sound button at ${hud.muteLeft}`,
    );
    await page.evaluate(() => localStorage.removeItem('jd.settings.v1'));
    // funnel events reached the test verifier: steps counted per install, nothing identifying stored
    assert.equal(await api('flushTelemetry'), true, 'the queued events were accepted by the verifier');
    const funnel = await vjson('/funnel');
    const step = (n) => funnel.steps.find((s) => s.name === n)?.installs;
    assert.ok(funnel.installs >= 1 && step('app_start') === funnel.installs, 'play data is on by default, so every browser context in this file counts');
    assert.deepEqual(
      {
        pick: step('first_draft_pick'),
        attempt: step('first_place_attempt'),
        run: step('first_run_start'),
        complete: step('first_run_complete'),
        game: step('game_complete'),
      },
      { pick: 1, attempt: 1, run: 1, complete: 1, game: 1 },
      `funnel: ${JSON.stringify(funnel)}`,
    );
    assert.ok(
      funnel.counts.daily_submit_result >= 1 && funnel.counts.share_copied >= 1 && funnel.counts.undo_used === 1 && funnel.counts.first_place_rejected === 1,
      `event counts: ${JSON.stringify(funnel.counts)}`,
    );
    const eventsText = fs.readFileSync(path.join(f.verifier.dataDir, 'events.jsonl'), 'utf8');
    assert.ok(!eventsText.includes('classic-e2e-seed') && !eventsText.includes('other-seed'), 'no seed string reached the verifier');
    assert.ok(!eventsText.includes('127.0.0.1'), 'no client address was stored');
    assert.deepEqual(page.errors, [], 'no page errors across the session');
  },
);

test(
  'your record (0.9.7): days, the daily chain, medals, bests, the standing of each checked game and machines drafted, read from this device, asking our server nothing',
  { timeout: 60000 },
  async () => {
    await page.evaluate(() => localStorage.removeItem('jd.settings.v1'));
    await page.goto(f.gameUrl());
    await title();
    let verifierHits = 0;
    const onReq = (r) => {
      if (r.url().startsWith(VURL)) verifierHits++;
    };
    await textMatches('daily-board', /\S/);
    page.on('request', onReq);
    await page.getByTestId('record').click();
    await page.waitForSelector('[data-testid=record-dialog]', { timeout: 5000 });
    const days = await page.getByTestId('record-days').textContent();
    assert.match(days, /1 day played/, days);
    assert.match(days, /1 checked day · 1 in a row now · longest run 1/, "the challenge run on today's daily was checked from the results screen");
    const bars = await page.locator('[data-testid=record-bar]').count();
    assert.ok(bars >= 1, `the standing of each checked game on this device is a bar (${bars})`);
    assert.match(await page.getByTestId('record-trend').textContent(), /games? · the latest/);
    assert.match(await page.getByTestId('record-medals').textContent(), /No medal yet/);
    assert.match(await page.getByTestId('record-bests').textContent(), /Best \$\d+ on yard /);
    assert.equal(await page.locator('[data-testid=record-kind-crusher]').count(), 1, 'the crusher drafted in round 1 is counted');
    assert.match(await page.getByTestId('record-note').textContent(), /read from this device/);
    await shot('record');
    await page.keyboard.press('Escape');
    await page.jd.noDialog('record-dialog');
    page.off('request', onReq);
    assert.equal(verifierHits, 0, 'the record page asked our server nothing');
    assert.deepEqual(page.errors, [], 'no page errors across the session');
  },
);
