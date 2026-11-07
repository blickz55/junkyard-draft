// Production roadmap 0.12.4 in Chromium: a key moved in Settings stays moved and a round plays on the moved keys, the old ones doing nothing; the
// accessibility tree reads the yard after a placement and the cursor says where it is; and at phone width Tab reaches everything in the order it
// is read, with a ring round it, and goes round a dialog instead of wandering behind it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';

const f = await fixture({ verifier: true, verifierEnv: { DAILY_SECRET: 'access-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0' } });
after(() => f.close());
const page = await f.page();
const { api, frames, title, draft, mode, textMatches, when } = page.jd;
const { RULES_VERSION } = await import('../game/src/sim/types.ts');

const openKeys = async () => {
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-keys').click();
  await page.getByTestId('keys-dialog').waitFor();
};
const move = async (slot, press, shows) => {
  await page.getByTestId(`key-${slot}`).click();
  await when((id) => document.querySelector(`[data-testid="key-${id}"]`).textContent === 'Press a key…', slot, 5000);
  await page.keyboard.press(press);
  await when(([id, want]) => document.querySelector(`[data-testid="key-${id}"]`).textContent === want, [slot, shows], 5000);
};

test('a key moves, a key in use is refused by name, Esc lets go, and it all stays through a reload', { timeout: 60000 }, async () => {
  await openKeys();
  assert.equal(await page.getByTestId('key-rotate.R').textContent(), 'R');
  await move('rotate.R', 'f', 'F');

  await page.getByTestId('key-rotate.R').click();
  await page.keyboard.press('m');
  await textMatches('keys-status', /^M already does this: .+\. Move that one first\.$/, 5000);
  assert.equal(await page.getByTestId('key-rotate.R').textContent(), 'Press a key…', 'still listening');
  await page.keyboard.press('Escape');
  await textMatches('key-rotate\\.R', /^F$/, 5000).catch(() => {});
  assert.equal(await page.getByTestId('key-rotate.R').textContent(), 'F', 'Esc lets go, and keeps the panel open');
  await page.getByTestId('keys-dialog').waitFor();

  await move('place.UP', 'w', 'W');
  await move('place.DOWN', 's', 'S');
  await move('place.LEFT', 'a', 'A');
  await move('place.RIGHT', 'd', 'D');
  await move('place.ENTER', 'e', 'E');
  await move('start.SPACE', 'g', 'G');
  await move('next.SPACE', 'h', 'H');
  await move('undo.ctrl+Z', 'Control+u', 'Ctrl+U');
  await page.screenshot({ path: path.join(SHOTS, `keys-${Date.now()}.png`) });

  await openKeys();
  assert.equal(await page.getByTestId('key-rotate.R').textContent(), 'F', 'after a reload');
  assert.equal(await page.getByTestId('key-undo.ctrl+Z').textContent(), 'Ctrl+U');
  assert.deepEqual(page.errors, []);
});

test('a round plays on the moved keys, and the old ones do nothing', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-keys'));
  await draft();
  await page.keyboard.press('Digit1');
  await mode('build');
  await frames();
  const cursor = () => api('cursor');
  await page.keyboard.press('ArrowRight');
  await frames();
  assert.equal((await cursor()).visible, false, 'an arrow no longer moves the cursor');

  await page.keyboard.press('d');
  await frames();
  assert.equal((await cursor()).visible, true, 'the moved key shows it');
  const from = await cursor();
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  await frames();
  const at = await cursor();
  assert.deepEqual([at.x, at.y], [from.x + 1, from.y + 1]);

  const before = await api('state');
  await page.keyboard.press('Enter');
  await frames();
  assert.equal((await api('state')).bin.length, before.bin.length, 'Enter no longer places');
  await page.keyboard.press('e');
  await frames();
  const placed = await api('state');
  assert.equal(placed.bin.length, before.bin.length - 1, 'the moved key does');
  const part = placed.layout.machines.find((m) => m.x === at.x && m.y === at.y);
  assert.ok(part, 'it is where the cursor was');

  await page.keyboard.press('r');
  await frames();
  assert.equal((await api('state')).layout.machines.find((m) => m.id === part.id).dir, part.dir, 'R no longer turns it');
  await page.keyboard.press('f');
  await frames();
  assert.equal((await api('state')).layout.machines.find((m) => m.id === part.id).dir, (part.dir + 1) % 4, 'F does');

  await page.keyboard.press('Control+z');
  await frames(3);
  assert.equal((await api('state')).layout.machines.find((m) => m.id === part.id).dir, (part.dir + 1) % 4, 'Ctrl+Z no longer undoes');
  await page.keyboard.press('Control+u');
  await when((id) => window.__jd.state().layout.machines.find((m) => m.id === id).dir !== undefined, part.id, 5000);
  await frames(3);
  assert.equal((await api('state')).layout.machines.find((m) => m.id === part.id).dir, part.dir, 'Ctrl+U does');

  await page.keyboard.press('Space');
  await frames(3);
  assert.equal(await api('mode'), 'build', 'Space no longer starts the shift');
  await page.keyboard.press('g');
  await mode('running');
  await api('finishRun');
  await mode('summary');
  await page.keyboard.press('h');
  await when(() => window.__jd.phase() === 'draft' && window.__jd.state().round === 2, null, 5000);
  assert.deepEqual(page.errors, []);
});

