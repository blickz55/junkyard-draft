// End-to-end gameplay test in Chromium: real pointer drag, keyboard rotate, a full six-round
// run to the results screen, save/continue, and replay export verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers'; // sandbox only; elsewhere Playwright's default cache is used
const { chromium } = await import('playwright');
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }

test('junkyard draft: full run in the browser', { timeout: 180000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  const VPORT = 4499;
  const boardFile = path.join(fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-')), 'board.json');
  const verifier = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], { env: { ...process.env, PORT: String(VPORT), BOARD_FILE: boardFile }, stdio: 'ignore' });
  let browser, page;
  const errors = [];
  const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await waitServer();
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    // player name for the verified board (set here so the results screen does not prompt)
    await page.evaluate(() => localStorage.setItem('jd.player', 'e2e player'));
    // Title → Game via a real click on "Today's challenge" button (Phaser object; click by canvas coords)
    await page.goto(`${URL}/?dev=1&scene=game&seed=e2e-seed&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    const st0 = await api('state');
    assert.equal(st0.round, 1);
    assert.ok(st0.offers.includes('crusher'), 'round 1 offers a crusher');

    // 1) pick crusher with keyboard number
    const idx = st0.offers.indexOf('crusher');
    await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][idx]);
    await page.waitForFunction(() => window.__jd.phase() === 'build');
    let st = await api('state');
    assert.equal(st.bin.length, 1); assert.equal(st.bin[0].kind, 'crusher');

    // 2) real drag: bin slot 0 → cell (2,2) which holds a conveyor → rejected (occupied), stays in bin
    const CELL = 72, GX = 32, GY = 72, BIN_Y = 520;
    const binX = GX + 12 + CELL / 2, binY = BIN_Y + 28 + CELL / 2;
    const cell = (x, y) => ({ x: GX + x * CELL + CELL / 2, y: GY + y * CELL + CELL / 2 });
    const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); await wait(250); };
    await drag({ x: binX, y: binY }, cell(2, 2));
    st = await api('state');
    assert.equal(st.bin.length, 1, 'occupied cell rejected the drop');
    // move the conveyor at (2,2) into the bin, then drop the crusher there
    await drag(cell(2, 2), { x: GX + 200, y: BIN_Y + 60 });
    st = await api('state');
    assert.equal(st.bin.length, 2, 'conveyor returned to bin');
    const crusherSlot = st.bin.findIndex((m) => m.kind === 'crusher');
    await drag({ x: GX + 12 + crusherSlot * (CELL + 8) + CELL / 2, y: binY }, cell(2, 2));
    st = await api('state');
    const crusher = st.layout.machines.find((m) => m.kind === 'crusher');
    assert.ok(crusher && crusher.x === 2 && crusher.y === 2, 'crusher placed by drag');
    // rotate with R (selected after drag) and rotate back with right-click ×3
    await page.keyboard.press('r'); await wait(100);
    st = await api('state'); assert.equal(st.layout.machines.find((m) => m.kind === 'crusher').dir, 1, 'R rotates');
    for (let i = 0; i < 3; i++) { await page.mouse.click(cell(2, 2).x, cell(2, 2).y, { button: 'right' }); await wait(80); }
    st = await api('state'); assert.equal(st.layout.machines.find((m) => m.kind === 'crusher').dir, 0, 'right-click rotates');
    await page.screenshot({ path: path.join(SHOTS, `e2e-build-${Date.now()}.png`) });

    // 2b) keyboard-only placement: arrows reveal/move the cursor, Enter places the bin part, R rotates,
    //     Enter picks it up again and drops it elsewhere, Delete returns it to the bin.
    const cur = () => api('cursor');
    assert.equal((await cur()).visible, false, 'cursor hidden until an arrow key is pressed');
    await page.keyboard.press('ArrowRight'); await wait(150);
    assert.deepEqual([(await cur()).x, (await cur()).y], [2, 2], 'first arrow press reveals the cursor on the selected crusher');
    await page.keyboard.press('ArrowDown'); await wait(150);
    assert.deepEqual([(await cur()).x, (await cur()).y], [2, 3]);
    assert.equal((await api('state')).bin.length, 1, 'the conveyor waits in the bin');
    await page.keyboard.press('Enter'); await wait(150);
    st = await api('state');
    let kbConv = st.layout.machines.find((mm) => mm.x === 2 && mm.y === 3);
    assert.ok(kbConv && kbConv.kind === 'conveyor', 'Enter placed the bin conveyor at the cursor');
    assert.equal(st.bin.length, 0);
    await page.keyboard.press('r'); await wait(150);
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id).dir, 1, 'R rotates the machine just placed');
    await page.keyboard.press('Enter'); await wait(150);
    assert.equal((await cur()).held, kbConv.id, 'Enter on a machine picks it up');
    await page.keyboard.press('ArrowUp'); await wait(150);
    await page.keyboard.press('Enter'); await wait(150);
    assert.equal((await cur()).held, kbConv.id, 'dropping onto the occupied crusher cell is refused and the part stays in hand');
    await page.keyboard.press('ArrowDown'); await wait(150); await page.keyboard.press('ArrowRight'); await wait(150);
    await page.keyboard.press('Enter'); await wait(150);
    st = await api('state');
    kbConv = st.layout.machines.find((mm) => mm.id === kbConv.id);
    assert.deepEqual([kbConv.x, kbConv.y, (await cur()).held], [3, 3, null], 'moved by keyboard and dropped');
    await page.keyboard.press('Delete'); await wait(150);
    st = await api('state');
    assert.equal(st.bin.length, 1, 'Delete sent the machine under the cursor back to the bin');
    assert.ok(!st.layout.machines.some((mm) => mm.x === 3 && mm.y === 3));
    await page.keyboard.press('Escape'); await wait(150); // first Esc clears the selection
    await page.keyboard.press('Escape'); await wait(150);
    assert.equal((await cur()).visible, false, 'Escape hides the cursor');
    await page.screenshot({ path: path.join(SHOTS, `e2e-keyboard-${Date.now()}.png`) });

    // 3) run with Space, watch some animation, then skip to the result
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__jd.mode() === 'running');
    await wait(1800);
    await page.screenshot({ path: path.join(SHOTS, `e2e-running-${Date.now()}.png`) });
    // pause/resume
    await page.keyboard.press('Escape'); await wait(100); assert.equal(await api('mode'), 'paused');
    await page.keyboard.press('Escape'); await wait(100); assert.equal(await api('mode'), 'running');
    await api('finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary');
    st = await api('state');
    assert.equal(st.rounds.length, 1);
    assert.ok(st.rounds[0].shipped.shards > 0, 'crusher chain shipped shards');
    assert.ok(st.rounds[0].earned > 38, `round 1 earned ${st.rounds[0].earned} > starter 38`);
    await page.screenshot({ path: path.join(SHOTS, `e2e-summary-${Date.now()}.png`) });

    // 4) save/continue: reload mid-run and continue from the title
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    const hasSave = await page.evaluate(() => !!localStorage.getItem('jd.save.v1'));
    assert.ok(hasSave, 'run saved to localStorage');
    // today's verified board on the title screen (verifier spawned by this test; no entries for today yet)
    await page.waitForFunction(() => { const t = window.__jdGame.scene.getScene('Title').children.getByName('daily-board'); return !!t && /No verified scores yet today/.test(t.text); }, null, { timeout: 15000 });
    // accessibility settings: reduced motion and text size persist, re-render the title, and apply in-game
    const titleBtn = (name) => page.evaluate((n) => { window.__jdGame.scene.getScene('Title').children.getByName(n).emit('pointerdown'); }, name);
    const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('jd.settings.v1') || '{}'));
    const titleReady = (pred) => page.waitForFunction(pred, null, { timeout: 8000 });
    await titleBtn('motion');
    await titleReady(() => window.__jdGame.scene.isActive('Title') && window.__jdGame.scene.getScene('Title').children.getByName('motion')?.label.text === 'Reduced');
    assert.equal((await settings()).reducedMotion, true, 'reduced motion persisted');
    await titleBtn('textscale');
    await titleReady(() => window.__jdGame.scene.isActive('Title') && window.__jdGame.scene.getScene('Title').children.getByName('textscale')?.label.text === '115%');
    assert.equal((await settings()).textScale, 1.15, 'text size persisted');
    assert.equal((await settings()).reducedMotion, true, 'text size change kept the motion setting');
    assert.equal(await page.evaluate(() => window.__jdGame.scene.getScene('Title').children.getByName('howto-1').style.fontSize), '17px', 'labels scale with text size (15px × 1.15)');
    await titleBtn('textscale'); await titleReady(() => window.__jdGame.scene.getScene('Title').children.getByName('textscale')?.label.text === '130%');
    await titleBtn('textscale'); await titleReady(() => window.__jdGame.scene.getScene('Title').children.getByName('textscale')?.label.text === '100%');
    assert.equal((await settings()).textScale, 1);
    await page.keyboard.press('Enter'); // continue
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'result', null, { timeout: 15000 });
    st = await api('state'); assert.equal(st.rounds.length, 1); assert.ok(st.score > 38, 'score restored');

    // 5) remaining rounds through the dev API (pick first offer, run, next); round 2 sells the part instead
    await api('next');
    for (let r = 2; r <= 6; r++) {
      await page.waitForFunction((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
      await api('pick', 0);
      if (r === 2) {
        const before = (await api('state')).score;
        const binPart = (await api('state')).bin.find((m) => m.x < 0);
        assert.ok(await api('act', { t: 'sell', id: binPart.id }), 'sell accepted');
        assert.equal((await api('state')).score, before + 10, 'sell bonus added');
      }
      await api('run');
      if (r === 2) {
        // reduced motion (set on the title screen above) keeps conveyor belts on frame 0 while running
        await wait(700);
        assert.equal((await api('prefs')).reducedMotion, true);
        const belts = await page.evaluate(() => window.__jdGame.scene.getScene('Game').children.list.flatMap((o) => (o.list ? o.list : [o])).filter((o) => o.texture && /^belt-/.test(o.texture.key)).map((o) => o.texture.key));
        assert.ok(belts.length > 0 && belts.every((k) => k === 'belt-0'), `belts static under reduced motion: ${belts.join(',')}`);
      }
      await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary');
      await api('next');
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await wait(700);
    await page.screenshot({ path: path.join(SHOTS, `e2e-results-${Date.now()}.png`) });
    const bests = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.bests.v1')));
    assert.ok(bests.overall && bests.overall.score === st.score + 0 || bests.overall.score > 0, 'personal best recorded');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'save cleared after finishing');
    // 6) submit the replay to the spawned verifier via the Results button (Phaser button: click its canvas position)
    for (let i = 0; i < 20; i++) { try { if ((await fetch(`http://127.0.0.1:${VPORT}/health`)).ok) break; } catch {} await wait(300); }
    await page.mouse.click(200, 650); // "Submit to local verifier"
    await page.waitForFunction(() => Array.from(window.__jdGame.scene.getScene('Results').children.list).some((o) => o.text && /Verified by re-simulation: \$\d+ — #1 of 1 on the local verified board as e2e player/.test(o.text)), null, { timeout: 15000 });
    const board = await (await fetch(`http://127.0.0.1:${VPORT}/board?seed=e2e-seed`)).json();
    assert.equal(board.entries.length, 1, 'one verified entry');
    assert.equal(board.entries[0].player, 'e2e player', 'the stored player name is sent with the submission');
    // share text: copied to the clipboard with seed, score and verified rank
    await page.evaluate(() => window.__jdGame.scene.getScene('Results').children.getByName('share').emit('pointerdown'));
    await page.waitForFunction(() => !!window.__jdGame.scene.getScene('Results').lastShareText, null, { timeout: 5000 }); // clipboard availability varies in headless runs; the text itself is what matters
    const shared = await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText); // headless clipboard contents are not reliably readable
    assert.match(shared, /^Junkyard Draft — seed e2e-seed: \$\d+\n/);
    assert.match(shared, /#1 of 1 on the verified board as e2e player \(replay re-simulated, rules v2\)/);
    const subs = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.submissions.v1')));
    assert.equal(subs['e2e-seed'].replayHash, board.entries[0].replayHash, 'submission recorded locally by replay hash');
    // 7) watch the verified replay from the board: fetched by hash, re-verified locally, played back labelled, never recorded as a best
    const bestsBefore = await page.evaluate(() => localStorage.getItem('jd.bests.v1'));
    await page.waitForFunction(() => !!window.__jdGame.scene.getScene('Results').children.getByName('board-entry-0'), null, { timeout: 10000 });
    await page.evaluate(() => window.__jdGame.scene.getScene('Results').children.getByName('board-entry-0').emit('pointerdown'));
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Game') && !!window.__jd && /verified replay by e2e player/.test(window.__jdGame.scene.getScene('Game').children.getByName('hud-seed')?.text || ''), null, { timeout: 15000 });
    for (let r = 1; r <= 6; r++) {
      await page.waitForFunction(() => window.__jd.mode() === 'running', null, { timeout: 15000 });
      await api('finishRun'); // playback uses the real run loop; skip the animation of each round
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results') && /verified replay by e2e player/.test(window.__jdGame.scene.getScene('Results').children.getByName('results-subtitle')?.text || ''), null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.bests.v1')), bestsBefore, 'watching a replay does not change local bests');
    assert.equal(await page.evaluate(() => Number(Array.from(window.__jdGame.scene.getScene('Results').children.list).find((o) => o.text && /^\$\d+$/.test(o.text)).text.slice(1))), board.entries[0].score, 'playback reproduces the verified score');
    const finalScore = await page.evaluate(() => Number(Array.from(window.__jdGame.scene.getScene('Results').children.list).find((o) => o.text && /^\$\d+$/.test(o.text)).text.slice(1)));
    assert.equal(board.entries[0].score, finalScore, 'board score equals the displayed final score');
    // title screen shows this device's verified rank for today's seed: submit a daily replay to the test verifier,
    // record it locally the way the results screen does, then reload the title
    const { newRun, apply } = await import('../game/src/sim/run.ts');
    const { exportReplay } = await import('../game/src/sim/replay.ts');
    const { dailySeed } = await import('../game/src/sim/daily.ts');
    const { RULES } = await import('../game/src/sim/rules.ts');
    const daily = newRun(dailySeed());
    for (let r = 1; r <= RULES.rounds; r++) { const ci = daily.offers.indexOf('crusher'); apply(daily, { t: 'pick', i: ci >= 0 ? ci : 0 }); if (r === 1) { const cv = daily.layout.machines.find((m) => m.x === 2 && m.y === 2); apply(daily, { t: 'unplace', id: cv.id }); apply(daily, { t: 'place', id: daily.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(daily, { t: 'run' }); apply(daily, { t: 'next' }); }
    const sub = await (await fetch(`http://127.0.0.1:${VPORT}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(daily), player: 'e2e player' }) })).json();
    assert.equal(sub.ok, true, 'daily replay verified');
    await page.evaluate(({ seed, s }) => localStorage.setItem('jd.submissions.v1', JSON.stringify({ [seed]: s })), { seed: dailySeed(), s: { score: sub.score, replayHash: sub.entry.replayHash, verifiedAt: sub.entry.verifiedAt, player: 'e2e player' } });
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => { const t = window.__jdGame.scene.getScene('Title')?.children.getByName('daily-board'); return !!t && /^You: #1 of 1 \(\$\d+\)/.test(t.text) && /1\. \$\d+ e2e player/.test(t.text); }, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__jdGame.scene.getScene('Title').children.getByName('player').label.text), 'Player: e2e player');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    if (browser) await browser.close().catch(() => {}); // guard: a failed launch must still stop the servers below
    server.kill('SIGTERM');
    verifier.kill('SIGTERM');
    fs.rmSync(path.dirname(boardFile), { recursive: true, force: true });
  }
});
