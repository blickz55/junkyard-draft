/**
 * Round / playback controller (review follow-up, 2026-10-29): owns the authoritative RunState, the mode machine
 * (build → running → paused → summary → build …), the simulation pacing, undo/redo and replay playback.
 * Pure TypeScript with no Phaser or storage imports, so the phase transitions are unit-tested in Node
 * (tests/controller.test.ts); the GameScene renders what this reports through the hooks and never changes
 * the layout except through act(). The one invariant the 0.2.0 review found broken lives here: once a round
 * starts, nothing edits the layout until the next build phase.
 */
import { apply, newRun, replay as replayRun, RunError, type Action, type RoundRecord, type RunState } from '../sim/run';
import { t } from '../content/strings';
import { createSim, step, type SimState } from '../sim/sim';
import { RULES } from '../sim/rules';
import { RULES_VERSION, type SimEvent } from '../sim/types';
import { canUndo, undo as undoEdit } from '../sim/undo';

export type Mode = 'build' | 'running' | 'paused' | 'summary';

export interface ControllerInit { seed: string; fresh: boolean; replay?: Action[]; actions?: Action[]; replayLabel?: string }

export interface ControllerHooks {
  /** a tick of the live simulation was stepped (render its events) */
  onTick?(evs: SimEvent[], sim: SimState): void;
  /** a round just started (freeze visuals, reset per-round indicators) */
  onRunStart?(): void;
  /** paused (true) or resumed (false) */
  onPause?(paused: boolean): void;
  /** the round is over and recorded; visualEarned is what the rendered sim showed (equal to rec.earned unless the renderer diverged) */
  onRoundEnd?(rec: RoundRecord, visualEarned: number): void;
  /** the next build phase began (or the run is finished: see onFinished) */
  onNextRound?(): void;
  /** every round is done: hand the run to the results screen */
  onFinished?(): void;
  /** the run state changed by an accepted action (a) or by undo/redo/speed (null): refresh HUD, panel, hints */
  onStateChange?(a: Action | null): void;
  /** the rules refused an action the player attempted */
  onReject?(a: Action, message: string): void;
  /** the playback queue ran out (watched replay fully applied) */
  onPlaybackDone?(): void;
  /** store the player's own run (never called during playback) */
  persist?(seed: string, actions: Action[]): void;
  /** run fn after ms (replay pacing); the default runs it synchronously */
  schedule?(ms: number, fn: () => void): void;
}

/** Layout edits are only legal while building; once a round starts the authoritative layout is frozen. */
const LAYOUT_EDITS: ReadonlySet<Action['t']> = new Set<Action['t']>(['place', 'unplace', 'rotate', 'sell', 'pick']);

export class RoundController {
  run: RunState;
  mode: Mode = 'build';
  sim: SimState | null = null;
  /** simulation pacing: wall-clock ms accumulated toward the next tick, ms per tick, speed multiplier */
  acc = 0;
  readonly tickMs = 170;
  speed = 1;
  /** watched replay: label shown in the HUD, the actions still to apply, per-round earnings of the original run */
  readonly replayLabel: string | null;
  replayQueue: Action[] | null;
  readonly replayRounds: number[] | null;
  /** set when a saved run could not be resumed (the UI shows it once) */
  resumeNotice: string | null = null;
  private redoStack: Action[] = [];
  private redoing = false;

  constructor(data: ControllerInit, private readonly hooks: ControllerHooks = {}) {
    this.replayLabel = data.replay ? data.replayLabel ?? 'replay playback' : null;
    let rounds: number[] | null = null;
    if (data.replay) { try { rounds = replayRun(data.seed, data.replay, RULES_VERSION).rounds.map((r) => r.earned); } catch { rounds = null; } }
    this.replayRounds = rounds;
    this.run = newRun(data.seed);
    if (!data.fresh && data.actions) {
      try { this.run = replayRun(data.seed, data.actions, RULES_VERSION); }
      catch (e) {
        // a damaged save must not silently start over: say so (the scene drops the save so the title stops offering it)
        this.run = newRun(data.seed);
        this.resumeNotice = t('hint.resumeFailed', { error: (e as Error).message });
      }
    }
    this.replayQueue = data.replay ? data.replay.slice() : null;
    if (this.run.phase === 'result') this.mode = 'summary';
  }