test('the keys go back with one press, and the pages say the ones that work', { timeout: 30000 }, async () => {
  await page.evaluate(() => {
    const moved = JSON.parse(localStorage.getItem('jd.keys.v1'));
    if (!moved['rotate.R']) throw new Error('nothing moved');
  });
  await openKeys();
  await page.getByTestId('keys-reset').click();
  assert.equal(await page.getByTestId('key-rotate.R').textContent(), 'R');
  assert.equal(await page.getByTestId('key-place.UP').textContent(), 'Up');
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.keys.v1')), '{}');
});

test('the accessibility tree reads the yard after a placement, and the cursor says where it is', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-mirror'));
  await draft();
  await page.keyboard.press('Digit1');
  await mode('build');
  await frames();
  const yard = page.getByRole('list', { name: 'The yard' });
  assert.match(await yard.ariaSnapshot(), /The yard is \d+ spots wide and \d+ spots deep/);
  const part = (await api('state')).bin[0];
  await page.keyboard.press('ArrowDown');
  await frames();
  await page.keyboard.press('ArrowDown');
  await frames();
  const at = await api('cursor');
  await textMatches('yard-cursor', new RegExp(`^Row ${at.y + 1}, column ${at.x + 1}: .+\\. Holding|^Row ${at.y + 1}, column ${at.x + 1}: `), 5000);
  await page.keyboard.press('Enter');
  await frames();
  const m = (await api('state')).layout.machines.find((q) => q.id === part.id);
  assert.ok(m, 'it was placed');
  const line = await page.evaluate(() => [...document.querySelectorAll('[data-testid=yard-mirror] li')].map((l) => l.textContent));
  const here = line.find((l) => l.startsWith(`Row ${m.y + 1}, column ${m.x + 1}:`));
  assert.ok(here, `a line for the part: ${line.join(' | ')}`);
  assert.match(here, /facing (right|down|left|up)/);
  const tree = await yard.ariaSnapshot();
  assert.ok(tree.includes(here), `the tree has it:\n${tree}`);
  assert.equal((await page.getByRole('status').filter({ hasText: /./ }).count()) > 0, true, "the foreman's line is a live region");
  const box = await page.getByTestId('yard-mirror').boundingBox();
  assert.ok(box.width <= 1 && box.height <= 1, 'and none of it shows');
  assert.deepEqual(page.errors, []);
});

// ---------- the focus audit, at phone width ----------
/** Every Tab stop until focus comes back round, with what a keyboard player sees of each. */
async function walk(limit = 90) {
  const stops = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const r = a.getBoundingClientRect();
      const s = getComputedStyle(a);
      return {
        tid: a.dataset.testid ?? `${a.tagName}:${(a.textContent ?? '').slice(0, 20)}`,
        top: r.top,
        bottom: r.bottom,
        ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
        modal: !!a.closest('.jd-modal'),
        height: innerHeight,
      };
    });
    if (at && stops.length && at.tid === stops[0].tid) break;
    if (at) stops.push(at);
  }
  return stops;
}
/** Elements a mouse could reach in this part of the page, in document order. */
const reachable = (scope) =>
  page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document.getElementById('ui');
    return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary')]
      .filter((e) => e.offsetParent !== null && !e.closest('.jd-sr') && (e.tagName === 'SUMMARY' || !e.closest('details:not([open])')))
      .map((e) => e.dataset.testid ?? `${e.tagName}:${(e.textContent ?? '').slice(0, 20)}`);
  }, scope);

