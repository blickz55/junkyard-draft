/**
 * The funnel's observer on the controller's hooks (production roadmap 0.9.4, extracted from GameScene): which accepted or
 * refused actions, round starts and ends and the finish mean for the opt-in statistics (PLAN-v1 0.3.7). The scene wraps its
 * hooks once; every event is tracked here, then the scene's own hook runs. Watching a recording tracks nothing but the finish.
 */
import type { Action } from '../sim/run';
import type { ControllerHooks } from './RoundController';
import type { EventName, Props } from '../telemetry/events';

export interface TelemetrySink {
  track(name: EventName, props?: Props): unknown;
}
export interface TelemetryContext {
  /** a recording is being watched */ watching(): boolean;
  seed(): string;
  round(): number;
}

export class GameTelemetry {
  constructor(
    private readonly sink: TelemetrySink,
    private readonly ctx: TelemetryContext,
  ) {}

  observe(hooks: ControllerHooks): ControllerHooks {
    const track = (name: EventName, props?: Props) => {
      this.sink.track(name, props);
    };
    return {
      ...hooks,
      onStateChange: (a) => {
        if (a && !this.ctx.watching()) {
          if (a.t === 'pick') track('first_draft_pick');
          else if (a.t === 'place') track('first_place_attempt');
          else if (a.t === 'rotate') track('first_rotate');
          else if (a.t === 'reroll') track('reroll_used', { n: this.ctx.round() });
        }
        hooks.onStateChange?.(a);
      },
      onReject: (a, message) => {
        if (a.t === 'place') {
          track('first_place_attempt');
          track('first_place_rejected', { reason: rejectReason(message) });
        }
        hooks.onReject?.(a, message);
      },
      onRunStart: () => {
        if (!this.ctx.watching()) track('first_run_start');
        hooks.onRunStart?.();
      },
      onRoundEnd: (rec, visual) => {
        if (!this.ctx.watching()) {
          track('round_complete', { n: rec.round });
          track('first_run_complete', { money: rec.earned });
        }
        hooks.onRoundEnd?.(rec, visual);
      },
      onFinished: () => {
        track('game_complete', { mode: this.ctx.watching() ? 'replay' : this.ctx.seed().startsWith('daily-') ? 'daily' : 'seed' });
        hooks.onFinished?.();
      },
    };
  }
  /** Ctrl+Z was used (an undo is not an action the controller reports). */
  undoUsed() {
    this.sink.track('undo_used');
  }
  /** The lesson moved from one step to another (0 = none). */
  tutorialStep(prev: number, next: number) {
    if (prev) this.sink.track('tutorial_step_complete', { n: prev });
    if (next) this.sink.track('tutorial_step_start', { n: next });
  }
}

/** The refusal's coarse reason for the funnel (never the message itself). */
export function rejectReason(message: string): 'occupied' | 'out_of_bounds' | 'other' {
  return /occupied/i.test(message) ? 'occupied' : /bounds/i.test(message) ? 'out_of_bounds' : 'other';
}
export type { Action };