  /** True while watching someone else's run: nothing is saved, recorded or submitted. */
  get isPlayback(): boolean { return this.replayLabel != null; }
  /** True while a watched replay still has actions to apply (input is ignored meanwhile). */
  get playbackPending(): boolean { return this.replayQueue != null; }

  /** bumped when playback stops: a callback scheduled by an earlier playback must not act on the new state (review F09) */
  private generation = 0;
  private schedule(ms: number, fn: () => void) { const g = this.generation; const run = () => { if (g === this.generation) fn(); }; if (this.hooks.schedule) this.hooks.schedule(ms, run); else run(); }
  private persist() { if (!this.isPlayback) this.hooks.persist?.(this.run.seed, this.run.actions); }

  // ---------- actions ----------
  /** Apply an action to the run; false (state unchanged) if the rules reject it or the layout is frozen. */
  act(a: Action): boolean {
    if (LAYOUT_EDITS.has(a.t) && this.mode !== 'build') return false; // frozen: a drop, key or dev-API call during a run changes nothing
    try { apply(this.run, a); } catch (e) { if (e instanceof RunError) { this.hooks.onReject?.(a, e.message); return false; } throw e; }
    if (!this.redoing) this.redoStack.length = 0; // a new edit forks history: stale redos are dropped
    this.persist();
    this.hooks.onStateChange?.(a);
    return true;
  }
  pick(i: number): boolean { return this.run.phase === 'draft' && this.act({ t: 'pick', i }); }

  // ---------- undo / redo (build phase only; the replay stays a flat list of final actions) ----------
  canUndo(): boolean { return this.mode === 'build' && !this.playbackPending && canUndo(this.run); }
  canRedo(): boolean { return this.mode === 'build' && !this.playbackPending && this.redoStack.length > 0; }
  /** Remove the last layout edit of this build phase (never across a run); false when there is nothing to undo. */
  undo(): boolean {
    if (!this.canUndo()) return false;
    const u = undoEdit(this.run); if (!u) return false;
    this.run = u.state; this.redoStack.push(u.undone);
    this.persist();
    this.hooks.onStateChange?.(null);
    return true;
  }
  /** Re-apply the last undone edit if the rules still accept it; a stale redo is dropped. */
  redo(): boolean {
    if (!this.canRedo()) return false;
    const a = this.redoStack.pop()!;
    this.redoing = true; const ok = this.act(a); this.redoing = false;
    if (!ok) { this.redoStack.length = 0; return false; }
    this.hooks.onStateChange?.(null);
    return true;
  }