/** What must hold of a screen: everything is reached, each stop is on screen with a ring round it. */
function audit(where, stops, want) {
  const got = stops.map((s) => s.tid);
  for (const w of want) assert.ok(got.includes(w), `${where}: Tab never reaches ${w}; it reached ${got.join(', ')}`);
  for (const s of stops) {
    assert.ok(s.ring, `${where}: ${s.tid} has no ring when focused`);
    assert.ok(s.top >= -1 && s.bottom <= s.height + 1, `${where}: ${s.tid} is off screen when focused (${s.top}..${s.bottom} of ${s.height})`);
  }
}
/** A dialog: Tab goes round it and never leaves. */
async function dialog(where, tid) {
  await page.getByTestId(tid).waitFor();
  const want = await reachable(`[data-testid=${tid}]`);
  const stops = await walk();
  audit(where, stops, want);
  for (const s of stops) assert.ok(s.modal, `${where}: Tab left the dialog for ${s.tid}`);
}

test('Home at phone width: Tab reaches everything, on screen, with a ring', { timeout: 60000 }, async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(f.gameUrl());
  await title();
  // a finished daily not yet on the board (2026-11-06) puts a button on Home: keep one so the audit reaches it
  await page.evaluate(
    ({ v, seed }) =>
      localStorage.setItem(
        'jd.pending.v1',
        JSON.stringify([
          { seed, rulesVersion: v, replay: { format: 1, rulesVersion: v, seed, actions: [], claimedScore: 1234 }, player: '', savedAt: '', unsent: true },
        ]),
      ),
    { v: RULES_VERSION, seed: `daily-${new Date().toISOString().slice(0, 10)}-abcdefgh` },
  );
  await page.goto(f.gameUrl());
  await title();
  const want = await reachable();
  assert.ok(want.includes('unsent-submit'), `the kept game's button is on Home: ${want.join(', ')}`);
  const stops = await walk();
  audit('Home', stops, want);
  await page.evaluate(() => localStorage.removeItem('jd.pending.v1'));
});

test('the dialogs at phone width: Tab goes round each and never wanders behind it', { timeout: 120000 }, async () => {
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('settings').click();
  await dialog('Settings', 'settings-dialog');
  await page.getByTestId('settings-keys').click();
  await dialog('Keys', 'keys-dialog');
  await page.getByTestId('keys-close').click();
  await page.keyboard.press('Escape');
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('more').click();
  await dialog('More', 'more-dialog');
  await page.getByTestId('paint').click();
  await dialog('Paint shop', 'paint-dialog');
  await page.getByTestId('paint-close').click();
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('more').click();
  await page.getByTestId('privacy').click();
  await dialog('Privacy', 'privacy-dialog');
});

test('a game at phone width: F6 reaches the buttons, which Tab cannot from the yard, and it comes back; the menu goes round', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-focus'));
  await draft();
  await page.keyboard.press('F6');
  await when(() => document.activeElement?.dataset?.testid === 'menu', null, 5000);
  await page.keyboard.press('Escape');
  await when(() => document.activeElement === document.body, null, 5000);
  await page.keyboard.press('F6');
  await when(() => document.activeElement?.dataset?.testid === 'menu', null, 5000);
  await page.keyboard.press('F6');
  await when(() => document.activeElement === document.body, null, 5000);
  await page.keyboard.press('F6');
  await when(() => document.activeElement?.dataset?.testid === 'menu', null, 5000);
  const want = await reachable('.jd-game');
  const stops = await walk();
  audit(
    'the game',
    stops,
    want.filter((w) => w !== 'menu'),
  );
  await page.getByTestId('menu').focus();
  await page.keyboard.press('Enter');
  await dialog('Menu', 'menu-dialog');
});

test('two keys in one frame move the cursor twice, not five times', { timeout: 30000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-keys'));
  await draft();
  await page.keyboard.press('Digit1');
  await mode('build');
  await frames();
  await page.keyboard.press('ArrowRight');
  await frames();
  await page.keyboard.press('ArrowLeft');
  await frames();
  const from = await api('cursor');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await frames(4);
  const at = await api('cursor');
  assert.deepEqual([at.x, at.y], [from.x + 2, from.y + 1], 'Phaser replays its queue within a frame; each press still counts once');
});

test('the results at phone width: Tab reaches everything, and a closed section stays out of the way', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-focus-end'));
  await draft();
  for (let r = 1; r <= 6; r++) {
    await api('pick', 0);
    await api('run');
    await api('finishRun');
    await mode('summary');
    await api('next');
  }
  await page.jd.results(10000);
  const want = await reachable();
  const stops = await walk();
  audit('Results', stops, want);
  await page.screenshot({ path: path.join(SHOTS, `focus-results-${Date.now()}.png`) });
  assert.deepEqual(
    page.errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e)),
    [],
  );
});
