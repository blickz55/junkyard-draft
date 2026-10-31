// Renderer, run HUD, tips and tutorial in Chromium (DOSSIER-v1 0.3.10; production roadmap 0.9.5: one scenario per test on the
// shared fixture, each in its own browser context): HiDPI canvas with correct pointer mapping, the Canvas renderer completing a
// round, WebGL context loss and restore, the stall marker, the tips badge and demo, keyboard ownership, DOM dialogs, records
// partitioned by rules version, the tips dialog at 130 %, the lesson, the overlay tracking the canvas, reduced audio, the reroll
// button, the sound bank, the ambient bed, a hidden tab going quiet, the art atlas, a slow line.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cellCenter, binSlotCenter, until } from './e2e/fixture.mjs';

const { draftOffers } = await import('../game/src/sim/run.ts');
const { RULES_VERSION } = await import('../game/src/sim/types.ts');
const { beltShape } = await import('../game/src/render/placement.ts');

const f = await fixture();
after(() => f.close());
const URL = f.url;
/** A game page on a seed, in its own context: the draft of round 1 is on screen. */
const open = async (query, ctxOpts = {}, pageOpts = {}) => {
  const page = await f.page(ctxOpts, pageOpts);
  await page.goto(`${URL}/?dev=1&scene=game&${query}`);
  await page.jd.draft();
  return page;
};
/** A title page in its own context. */
const openTitle = async (ctxOpts = {}, pageOpts = {}, query = '') => {
  const page = await f.page(ctxOpts, pageOpts);
  await page.goto(`${URL}/?dev=1${query}`);
  await page.jd.title();
  return page;
};
/** The job card, where a fresh game opens one: its button is the first gesture of a shift. */
const startJob = async (page) => {
  const start = page.getByTestId('job-start');
  if (await start.count()) await start.click();
};
const settings130 = {
  fn: () => {
    try {
      localStorage.setItem(
        'jd.settings.v1',
        JSON.stringify({ volume: 0.7, muted: false, reducedMotion: false, textScale: 1.3, renderQuality: 'auto', telemetry: false }),
      );
    } catch {}
  },
};

test(
  'hidpi_canvas_keeps_logical_coordinates: at deviceScaleFactor 2 the backing store is twice the 1120x700 container, the camera zooms by 2 times the board fit, text renders at resolution 2, a drag lands on the logical cell',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=classic-render-dpr', { deviceScaleFactor: 2 });
    const { api, drag } = page.jd;
    const dims = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const g = window.__jdGame;
      return {
        w: c.width,
        h: c.height,
        dpr: window.devicePixelRatio,
        zoom: g.scene.getScene('Game').cameras.main.zoom,
        fit: window.__jd.geometry().scale,
        textRes: g.scene.getScene('Game').children.list.find((o) => o.type === 'Text')?.style.resolution,
      };
    });
    assert.deepEqual({ w: dims.w, h: dims.h, textRes: dims.textRes }, { w: 2240, h: 1400, textRes: 2 }, `hidpi: ${JSON.stringify(dims)}`);
    assert.ok(
      Math.abs(dims.zoom - 2 * dims.fit) < 1e-6 && dims.fit > 0.5 && dims.fit <= 1.25,
      `the camera zooms by DPR times the board fit (0.10.0): ${JSON.stringify(dims)}`,
    );
    await api('pick', 0);
    const part = (await api('state')).bin[0];
    assert.ok(part, 'a part is in the bin');
    await drag(binSlotCenter(0), cellCenter(5, 4));
    const placed = (await api('state')).layout.machines.find((m) => m.id === part.id);
    assert.ok(placed && placed.x === 5 && placed.y === 4, `pointer drop maps to the logical cell under a zoomed camera: ${JSON.stringify(placed)}`);
    assert.deepEqual(page.errors, [], 'no page errors at DPR 2');
    await page.ctx.close();
  },
);

test('canvas_renderer_completes_a_round: ?renderer=canvas boots the Canvas renderer and a round runs to its summary', { timeout: 60000 }, async () => {
  const page = await open('seed=classic-render-canvas&renderer=canvas');
  const { api, mode } = page.jd;
  assert.equal(await page.evaluate(() => window.__jdGame.renderer.type), 1, 'Phaser.CANVAS renderer selected');
  await api('pick', 0);
  await api('run');
  await mode('running');
  await api('finishRun');
  await mode('summary');
  assert.equal((await api('state')).rounds.length, 1, 'one round recorded under the Canvas renderer');
  assert.deepEqual(page.errors, [], 'no page errors under the Canvas renderer');
  await page.ctx.close();
});

test(
  'webgl_context_loss_keeps_the_run: losing and restoring the context mid-build leaves the state untouched and the grid redrawn',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=classic-render-loss');
    const { api, when, mode } = page.jd;
    assert.equal(await page.evaluate(() => window.__jdGame.renderer.type), 2, 'WebGL renderer in use');
    await api('pick', 0);
    const before = await api('state');
    const lost = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'no-ext';
      window.__loseExt = ext;
      ext.loseContext();
      return 'lost';
    });
    assert.equal(lost, 'lost', 'WEBGL_lose_context available');
    await when(() => window.__jdGame.renderer.contextLost === true, null, 10000);
    await page.evaluate(() => window.__loseExt.restoreContext());
    await when(() => window.__jdGame.renderer.contextLost === false, null, 10000);
    await when(
      () => {
        const g = window.__jdGame;
        const t = g.textures.get('m-crusher');
        const img = g.scene
          .getScene('Game')
          .children.list.flatMap((o) => (o.list ? o.list : [o]))
          .find((o) => o.texture && o.texture.key === 'm-conveyor');
        return !!t.source[0].glTexture && !!img && img.visible && img.active;
      },
      null,
      10000,
    );
    const after = await api('state');
    assert.deepEqual(after, before, 'run state unchanged by the context loss');
    // the scene still works: place the part and run a round
    await api('act', { t: 'place', id: before.bin[0].id, x: 5, y: 4, dir: 0 });
    await api('run');
    await api('finishRun');
    await mode('summary');
    assert.deepEqual(
      page.errors.filter((e) => !/context/i.test(e)),
      [],
      'no page errors after the restore',
    );
    await page.ctx.close();
  },
);