  // ---------- phases ----------
  canStartRun(): boolean { return this.mode === 'build' && this.run.phase === 'build'; }
  /** Freeze the layout and start the live simulation. */
  startRun(byPlayback = false): boolean {
    if (this.replayQueue && !byPlayback) return false; // while watching, only the replay advances the phase (review F09)
    if (!this.canStartRun()) return false;
    const layout = { width: this.run.layout.width, height: this.run.layout.height, machines: this.run.layout.machines.map((m) => ({ ...m })) };
    this.sim = createSim(layout);
    this.acc = 0; this.mode = 'running';
    this.hooks.onRunStart?.();
    return true;
  }
  setPaused(p: boolean): boolean {
    if (p && this.mode === 'running') { this.mode = 'paused'; this.hooks.onPause?.(true); return true; }
    if (!p && this.mode === 'paused') { this.mode = 'running'; this.hooks.onPause?.(false); return true; }
    return false;
  }
  setSpeed(s: number) { this.speed = s; this.hooks.onStateChange?.(null); }
  /**
   * Single step (production roadmap 0.8.12): while paused, in play and in replay playback alike, advance exactly one tick and
   * report it like any other; the round ends normally when the tick limit is reached. Watching only: the simulation does
   * what it would have done, scoring is untouched. The tick is left "fully elapsed" so the renderer draws items at rest in
   * their new cells; the first frame after a resume therefore ticks at once. Returns true when the round ended on this step.
   */
  stepTick(): boolean {
    if (this.mode !== 'paused' || !this.sim) return false;
    const evs = step(this.sim);
    this.acc = this.tickMs;
    this.hooks.onTick?.(evs, this.sim);
    if (this.sim.tick >= RULES.ticksPerRound) { this.endRun(); return true; }
    this.hooks.onStateChange?.(null);
    return false;
  }
  /**
   * Advance the live simulation by wall-clock ms (already scaled by the caller if it wants; this applies `speed`).
   * Steps whole ticks, reporting each through onTick, and ends the round at the tick limit. Returns true if the
   * round ended during this call.
   */
  advance(deltaMs: number): boolean {
    if (this.mode !== 'running' || !this.sim) return false;
    this.acc += deltaMs * this.speed;
    let guard = 0;
    while (this.acc >= this.tickMs && guard++ < 10) {
      this.acc -= this.tickMs;
      const evs = step(this.sim);
      this.hooks.onTick?.(evs, this.sim);
      if (this.sim.tick >= RULES.ticksPerRound) { this.endRun(); return true; }
    }
    return false;
  }
  /** Fraction of the current tick elapsed (for interpolating item movement). */
  get tickPhase(): number { return Math.min(1, this.acc / this.tickMs); }
  /** Complete the round instantly (the authoritative result still comes from the run orchestrator). */
  finishRun(): boolean {
    if (this.mode !== 'running' && this.mode !== 'paused') return false;
    while (this.sim && this.sim.tick < RULES.ticksPerRound) step(this.sim);
    this.endRun();
    return true;
  }
  private endRun() {
    const visual = this.sim?.earned ?? 0;
    this.sim = null;
    this.mode = 'summary';
    this.act({ t: 'run' });
    const rec = this.run.rounds[this.run.rounds.length - 1];
    this.hooks.onRoundEnd?.(rec, visual);
    if (this.replayQueue) this.schedule(1200, () => this.advanceReplay());
  }
  /** Leave the summary: the next build phase, or 'finished' after the last round. */
  nextRound(byPlayback = false): 'build' | 'finished' | null {
    if (this.replayQueue && !byPlayback) return null; // the queue carries its own 'next'; a manual advance would double it (review F09)
    if (this.mode !== 'summary') return null;
    const last = this.run.round >= RULES.rounds;
    this.act({ t: 'next' });
    if (last || this.run.phase === 'finished') {
      if (this.replayQueue) { this.replayQueue = null; this.hooks.onPlaybackDone?.(); } // a watched run ends with its last 'next'
      this.hooks.onFinished?.(); return 'finished';
    }
    this.mode = 'build';
    this.hooks.onNextRound?.();
    if (this.replayQueue) this.schedule(400, () => this.advanceReplay());
    return 'build';
  }

  // ---------- replay playback ----------
  /** Apply queued replay actions up to the next run/next boundary; runs play live at 4×. */
  advanceReplay() {
    const q = this.replayQueue; if (!q) return;
    while (q.length) {
      const a = q[0];
      if (a.t === 'run') { q.shift(); this.startRun(true); this.schedule(200, () => this.setSpeed(4)); return; }
      if (a.t === 'next') { q.shift(); if (this.mode === 'summary') this.nextRound(true); else this.schedule(300, () => this.advanceReplay()); return; }
      q.shift(); this.act(a);
    }
    this.replayQueue = null;
    this.hooks.onPlaybackDone?.();
  }
  /** Abandon a watched replay: nothing was recorded, nothing to save. */
  stopReplay() { this.replayQueue = null; this.sim = null; this.generation++; }
}
