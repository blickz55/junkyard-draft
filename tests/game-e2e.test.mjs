// End-to-end gameplay test in Chromium: real pointer drag, keyboard rotate, a full six-round
// run to the results screen, save/continue, and replay export verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers'; // sandbox only; elsewhere Playwright's default cache is used
const { chromium } = await import('playwright');
const { RULES_VERSION } = await import('../game/src/sim/types.ts');
const V = String(RULES_VERSION); // records are partitioned by rules version (PLAN-v2 0.5.0)
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }

test('junkyard draft: full run in the browser', { timeout: 180000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  const VPORT = 4499;
  const boardFile = path.join(fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-')), 'board.json');
  const verifier = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], { env: { ...process.env, PORT: String(VPORT), BOARD_FILE: boardFile, PLAYER_RATE_LIMIT: '100', DAILY_SECRET: 'e2e-daily-secret' }, stdio: 'ignore' });
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
    await page.evaluate(() => { localStorage.removeItem('jd.bests.v1'); localStorage.removeItem('jd.bests.v2'); localStorage.removeItem('jd.settings.v1'); localStorage.removeItem('jd.submissions.v1'); localStorage.removeItem('jd.submissions.v2'); });
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
    const bests = await page.evaluate((v) => JSON.parse(localStorage.getItem('jd.bests.v2')).byVersion[v], V);
    assert.equal(bests.overall?.score, completed, 'personal_best_equals_completed_score (overall)');
    assert.equal(bests.bySeed['e2e-seed']?.score, completed, 'personal_best_equals_completed_score (seed)');
    assert.equal(bests.runs, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'save cleared after finishing');
    // 6) submit the replay to the spawned verifier via the Results button (Phaser button: click its canvas position)
    for (let i = 0; i < 20; i++) { try { if ((await fetch(`http://127.0.0.1:${VPORT}/health`)).ok) break; } catch {} await wait(300); }
    await page.getByTestId('submit').click();
    await page.waitForFunction(() => /Verified by re-simulation: \$\d+ — #1 of 1 on the local verified board as e2e player#[2-9A-HJKMNP-TV-Z]{4}\./.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    // histogram_first (PLAN-v1 0.4.1): the only verified run is highlighted and the text says so without inventing a population
    await page.waitForFunction(() => /^1 verified run so far · you are #1$/.test(document.querySelector('[data-testid=percentile]')?.textContent || ''), null, { timeout: 10000 });
    const hist = await page.evaluate(() => ({ bins: document.querySelectorAll('[data-testid=histogram] .jd-hist-bin').length, mine: document.querySelectorAll('[data-testid=histogram] .jd-hist-mine').length, mineCount: document.querySelector('[data-testid=histogram] .jd-hist-mine .jd-hist-count')?.textContent }));
    assert.ok(hist.bins >= 1 && hist.mine === 1 && hist.mineCount === '1', `histogram shows the player's bin: ${JSON.stringify(hist)}`);
    // bot_par_is_a_target_not_an_entry (PLAN-v1 0.4.5): the test verifier computed the autoplayer's par for this seed in a worker; it shows as a bot line and the board still has one entry
    await page.waitForFunction(() => /^Bot par \$\d+ · the shipped autoplayer/.test(document.querySelector('[data-testid=bot-par]')?.textContent || ''), null, { timeout: 30000 });
    const board = await (await fetch(`http://127.0.0.1:${VPORT}/board?seed=e2e-seed`)).json();
    assert.ok(typeof board.botPar === 'number' && board.botPar > 0, 'the board carries a numeric bot par');
    assert.equal(board.entries.length, 1, 'one verified entry');
    assert.match(board.entries[0].player, /^e2e player#[2-9A-HJKMNP-TV-Z]{4}$/, 'the local name was claimed on first submission and the entry carries name#tag (PLAN-v3 0.6.0)');
    const identity = JSON.parse(await page.evaluate(() => localStorage.getItem('jd.identity.v1')));
    assert.match(identity.token, /^[0-9a-f]{32}$/); assert.equal(board.entries[0].playerId, createHash('sha256').update(identity.token).digest('hex'), 'the entry is stamped with SHA-256(token) of the device token the page holds'); assert.equal(identity.playerId, board.entries[0].playerId, 'the page cached the player id the verifier confirmed');
    assert.equal(`${identity.name}#${identity.tag}`, board.entries[0].player, 'the claimed name and tag are cached on the device');
    assert.equal(typeof board.entries[0].finalMachines, 'number', 'the verifier derived the tie-break field');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid=tie-rule]')?.textContent ?? ''), /^Equal scores: fewer machines in round 6/, 'the tie rule is printed under the board (PLAN-v2 0.5.5)');
    // share text: copied to the clipboard with seed, score and verified rank
    // without a clipboard (headless), copying opens the select-and-copy dialog (review F04): close it like a player would
    const dismissCopyDialog = async () => { await wait(400); /* the clipboard promise rejects asynchronously before the dialog opens */ if (await page.locator('[data-testid=dialog]').count()) { await page.getByTestId('dialog-ok').click(); await wait(100); } };
    await page.getByTestId('share').click();
    await page.waitForFunction(() => !!window.__jdGame.scene.getScene('Results').lastShareText, null, { timeout: 5000 }); // clipboard availability varies in headless runs; the text itself is what matters
    const shared = await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText); // headless clipboard contents are not reliably readable
    // spoiler_free_share (PLAN-v1 0.4.3): label · score, six glyphs, the standing, days played; no URL, no per-round dollars, no layout
    assert.match(shared, /^Junkyard Draft · seed e2e-seed · \$\d+\n[░▒▓█]{6}\n#1 of 1 on the verified board as e2e player#[2-9A-HJKMNP-TV-Z]{4}\n1 day played$/, `default share text: ${JSON.stringify(shared)}`);
    assert.doesNotMatch(shared, /https?:|rounds \$|hopper|conveyor|crusher/);
    await dismissCopyDialog();
    await page.getByTestId('share-link').check();
    await page.getByTestId('share-detailed').click();
    await page.waitForFunction(() => /rounds \$/.test(window.__jdGame.scene.getScene('Results').lastShareText), null, { timeout: 5000 });
    const detailed = await page.evaluate(() => window.__jdGame.scene.getScene('Results').lastShareText);
    assert.match(detailed, new RegExp(`\\nrounds \\$\\d+ · \\$\\d+ · \\$\\d+ · \\$\\d+ · \\$\\d+ · \\$\\d+\\nreplay re-simulated by the verifier, rules v${V}(\\nbadges: [^\\n]+)?\\n1 day played\\nhttp:\\/\\/127\\.0\\.0\\.1:\\d+\\/\\?scene=game&seed=e2e-seed$`), `detailed share text with link: ${JSON.stringify(detailed)}`);
    await dismissCopyDialog();
    await page.getByTestId('share-link').uncheck();
    // non_ranked_badges (PLAN-v1 0.4.6): pills are known badges and the detailed verified text lists exactly them
    const pills = await page.evaluate(() => [...document.querySelectorAll('[data-testid=badges] .jd-badge-pill')].map((p) => ({ id: p.dataset.testid, title: p.textContent })));
    for (const p of pills) assert.ok(['badge-clean', 'badge-minimalist', 'badge-full-grid'].includes(p.id), `known badge: ${p.id}`);
    const badgeLine = detailed.split('\n').find((l) => l.startsWith('badges: '));
    if (pills.length) assert.equal(badgeLine, 'badges: ' + pills.map((p) => p.title).join(' · ')); else assert.equal(badgeLine, undefined, 'no badges, no line');
    assert.doesNotMatch(shared, /badges/, 'the spoiler-free grid never lists badges');
    const subs = await page.evaluate((v) => JSON.parse(localStorage.getItem('jd.submissions.v2')).byVersion[v], V);
    assert.equal(subs['e2e-seed'].replayHash, board.entries[0].replayHash, 'submission recorded locally by replay hash');
    // loop_clip_exports (PLAN-v1 0.4.2): the best round is re-simulated and recorded live in Chromium; the clip is non-empty, at least 3 s, and takes under 10 s to make
    const clip = await page.evaluate(() => window.__jdGame.scene.getScene('Results').exportClip().then((c) => ({ ...c })));
    assert.ok(clip.size > 0, `clip has bytes (${clip.size})`);
    assert.ok(clip.ms >= 3000, `clip recorded for at least 3 s (${clip.ms} ms)`);
    assert.ok(clip.elapsedMs <= 10000, `export finished in under 10 s (${clip.elapsedMs} ms)`);
    assert.match(clip.mime, /^video\/(webm|mp4)/); assert.match(clip.filename, /^junkyard-e2e-seed-\$\d+-r\d\.(webm|mp4)$/);
    assert.ok(clip.frames >= 60 && clip.width >= 624 && clip.height >= 536, `frames ${clip.frames}, ${clip.width}x${clip.height}`);
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid=export-clip]')?.disabled), false, 'the export button is usable again');
    assert.equal(clip.footer, 'junkyard draft · verified replay', 'this run was accepted by the verifier above, so its clip may say so (review F10)');
    // gif_clip_exports (PLAN-v1 0.4.11): the same round as a GIF89a drawn offline at 1x and 10 fps: real header, logical size,
    // a one-pass loop with a hold, ≤ 256 colours, under the 2 MB budget, in a few seconds
    const gif = await page.evaluate(() => window.__jdGame.scene.getScene('Results').exportGif().then((g) => ({ ...g })));
    assert.equal(gif.magic, 'GIF89a');
    assert.ok(gif.size > 10_000 && gif.size <= 2 * 1024 * 1024, `GIF size within budget (${gif.size} bytes)`);
    assert.ok(gif.frames >= 30 && gif.frames <= 60 && gif.ms >= 3000, `${gif.frames} frames over ${gif.ms} ms`);
    assert.ok(gif.colours > 8 && gif.colours <= 256, `palette of ${gif.colours} colours`);
    assert.ok(gif.width >= 624 && gif.height >= 536, `${gif.width}x${gif.height}`);
    assert.ok(gif.elapsedMs <= 15000, `GIF drawn and encoded in under 15 s (${gif.elapsedMs} ms)`);
    assert.match(gif.filename, /^junkyard-e2e-seed-\$\d+-r\d\.gif$/);
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid=export-gif]')?.disabled), false, 'the GIF button is usable again');
    assert.equal(gif.footer, 'junkyard draft · verified replay');
    // results_provenance (review F11): a different, unsubmitted attempt on the same seed shows no rank for itself, names the earlier
    // verified attempt as a different one, and its exports say local
    await page.evaluate(() => window.__jdGame.scene.start('Game', { seed: 'e2e-seed', fresh: true }));
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft' && window.__jd.state().round === 1 && window.__jd.state().rounds.length === 0, null, { timeout: 15000 });
    for (let r = 0; r < 6; r++) {
      await page.evaluate(() => { const j = window.__jd; const st = j.state(); j.pick(st.offers.length - 1); j.run(); });
      await page.waitForFunction(() => window.__jd.mode() === 'running', null, { timeout: 10000 });
      await page.evaluate(() => window.__jd.finishRun());
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 10000 });
      await page.evaluate(() => window.__jd.next());
      await wait(150);
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await page.waitForFunction(() => !!document.querySelector('[data-testid=prior-best]'), null, { timeout: 10000 });
    const prov = await page.evaluate(() => ({ prior: document.querySelector('[data-testid=prior-best]')?.textContent, pct: document.querySelector('[data-testid=percentile]')?.textContent, mine: document.querySelectorAll('[data-testid=histogram] .jd-hist-mine').length, verifiedHash: window.__jdGame.scene.getScene('Results').verifiedHash }));
    assert.match(prov.prior ?? '', /^This device's verified run on this seed: \$\d+ \(a different attempt/, JSON.stringify(prov));
    assert.doesNotMatch(prov.pct ?? '', /you are #|Better than/, 'no standing is claimed for an unverified attempt');
    assert.equal(prov.mine, 0, 'no bin is highlighted as this run'); assert.equal(prov.verifiedHash, null);
    const localGif = await page.evaluate(() => window.__jdGame.scene.getScene('Results').exportGif().then((g) => ({ footer: g.footer })));
    assert.equal(localGif.footer, 'junkyard draft · local run · not verified', 'a local export never claims verification');
    // 7) watch the verified replay from the board: fetched by hash, re-verified locally, played back labelled, never recorded as a best
    const bestsBefore = await page.evaluate(() => localStorage.getItem('jd.bests.v2'));
    // watched_replay_preserves_existing_save: plant an unrelated unfinished run; it must survive playback byte for byte
    const plantedSave = JSON.stringify({ rulesVersion: Number(V), seed: 'other-seed', actions: [{ t: 'pick', i: 0 }], savedAt: '2026-10-26T00:00:00.000Z' });
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
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.bests.v2')), bestsBefore, 'watching a replay does not change local bests');
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
    // minted daily (PLAN-v3 0.6.1): the ranked seed comes from the verifier, never from the client's date
    const dinfo = await (await fetch(`http://127.0.0.1:${VPORT}/daily`)).json();
    assert.match(dinfo.seed, /^daily-\d{4}-\d{2}-\d{2}-[a-z2-7]{8}$/, `minted seed: ${dinfo.seed}`); assert.equal(dinfo.minted, true); assert.match(dinfo.commitment, /^[0-9a-f]{64}$/, 'a commitment to tomorrow is published');
    const daily = newRun(dinfo.seed);
    for (let r = 1; r <= RULES.rounds; r++) { const ci = daily.offers.indexOf('crusher'); apply(daily, { t: 'pick', i: ci >= 0 ? ci : 0 }); if (r === 1) { const cv = daily.layout.machines.find((m) => m.x === 2 && m.y === 2); apply(daily, { t: 'unplace', id: cv.id }); apply(daily, { t: 'place', id: daily.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(daily, { t: 'run' }); apply(daily, { t: 'next' }); }
    const sub = await (await fetch(`http://127.0.0.1:${VPORT}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(daily), player: 'e2e player' }) })).json();
    assert.equal(sub.ok, true, 'daily replay verified');
    // a run on the practice seed verifies as an ordinary seed board and never reaches the daily board
    const practice = newRun(dailySeed());
    for (let r = 1; r <= RULES.rounds; r++) { const ci = practice.offers.indexOf('crusher'); apply(practice, { t: 'pick', i: ci >= 0 ? ci : 0 }); if (r === 1) { const cv = practice.layout.machines.find((m) => m.x === 2 && m.y === 2); apply(practice, { t: 'unplace', id: cv.id }); apply(practice, { t: 'place', id: practice.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(practice, { t: 'run' }); apply(practice, { t: 'next' }); }
    const psub = await (await fetch(`http://127.0.0.1:${VPORT}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(practice), player: 'practice player' }) })).json();
    assert.equal(psub.ok, true, 'the practice seed is an ordinary seed board');
    const dboard = await (await fetch(`http://127.0.0.1:${VPORT}/daily`)).json();
    assert.deepEqual(dboard.entries.map((e) => e.replayHash), [sub.entry.replayHash], 'only the minted-seed run is on the daily board');
    await page.evaluate(({ seed, s, v }) => localStorage.setItem('jd.submissions.v2', JSON.stringify({ byVersion: { [v]: { [seed]: s } } })), { v: V, seed: dinfo.seed, s: { score: sub.score, replayHash: sub.entry.replayHash, verifiedAt: sub.entry.verifiedAt, player: 'e2e player' } });
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => { const t = document.querySelector('[data-testid=daily-board]')?.textContent || ''; return /^You: #1 of 1 \(\$\d+\)/.test(t) && /1\. \$\d+ e2e player/.test(t); }, null, { timeout: 15000 });
    assert.match(await page.getByTestId('daily-mode').textContent(), /^minted · ranked · provisional · closes in \d+ (h|min)$/); assert.equal(await page.getByTestId('daily-seed').textContent(), `seed ${dinfo.seed}`);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.daily.v1'))).seed, dinfo.seed, 'the minted seed is cached for the day');
    // streak with grace (PLAN-v3 0.6.3): the title line counts consecutive verified dailies ending today or yesterday; a broken chain just shows the plain count
    const dayBack = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await page.evaluate((ds) => localStorage.setItem('jd.dailystreak.v1', JSON.stringify(ds)), [dayBack(1), dayBack(2), dayBack(4)]);
    await page.reload(); await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    assert.match(await page.getByTestId('today-line').textContent(), / · 1 day played · 2 in a row$/, 'yesterday and the day before: alive through the grace window, the gap before does not count');
    await page.evaluate((ds) => localStorage.setItem('jd.dailystreak.v1', JSON.stringify(ds)), [dayBack(2), dayBack(3)]);
    await page.reload(); await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    assert.match(await page.getByTestId('today-line').textContent(), / · 1 day played$/, 'a chain that ended two days back shows the plain count, no loss copy');
    await page.evaluate(() => localStorage.removeItem('jd.dailystreak.v1'));
    // window, freeze, archive (PLAN-v3 0.6.2): a day two days back closed at 00:00 UTC today: final, a run on it verifies as late and never ranks, the archive lists it
    const twoBack = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const old = await (await fetch(`http://127.0.0.1:${VPORT}/daily?date=${twoBack}`)).json();
    assert.equal(old.final, true); assert.equal(old.frozenAt, old.closesAt);
    const lateRun = newRun(old.seed);
    for (let r = 1; r <= RULES.rounds; r++) { const ci = lateRun.offers.indexOf('crusher'); apply(lateRun, { t: 'pick', i: ci >= 0 ? ci : 0 }); if (r === 1) { const cv = lateRun.layout.machines.find((m) => m.x === 2 && m.y === 2); apply(lateRun, { t: 'unplace', id: cv.id }); apply(lateRun, { t: 'place', id: lateRun.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(lateRun, { t: 'run' }); apply(lateRun, { t: 'next' }); }
    const lsub = await (await fetch(`http://127.0.0.1:${VPORT}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(lateRun), player: 'late player' }) })).json();
    assert.equal(lsub.ok, true); assert.equal(lsub.late, true); assert.equal(lsub.recorded, false); assert.equal(lsub.score, lateRun.score, 'late runs are still re-simulated');
    const arch = await (await fetch(`http://127.0.0.1:${VPORT}/archive`)).json();
    assert.deepEqual(arch.days[0], { ...arch.days[0], date: twoBack, n: 0 }, 'the archive lists the closed day without the late run'); assert.ok(arch.days.every((x) => x.frozenAt && x.n === 0), JSON.stringify(arch.days));
    await page.getByTestId('archive').click();
    await page.waitForFunction((d) => [...document.querySelectorAll('[data-testid=archive-row]')].some((r) => r.dataset.date === d && /final/.test(r.textContent)), twoBack, { timeout: 10000 });
    assert.match(await page.getByTestId('archive-row').first().textContent(), new RegExp(`^${twoBack} · final · 0 verified runs`));
    assert.equal(arch.days[0].medals, null, 'fewer than five runs: no medals on the day');
    assert.equal(await page.locator('[data-testid=archive-medals]').count(), 0, 'the client draws medals only when the server sent thresholds (PLAN-v3 0.6.4)');
    await page.getByTestId('archive-play').first().click();
    await page.waitForFunction((seed) => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.state().seed === seed, old.seed, { timeout: 15000 });
    assert.equal(await page.getByTestId('hud-seed').textContent(), `seed ${old.seed} · archived daily (practice)`);
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:${VPORT}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    assert.match(await page.getByTestId('player').textContent(), /^Player: e2e player#[2-9A-HJKMNP-TV-Z]{4}$/);
    // keep_best_per_player (PLAN-v3 0.6.0): with the page's bearer, a better run on a seed replaces the entry, an equal one is verified but not recorded
    {
      const bearer = { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' };
      const park = [[6, 0], [6, 5]];
      const mk = (extra, twist = false) => { const s = newRun('kb-e2e'); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let k = 0; k < extra; k++) apply(s, { t: 'place', id: s.bin[k].id, x: park[k][0], y: park[k][1], dir: 0 }); if (twist && r === 1) apply(s, { t: 'rotate', id: s.bin[0].id }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
      const post = async (run) => (await fetch(`http://127.0.0.1:${VPORT}/verify`, { method: 'POST', headers: bearer, body: JSON.stringify({ replay: exportReplay(run) }) })).json();
      const first = await post(mk(2)); assert.equal(first.recorded, true); assert.equal(first.player, board.entries[0].player);
      await new Promise((r) => setTimeout(r, 1100)); // the per-player bucket is 2/min in production; the test verifier runs with PLAYER_RATE_LIMIT=100
      const better = await post(mk(0)); assert.equal(better.recorded, true, 'fewer round-6 machines at the same score is better');
      const equal = await post(mk(0, true)); assert.equal(equal.ok, true); assert.equal(equal.recorded, false, 'an equal run is verified but not recorded');
      const kb = await (await fetch(`http://127.0.0.1:${VPORT}/board?seed=kb-e2e`)).json();
      assert.equal(kb.entries.length, 1, 'one entry per player per seed'); assert.equal(kb.entries[0].replayHash, better.entry.replayHash);
    }
    await page.waitForSelector('[data-testid=daily-hist] .jd-hist-bar', { timeout: 10000 });
    assert.ok((await page.locator('[data-testid=daily-hist] .jd-hist-bar').count()) >= 1, 'the daily strip shows a mini histogram once a verified run exists');
    // the title's button plays the minted seed, and the HUD names it (PLAN-v3 0.6.1)
    await page.getByTestId('daily').click();
    await page.waitForFunction((seed) => window.__jdGame.scene.isActive('Game') && !!window.__jd && window.__jd.state().seed === seed, dinfo.seed, { timeout: 15000 });
    assert.equal(await page.getByTestId('hud-seed').textContent(), `seed ${dinfo.seed} · today's challenge`);
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
