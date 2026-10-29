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
    // malformed_storage_shapes_fall_back: valid JSON with the wrong shape must not crash boot or the title
    await page.evaluate(() => { localStorage.setItem('jd.bests.v1', JSON.stringify({ bySeed: null })); localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 'loud', textScale: 9, reducedMotion: 'maybe' })); localStorage.setItem('jd.submissions.v1', '"junk"'); });
    await page.reload();
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    assert.deepEqual(errors, [], 'damaged storage shapes produced no page errors');
    assert.equal(await page.getByTestId('textscale').textContent(), '100%', 'an invalid text scale falls back to 100%');
    await page.evaluate(() => { localStorage.removeItem('jd.bests.v1'); localStorage.removeItem('jd.settings.v1'); localStorage.removeItem('jd.submissions.v1'); });
    // player name for the verified board (set here so the results screen does not prompt)
    await page.evaluate(() => localStorage.setItem('jd.player', 'e2e player'));
    // opt_in_funnel_events (PLAN-v1 0.3.7): off by default; the title toggle turns it on and says so
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.settings.v1') || '{}')).telemetry ?? false, false, 'telemetry is off by default');
    assert.equal(await page.getByTestId('telemetry').textContent(), 'Share stats: Off');
    await page.getByTestId('telemetry').click();
    await wait(200);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.settings.v1'))).telemetry, true, 'the toggle records consent');
    assert.equal(await page.getByTestId('telemetry').textContent(), 'Share stats: On');
    assert.match(await page.evaluate(() => localStorage.getItem('jd.telemetry.v1') || ''), /"installId":"[0-9a-f]{32}"/, 'a random install id exists only after consent');
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
    assert.match(await api('hint'), /^Cell occupied/, 'a refused drop explains why in the hint strip');
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
    // undo_restores_facing (PLAN-v1 0.3.3): Ctrl+Z undoes the rotation, Ctrl+Y re-applies it, the panel buttons track it
    const undoBtn = () => page.evaluate(() => { const q = (n) => document.querySelector('[data-testid=' + n + ']'); const a = (el) => (el ? (el.disabled ? 0.4 : 1) : undefined); return { undo: a(q('undo')), redo: a(q('redo')) }; });
    assert.deepEqual(await undoBtn(), { undo: 1, redo: 0.4 }, 'Undo enabled after an edit, Redo disabled');
    await page.keyboard.press('Control+z'); await wait(200);
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id).dir, 0, 'Ctrl+Z restores the previous facing');
    assert.deepEqual(await undoBtn(), { undo: 1, redo: 1 }, 'Redo enabled after an undo');
    await page.keyboard.press('Control+z'); await wait(200);
    assert.ok((await api('state')).bin.some((mm) => mm.id === kbConv.id), 'a second Ctrl+Z undoes the placement: the conveyor is back in the bin');
    await page.keyboard.press('Control+y'); await wait(200);
    await page.keyboard.press('Control+y'); await wait(200);
    assert.equal((await api('state')).layout.machines.find((mm) => mm.id === kbConv.id)?.dir, 1, 'two Ctrl+Y re-place and re-rotate it');
    assert.deepEqual(await undoBtn(), { undo: 1, redo: 0.4 });
    await page.keyboard.press('Enter'); await wait(150);
    assert.equal((await cur()).held, kbConv.id, 'Enter on a machine picks it up');
    await page.keyboard.press('ArrowUp'); await wait(150);
    await page.keyboard.press('Enter'); await wait(150);
    assert.equal((await cur()).held, kbConv.id, 'dropping onto the occupied crusher cell is refused and the part stays in hand');
    assert.match(await api('hint'), /^Cell occupied/, 'keyboard refusal shows the reason');
    await page.keyboard.press('ArrowDown'); await wait(150); await page.keyboard.press('ArrowRight'); await wait(2400);
    assert.match(await api('hint'), /^Heads up: .*feeding/, 'a legal but unfed spot warns instead of refusing');
    await page.screenshot({ path: path.join(SHOTS, `e2e-ghost-arrows-${Date.now()}.png`) });
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

    // starting_round_cancels_active_drag: a machine under the pointer when the round starts snaps back; the drop edits nothing
    const hopperCell = cell(1, 2);
    const before = JSON.stringify((await api('state')).layout.machines);
    await page.mouse.move(hopperCell.x, hopperCell.y); await page.mouse.down(); await page.mouse.move(hopperCell.x + 24, hopperCell.y + 24, { steps: 4 });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__jd.mode() === 'running');
    await page.mouse.move(GX + 200, BIN_Y + 60, { steps: 8 }); await page.mouse.up(); await wait(250);
    st = await api('state');
    assert.equal(JSON.stringify(st.layout.machines), before, 'the authoritative layout is frozen once the round starts');
    assert.equal(st.bin.length, 1, 'the dropped hopper did not land in the bin');
    assert.equal(await api('act', { t: 'unplace', id: st.layout.machines[0].id }), false, 'layout edits through the dev API are refused while running too');
    assert.equal(JSON.stringify((await api('state')).layout.machines), before);

    // 3) the round is already running from the drag check above (Space is ignored while running); watch some animation, then skip
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
    await page.waitForFunction(() => /No verified scores yet today/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''), null, { timeout: 15000 });
    // accessibility settings: reduced motion and text size persist, re-render the title, and apply in-game
    const titleBtn = (name) => page.getByTestId(name).click();
    const tidText = (name) => `document.querySelector('[data-testid=${name}]')?.textContent`;
    const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('jd.settings.v1') || '{}'));
    const titleReady = (pred) => page.waitForFunction(pred, null, { timeout: 8000 });
    await titleBtn('motion');
    await titleReady(`window.__jdGame.scene.isActive('Title') && ${tidText('motion')} === 'Reduced'`);
    assert.equal((await settings()).reducedMotion, true, 'reduced motion persisted');
    await titleBtn('textscale');
    await titleReady(`window.__jdGame.scene.isActive('Title') && ${tidText('textscale')} === '115%'`);
    assert.equal((await settings()).textScale, 1.15, 'text size persisted');
    assert.equal((await settings()).reducedMotion, true, 'text size change kept the motion setting');
    const howtoPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid=howto-1]')).fontSize));
    assert.ok(Math.abs(howtoPx - 15 * 1.15) < 0.6, `labels scale with text size (15px × 1.15 ≈ ${howtoPx.toFixed(2)}px)`);
    await titleBtn('textscale'); await titleReady(`${tidText('textscale')} === '130%'`);
    // large_text_layout_fits (title, 130 %, with a saved run present): nothing overlaps or leaves the canvas
    const titleLayout = await page.evaluate(() => { const g = (n) => document.querySelector('[data-testid=' + n + ']')?.getBoundingClientRect(); const ui = document.getElementById('ui').getBoundingClientRect(); const all = [...document.querySelectorAll('#ui [data-testid]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.testid, inside: r.left >= ui.left - 1 && r.right <= ui.right + 1 && r.top >= ui.top - 1 && r.bottom <= ui.bottom + 1 }; }); return { howto5: g('howto-5'), note: g('continue-note'), daily: g('daily'), strip: g('daily-strip'), ui, outside: all.filter((a) => !a.inside).map((a) => a.id), scrollH: document.querySelector('#ui .jd-screen').scrollHeight, clientH: document.querySelector('#ui .jd-screen').clientHeight }; });
    assert.ok(titleLayout.note.bottom <= titleLayout.daily.top + 1, `continue note (${titleLayout.note.bottom}) clears the buttons below (${titleLayout.daily.top})`);
    assert.ok(titleLayout.howto5.bottom <= titleLayout.strip.top + 1, `how-to panel text (${titleLayout.howto5.bottom}) clears the daily strip (${titleLayout.strip.top})`);
    assert.deepEqual(titleLayout.outside, [], 'every control stays inside the overlay at 130 %');
    assert.ok(titleLayout.scrollH <= titleLayout.clientH + 1, `the title does not need to scroll at 130 % (${titleLayout.scrollH} vs ${titleLayout.clientH})`);
    await titleBtn('textscale'); await titleReady(`${tidText('textscale')} === '100%'`);
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
      if (r === 3) {
        // pooled_pops_never_exceed_the_pool: let the round run live for a moment (finishRun skips the visuals), then check the pool
        await wait(1800);
        const liveEarned = await page.evaluate(() => window.__jdGame.scene.getScene('Game').sim?.earned ?? 0);
        const live = await api('counters');
        if (liveEarned > 0) assert.ok(live.popsPeak >= 1, `a round that has earned $${liveEarned} so far showed at least one pop`);
        assert.ok(live.popsPeak <= live.poolMax && live.poolSize <= live.poolMax, `pops peaked at ${live.popsPeak}, pool ${live.poolSize}/${live.poolMax}`);
      }
      if (r === 2) {
        // reduced motion (set on the title screen above) keeps conveyor belts on frame 0 while running
        await wait(700);
        assert.equal((await api('prefs')).reducedMotion, true);
        const belts = await page.evaluate(() => window.__jdGame.scene.getScene('Game').children.list.flatMap((o) => (o.list ? o.list : [o])).filter((o) => o.texture && /^belt-/.test(o.texture.key)).map((o) => o.texture.key));
        assert.ok(belts.length > 0 && belts.every((k) => k === 'belt-0'), `belts static under reduced motion: ${belts.join(',')}`);
      }
      await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary');
      if (r >= 3) {
        // pooled_pops_never_exceed_the_pool: finishRun ships a whole round in one frame; the +$ pops come from a 16-slot pool
        const ctr = await api('counters');
        assert.ok(ctr.popsPeak <= ctr.poolMax, `pops alive peaked at ${ctr.popsPeak} (pool ${ctr.poolMax})`);
        assert.ok(ctr.poolSize <= ctr.poolMax, 'the pool never grows past its cap');
      }
      await api('next');
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await wait(700);
    await page.screenshot({ path: path.join(SHOTS, `e2e-results-${Date.now()}.png`) });
    const completed = (await api('state')).score; // the Game scene's run object holds the finished run
    const bests = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.bests.v1')));
    assert.equal(bests.overall?.score, completed, 'personal_best_equals_completed_score (overall)');
    assert.equal(bests.bySeed['e2e-seed']?.score, completed, 'personal_best_equals_completed_score (seed)');
    assert.equal(bests.runs, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'save cleared after finishing');
    // 6) submit the replay to the spawned verifier via the Results button (Phaser button: click its canvas position)
    for (let i = 0; i < 20; i++) { try { if ((await fetch(`http://127.0.0.1:${VPORT}/health`)).ok) break; } catch {} await wait(300); }
    await page.getByTestId('submit').click();
    await page.waitForFunction(() => /Verified by re-simulation: \$\d+ — #1 of 1 on the local verified board as e2e player/.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    // histogram_first (PLAN-v1 0.4.1): the only verified run is highlighted and the text says so without inventing a population
    await page.waitForFunction(() => /^1 verified run so far · you are #1$/.test(document.querySelector('[data-testid=percentile]')?.textContent || ''), null, { timeout: 10000 });
    const hist = await page.evaluate(() => ({ bins: document.querySelectorAll('[data-testid=histogram] .jd-hist-bin').length, mine: document.querySelectorAll('[data-testid=histogram] .jd-hist-mine').length, mineCount: document.querySelector('[data-testid=histogram] .jd-hist-mine .jd-hist-count')?.textContent }));
    assert.ok(hist.bins >= 1 && hist.mine === 1 && hist.mineCount === '1', `histogram shows the player's bin: ${JSON.stringify(hist)}`);
    // bot_par_is_a_target_not_an_entry (PLAN-v1 0.4.5): the test verifier computed the autoplayer's par for this seed in a worker; it shows as a bot line and the board still has one entry
    await page.waitForFunction(() => /^Bot par \$\d+ · the shipped autoplayer/.test(document.querySelector('[data-testid=bot-par]')?.textContent || ''), null, { timeout: 30000 });
    const board = await (await fetch(`http://127.0.0.1:${VPORT}/board?seed=e2e-seed`)).json();
    assert.ok(typeof board.botPar === 'number' && board.botPar > 0, 'the board carries a numeric bot par');
    assert.equal(board.entries.length, 1, 'one verified entry');
    assert.equal(board.entries[0].player, 'e2e player', 'the stored player name is sent with the submission');
    // share text: copied to the clipboard with seed, score and verified rank
    await page.getByTestId('share').click();
    await page.waitForFunction(() => !!window.__jdGame.scene.getScene('Results').lastShareText, null, { timeout: 5000 }); // clipboard availability varies in headless runs; the text itself is what matters
    const shared = await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText); // headless clipboard contents are not reliably readable
    assert.match(shared, /^Junkyard Draft — seed e2e-seed: \$\d+\n/);
    assert.match(shared, /#1 of 1 on the verified board as e2e player \(replay re-simulated, rules v2\)/);
    const subs = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.submissions.v1')));
    assert.equal(subs['e2e-seed'].replayHash, board.entries[0].replayHash, 'submission recorded locally by replay hash');
    // 7) watch the verified replay from the board: fetched by hash, re-verified locally, played back labelled, never recorded as a best
    const bestsBefore = await page.evaluate(() => localStorage.getItem('jd.bests.v1'));
    // watched_replay_preserves_existing_save: plant an unrelated unfinished run; it must survive playback byte for byte
    const plantedSave = JSON.stringify({ rulesVersion: 2, seed: 'other-seed', actions: [{ t: 'pick', i: 0 }], savedAt: '2026-10-26T00:00:00.000Z' });
    await page.evaluate((s) => localStorage.setItem('jd.save.v1', s), plantedSave);
    await page.waitForSelector('[data-testid=board-entry-0]:not([disabled])', { timeout: 10000 });
    await page.getByTestId('board-entry-0').click();
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Game') && !!window.__jd && /verified replay by e2e player/.test(document.querySelector('[data-testid=hud-seed]')?.textContent || ''), null, { timeout: 15000 });
    // playback controls: REPLAY marker, the original run's earnings next to the live total, a Stop button
    assert.ok(await page.evaluate(() => !!document.querySelector('[data-testid=replay-banner]')), 'REPLAY marker shown while watching');
    await page.waitForFunction(() => window.__jd.mode() === 'running', null, { timeout: 15000 });
    const sideTexts = await page.evaluate(() => ({ orig: document.querySelector('[data-testid=replay-original]')?.textContent, stop: document.querySelector('[data-testid=stop]')?.textContent }));
    assert.match(sideTexts.orig || '', /^Original run: \$\d+ this round · \$\d+ after round 1 · \$\d+ final$/);
    assert.equal(sideTexts.stop, 'Stop watching (Esc)');
    for (let r = 1; r <= 6; r++) {
      await page.waitForFunction(() => window.__jd.mode() === 'running', null, { timeout: 15000 });
      await api('finishRun'); // playback uses the real run loop; skip the animation of each round
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results') && /verified replay by e2e player/.test(document.querySelector('[data-testid=results-subtitle]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.bests.v1')), bestsBefore, 'watching a replay does not change local bests');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), plantedSave, 'finishing a watched replay leaves the unrelated save untouched');
    assert.equal(await page.evaluate(() => Number(document.querySelector('[data-testid=score]').textContent.slice(1))), board.entries[0].score, 'playback reproduces the verified score');
    const finalScore = await page.evaluate(() => Number(document.querySelector('[data-testid=score]').textContent.slice(1)));
    assert.equal(board.entries[0].score, finalScore, 'board score equals the displayed final score');
    // Esc stops a watched replay mid-run and returns to the title (instead of pausing)
    await page.waitForSelector('[data-testid=board-entry-0]:not([disabled])', { timeout: 10000 });
    await page.getByTestId('board-entry-0').click();
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.mode() === 'running', null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Title'), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), plantedSave, 'stopping a replay leaves the unrelated save untouched too');
    await page.evaluate(() => localStorage.removeItem('jd.save.v1'));
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
    await page.waitForFunction(() => { const t = document.querySelector('[data-testid=daily-board]')?.textContent || ''; return /^You: #1 of 1 \(\$\d+\)/.test(t) && /1\. \$\d+ e2e player/.test(t); }, null, { timeout: 15000 });
    assert.equal(await page.getByTestId('player').textContent(), 'Player: e2e player');
    await page.waitForSelector('[data-testid=daily-hist] .jd-hist-bar', { timeout: 10000 });
    assert.ok((await page.locator('[data-testid=daily-hist] .jd-hist-bar').count()) >= 1, 'the daily strip shows a mini histogram once a verified run exists');
    // large_text_layout_fits (HUD): a maximum-length seed at 130 % keeps round, score and local-best on the canvas
    await page.evaluate(() => localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 0.7, muted: false, reducedMotion: true, textScale: 1.3 })));
    await page.goto(`${URL}/?dev=1&scene=game&seed=${'m'.repeat(64)}&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    const hud = await page.evaluate(() => { const q = (n) => document.querySelector('[data-testid=' + n + ']'); const seed = q('hud-seed'); const r = (el) => el.getBoundingClientRect(); return { seedTruncated: seed.scrollWidth > seed.clientWidth + 1 && getComputedStyle(seed).textOverflow === 'ellipsis', seedText: seed.textContent, scoreRight: r(q('hud-score').parentElement).right, titleLeft: r(q('title')).left, roundRight: r(q('hud-round')).right, scoreLeft: r(q('hud-score')).left, uiRight: document.getElementById('ui').getBoundingClientRect().right, state: window.__jd.state().seed.length }; });
    assert.equal(hud.state, 64, 'the full 64-character seed is the run seed');
    assert.ok(hud.seedTruncated && hud.seedText.includes('m'.repeat(64)), 'the HUD shortens the seed label visually (ellipsis) while keeping the full seed in the text');
    assert.ok(hud.scoreRight <= hud.titleLeft && hud.roundRight <= hud.scoreLeft && hud.scoreRight <= hud.uiRight, `HUD fits: round→${hud.roundRight} score→${hud.scoreLeft}..${hud.scoreRight} title button at ${hud.titleLeft}`);
    await page.evaluate(() => localStorage.removeItem('jd.settings.v1'));
    // funnel events reached the test verifier: steps counted per install, nothing identifying stored
    assert.equal(await api('flushTelemetry'), true, 'the queued events were accepted by the verifier');
    const funnel = await (await fetch(`http://127.0.0.1:${VPORT}/funnel`)).json();
    const step = (n) => funnel.steps.find((s) => s.name === n)?.installs;
    assert.deepEqual({ installs: funnel.installs, app_start: step('app_start'), pick: step('first_draft_pick'), attempt: step('first_place_attempt'), run: step('first_run_start'), complete: step('first_run_complete'), game: step('game_complete') }, { installs: 1, app_start: 1, pick: 1, attempt: 1, run: 1, complete: 1, game: 1 }, `funnel: ${JSON.stringify(funnel)}`);
    assert.ok(funnel.counts.daily_submit_result >= 1 && funnel.counts.share_copied >= 1 && funnel.counts.undo_used === 1 && funnel.counts.first_place_rejected === 1, `event counts: ${JSON.stringify(funnel.counts)}`);
    const eventsText = fs.readFileSync(path.join(path.dirname(boardFile), 'events.jsonl'), 'utf8');
    assert.ok(!eventsText.includes('e2e-seed') && !eventsText.includes('other-seed'), 'no seed string reached the verifier');
    assert.ok(!eventsText.includes('127.0.0.1'), 'no client address was stored');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    if (browser) await browser.close().catch(() => {}); // guard: a failed launch must still stop the servers below
    server.kill('SIGTERM');
    verifier.kill('SIGTERM');
    fs.rmSync(path.dirname(boardFile), { recursive: true, force: true });
  }
});