test(
  'stall_marker_names_the_blocking_cell (PLAN-v1 0.3.5): a head-on conveyor jams the line; the HUD says what and where, the total stays at $0, the marker sits on the first blocking cell',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=classic-stall-seed');
    const { api, mode } = page.jd;
    await api('pick', 0);
    const st = await api('state');
    const conv = st.layout.machines.find((m) => m.x === 3 && m.y === 2);
    assert.equal(conv?.kind, 'conveyor');
    assert.ok(await api('act', { t: 'rotate', id: conv.id }));
    assert.ok(await api('act', { t: 'rotate', id: conv.id })); // now facing west: head-on to the line
    await api('run');
    await page.getByTestId('speed-4').click();
    const seen = await page.waitForFunction(
      () => {
        const s = window.__jd.stall();
        return s.text ? s : false;
      },
      null,
      { timeout: 15000 },
    );
    const stall = await seen.jsonValue();
    assert.match(stall.text, /^Stuck: the [A-Za-z ]+ is (waiting|blocked)\. Nothing shipped for 8 s$/, stall.text);
    assert.ok(stall.flaggedAt > 0 && stall.flaggedAt <= 10, `flagged by tick ${stall.flaggedAt} (read at tick ${stall.tick})`); // the flag tick, not the poll's: at 4x on a loaded CI runner the sim advances several ticks per frame
    assert.ok(
      [2 * 8 + 1, 2 * 8 + 2].includes(stall.cell),
      `first blocking cell is the hopper (1,2) or the conveyor in front of the head-on belt (2,2): got ${stall.cell}`,
    );
    const hud = await page.evaluate(() => ({
      score: document.querySelector('[data-testid=hud-score]')?.textContent,
      mark: !!window.__jdGame.scene.getScene('Game').children.getByName('stall-mark')?.visible,
    }));
    assert.deepEqual(hud, { score: '$0', mark: true }, 'nothing shipped and the marker is visible');
    await api('finishRun');
    await mode('summary');
    assert.equal((await api('stall')).text, '', 'the marker clears when the round ends');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'first_draft_suggests_its_tip_once (PLAN-v1 0.3.6): a first press badges Tips, opening marks it read and its demo ships a plate, Esc closes, a reload keeps it read',
  { timeout: 60000 },
  async () => {
    let seed = '';
    for (let i = 0; i < 500 && !seed; i++) if (draftOffers(`classic-tips-${i}`, 1).includes('press')) seed = `classic-tips-${i}`;
    assert.ok(seed, 'found a seed whose round-1 offers include a press');
    const page = await open(`seed=${seed}`);
    const { api, when, draft } = page.jd;
    const btnText = () => page.evaluate(() => document.querySelector('[data-testid=tips]')?.textContent ?? null);
    assert.equal(await btnText(), 'Tips', 'no badge before any draft');
    assert.equal((await api('tips')).suggested, null);
    const idx = (await api('state')).offers.indexOf('press');
    await api('pick', idx);
    assert.equal((await api('tips')).suggested, 'press', 'the first press draft suggests the press tip');
    assert.equal(await btnText(), 'Tips ●', 'the Tips button carries a badge');
    await api('openTips');
    const t = await api('tips');
    assert.deepEqual(
      { open: t.open, current: t.current, readHasPress: t.read.includes('press'), suggested: t.suggested },
      { open: true, current: 'press', readHasPress: true, suggested: null },
      'opening shows and marks the suggested tip',
    );
    const demo = await page.waitForFunction(
      () => {
        const d = window.__jd.tips().demo;
        return d && d.shipped.plate >= 1 ? d : false;
      },
      null,
      { timeout: 20000 },
    );
    const d = await demo.jsonValue();
    assert.equal(d.tip, 'press');
    assert.ok(d.shipped.plate >= 1, `the live demo pressed a plate by tick ${d.tick}`);
    // the panel is DOM (0.4.12): dialog, nav button marked read and active, the watch line reports the demo, the demo canvas has pixels
    const dom = await page.evaluate(() => {
      const q = (t) => document.querySelector(`[data-testid=${t}]`);
      const c = q('tips-demo');
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && px[i] + px[i + 1] + px[i + 2] > 60) lit++;
      return {
        dialog: q('tips-panel')?.getAttribute('role'),
        press: q('tip-press')?.textContent,
        active: q('tip-press')?.classList.contains('jd-active'),
        watch: q('tips-watch')?.textContent,
        canvas: [c.width, c.height],
        lit,
        hidden: document.getElementById('ui').classList.contains('jd-hidden'),
      };
    });
    assert.equal(dom.dialog, 'dialog');
    assert.equal(dom.press, 'A press needs two shards for one plate', 'read: no badge dot');
    assert.equal(dom.active, true);
    assert.match(dom.watch, /shipped: .*plate/);
    assert.ok(dom.canvas[0] > 0 && dom.canvas[0] % 108 === 0 && dom.canvas[1] % 108 === 0, `demo canvas is whole 54 px cells at 2x backing: ${dom.canvas}`);
    assert.ok(dom.lit > 1000, `the demo canvas is drawn (${dom.lit} lit pixels)`);
    assert.equal(dom.hidden, false, 'the DOM screen is not hidden behind the panel any more');
    assert.equal(await api('hint'), await api('hint'), 'sanity'); // tips never touch the hint strip: it still shows the build hint
    assert.doesNotMatch(await api('hint'), /press needs two shards/i, 'the tip text did not leak into the hint strip');
    await page.keyboard.press('Escape');
    await when(() => window.__jd.tips().open === false, null, 5000);
    assert.equal(await btnText(), 'Tips', 'badge gone once read');
    await page.reload();
    await draft();
    await api('pick', idx);
    assert.equal((await api('tips')).suggested, null, 'a read tip is never suggested again');
    assert.equal(await btnText(), 'Tips');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'keyboard_ownership (review F05): Enter on a focused offer picks it; Tab from a button moves DOM focus; Space with Tips open does not start the run; Esc blurs first',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=classic-kbd-own');
    const { api, when, mode } = page.jd;
    await page.focus('[data-testid=offer-1]');
    await page.keyboard.press('Enter');
    await when(() => window.__jd.phase() === 'build', null, 5000);
    const after = await api('state');
    assert.equal(after.phase, 'build', 'Enter on the focused offer picked it');
    assert.equal(after.bin.length, 1);
    await page.focus('[data-testid=tips]');
    await page.keyboard.press('Tab');
    await when(() => document.activeElement?.dataset.testid !== 'tips', null, 5000);
    const focusNow = await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid);
    assert.notEqual(focusNow, 'tips', 'Tab moved DOM focus');
    assert.equal((await api('cursor')).held, null, 'Tab did not take a bin part while a button had focus');
    await page.evaluate(() => document.activeElement.blur());
    await api('openTips');
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid),
      'tips-close',
      'Tips opened with focus on its Close button',
    );
    await page.keyboard.press('Tab');
    await when(() => document.activeElement?.dataset.testid !== 'tips-close', null, 5000);
    const inDialog = await page.evaluate(() => !!document.activeElement?.closest('[data-testid=tips-panel]'));
    assert.equal(inDialog, true, 'Tab stays inside the dialog');
    assert.equal((await api('cursor')).held, null, 'Tab inside Tips did not take a bin part');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await page.jd.frames(3);
    assert.equal(await api('mode'), 'build', 'arrows and Space with Tips open did not touch the run');
    assert.equal((await api('tips')).open, true, "Space on a focused tip button is the button's own click, not a run start");
    await page.keyboard.press('Escape');
    await when(() => window.__jd.tips().open === false, null, 5000);
    await page.keyboard.press('Space');
    await mode('running', 5000);
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'dom_dialogs (review F04): custom seed, player name, recovery code and recording import use DOM dialogs; the policy panel; the practice yard when no server answers',
  { timeout: 90000 },
  async () => {
    const page = await f.page(
      {},
      {
        init: {
          fn: () => {
            window.prompt = () => {
              throw new Error('prompt() is not supported.');
            };
            window.alert = () => {
              throw new Error('alert() is not supported.');
            };
          },
        },
      },
    );
    const { when, textMatches, noDialog, title } = page.jd;
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:9`); // nothing listens on port 9: the daily must fall back to practice (PLAN-v3 0.6.1)
    await title();
    await textMatches('daily-mode', /^practice: offline$/, 10000);
    await page.getByTestId('settings').click();
    await page.getByTestId('player').click();
    await page.getByTestId('dialog-input').fill('Kbd Tester');
    await page.keyboard.press('Enter');
    await textMatches('player', /^Kbd Tester$/, 5000);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.player')), 'Kbd Tester');
    await page.getByTestId('player').click();
    await page.waitForSelector('[data-testid=dialog]', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await noDialog();
    assert.equal(await page.getByTestId('player').textContent(), 'Kbd Tester', 'cancel keeps the name');
    await page.getByTestId('settings-close').click();
    await noDialog('settings-dialog');
    await page.jd.frames(3);
    // policy panel (PLAN-v3 0.6.5): generated from the code, names the rules version and the tie rule, Esc closes
    await page.getByTestId('more').click();
    await page.getByTestId('policy').click();
    await page.waitForSelector('[data-testid=policy-dialog]', { timeout: 5000 });
    assert.match(await page.getByTestId('policy-headline').textContent(), new RegExp(`^Rules version ${RULES_VERSION} · verifier protocol \\d+$`));
    assert.match(await page.getByTestId('policy-tie').textContent(), /^Tie-break: Equal scores: fewer machines in round 6 first/);
    assert.ok((await page.getByTestId('policy-body').textContent()).includes('48 h from 00:00 UTC'), 'the daily window comes from the verifier constant');
    await page.keyboard.press('Escape');
    await noDialog('policy-dialog');
    // identity_recovery (PLAN-v3 0.6.0): the recovery code shown here restores the same device token in a fresh browser context
    const identityBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('jd.identity.v1')));
    assert.match(identityBefore.token, /^[0-9a-f]{32}$/, 'a device token exists after the first use of the player dialog');
    await page.getByTestId('settings').click();
    await page.getByTestId('player').click();
    await page.getByTestId('dialog-recovery').click();
    await when(() => /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/.test(document.querySelector('[data-testid=dialog-input]')?.value || ''), null, 5000);
    const code = await page.getByTestId('dialog-input').inputValue();
    assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/, `recovery code in base32 groups: ${code}`);
    await page.getByTestId('dialog-ok').click();
    await noDialog();
    await page.getByTestId('settings-close').click();
    await noDialog('settings-dialog');
    await page.jd.frames(3);
    {
      const p2 = await openTitle();
      assert.equal(await p2.getByTestId('player-name').textContent(), 'Choose a name', 'a fresh context has no name');
      await p2.getByTestId('settings').click();
      await p2.getByTestId('player').click();
      await p2.getByTestId('dialog-restore').click();
      await p2.jd.when(() => (document.querySelector('[data-testid=dialog-input]')?.value || '') === '', null, 5000);
      await p2.getByTestId('dialog-input').fill(code.toLowerCase().replace(/-/g, ' '));
      await p2.keyboard.press('Enter');
      await p2.jd.textMatches('player-note', /^Your key is back/, 10000);
      const restored = JSON.parse(await p2.evaluate(() => localStorage.getItem('jd.identity.v1')));
      assert.equal(restored.token, identityBefore.token, 'the restored device token equals the original (case, spaces and dashes ignored)');
      await p2.ctx.close();
    }
    await page.getByTestId('more').click();
    await page.getByTestId('import').click();
    await page.getByTestId('dialog-input').fill('{"not":"a replay"}');
    await page.getByTestId('dialog-ok').click();
    await when(() => /Couldn't read that recording/.test(document.querySelector('[data-testid=dialog]')?.textContent ?? ''), null, 5000);
    await page.getByTestId('dialog-ok').click();
    await noDialog();
    await page.getByTestId('more').click();
    await page.getByTestId('custom').click();
    await page.getByTestId('dialog-input').fill('dialog-seed');
    await page.getByTestId('dialog-ok').click();
    await page.jd.draft();
    assert.equal((await page.evaluate(() => window.__jd.state())).seed, 'dialog-seed');
    assert.deepEqual(page.errors, [], 'no page errors without window.prompt');
    await page.ctx.close();
  },
);

test(
  'records_partitioned_by_rules_version (PLAN-v2 0.5.0): a pre-0.5.0 profile migrates and the legacy key goes; other versions show as a collapsed archived block that still fits at 130 %',
  { timeout: 60000 },
  async () => {
    const page = await openTitle(
      {},
      {
        init: {
          fn: () => {
            try {
              localStorage.setItem(
                'jd.bests.v1',
                JSON.stringify({ overall: { score: 912, seed: 'old-seed', at: 't' }, bySeed: { 'old-seed': { score: 912, at: 't' } }, runs: 3 }),
              );
            } catch {}
          },
        },
      },
    );
    const migrated = await page.evaluate(() => ({
      legacy: localStorage.getItem('jd.bests.v1'),
      v2: JSON.parse(localStorage.getItem('jd.bests.v2') || 'null'),
      text: document.querySelector('#ui')?.textContent || '',
    }));
    assert.equal(migrated.legacy, null, 'legacy key removed');
    assert.equal(migrated.v2?.byVersion?.['2']?.overall?.score, 912, 'migrated into the rules-2 slot whatever version runs');
    if (RULES_VERSION === 2) {
      assert.match(migrated.text, /Best: \$912/);
      assert.equal(await page.locator('[data-testid^=archived-bests-]').count(), 0, 'nothing archived while rules 2 are current');
    } else {
      assert.match(migrated.text, /No finished games yet/);
      assert.match(migrated.text, /From earlier versions \(v2\)/);
      assert.match(migrated.text, /\$912/, 'the migrated v2 best is archived, not the headline, under newer rules');
    }
    await page.ctx.close();
    const p2 = await openTitle(
      {},
      {
        init: {
          fn: (v) => {
            try {
              localStorage.setItem(
                'jd.bests.v2',
                JSON.stringify({
                  byVersion: {
                    [v]: { overall: { score: 1500, seed: 'now', at: 't' }, bySeed: {}, runs: 2 },
                    1: { overall: { score: 300, seed: 'then', at: 't' }, bySeed: {}, runs: 4 },
                  },
                }),
              );
              localStorage.setItem(
                'jd.settings.v1',
                JSON.stringify({ volume: 0.7, muted: false, reducedMotion: false, textScale: 1.3, renderQuality: 'auto', telemetry: false }),
              );
            } catch {}
          },
          arg: String(RULES_VERSION),
        },
      },
    );
    const arch = await p2.evaluate(() => {
      const d = document.querySelector('[data-testid=archived-bests-1]');
      const sc = document.querySelector('#ui .jd-screen');
      return {
        present: !!d,
        open: d?.open,
        text: d?.textContent,
        scrollH: sc?.scrollHeight,
        clientH: sc?.clientHeight,
        headline: document.querySelector('#ui')?.textContent?.includes('Best: $1500'),
      };
    });
    assert.equal(arch.present, true);
    assert.equal(arch.open, false, 'collapsed by default');
    assert.match(arch.text ?? '', /From earlier versions \(v1\)/);
    assert.match(arch.text ?? '', /\$300/);
    assert.equal(arch.headline, true, 'the current version is the headline');
    assert.ok(arch.scrollH <= arch.clientH + 1, `the title still fits at 130 % with the archived block (${arch.scrollH} vs ${arch.clientH})`);
    await p2.ctx.close();
  },
);

test(
  'tips_panel_fits_at_130 (0.4.12): from the title at 130 % the dialog needs no scrolling and every control stays inside the overlay; Esc closes it',
  { timeout: 60000 },
  async () => {
    const page = await openTitle({}, { init: settings130 });
    await page.getByTestId('howto').click();
    await page.getByTestId('howto-tips').click();
    await page.getByTestId('tip-splitter').click();
    await page.jd.when(() => document.querySelector('[data-testid=tip-splitter]')?.classList.contains('jd-active'), null, 5000);
    const fit = await page.evaluate(() => {
      const box = document.querySelector('[data-testid=tips-panel]');
      const ui = document.getElementById('ui').getBoundingClientRect();
      const outside = [...box.querySelectorAll('[data-testid]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return !(r.left >= ui.left - 1 && r.right <= ui.right + 1 && r.top >= ui.top - 1 && r.bottom <= ui.bottom + 1);
        })
        .map((el) => el.dataset.testid);
      return {
        scrollH: box.scrollHeight,
        clientH: box.clientHeight,
        outside,
        textScale: getComputedStyle(document.getElementById('ui')).getPropertyValue('--text-scale').trim(),
      };
    });
    assert.equal(fit.textScale, '1.3');
    assert.ok(fit.scrollH <= fit.clientH + 1, `the tips dialog does not scroll at 130 % (${fit.scrollH} vs ${fit.clientH})`);
    assert.deepEqual(fit.outside, [], 'every tips control stays inside the overlay at 130 %');
    await page.keyboard.press('Escape');
    await page.jd.noDialog('tips-panel');
    await page.ctx.close();
  },
);

test(
  'a fresh profile sees the lesson as the one primary action; once it is done it stays offered, quietly (the lesson itself: tests/walkthrough-e2e.test.mjs)',
  { timeout: 60000 },
  async () => {
    const page = await openTitle();
    const learn = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=learn]');
      return {
        text: b?.textContent,
        primary: !!b && b.classList.contains('jd-btn-primary'),
        today: document.querySelector('[data-testid=daily]')?.classList.contains('jd-btn-primary'),
      };
    });
    assert.deepEqual(learn, { text: 'Learn to play (3 min)', primary: true, today: false });
    await page.evaluate(() => localStorage.setItem('jd.onboarded.v1', '1'));
    await page.reload();
    await page.jd.title();
    assert.equal(await page.getByTestId('learn').textContent(), 'Take the lesson again');
    assert.equal(
      await page.evaluate(() => document.querySelector('[data-testid=daily]')?.classList.contains('jd-btn-primary')),
      true,
      "today's yard is the primary now",
    );
    await page.ctx.close();
  },
);

test(
  'dom_overlay_tracks_the_canvas (DOSSIER-v1 0.4.0, 0.10.0): at 1280x800 and 1920x1080 the DOM title and the canvas both cover the container and no control leaves it',
  { timeout: 60000 },
  async () => {
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 1920, height: 1080 },
    ]) {
      const page = await openTitle({ viewport: vp });
      await page.jd.when(() => !!document.querySelector('#ui .jd-screen'));
      await page.jd.overlaySynced();
      const geo = await page.evaluate(() => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        const u = document.getElementById('ui').getBoundingClientRect();
        const s = document.querySelector('#ui .jd-screen');
        const outside = [...document.querySelectorAll('#ui [data-testid]')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < u.left - 1 || r.right > u.right + 1 || r.top < u.top - 1 || r.bottom > u.bottom + 1;
          })
          .map((el) => el.dataset.testid);
        return {
          dx: Math.abs(c.left - u.left) + Math.abs(c.top - u.top),
          dw: Math.abs(c.width - u.width) + Math.abs(c.height - u.height),
          outside,
          scroll: s.scrollHeight - s.clientHeight,
        };
      });
      assert.ok(geo.dx < 1.5 && geo.dw < 1.5, `overlay matches the canvas at ${vp.width}x${vp.height}: ${JSON.stringify(geo)}`);
      assert.deepEqual(geo.outside, [], 'no title control leaves the overlay');
      assert.ok(geo.scroll <= 1, 'the title does not scroll');
      await page.ctx.close();
    }
  },
);

test(
  'reduced_audio_one_sound_per_tick (DOSSIER-v1 0.4.9): with reduced audio on no tick asks for more than one sound; the bus controls persist',
  { timeout: 90000 },
  async () => {
    const page = await open(
      'seed=classic-auto-12',
      {},
      {
        init: {
          fn: () => {
            try {
              localStorage.setItem(
                'jd.settings.v1',
                JSON.stringify({
                  volume: 0.7,
                  muted: false,
                  reducedMotion: false,
                  textScale: 1,
                  renderQuality: 'auto',
                  telemetry: false,
                  buses: { ui: 1, factory: 0.4, music: 1 },
                  reducedAudio: true,
                }),
              );
            } catch {}
          },
        },
      },
    );
    const { api, mode } = page.jd;
    await startJob(page);
    await api('pick', 0);
    await api('run');
    await page.getByTestId('speed-4').click();
    await mode('summary', 30000);
    const a = await api('audio');
    assert.equal(a.reducedAudio, true);
    assert.equal(a.buses.factory, 0.4, 'bus levels load from settings');
    assert.ok(a.ticks >= 80 && a.maxPerTick <= 1 && a.chords === 0, `reduced audio: ${JSON.stringify(a)}`);
    assert.deepEqual([a.hum.on, a.hum.starts], [false, 0], 'reduced audio never starts the hum');
    assert.equal(a.hum.loops, 0, 'no looping source under reduced audio');
    await page.ctx.close();
    const p2 = await openTitle();
    await p2.getByTestId('settings').click();
    await p2.getByTestId('bus-music').fill('0.25');
    await p2.getByTestId('reduced-audio').click();
    await p2.jd.textMatches('reduced-audio', /^Fewer sounds: On$/, 5000);
    const saved = JSON.parse(await p2.evaluate(() => localStorage.getItem('jd.settings.v1')));
    assert.equal(saved.buses.music, 0.25);
    assert.equal(saved.reducedAudio, true);
    await p2.ctx.close();
  },
);

test(
  'reroll_button (rules v3, PLAN-v2 0.5.4): disabled while unaffordable in round 1, buys new offers once in round 2 for the cost, then disables',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=classic-reroll-e2e');
    const { api, when, mode } = page.jd;
    assert.equal(await page.locator('[data-testid=reroll]').count(), 0, 'round 1: nothing earned yet, so the button is not there to tempt anyone');
    const st0 = await api('state');
    await api('pick', Math.max(0, st0.offers.indexOf('crusher')));
    const st1 = await api('state');
    const old = st1.layout.machines.find((m) => m.x === 2 && m.y === 2);
    const pick = st1.bin[st1.bin.length - 1];
    await api('act', { t: 'unplace', id: old.id });
    await api('act', { t: 'place', id: pick.id, x: 2, y: 2, dir: 0 });
    await api('run');
    await api('finishRun');
    await mode('summary');
    await api('next');
    await when(() => window.__jd.phase() === 'draft' && window.__jd.state().round === 2);
    const before = await api('state');
    assert.equal(before.phase, 'draft');
    assert.ok(before.score >= 40, `a crusher round affords a reroll (${before.score})`);
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid=reroll]')?.disabled), false, 'affordable: enabled');
    await page.getByTestId('reroll').click();
    await when(() => window.__jd.state().rerolls === 1, null, 5000);
    const after = await api('state');
    assert.equal(after.score, before.score - 40, 'the cost left the score');
    assert.equal(after.rerolls, 1);
    assert.notDeepEqual(after.offers, before.offers, 'new offers on the cards');
    assert.equal(
      await page.evaluate(() => document.querySelector('[data-testid=hud-score]')?.textContent),
      `$${after.score}`,
      'the HUD shows the deducted score',
    );
    assert.equal(await page.locator('[data-testid=reroll]').count(), 0, 'once a shift: gone once used');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'sound_bank_renders_from_recipes (docs/SOUND.md): no audio file is fetched; the first gesture renders the catalog in short slices; a shift at 4x plays rendered voices with no page errors',
  { timeout: 90000 },
  async () => {
    const page = await f.page();
    const fetched = [];
    page.on('request', (r) => fetched.push(r.url()));
    await page.goto(`${URL}/?dev=1&scene=game&seed=auto-12`);
    await page.jd.draft();
    const { api, mode } = page.jd;
    const before = await api('audio');
    assert.equal(before.bank.rendered, 0, 'nothing renders before a gesture');
    await startJob(page);
    await api('pick', 0);
    await api('run');
    await page.getByTestId('speed-4').click();
    const a = await until(
      async () => {
        const i = await api('audio');
        return i.bank.rendered === i.bank.total ? i : false;
      },
      { what: 'the catalog to render' },
    );
    assert.equal(a.bank.failed, 0, JSON.stringify(a.bank));
    assert.ok(a.bank.maxSliceMs < 50, `no slice near a blocked frame: ${a.bank.maxSliceMs} ms`);
    await mode('summary', 30000);
    const done = await api('audio');
    assert.ok(done.played >= 1, `rendered voices played: ${done.played}`);
    assert.equal(done.contextState, 'running');
    assert.deepEqual(
      fetched.filter((u) => /\.(wav|mp3|ogg|flac|m4a)(\?|$)/.test(u)),
      [],
      'no audio bytes over the network',
    );
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  "ambient_bed_follows_the_line (DOSSIER-v1 0.4.10, docs/SOUND.md): no music during build; the bed starts on the round's root, its loops run, it detunes while the belt jams, it stops at the summary and no looping source outlives it",
  { timeout: 60000 },
  async () => {
    const page = await open('seed=classic-stall-seed');
    const { api, mode } = page.jd;
    assert.equal((await api('audio')).hum.on, false, 'no music during build');
    await startJob(page);
    await api('pick', 0);
    const st = await api('state');
    const conv = st.layout.machines.find((m) => m.x === 3 && m.y === 2);
    assert.ok(await api('act', { t: 'rotate', id: conv.id }));
    assert.ok(await api('act', { t: 'rotate', id: conv.id }));
    await api('run');
    const started = await (
      await page.waitForFunction(
        () => {
          const h = window.__jd.audio().hum;
          return h.on ? h : false;
        },
        null,
        { timeout: 5000 },
      )
    ).jsonValue();
    assert.ok(started.root > 130 && started.root < 132, `round 1 root is C3: ${started.root}`);
    await page.getByTestId('speed-1').click(); // the first gesture of this game: the sounds render from here
    await until(async () => (await api('audio')).hum.loops === 2, { what: 'the pad and the belt to start once rendered' }); // at 1×: on a slow machine 4× can end the shift first
    await page.getByTestId('speed-4').click();
    const jammed = await (
      await page.waitForFunction(
        () => {
          const h = window.__jd.audio().hum;
          return h.detuned ? h : false;
        },
        null,
        { timeout: 15000 },
      )
    ).jsonValue();
    assert.ok(
      jammed.on && jammed.freq > jammed.root && jammed.freq < jammed.root * 1.03 && jammed.cutoff >= 300 && jammed.cutoff <= 2000,
      `a jam detunes the pad: ${JSON.stringify(jammed)}`,
    );
    await api('finishRun');
    await mode('summary');
    const after = (await api('audio')).hum;
    assert.deepEqual([after.on, after.starts], [false, 1], 'the bed stops at the summary');
    await until(async () => (await api('audio')).hum.loops === 0, { what: 'the loops to fade and stop' });
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'sound_test_plays_every_sound (docs/SOUND.md): every row of the Settings list plays, a bed stops when the next row plays, nothing keeps looping',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=auto-12'); // the dev API is installed by the game scene
    const { api } = page.jd;
    await startJob(page);
    await page.evaluate(() => window.__jdGame.scene.getScene('Game').scene.start('Title'));
    await page.jd.title();
    await page.getByTestId('settings').click();
    await page.getByTestId('sound-test').locator('summary').click();
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="sound-"]')].map((e) => e.dataset.testid).filter((t) => t !== 'sound-test'),
    );
    const bank = await until(
      async () => {
        const b = (await api('audio')).bank;
        return b.rendered === b.total ? b : false;
      },
      { what: 'the catalog to render' },
    );
    assert.equal(rows.length, bank.total - 1, 'every sound but the room has a row');
    for (const row of rows) {
      const before = (await api('audio')).played;
      await page.getByTestId(row).click();
      await until(async () => (await api('audio')).played > before, { what: `${row} to play` });
    }
    await page.getByTestId('sound-pad').click();
    await until(async () => (await api('audio')).hum.loops === 1, { what: 'the bed to run' });
    await page.getByTestId('sound-click').click();
    await until(async () => (await api('audio')).hum.loops === 0, { what: 'the bed to stop for the next row' });
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'a_hidden_tab_goes_quiet (docs/SOUND.md): hidden, the context fades and suspends while a shift is running; visible again it resumes, unless the game itself is paused',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=auto-12');
    const { api, mode } = page.jd;
    const show = (state) =>
      page.evaluate((v) => {
        Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    const context = (state) => until(async () => (await api('audio')).contextState === state, { what: `the context to be ${state}` });
    await startJob(page);
    await api('pick', 0);
    await api('run');
    await page.getByTestId('speed-1').click();
    await until(async () => (await api('audio')).hum.loops === 2, { what: 'the bed' });
    await context('running');
    await show('hidden');
    await context('suspended');
    await show('visible');
    await context('running');
    await page.evaluate(() => document.activeElement?.blur()); // the shortcuts yield to a focused button
    await page.keyboard.press('Escape');
    await mode('paused');
    await context('suspended');
    await show('hidden');
    await show('visible');
    assert.equal((await api('audio')).contextState, 'suspended', 'coming back does not wake a paused game');
    await page.keyboard.press('Escape');
    await mode('running');
    await context('running');
    await api('finishRun');
    await mode('summary');
    await until(async () => (await api('audio')).hum.loops === 0, { what: 'the loops to stop' });
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'art_atlas_aliases_every_key (DOSSIER-v1 0.4.8): the sheet is one texture with every scene key an alias; at dpr 2 the atlas is the sheet itself and frames keep their logical size; a missing sheet falls back to the procedural look at 1x',
  { timeout: 90000 },
  async () => {
    const page = await open('seed=atlas-seed');
    const art = await page.evaluate(() => {
      const tm = window.__jdGame.textures;
      const keys = [
        'tile',
        'tile-ok',
        'tile-bad',
        'tile-sel',
        'tile-cursor',
        'm-conveyor',
        'm-conveyor-bend',
        'm-hopper',
        'm-crusher',
        'm-crusher-1',
        'm-furnace',
        'm-furnace-1',
        'm-press',
        'm-press-1',
        'm-press-2',
        'm-splitter',
        'm-splitter-1',
        'm-dock',
        'm-tuner',
        ...Array.from({ length: 8 }, (_, k) => `belt-${k}`),
        ...Array.from({ length: 8 }, (_, k) => `belt-bend-${k}`),
        ...Array.from({ length: 4 }, (_, k) => `rubble-${k}`),
        'i-scrap',
        'i-shards',
        'i-plate',
        'i-ingot',
        'i-slag',
        'ground',
        'shelf',
        'fx-glow',
        'dot',
        'px',
      ];
      const atlasSrc = tm.get('art').source[0];
      return {
        status: window.__jdArt,
        allExist: keys.every((k) => tm.exists(k)),
        everyKey: keys.filter((k) => k !== 'dot' && k !== 'px').length,
        shared: keys.filter((k) => k !== 'dot' && k !== 'px').every((k) => tm.get(k).source[0] === atlasSrc),
        crusherCut: (() => {
          const f = tm.getFrame('m-crusher');
          return [f.cutWidth, f.cutHeight];
        })(),
        plateCut: (() => {
          const f = tm.getFrame('i-plate');
          return [f.cutWidth, f.cutHeight];
        })(),
        groundCut: (() => {
          const f = tm.getFrame('ground');
          return [f.cutWidth, f.cutHeight];
        })(),
        base64: tm.getBase64('m-crusher').slice(0, 22),
      };
    });
    assert.deepEqual(
      {
        built: art.status.built,
        packed: art.status.packed.length,
        missing: art.status.missing,
        allExist: art.allExist,
        shared: art.shared,
        crusherCut: art.crusherCut,
        plateCut: art.plateCut,
        groundCut: art.groundCut,
      },
      { built: true, packed: art.everyKey, missing: [], allExist: true, shared: true, crusherCut: [72, 72], plateCut: [24, 24], groundCut: [576, 432] },
      JSON.stringify(art),
    );
    assert.equal(art.base64, 'data:image/png;base64,', 'frame-aware base64 export still works for the DOM');
    assert.deepEqual(page.errors, [], 'no page errors with the atlas');
    await page.ctx.close();
    // hidpi_atlas_keeps_logical_size (DOSSIER-v1 0.4.8b): at ?dpr=2 the atlas is twice the 1x copy and every frame is cut at 2x, yet machines, items and tiles display at their logical 72 / 24 px
    const p3 = await f.page({ deviceScaleFactor: 2 });
    await p3.goto(`${URL}/?dev=1&scene=game&seed=atlas-seed&dpr=2`);
    await p3.jd.draft();
    await p3.evaluate(() => window.__jd.pick(0));
    const logicalSizes = () => {
      const g = window.__jdGame;
      const tm = g.textures;
      const scene = g.scene.getScene('Game');
      const imgs = [];
      const walk = (list) => {
        for (const o of list) {
          if (o.type === 'Image') imgs.push(o);
          if (o.list) walk(o.list);
        }
      };
      walk(scene.children.list);
      const by = (prefix) => imgs.find((o) => o.texture.key.startsWith(prefix));
      const m = by('m-');
      const tile = by('tile');
      const ground = by('ground');
      return {
        status: window.__jdArt,
        crusherCut: [tm.getFrame('m-crusher').cutWidth, tm.getFrame('m-crusher').cutHeight],
        plateCut: tm.getFrame('i-plate').cutWidth,
        machine: m && [m.texture.key, m.displayWidth, m.displayHeight],
        tile: tile && [tile.displayWidth, tile.displayHeight],
        ground: ground && [ground.displayWidth, ground.displayHeight],
        shared: tm.get('m-dock').source[0] === tm.get('art').source[0],
      };
    };
    const hi = await p3.evaluate(logicalSizes);
    assert.deepEqual(
      {
        built: hi.status.built,
        scale: hi.status.scale,
        packed: hi.status.packed.length,
        atlas: hi.status.atlas,
        crusherCut: hi.crusherCut,
        plateCut: hi.plateCut,
        machine: hi.machine && hi.machine.slice(1),
        tile: hi.tile,
        ground: hi.ground,
        shared: hi.shared,
      },
      {
        built: true,
        scale: 2,
        packed: art.everyKey,
        atlas: { width: art.status.atlas.width * 2, height: art.status.atlas.height * 2 },
        crusherCut: [144, 144],
        plateCut: 48,
        machine: [72, 72],
        tile: [72, 72],
        ground: [576, 432],
        shared: true,
      },
      JSON.stringify(hi),
    );
    assert.ok(hi.machine && hi.machine[0].startsWith('m-'), 'a machine sprite is on screen');
    await p3.ctx.close();
    // fallback: without the sheet every key is generated at 1x, even at dpr 2, and the game still plays
    const p2 = await f.page({ deviceScaleFactor: 2 });
    await p2.route('**/art/sheet.webp', (route) => route.fulfill({ status: 404, body: 'gone' }));
    await p2.goto(`${URL}/?dev=1&scene=game&seed=atlas-seed&dpr=2`);
    await p2.jd.draft();
    await p2.evaluate(() => window.__jd.pick(0));
    const fb = await p2.evaluate(logicalSizes);
    const keysExist = await p2.evaluate(() =>
      ['m-press', 'm-furnace-1', 'm-splitter-1', 'rubble-2', 'ground', 'shelf', 'fx-glow'].every((k) => window.__jdGame.textures.exists(k)),
    );
    assert.deepEqual(
      {
        built: fb.status.built,
        packed: fb.status.packed.length,
        missing: fb.status.missing.length,
        keysExist,
        crusherCut: fb.crusherCut,
        machine: fb.machine && fb.machine.slice(1),
        ground: fb.ground,
        shared: fb.shared,
      },
      { built: false, packed: 0, missing: art.everyKey, keysExist: true, crusherCut: [72, 72], machine: [72, 72], ground: [576, 432], shared: false },
      JSON.stringify(fb),
    );
    await p2.ctx.close();
  },
);

test(
  'belt_corners_and_junk_piles: a conveyor fed from one side draws as a corner, mirrored for a left turn, the shelf stays straight and a round leaves the corners alone; every rubble cell has a junk pile under the machines',
  { timeout: 60000 },
  async () => {
    const page = await open('seed=yard-13');
    const read = () =>
      page.evaluate(() => {
        const s = window.__jdGame.scene.getScene('Game');
        return {
          layout: s.run.layout,
          belts: [...s.view.views.values()]
            .filter((v) => v.belt)
            .map((v) => ({ id: v.m.id, inBin: v.inBin, key: v.img.texture.key, flip: v.img.flipY, overlay: v.belt.texture.key, overlayFlip: v.belt.flipY })),
          piles: s.children.list.filter((o) => o.texture?.key.startsWith('rubble-')).map((o) => ({ key: o.texture.key, depth: o.depth, x: o.x, y: o.y })),
        };
      });
    const expectShapes = (st, when) => {
      const shapes = [];
      for (const b of st.belts) {
        const m = st.layout.machines.find((q) => q.id === b.id);
        const shape = b.inBin ? 'straight' : beltShape(st.layout, m);
        shapes.push(shape);
        const bent = shape !== 'straight';
        assert.equal(b.key, bent ? 'm-conveyor-bend' : 'm-conveyor', `${when}: conveyor ${b.id} draws its shape (${shape})`);
        assert.match(b.overlay, bent ? /^belt-bend-\d$/ : /^belt-\d$/, `${when}: its rolling belt follows`);
        assert.equal(b.flip, shape === 'left', `${when}: only a left turn is mirrored`);
        assert.equal(b.overlayFlip, shape === 'left', `${when}: the belt is mirrored with it`);
      }
      return shapes;
    };
    const st = await read();
    const shapes = expectShapes(st, 'at the start');
    assert.ok(shapes.includes('left') && shapes.includes('right'), `the yard has both corners: ${shapes.join(',')}`);
    assert.ok(st.belts.some((b) => b.inBin) && st.belts.filter((b) => b.inBin).every((b) => b.key === 'm-conveyor'), 'parts on the shelf stay straight');
    const rubble = st.layout.rubble;
    assert.equal(st.piles.length, rubble.length, 'one pile per rubble cell');
    assert.ok(
      st.piles.every((p) => p.depth === 1 && /^rubble-[0-3]$/.test(p.key)),
      'piles lie under the machines',
    );
    const again = await read();
    assert.deepEqual(again.piles, st.piles, 'the same yard draws the same piles');
    // a round: the state frames come and go, the corners stay
    await page.jd.api('pick', 0);
    await page.jd.api('run');
    await page.waitForFunction(() => window.__jd.mode() === 'running');
    await page.jd.api('finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary');
    expectShapes(await read(), 'after a round');
    assert.deepEqual(page.errors, [], 'no page errors');
    await page.ctx.close();
  },
);

test(
  'a slow line: Home is up before the sprite sheet; a tap says so on the screen and goes on by itself when the sheet arrives',
  { timeout: 60000 },
  async () => {
    const held = async (page) => {
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route('**/art/sheet.webp', async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(`${URL}/?dev=1`, { waitUntil: 'commit' }); // the load event waits for the sheet
      await page.jd.title();
      await page.getByTestId('daily').waitFor();
      return release;
    };
    const game = await f.page();
    const release = await held(game);
    assert.equal(await game.evaluate(() => window.__jdGame.textures.exists('m-press')), false, 'Home is up and the art is not');
    await game.getByTestId('random').click();
    await game.getByTestId('opening').waitFor();
    assert.equal(await game.getByTestId('opening').textContent(), 'Opening the yard…');
    assert.equal(await game.evaluate(() => window.__jdGame.scene.isActive('Title')), true, 'Home stays until the yard can be drawn');
    release();
    await game.jd.draft();
    assert.equal(await game.getByTestId('opening').count(), 0);
    assert.equal(await game.evaluate(() => window.__jdGame.textures.exists('m-press')), true);
    assert.equal(await game.evaluate(() => window.__jdGame.scene.isActive('Boot')), false, 'Boot is done');
    assert.deepEqual(game.errors, []);
    await game.ctx.close();
    const demos = await f.page();
    const open = await held(demos);
    await demos.getByTestId('howto').click();
    await demos.getByTestId('howto-tips').click();
    await demos.getByTestId('opening').waitFor();
    open();
    await demos.getByTestId('tips-panel').waitFor();
    assert.equal(await demos.getByTestId('opening').count(), 0);
    assert.deepEqual(demos.errors, []);
    await demos.ctx.close();
  },
);
