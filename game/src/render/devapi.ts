/**
 * Development-only semantic API for automated gameplay tests (Playwright).
 * Exposed as window.__jd only in dev builds or with ?dev=1. It drives the same
 * rule-checked actions a player would; it has no authority over scoring.
 */
import type { Action } from '../sim/run';
import type { GameScene } from './scenes/GameScene';
import { prefs } from './prefs';
import { telemetry } from './telemetry';
import { audio } from './audio';

export interface DevApi {
  scene: () => string;
  phase: () => string;
  mode: () => string;
  state: () => unknown;
  act: (a: Action) => boolean;
  run: () => void;
  finishRun: () => void;
  next: () => void;
  pick: (i: number) => void;
  hint: () => string;
  /** keyboard cursor: grid cell, visibility, and the id of the machine held in hand (null when empty) */
  cursor: () => { visible: boolean; x: number; y: number; held: number | null };
  prefs: () => { reducedMotion: boolean; textScale: number };
  /** +$ pop pool counters: alive now, peak, skipped (pool full), pool size and cap */
  counters: () => { popsAlive: number; popsPeak: number; popsSkipped: number; poolSize: number; poolMax: number };
  /** build-phase undo / redo (Ctrl+Z / Ctrl+Y); false when nothing could be undone or redone */
  undo: () => boolean;
  redo: () => boolean;
  /** stall indicator: HUD text (empty when none), flagged cell index, current sim tick */
  stall: () => { text: string; cell: number | null; tick: number };
  /** tips panel: open state, the tip suggested by the last draft (unread), read ids, demo progress */
  tips: () => { open: boolean; current: string | null; suggested: string | null; read: string[]; demo: { tip: string | null; tick: number; shipped: Record<string, number> } | null };
  openTips: (id?: string) => void;
  closeTips: () => void;
  /** opt-in funnel: enabled flag, install id presence, queue and send counters */
  telemetry: () => { enabled: boolean; hasInstallId: boolean; queued: number; sent: number; dropped: number; firsts: number; games: number };
  /** synth counters: sounds requested, chords, most sounds in one tick, reduced-audio flag, bus levels */
  audio: () => ReturnType<typeof audio.info>;
  flushTelemetry: () => Promise<boolean>;
}

export const devEnabled = () => import.meta.env.DEV || new URLSearchParams(location.search).get('dev') === '1';

export function installDevApi(scene: GameScene) {
  if (!devEnabled()) return;
  const api: DevApi = {
    scene: () => (scene.scene.isActive('Game') ? 'Game' : scene.scene.manager.getScenes(true)[0]?.scene.key ?? 'unknown'),
    phase: () => scene.run.phase,
    mode: () => scene.mode,
    state: () => ({ seed: scene.run.seed, round: scene.run.round, phase: scene.run.phase, score: scene.run.score, offers: scene.run.offers, bin: scene.run.bin, layout: scene.run.layout, rounds: scene.run.rounds.map((r) => ({ round: r.round, earned: r.earned, shipped: r.result.shipped })), actions: scene.run.actions.length }),
    act: (a) => { const ok = scene.act(a); scene.syncMachines(); scene.renderSide(); return ok; },
    run: () => scene.startRun(),
    finishRun: () => scene.finishRun(),
    next: () => scene.nextRound(),
    pick: (i) => scene.pick(i),
    hint: () => scene.hintText(),
    cursor: () => scene.cursorInfo(),
    prefs: () => ({ reducedMotion: prefs.reducedMotion, textScale: prefs.textScale }),
    counters: () => scene.popCounters(),
    undo: () => scene.undo(),
    redo: () => scene.redo(),
    stall: () => scene.stallInfo(),
    tips: () => scene.tipsInfo(),
    openTips: (id) => scene.openTips(id),
    closeTips: () => scene.closeTips(),
    telemetry: () => telemetry.stats(),
    audio: () => audio.info(),
    flushTelemetry: () => telemetry.flush(),
  };
  (window as unknown as { __jd: DevApi }).__jd = api;
}
