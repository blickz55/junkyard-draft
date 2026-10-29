/** Results screen as DOM (DOSSIER-v1 0.4.0): score, round bars, what shipped, the local verified board, submission and sharing. */
import type Phaser from 'phaser';
import { h, btn, ui, textureImg, promptText, showText } from './dom';
import type { RunState } from '../sim/run';
import { encodeReplay, exportReplay } from '../sim/replay';
import { RULES } from '../sim/rules';
import { dailySeed, daysPlayed, loadBests, loadPlayer, loadSubmissions, randomSeed, recordSubmission, savePlayer, recordDailyDate, currentStreak } from '../render/storage';
import { isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { telemetry } from '../render/telemetry';
import { shareText, type Rank } from '../render/share';
import { badgesFor } from '../sim/badges';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { audio } from '../render/audio';
import { authHeaders, bearerAllowed, claimName, loadIdentity } from '../render/identity';
import { labelFor } from '../identity/identity';
import { todaySeed, revealGate } from '../render/daily';
import { medalFor, medalsLine, type Medals } from '../daily/medals';
import { openPolicy } from './PolicyPanel';
import { challengeLink, challengeOutcome, type Challenge } from '../render/challenge';
import { groupHeaders, groupParam, loadGroup } from '../render/groups';
import { forkLabelOf } from '../sim/fork';
import type { CardInput } from '../render/card';
import { loadForkBests } from '../render/storage';

/** What the scene keeps so tests and later screens can read it. */
export interface ResultsHost extends Phaser.Scene { lastRank: Rank | null; lastPlayer: string; lastShareText: string; lastPercentile: number | null; lastN: number; lastMedal: string | null; cardInput: (() => CardInput) | null; exportCard(): Promise<{ size: number; width: number; height: number; filename: string; savedTo: string; footer: string }>; verifiedHash: string | null; matchesStoredSubmission(): Promise<boolean>; exportClip(round?: number, onProgress?: (f: number) => void): Promise<{ filename: string; savedTo: string; size: number; ms: number }>; exportGif(round?: number, onProgress?: (f: number) => void): Promise<{ filename: string; savedTo: string; size: number; ms: number; frames: number }> }

export function mountResults(scene: ResultsHost, run: RunState, o: { replayed: boolean; replayLabel?: string; newOverall: boolean; newSeed: boolean; challenge?: Challenge; replayHash?: string; replayPlayer?: string; newFork?: boolean }) {
  const fork = run.forkedFrom ?? null; // PLAN-v4 0.7.3
  const bests = loadBests();
  const go = (seed: string) => { audio.unlock(); scene.scene.start('Game', { seed, fresh: true, challenge: o.challenge && o.challenge.seed === seed ? o.challenge : undefined }); }; // a retry keeps the challenge; another seed drops it (PLAN-v4 0.7.1)
  const verifierUrl = new URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL;

  const header = h('div', { style: 'text-align:center' },
    h('div', { class: 'jd-head' }, 'Run complete'),
    h('div', { class: 'jd-gold jd-pop', tid: 'score', style: 'font-size:4.25em; font-weight:700; line-height:1.05' }, `$${run.score}`),
    h('div', { class: `jd-mono ${o.replayed ? 'jd-blue' : 'jd-dim'}`, tid: 'results-subtitle', style: 'font-size:0.8125em; margin-top:0.25em; overflow-wrap:anywhere' }, `seed ${run.seed} · rules v${run.rulesVersion}${o.replayed ? ` · ${o.replayLabel ?? 'replay playback'} (not recorded as a best)` : ''}${fork ? ` · ${forkLabelOf(fork)} (never submitted, not your own best)` : ''}`),
    fork ? h('div', { class: o.newFork ? 'jd-green' : 'jd-dim', tid: 'fork-best', style: 'margin-top:0.25em; font-size:0.875em' }, o.newFork ? `New fork best for this seed: $${run.score}` : `Fork best for this seed: $${loadForkBests()[run.seed]?.score ?? run.score}`)
    : o.newOverall ? h('div', { class: 'jd-green', style: 'font-weight:700; letter-spacing:0.1em; margin-top:0.25em' }, 'NEW LOCAL PERSONAL BEST')
      : o.newSeed ? h('div', { class: 'jd-green', style: 'margin-top:0.25em' }, 'New local best for this seed')
        : h('div', { class: 'jd-dim', style: 'font-size:0.875em; margin-top:0.25em' }, bests.overall ? `Local best: $${bests.overall.score} (${bests.overall.seed})` : ''),
    o.challenge && !o.replayed ? h('div', { class: 'jd-mono jd-amber', tid: 'challenge-result', style: 'font-size:0.8125em; margin-top:0.3em' }, `Challenge · you $${run.score} · ${o.challenge.player} $${o.challenge.score} · ${challengeOutcome(run.score, o.challenge).text}`) : null);

  // non-ranked badges (PLAN-v1 0.4.6): recognition, never a ladder; Minimalist needs the bot par, so the row is refreshed when the par lands
  let botPar: number | null = null;
  const badgeRow = h('div', { class: 'jd-row jd-center', tid: 'badges', style: 'gap:0.5em; margin-top:0.3em; min-height:1.6em' });
  const renderBadges = () => {
    const earned = badgesFor(run, botPar);
    badgeRow.replaceChildren(...earned.map((b) => h('span', { class: 'jd-badge-pill', tid: `badge-${b.id}`, title: b.text }, b.title)));
    if (earned.length) badgeRow.append(h('span', { class: 'jd-dim', style: 'font-size:0.6875em' }, 'badges · not ranked'));
  };
  renderBadges();
  header.append(badgeRow);
  const max = Math.max(1, ...run.rounds.map((r) => r.earned));
  const rounds = h('div', { class: 'jd-panel' }, h('div', { class: 'jd-head' }, 'Round by round'),
    ...run.rounds.map((r, i) => h('div', { class: 'jd-row', style: 'margin-top:0.4em; flex-wrap:nowrap' },
      h('span', { class: 'jd-dim', style: 'width:5em; font-size:0.875em' }, `Round ${r.round}`),
      h('div', { style: 'flex:1' }, h('div', { class: `jd-bar${i === run.rounds.length - 1 ? ' jd-bar-last' : ''}`, style: `width:${Math.round((100 * r.earned) / max)}%` })),
      h('span', { style: 'width:4em; text-align:right; font-weight:700; font-size:0.875em' }, `$${r.earned}`))));

  const shipped = run.rounds.reduce((acc, r) => { for (const k of Object.keys(r.result.shipped) as (keyof typeof r.result.shipped)[]) acc[k] = (acc[k] || 0) + r.result.shipped[k]; return acc; }, {} as Record<string, number>);
  const shippedPanel = h('div', { class: 'jd-panel' }, h('div', { class: 'jd-head' }, 'What shipped'));
  for (const m of ['ingot', 'plate', 'shards', 'scrap', 'slag'] as const) if (shipped[m]) shippedPanel.append(h('div', { class: 'jd-row', style: 'margin-top:0.35em; gap:0.5em; font-size:0.875em' }, textureImg(scene.game, `i-${m}`, m), `${shipped[m]} × ${m} ($${RULES.value[m]} each) = $${shipped[m] * RULES.value[m]}`));
  if (run.sold) shippedPanel.append(h('div', { style: 'margin-top:0.35em; font-size:0.875em' }, `Sold unused parts = $${run.sold}`));
  if (run.rerolls) shippedPanel.append(h('div', { style: 'margin-top:0.35em; font-size:0.875em', tid: 'rerolls-line' }, `Rerolls: ${run.rerolls} × −$${RULES.rerollCost} = −$${run.rerolls * RULES.rerollCost}`)); // score = production + sales − rerolls
  shippedPanel.append(h('div', { class: 'jd-dim', style: 'margin-top:0.5em; font-size:0.8125em' }, `Drafted: ${run.picks.map((p) => p.replace(/^./, (c) => c.toUpperCase())).join(', ')}`));
  shippedPanel.append(h('div', { class: 'jd-dim', style: 'margin-top:0.35em; font-size:0.75em' }, 'Scores are local and unverified until a verifier re-simulates the replay.'));

  const histBox = h('div', { tid: 'histogram' });
  const entriesBox = h('div', { class: 'jd-entries' });
  const boardPanel = h('div', { class: 'jd-panel', tid: 'board' }, h('div', { class: 'jd-head', tid: 'board-head' }, `Local verified board · this seed${loadGroup() ? ` · group ${loadGroup()!.name}` : ''}`), h('div', { class: 'jd-grid2', style: 'gap:1.25em; align-items:start' }, histBox, entriesBox));
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'status', style: 'font-size:0.75em; min-height:1.3em' });
  const setStatus = (text: string, cls = 'jd-dim') => { status.textContent = text; status.className = `jd-mono ${cls}`; };

  /** Histogram-first (PLAN-v1 0.4.1): where this run sits among real verified runs; with fewer than five, the entries that exist and never an invented population. */
  let histGen = 0;
  const loadHistogram = async (attempt = 0) => {
    const gen = ++histGen; // a response for an older request or a replaced screen is ignored (review F11)
    histBox.replaceChildren();
    try {
      // standing is shown only for THIS run's replay: a submission made on this screen, or a stored one with the same identity
      if (!scene.verifiedHash && (await scene.matchesStoredSubmission())) scene.verifiedHash = loadSubmissions()[run.seed]?.replayHash ?? null;
      const mine = scene.verifiedHash ?? undefined;
      const prior = !mine ? loadSubmissions()[run.seed] : undefined;
      const hres = await fetch(`${verifierUrl}/histogram?seed=${encodeURIComponent(run.seed)}${mine ? `&hash=${encodeURIComponent(mine)}` : ''}${groupParam(verifierUrl)}`, { headers: groupHeaders(verifierUrl) });
      const hg = await hres.json() as { n: number; step: number; bins: { from: number; to: number; count: number }[]; mine: { score: number; rank: number; bin: number; percentile: number } | null; around: { rank: number; player: string; score: number; mine: boolean }[]; botPar?: number | null; medals?: Medals | null };
      if (gen !== histGen || !histBox.isConnected) return;
      // the par is computed off the request path by the verifier the first time a seed is seen: poll a few times while it is pending
      if (hg.botPar == null && attempt < 6) setTimeout(() => { if (histBox.isConnected) void loadHistogram(attempt + 1); }, 4000);
      const parLine = hg.botPar != null ? h('div', { class: 'jd-mono jd-dim', tid: 'bot-par', style: 'font-size:0.75em; margin-top:0.3em' }, `Bot par $${hg.botPar} · the shipped autoplayer's median on this seed (a target, never ranked)${run.score > hg.botPar ? ' — you beat it' : run.score === hg.botPar ? ' — matched' : ''}`) : null;
      if (hg.mine) { scene.lastPercentile = hg.mine.percentile; scene.lastN = hg.n; }
      if (hg.botPar != null && hg.botPar !== botPar) { botPar = hg.botPar; renderBadges(); }
      if (!hg.n) { if (parLine) histBox.append(parLine); return; }
      const max = Math.max(1, ...hg.bins.map((b) => b.count));
      histBox.append(h('div', { class: 'jd-hist', role: 'img', ariaLabel: `distribution of ${hg.n} verified scores` }, ...hg.bins.map((b, i) => h('div', { class: `jd-hist-bin${hg.mine && hg.mine.bin === i ? ' jd-hist-mine' : ''}`, tid: `hist-bin-${i}`, title: `$${b.from}–$${b.to}: ${b.count}` }, h('div', { class: 'jd-hist-count' }, b.count ? String(b.count) : ''), h('div', { class: 'jd-hist-bar', style: `height:${Math.max(2, Math.round((100 * b.count) / max))}%` })))));
      histBox.append(h('div', { class: 'jd-hist-axis' }, h('span', {}, '$0'), h('span', {}, `$${hg.bins[hg.bins.length - 1].to}`)));
      const pct = hg.mine ? (hg.n >= 5 ? `Better than ${hg.mine.percentile} % of ${hg.n} verified runs · #${hg.mine.rank}` : `${hg.n} verified run${hg.n === 1 ? '' : 's'} so far · you are #${hg.mine.rank}`) : `${hg.n} verified run${hg.n === 1 ? '' : 's'} on this seed`;
      histBox.append(h('div', { class: hg.mine ? 'jd-amber' : 'jd-dim', tid: 'percentile', style: 'font-size:0.8125em; margin-top:0.3em; font-weight:700' }, pct));
      if (parLine) histBox.append(parLine);
      if (hg.medals) { // a frozen daily: the server sent thresholds (PLAN-v3 0.6.4); the medal is named only for this run's verified entry
        const medal = hg.mine ? medalFor(hg.mine.score, hg.medals) : null; scene.lastMedal = medal;
        histBox.append(h('div', { class: 'jd-mono jd-amber', tid: 'medals', style: 'font-size:0.75em; margin-top:0.3em' }, `Final board medals: ${medalsLine(hg.medals)}${hg.mine ? ` · yours: ${medal ?? 'none'}` : ''}`));
      }
      if (hg.mine && hg.around.length > 1) histBox.append(h('div', { class: 'jd-around', tid: 'around' }, ...hg.around.map((a) => h('div', { class: a.mine ? 'jd-mine' : '' }, `#${a.rank}  $${a.score}  ${a.mine ? 'you' : a.player}`))));
      if (prior) histBox.append(h('div', { class: 'jd-mono jd-dim', tid: 'prior-best', style: 'font-size:0.7em; margin-top:0.3em' }, `This device's verified run on this seed: $${prior.score} (a different attempt; this run is unverified until submitted)`));
    } catch { /* histogram is decoration over the board; the status line already says whether the verifier is reachable */ }
  };
  const loadBoard = async (keepStatus = false) => {
    entriesBox.replaceChildren();
    void loadHistogram();
    try {
      const res = await fetch(`${verifierUrl}/board?seed=${encodeURIComponent(run.seed)}&limit=5${groupParam(verifierUrl)}`, { headers: groupHeaders(verifierUrl) });
      const body = await res.json() as { entries: { player: string; score: number; verifiedAt: string; replayHash: string; replayAvailable?: boolean; finalMachines?: number }[]; tieBreak?: string };
      if (!body.entries.length) entriesBox.append(h('div', { class: 'jd-mono jd-dim jd-board-note', style: 'font-size:0.75em' }, 'no verified scores yet'));
      const gate = revealGate(run.seed); // PLAN-v3 0.6.6: on an open daily, replays open up once this device has submitted (loadBoard runs again after a submission)
      body.entries.forEach((e, i) => {
        const entry = h('button', { class: 'jd-entry', tid: `board-entry-${i}`, type: 'button', disabled: !e.replayAvailable || !!gate, title: gate ?? (e.replayAvailable ? 'watch this verified replay' : undefined),
          onClick: () => { setStatus(`Fetching and re-verifying ${e.player}'s replay…`); fetchVerifiedReplay(verifierUrl, e.replayHash, run.seed).then((r) => playVerifiedReplay(scene, r)).catch((err: Error) => setStatus(err.message, 'jd-red')); } },
          `${i + 1}. $${e.score}  ${e.player}${e.replayAvailable ? '  ▶' : ''}`);
        const dare = btn('Challenge', `challenge-${i}`, () => copyWith(dare, 'Challenge', challengeLink(e.replayHash), `Challenge link (plays ${run.seed} against ${e.player}'s $${e.score}):`), { small: true, title: `copy a link that plays this seed against ${e.player}'s run (earnings only, no layout)` });
        dare.style.cssText += 'padding:0 0.4em; font-size:0.65em; line-height:1.3; min-height:0; margin-left:0.4em';
        entriesBox.append(h('div', { class: 'jd-board-note jd-row', style: 'gap:0; flex-wrap:nowrap' }, entry, dare));
      });
      if (body.entries.some((e) => e.replayAvailable)) entriesBox.append(h('div', { class: 'jd-mono jd-dim jd-board-note', tid: gate ? 'reveal-note' : undefined, style: 'font-size:0.7em; margin-top:0.3em' }, gate ? `Replays: ${gate}.` : 'click an entry to watch its verified replay'));
      entriesBox.append(h('div', { class: 'jd-mono jd-dim jd-board-note', tid: 'tie-rule', style: 'font-size:0.7em; margin-top:0.3em' }, body.tieBreak ?? 'Equal scores: fewer machines in round 6 first, then the earlier verified submission.'));
      if (!keepStatus) setStatus(`Local verifier online at ${verifierUrl}. Scores on this board were re-simulated, not trusted from the client.`);
    } catch { if (!keepStatus) setStatus('No local verifier running (optional: npm run verifier). Local bests are unverified.'); }
  };

  /** The display name for the board: the saved one, or a dialog on the first submission; null when the player cancels. */
  const ensurePlayer = async (): Promise<string | null> => {
    const id = loadIdentity();
    if (id.name && id.tag) return labelFor(id.name, id.tag); // claimed: the verifier stamps the same label from the bearer
    let player = loadPlayer();
    if (!player) {
      const typed = await promptText(scene, 'Name for the verified board', 'Shown publicly next to your score as Name#tag (max 32 characters; empty = anonymous):', 'player', 32);
      if (typed === null) return null;
      player = typed.trim() ? typed.trim().slice(0, 32) : 'anonymous';
      if (player !== 'anonymous') savePlayer(player);
    }
    // PLAN-v3 0.6.0: the local name migrates into the first claim; offline or refused, the submission still goes out with the plain name
    if (player !== 'anonymous' && bearerAllowed(verifierUrl)) { const c = await claimName(verifierUrl, player); if (c && 'name' in c) return labelFor(c.name, c.tag); }
    return player;
  };
  const rankOf = async (replayHash: string): Promise<Rank> => {
    const res = await fetch(`${verifierUrl}/board?seed=${encodeURIComponent(run.seed)}&limit=100${groupParam(verifierUrl)}`, { headers: groupHeaders(verifierUrl) });
    const body = await res.json() as { entries: { replayHash: string }[] };
    const i = body.entries.findIndex((e) => e.replayHash === replayHash);
    return { n: i >= 0 ? i + 1 : null, of: body.entries.length };
  };
  const submitBtn = btn('Submit to local verifier', 'submit', async () => {
    submitBtn.disabled = true;
    let verified = false;
    try {
      const player = await ensurePlayer();
      if (player === null) { setStatus('Submission cancelled.'); return; }
      setStatus('Submitting replay to the local verifier…');
      let body: { ok: boolean; score?: number; error?: string; entry?: { replayHash: string; verifiedAt: string; score?: number }; recorded?: boolean; player?: string; late?: boolean; closesAt?: string };
      try {
        const res = await fetch(`${verifierUrl}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) }, body: JSON.stringify({ replay: exportReplay(run, import.meta.env.BUILD), player }) });
        body = await res.json() as typeof body;
        if (res.status === 503 || res.status === 429) { telemetry.track('daily_submit_result', { result: 'busy' }); setStatus(`Verifier busy (${body.error || res.status}); nothing was recorded. Try again in a moment.`); return; }
      } catch { setStatus(`Verifier unreachable at ${verifierUrl} (start it with: npm run verifier). Score stays local/unverified.`); return; }
      if (body.ok && body.late) { // PLAN-v3 0.6.2: the day closed; the run was re-simulated and is real, the final board does not move
        telemetry.track('daily_submit_result', { result: 'late' });
        setStatus(`Verified by re-simulation: $${body.score} — too late for the ranked board: this daily closed at ${body.closesAt ? body.closesAt.replace('T', ' ').slice(0, 16) + ' UTC' : 'its deadline'}. Not recorded.`, 'jd-amber');
        return;
      }
      if (!body.ok || !body.entry) { telemetry.track('daily_submit_result', { result: 'rejected' }); setStatus(`Verifier response: ${body.error || 'rejected'}`, 'jd-red'); return; }
      verified = true;
    telemetry.track('daily_submit_result', { result: 'verified' });
    if (isMintedDailySeed(run.seed)) { const dd = dailyDateOf(run.seed); if (dd) recordDailyDate(dd); } // PLAN-v3 0.6.3: a verified daily (recorded or keep-best) counts for the streak by the daily's date; late ones returned above
    const label = body.player || player;
    scene.lastPlayer = label;
    if (body.recorded === false) { // keep-best (PLAN-v3 0.6.0): verified, but an earlier run of this player on this seed ranks at least as well
      setStatus(`Verified by re-simulation: $${body.score} — not recorded: your earlier $${body.entry.score ?? '?'} on this seed ranks at least as well (one best entry per player per seed).`, 'jd-amber');
      try { await loadBoard(true); } catch { /* decoration */ }
      return;
    }
    recordSubmission(run.seed, { score: body.score ?? run.score, replayHash: body.entry.replayHash, verifiedAt: body.entry.verifiedAt, player: label });
    scene.verifiedHash = body.entry.replayHash; // this run, this replay: exports and standing may now say verified
    challengeBtn.disabled = false; // the verified entry can now be challenged (PLAN-v4 0.7.1)
    try {
      scene.lastRank = await rankOf(body.entry.replayHash);
      const r = scene.lastRank;
      setStatus(`Verified by re-simulation: $${body.score} — ${r.n != null ? `#${r.n} of ${r.of}` : `beyond the top ${r.of}`} on the local verified board as ${label}.`, 'jd-green');
    } catch { setStatus(`Verified by re-simulation: $${body.score} as ${label} — recorded on the local verified board (rank unavailable right now).`, 'jd-green'); }
    try { await loadBoard(true); } catch { /* the board list is decoration; the status line already says what happened */ }
    } finally { if (!verified) submitBtn.disabled = false; } // a cancelled, busy, unreachable or rejected attempt leaves the control usable (review F04)
  }, { disabled: o.replayed, small: true });

  const copyWith = (b: HTMLButtonElement, label: string, text: string, title: string) => {
    const done = () => { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = label; }, 1500); };
    const fallback = () => { void showText(scene, title, text); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  };
  // share (PLAN-v1 0.4.3): spoiler-free glyph grid by default, per-round dollars in the detailed variant, link only on request
  const linkToggle = h('input', { type: 'checkbox', tid: 'share-link', ariaLabel: 'append a link to this seed' });
  const permalink = () => (linkToggle.checked ? `${location.origin}${location.pathname}?scene=game&seed=${encodeURIComponent(run.seed)}` : undefined);
  const buildShare = (variant: 'grid' | 'detailed') => shareText({ seed: run.seed, score: run.score, rulesVersion: run.rulesVersion, rounds: run.rounds.map((r) => r.earned), player: scene.lastPlayer || undefined, rank: scene.lastRank, percentile: scene.lastPercentile, n: scene.lastN, daysPlayed: daysPlayed(), streak: currentStreak(), medal: scene.lastMedal ?? undefined, fork: fork ? { player: fork.player, round: fork.round } : undefined, challenge: o.challenge && !o.replayed ? { player: o.challenge.player, score: o.challenge.score } : undefined, permalink: permalink(), variant, rerolls: run.rerolls, badges: badgesFor(run, botPar).map((b) => b.title) });
  scene.cardInput = () => ({ seed: run.seed, score: run.score, rounds: run.rounds.map((r) => r.earned), rulesVersion: run.rulesVersion, player: scene.lastPlayer || undefined, verified: !!scene.verifiedHash, rank: scene.lastRank, percentile: scene.lastPercentile, n: scene.lastN, medal: scene.lastMedal, group: loadGroup(), challenge: o.challenge && !o.replayed ? { player: o.challenge.player, score: o.challenge.score } : null, fork: fork ? { player: fork.player, round: fork.round } : null, permalink: permalink(), build: import.meta.env.BUILD }); // PLAN-v4 0.7.4
  const cardBtn = btn('Share card', 'share-card', async () => {
    cardBtn.disabled = true;
    try { const c = await scene.exportCard(); setStatus(`Share card saved: ${c.savedTo} (${c.width}×${c.height}, ${Math.round(c.size / 1024)} KB) · ${c.footer}`, 'jd-green'); }
    catch (e) { setStatus((e as Error).message, 'jd-red'); }
    finally { cardBtn.disabled = false; }
  }, { small: true, title: 'a 1200×630 picture of this run: seed, score, the six rounds, and only the standing this run actually has (verified, local, fork); rendered here, never uploaded' });
  const shareBtn = btn('Copy share text', 'share', () => {
    const text = buildShare('grid'); scene.lastShareText = text;
    telemetry.track('share_copied', { variant: 'grid' });
    copyWith(shareBtn, 'Copy share text', text, 'Share text:');
  }, { small: true, title: 'label, score, six glyphs for the rounds, your verified standing; no URL unless ticked' });
  const detailedBtn = btn('Copy detailed', 'share-detailed', () => {
    const text = buildShare('detailed'); scene.lastShareText = text;
    telemetry.track('share_copied', { variant: 'detailed' });
    copyWith(detailedBtn, 'Copy detailed', text, 'Detailed share text:');
  }, { small: true, title: 'adds the per-round earnings and the rules version' });
  const shareLinkLabel = h('label', { class: 'jd-dim', style: 'font-size:0.75em; display:inline-flex; align-items:center; gap:0.3em' }, linkToggle, 'add link');
  const challengeBtn = btn('Challenge link', 'challenge-link', () => { if (scene.verifiedHash) copyWith(challengeBtn, 'Challenge link', challengeLink(scene.verifiedHash), 'Challenge link (anyone who opens it plays this seed against your run):'); }, { small: true, disabled: !scene.verifiedHash, title: 'a link that plays this seed with your verified run\'s earnings overlaid (after a verified submission)' });
  const exportBtn = btn('Copy replay JSON', 'export', () => copyWith(exportBtn, 'Copy replay JSON', encodeReplay(exportReplay(run, import.meta.env.BUILD)), 'Copy replay JSON:'), { small: true });
  const best = run.rounds.reduce((b, r) => (r.earned > b.earned ? r : b), run.rounds[0]);
  const clipBtn = btn(`Export clip (round ${best?.round ?? 1})`, 'export-clip', async () => {
    clipBtn.disabled = true; const label = clipBtn.textContent ?? '';
    setStatus('Recording a loop of your best round at 4× — about 7 seconds…');
    try {
      const c = await scene.exportClip(undefined, (f) => { clipBtn.textContent = `Recording… ${Math.round(f * 100)} %`; });
      setStatus(`Clip saved: ${c.savedTo} (${Math.round(c.size / 1024)} KB, ${(c.ms / 1000).toFixed(1)} s). Share it anywhere; it loops.`, 'jd-green');
    } catch (e) { setStatus((e as Error).message, 'jd-red'); }
    finally { clipBtn.textContent = label; clipBtn.disabled = false; }
  }, { small: true, title: 'a short looping video of the round, drawn from the real simulation; always full motion' });
  const gifBtn = btn('Save GIF', 'export-gif', async () => {
    gifBtn.disabled = true; const label = gifBtn.textContent ?? '';
    setStatus('Drawing a looping GIF of your best round…');
    try {
      const g = await scene.exportGif(undefined, (f) => { gifBtn.textContent = `GIF… ${Math.round(f * 100)} %`; });
      setStatus(`GIF saved: ${g.savedTo} (${Math.round(g.size / 1024)} KB, ${g.frames} frames, ${(g.ms / 1000).toFixed(1)} s loop). Posts anywhere a video will not autoplay.`, 'jd-green');
    } catch (e) { setStatus((e as Error).message, 'jd-red'); }
    finally { gifBtn.textContent = label; gifBtn.disabled = false; }
  }, { small: true, title: 'the same round as a looping GIF (1×, 10 fps); larger than the video, plays everywhere' });
  const downloadBtn = btn('Download replay', 'download', () => {
    const text = encodeReplay(exportReplay(run, import.meta.env.BUILD));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = `junkyard-draft-${run.seed}-${run.score}.replay.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, { small: true });

  const screen = h('div', { class: 'jd-results' },
    header,
    h('div', { class: 'jd-grid2', style: 'margin-top:0.5em' }, rounds, shippedPanel),
    boardPanel,
    o.replayed && run.rounds.length === RULES.rounds ? h('div', { class: 'jd-row jd-center', tid: 'fork-row', style: 'margin-top:0.25em; gap:0.4em' }, h('span', { class: 'jd-mono jd-dim', style: 'font-size:0.75em' }, 'Continue as practice from after round'), ...Array.from({ length: RULES.rounds - 1 }, (_, i) => btn(String(i + 1), `fork-${i + 1}`, () => { audio.unlock(); scene.scene.start('Game', { seed: run.seed, fresh: false, fork: { origin: { hash: o.replayHash ?? null, player: o.replayPlayer ?? (o.replayLabel?.replace(/^verified replay by /, '') ?? 'replay') }, actions: run.actions, round: i + 1 } }); }, { small: true, title: `take over this run's layout and bin after round ${i + 1}; a fork is labelled, never submitted and never your own best` }))) : null,
    h('div', { class: 'jd-row jd-center', style: 'margin-top:0.25em' },
      btn('Retry this seed', 'retry', () => go(run.seed), { variant: 'primary' }),
      btn('New random seed', 'newseed', () => go(randomSeed()), { variant: 'steel' }),
      btn("Today's challenge", 'daily', () => go(todaySeed()), { variant: 'steel' })),
    h('div', { class: 'jd-row jd-center' }, fork ? null : submitBtn, shareBtn, detailedBtn, shareLinkLabel, cardBtn, fork ? null : challengeBtn, clipBtn, gifBtn, fork ? null : exportBtn, fork ? null : downloadBtn, btn('Policy', 'policy', () => openPolicy(scene), { small: true, title: 'fairness and verification policy' }), btn('Title screen', 'title', () => scene.scene.start('Title'), { small: true })),
    status);
  ui.mount(scene, screen, (e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) go(run.seed); });
  void loadBoard();
}
