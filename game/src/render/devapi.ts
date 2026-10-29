/**
 * Development-only semantic API for automated gameplay tests (Playwright).
 * Exposed as window.__jd only in dev builds or with ?dev=1. It drives the same
 * rule-checked actions a player would; it has no authority over scoring.
 */
import type { Action } from '../sim/run';
import type { GameScene } from './scenes/GameScene';
import { prefs } from './prefs';

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
  };
  (window as unknown as { __jd: DevApi }).__jd = api;
}
