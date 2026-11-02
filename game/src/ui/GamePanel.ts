/**
 * Game-scene chrome as DOM (DOSSIER-v1 0.4.0; rebuilt for docs/UX-STANDARD.md): the HUD with the job, and a side panel that
 * always answers "what do I do now": the step (Pick, Build, Run), one instruction from Sal, the advice from last shift (which
 * stays until it stops being true), then the controls of the moment. The canvas keeps the yard, the shelf, machines, items,
 * ghost, cursor, jam and stall marks and the pooled +$ pops. The panel is rebuilt only when its inputs change; per-frame
 * values update in place. Every control carries data-testid. Every string comes from the table (0.9.0).
 *
 * Layout (production roadmap 0.10.0): a CSS grid of HUD, board slot and side panel. Wide screens put the board and the panel
 * side by side; portrait phones and tablets stack HUD, board and the panel as a bottom sheet; short landscape screens keep two
 * columns. The slot's rectangle goes to the scene, which fits the camera to it (render/layout.ts); the fitted cell size comes
 * back as `--cell`, so everything anchored to the yard (the toast, the inspector, the lit spots, the badges) sits on the
 * drawn cells. Touch targets are 44 px where the pointer is coarse.
 */
import type Phaser from 'phaser';
import { h, btn, ui, textureImg } from './dom';
import { canBuyBelt, canReroll, cardParts, draftOffers, orderFor, shippedTotal, type RunState } from '../sim/run';
import type { Job } from '../sim/yard';
import { analyseRound } from '../sim/bottleneck';
import { againLine, bottleneckLine, sameLimit } from '../content/bottleneck';
import type { Machine, MachineKind, Material } from '../sim/types';
import { RULES } from '../sim/rules';
import { priceOf, starsFor } from '../sim/yard';
import { cellIndex, runLayout } from '../sim/sim';
import { CELL, machineTexture } from '../render/textures';
import { GRID_W, GRID_H, BOARD_W, BOARD_H, GRID_X, GRID_Y, binSlotXY, slotOfBin } from '../render/layout';
import { prefs } from '../render/prefs';
import { audio } from '../render/audio';
import { cellLine, yardLines } from '../render/mirror';
import { loadBests } from '../render/storage';
import { isDailySeed, isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { isWeeklySeed, weeklyClosed } from '../sim/weekly';
import { challengerTotal, type Challenge } from '../render/challenge';
import type { Spot } from '../render/guide';
import { t } from '../content/strings';
import { shiftsOf } from '../content/lessons';
import { money, int } from '../content/format';
import { cardLine, machineName, machineBlurb, machineWord, materialName } from '../content/machines';
import {
  jobLine,
  jobRecipe,
  jobTarget,
  materialMany,
  materialOf,
  missingForJob,
  nextNeeded,
  otherMaterial,
  paceOf,
  starMarks,
  starWords,
} from '../content/job';
import { yardLabel } from '../content/yard';
import { salKnown, salLater } from '../render/sal';
import { offerWorths, planUnderway, pressPaysLess } from '../render/guide';
import { recipeRow } from './JobCard';
import { reactionBar } from './ReactionBar';
import { verifierUrl as resolveVerifierUrl } from '../render/config';

/** A card's name and line: a card can be a kit of two parts (rules v6). */
function cardName(kind: MachineKind, r: RunState): string {
  const parts = cardParts(kind, r.job, r.seed);
  if (parts.length === 1) return machineName(kind);
  return kind === 'hopper' ? t('game.kitHopper') : t('game.kitJob', { name: machineName(kind) });
}
function cardBlurb(kind: MachineKind, r: RunState): string {
  const parts = cardParts(kind, r.job, r.seed);
  if (parts.length === 1) return cardLine(kind, r.layout);
  return kind === 'hopper' ? t('game.kitHopperBlurb') : t('game.kitJobBlurb', { name: machineWord(kind) });
}

export type PanelMode = 'build' | 'running' | 'paused' | 'summary';

/** Everything the panel renders from; the scene builds it on demand. */
export interface PanelState {
  run: RunState;
  mode: PanelMode;
  speed: number;
  replayLabel: string | null;
  /** the recording's hash when it came from the board (0.11.3): the reactions need it */
  replayHash: string | null;
  replayRounds: number[] | null;
  playbackPending: boolean;
  /** the challenge being played, if any (PLAN-v4 0.7.1) */
  challenge?: Challenge | null;
  canUndo: boolean;
  canRedo: boolean;
  selected: Machine | undefined;
  tipsBadge: boolean;
  tipsOpen: boolean;
  /** the lesson is on: its skip button shows and only what it asks for can be touched */
  lesson: boolean;
  /** the card the lesson wants, in a lesson's pick */
  lessonPick: number | null;
  /** every move of this lesson shift is made */
  lessonReady: boolean;
  /** the button the lesson's step calls for */
  lessonWants: 'buy' | 'sell' | null;
}
/** What the panel asks the scene to do. */
export interface PanelActions {
  pick(i: number): void;
  startRun(): void;
  setPaused(p: boolean): void;
  finishRun(): void;
  stopReplay(): void;
  setSpeed(s: number): void;
  /** one tick while paused (0.8.12) */ stepTick(): void;
  undo(): void;
  redo(): void;
  /** the machine demos, at one tip when asked (0.9.3) */ openTips(id?: string): void;
  rotateSelected(): void;
  /** a quarter turn the other way, one Undo */
  rotateBack(): void;
  toBin(id: number): void;
  sell(id: number): void;
  /** a belt for the shelf, paid from the score (rules v5) */ buyBelt(): void;
  nextRound(): void;
  openMenu(): void;
  skipLesson(): void;
  /** back to the first shift of this yard; it asks first */ startOver(): void;
  /** light a machine and say what it does: the "Show me" of the advice card */ showMachine(id: number): void;
  toggleMute(): boolean;
  /** a star mark was passed during a shift */ starReached(n: number): void;
  /** the selected machine goes in hand: the next tap on the yard is where it goes */
  moveSelected(): void;
  /** light where this card pays: the coach's spots on request */
  showSpot(): void;
  /** buy new offers (rules v3): the scene applies { t: 'reroll' } through the controller */
  reroll(): void;
  /** continue the watched recording from the shift just finished as a practice try (PLAN-v4 0.7.3) */
  forkHere(): void;
  /** report the watched recording's player name (PLAN-v4 0.7.7); present only while watching a checked recording with a hash */
  reportName?: () => void;
}

/** Board-logical pixels → CSS length that follows the fitted board (`--px`, set on the board slot) and ignores local font-size. */
const em = (px: number) => `calc(${px} * var(--px))`;
/** The compact layout: phones, and portrait tablets (the same list the stylesheet uses). */
const mq = (feature: string, value: string) => `(${feature}: ${value})`;
export const COMPACT_MQ = `${mq('max-width', '700px')}, (${[mq('orientation', 'portrait'), mq('max-width', '1000px')].join(' and ')})`;
/** a short landscape screen (a phone on its side): two columns */
const LANDSCAPE_MQ = [mq('max-height', '520px'), mq('orientation', 'landscape')].join(' and ');
/** a portrait tablet: the board takes less of the height so the sheet shows three offers */
const TABLET_MQ = [mq('orientation', 'portrait'), mq('min-width', '600px'), mq('max-width', '1000px')].join(' and ');
/** grid-template-areas from rows of area names */
const areas = (rows: string[][]) => rows.map((r) => `"${r.join(' ')}"`).join(' ');
/** A finger rather than a mouse (0.10.1): the instructions say tap, the shelf label too. */
export const coarsePointer = () => typeof matchMedia === 'function' && matchMedia(mq('pointer', 'coarse')).matches;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** The third star sits at this share of the job bar, so going past it still shows. */
const THIRD_STAR_AT = 0.9;

/** Which way a machine sends what it makes, as the selected card says it. */
const WAYS = ['game.wayRight', 'game.wayDown', 'game.wayLeft', 'game.wayUp'] as const;
const sendsLine = (kind: MachineKind, dir: number): string =>
  kind === 'splitter' ? t('game.sendsSplit', { way: t(WAYS[dir]) }) : t('game.sends', { way: t(WAYS[dir]) });

export class GamePanel {
  private root: HTMLElement;
  private hud: { seed: HTMLElement; round: HTMLElement; score: HTMLElement; best: HTMLElement; stall: HTMLElement; mute: HTMLButtonElement };
  private side: HTMLElement;
  /** Sal's card: the one instruction, re-appended at the top of the panel on every render */
  private coachEl: HTMLElement;
  private hintEl: HTMLElement;
  private showMeEl: HTMLButtonElement;
  private aboutEl: HTMLElement;
  private spots: Spot[] = [];
  /** the rings on the board for the lit spots */
  private spotLayer: HTMLElement;
  /** the board slot: the canvas shows through it; the scene fits the camera to its rectangle (0.10.0) */
  private boardEl: HTMLElement;
  private boardCb: ((slot: { x: number; y: number; w: number; h: number }) => void) | null = null;
  private ro: ResizeObserver | null = null;
  private gridLayer: HTMLElement;
  /** a refusal or a warning anchored to a grid cell (production roadmap 0.9.3); it stays until the scene clears it */
  private toastEl: HTMLElement;
  private mirrorEl: HTMLElement;
  private cursorEl: HTMLElement;
  private mirrorText = '';
  /** the card a tap on a piece opens */
  private inspectEl: HTMLElement;
  private inspectRing: HTMLElement | null = null;
  private job: { data: Job; fill: HTMLElement; bar: HTMLElement; count: HTMLElement; stars: HTMLElement[]; reached: number } | null = null;
  private orders: {
    fill: HTMLElement;
    bar: HTMLElement;
    line: HTMLElement;
    count: HTMLElement;
    pips: HTMLElement[];
    round: number;
    done: boolean;
    filled: number;
  } | null = null;
  private key = '';
  /** whether the last rendered state was recording playback (the summary overlay offers a try then, PLAN-v4 0.7.3) */
  private replayMode = false;
  private reactions: { hash: string; bar: HTMLElement } | null = null;
  private progress: HTMLElement | null = null;
  private earned: HTMLElement | null = null;
  private lastEarned = -1;
  private lastTick = -1;
  private legendEl: HTMLElement | null = null;
  private legendKey = '';
  hintText = '';
  stallText = '';
  /** Sal's line for the shift banner (0.9.1) */
  bannerForeman = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly actions: PanelActions,
    run: RunState,
    replayLabel: string | null,
    muted: boolean,
    forkLabelText: string | null = null,
  ) {
    const seed = run.seed;
    const suffix = forkLabelText
      ? ` · ${forkLabelText}`
      : replayLabel
        ? ` · ${replayLabel}`
        : isWeeklySeed(seed)
          ? weeklyClosed(seed, new Date())
            ? t('game.suffixArchivedWeekly')
            : ''
          : isMintedDailySeed(seed)
            ? dailyDateOf(seed) === new Date().toISOString().slice(0, 10)
              ? ''
              : t('game.suffixArchivedDaily')
            : isDailySeed(seed)
              ? t('game.suffixPractice')
              : ''; // PLAN-v3 0.6.1/0.6.2: the HUD says which daily this is
    this.hud = {
      seed: h(
        'span',
        { class: `jd-hud-seed ${replayLabel ? 'jd-blue' : 'jd-dim'}`, tid: 'hud-seed', title: seed },
        t('game.hudYard', { yard: cap(yardLabel(seed)), suffix }),
      ),
      round: h('span', { class: 'jd-hud-round', tid: 'hud-round' }, ''),
      score: h('span', { class: 'jd-gold jd-hud-score', tid: 'hud-score' }, money(0)),
      best: h('span', { class: 'jd-dim jd-hud-best' }, ''),
      stall: h('span', { class: 'jd-red jd-hud-stall', tid: 'stall' }, ''),
      mute: btn(
        muted ? t('common.unmute') : t('common.mute'),
        'mute',
        () => {
          this.hud.mute.textContent = this.actions.toggleMute() ? t('common.unmute') : t('common.mute');
        },
        { small: true },
      ),
    };
    const hudBar = h(
      'div',
      { class: 'jd-hud' },
      btn(t('common.menu'), 'menu', () => this.actions.openMenu(), { small: true }),
      h('div', { class: 'jd-hud-where' }, this.hud.round, this.hud.seed),
      this.jobStrip(run.job),
      h('div', { class: 'jd-hud-scoreblock' }, this.hud.score, this.hud.best, this.hud.stall),
      this.hud.mute,
    );
    this.side = h('div', { class: 'jd-side', tid: 'side' });
    this.hintEl = h('div', { class: 'jd-coach-text', tid: 'hint', role: 'status' }, '');
    // outside the status line, so a screen reader hears the words once and finds the button as a button
    this.showMeEl = btn(t('coach.showMe'), 'show-spot', () => this.actions.showSpot(), { small: true });
    this.showMeEl.hidden = true;
    this.coachEl = h('div', { class: 'jd-coach', tid: 'coach' }, h('span', { class: 'jd-coach-face' }, t('foreman.name')), this.hintEl, this.showMeEl);
    this.aboutEl = h('div', { class: 'jd-about', tid: 'lesson-about' });
    this.gridLayer = h('div', { class: 'jd-gridlayer' });
    this.spotLayer = h('div', { class: 'jd-spotlayer' });
    this.toastEl = h('div', { class: 'jd-toast', tid: 'toast', role: 'status', style: 'display:none' });
    this.inspectEl = h('div', { class: 'jd-inspect', style: 'display:none' });
    this.boardEl = h('div', { class: 'jd-board', tid: 'board-slot' }, this.gridLayer, this.spotLayer, this.toastEl, this.inspectEl);
    this.mirrorEl = h('ul', { class: 'jd-sr', tid: 'yard-mirror', ariaLabel: t('mirror.head') });
    this.cursorEl = h('div', { class: 'jd-sr', tid: 'yard-cursor', role: 'status' });
    this.root = h('div', { class: 'jd-game' }, hudBar, this.boardEl, this.side, this.mirrorEl, this.cursorEl);
    if (!document.getElementById('jd-game-style')) {
      const st = document.createElement('style');
      st.id = 'jd-game-style';
      st.textContent = GAME_STYLE;
      document.head.append(st);
    }
    ui.mount(scene, this.root);
  }

  destroy() {
    this.ro?.disconnect();
    this.ro = null;
    this.boardCb = null;
    ui.unmount();
  }

  // ---------- the board slot (0.10.0) ----------
  /** The slot's rectangle (CSS px, relative to the overlay) now and whenever the shell re-lays out; the scene fits its camera to it. */
  onBoard(cb: (slot: { x: number; y: number; w: number; h: number }) => void) {
    this.boardCb = cb;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.relayout());
      this.ro.observe(this.boardEl);
    }
    this.relayout();
  }
  /** Re-measure the slot and report it (also when the container moved the slot without resizing it). */
  relayout() {
    const u = ui.element?.getBoundingClientRect();
    const r = this.boardEl.getBoundingClientRect();
    if (!u || !this.boardCb || r.width < 1 || r.height < 1) return;
    this.boardCb({ x: r.left - u.left, y: r.top - u.top, w: r.width, h: r.height });
  }
  /** The fitted board: its cell size in CSS px and its offset inside the slot, for everything anchored to the yard. */
  setBoardVars(cell: number, dx: number, dy: number) {
    const s = this.boardEl.style;
    s.setProperty('--cell', `${cell}px`);
    s.setProperty('--bx', `${dx}px`);
    s.setProperty('--by', `${dy}px`);
  }

  // ---------- HUD ----------
  setHud(run: RunState, total: number, pulse: boolean) {
    this.hud.round.textContent = t('game.round', { n: run.round, total: shiftsOf(run.seed) });
    const next = money(total);
    if (this.hud.score.textContent !== next) {
      this.hud.score.textContent = next;
      if (pulse && !prefs.reducedMotion) {
        this.hud.score.classList.remove('jd-pulse');
        void this.hud.score.offsetWidth;
        this.hud.score.classList.add('jd-pulse');
      }
    }
    const b = loadBests().bySeed[run.seed];
    this.hud.best.textContent = b ? t('game.bestForYard', { score: money(b.score) }) : t('game.noBestForYard');
  }
  /** The HUD's sound button follows a change made in the menu. */
  syncMute() {
    this.hud.mute.textContent = audio.muted ? t('common.unmute') : t('common.mute');
  }
  setStall(text: string) {
    this.stallText = text;
    this.hud.stall.textContent = text;
  }
  // ---------- the job in the HUD ----------
  private jobStrip(job: Job | null): HTMLElement | null {
    if (!job) return null;
    if (job.orders) return this.orderStrip(job);
    const target = jobTarget(job);
    const max = target / THIRD_STAR_AT;
    const fill = h('div', { class: 'jd-job-fill', tid: 'job-fill' });
    const bar = h('div', { class: 'jd-job-bar', tid: 'job-bar', role: 'progressbar' }, fill);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(target));
    const count = h('span', { class: 'jd-job-count', tid: 'job-count' }, '');
    // each star sits on the bar at its mark: what the marks are for is on the bar itself
    const stars = job.stars.map((n) => h('span', { class: 'jd-job-star', style: `left:${(100 * n) / max}%` }, '★'));
    this.job = { data: job, fill, bar, count, stars, reached: 0 };
    return h(
      'div',
      { class: 'jd-job', tid: 'job' },
      h('div', { class: 'jd-job-top' }, h('span', { class: 'jd-job-goal-line', tid: 'job-line' }, jobLine(job)), count),
      h('div', { class: 'jd-job-track', tid: 'job-stars' }, bar, ...stars),
    );
  }
  /** A yard with orders: this shift's order, the money against it, and a pip for each of the six. */
  private orderStrip(job: Job): HTMLElement {
    const fill = h('div', { class: 'jd-job-fill', tid: 'order-fill' });
    const bar = h('div', { class: 'jd-job-bar', tid: 'order-bar', role: 'progressbar' }, fill);
    const line = h('span', { class: 'jd-job-goal-line', tid: 'job-line' }, '');
    const count = h('span', { class: 'jd-job-count', tid: 'job-count' }, '');
    const pips = (job.orders ?? []).map(() => h('span', { class: 'jd-pip' }, ''));
    this.orders = { fill, bar, line, count, pips, round: 0, done: false, filled: 0 };
    return h(
      'div',
      { class: 'jd-job', tid: 'job' },
      h('div', { class: 'jd-job-top' }, line, count, h('span', { class: 'jd-pips', tid: 'order-pips' }, ...pips)),
      h('div', { class: 'jd-job-track', tid: 'job-stars' }, bar),
    );
  }
  /** Where this shift stands against its order. `live` during a shift: filling it is a moment. */
  setOrder(r: RunState, earned: number, live: boolean) {
    const o = this.orders;
    const order = orderFor(r);
    if (!o || order === null) return;
    if (o.round !== r.round) {
      o.round = r.round;
      o.done = false;
    }
    o.line.textContent = t('job.order', { amount: money(order) });
    o.count.textContent = t('job.orderCount', { amount: money(earned) });
    o.fill.style.width = `${Math.min(100, (100 * earned) / order)}%`;
    o.bar.setAttribute('aria-valuemin', '0');
    o.bar.setAttribute('aria-valuemax', String(order));
    o.bar.setAttribute('aria-valuenow', String(Math.min(earned, order)));
    r.rounds.forEach((rec, i) => {
      const filled = rec.earned >= (r.job?.orders?.[i] ?? Infinity);
      o.pips[i].className = `jd-pip ${filled ? 'on' : 'off'}`;
    });
    for (let i = r.rounds.length; i < o.pips.length; i++) o.pips[i].className = i === r.rounds.length ? 'jd-pip now' : 'jd-pip';
    if (live && !o.done && earned >= order) {
      o.done = true;
      // the orders filled before this shift's: the run has already counted this one once the shift is over, and not while it runs
      const orders = r.job?.orders ?? [];
      const before = r.rounds.filter((rec) => rec.round < r.round && rec.earned >= orders[rec.round - 1]).length;
      const stars = r.job ? r.job.stars.filter((n) => before + 1 >= n).length : 0;
      const newStar = stars > r.job!.stars.filter((n) => before >= n).length;
      this.actions.starReached(newStar ? stars : 1);
      this.ribbon(t('job.orderPop'), t('job.orderRaise', { raise: RULES.job.raise }));
      if (newStar) this.starPop(stars);
    }
  }
  /** The job's progress. `live` during a shift: passing a mark is a moment. */
  setJob(shipped: number, live: boolean) {
    const j = this.job;
    if (!j) return;
    const target = jobTarget(j.data);
    j.fill.style.width = `${Math.min(100, (100 * shipped * THIRD_STAR_AT) / target)}%`;
    j.bar.setAttribute('aria-valuenow', String(Math.min(shipped, target)));
    j.count.textContent = t('job.count', { n: int(shipped), target: int(target), mat: materialMany(j.data.material) });
    const reached = j.data.stars.filter((n) => shipped >= n).length;
    j.stars.forEach((el, i) => el.classList.toggle('on', i < reached));
    if (live && reached > j.reached) {
      for (let n = j.reached + 1; n <= reached; n++) this.actions.starReached(n);
      this.starPop(reached);
    }
    j.reached = reached;
  }
  /** An order filled is the moment of a shift: it stops the eye even at four times the speed. */
  private ribbon(text: string, under: string) {
    const el = h('div', { class: 'jd-ribbon', tid: 'order-ribbon' }, text, h('small', {}, under));
    this.boardEl.append(el);
    setTimeout(() => el.remove(), prefs.reducedMotion ? 2200 : 1600);
  }
  private starPop(n: number) {
    const words = starWords(n);
    const el = h(
      'div',
      { class: `jd-star-pop${words ? '' : ' jd-star-pop-quiet'}`, tid: 'star-pop' },
      h('span', { class: 'jd-gold' }, starMarks(n)),
      words ? h('span', {}, words) : null,
    );
    this.boardEl.append(el);
    setTimeout(() => el.remove(), prefs.reducedMotion ? 2600 : 1900);
    if (!prefs.reducedMotion && this.job) {
      const s = this.job.stars[n - 1];
      s.classList.remove('jd-pulse');
      void s.offsetWidth;
      s.classList.add('jd-pulse');
    }
  }

  // ---------- the coach ----------
  /** One instruction and what to touch; the spots light up where they are. */
  setHint(text: string, spots: Spot[] = [], about: { kind: MachineKind; text: string }[] = [], showMe = false) {
    this.hintText = text;
    this.hintEl.textContent = text;
    this.showMeEl.hidden = !showMe;
    this.spots = spots;
    this.applySpots();
    const key = JSON.stringify(about);
    if (key === this.aboutKey) return;
    this.aboutKey = key;
    this.aboutEl.replaceChildren(
      ...about.map((a) =>
        h(
          'div',
          { class: 'jd-about-row' },
          textureImg(this.scene.game, machineTexture(a.kind), machineName(a.kind)),
          h('div', {}, h('b', {}, machineName(a.kind)), h('div', { class: 'jd-dim' }, a.text)),
        ),
      ),
    );
  }
  private aboutKey = '[]';
  /** Light what the instruction talks about: cards and buttons in place, rings on the yard and the shelf. */
  private applySpots() {
    this.root.querySelectorAll('.jd-spot').forEach((e) => e.classList.remove('jd-spot'));
    const rings: HTMLElement[] = [];
    const ring = (x: number, y: number, spot: string, soft = false) => {
      const el = h('div', { class: `jd-ring${soft ? ' jd-ring-soft' : ''}`, style: `left:${em(x)}; top:${em(y)}; width:${em(CELL)}; height:${em(CELL)}` });
      el.dataset.spot = spot;
      rings.push(el);
    };
    for (const s of this.spots) {
      if (s.kind === 'offer') this.mark(`offer-${s.i}`);
      else if (s.kind === 'run') this.mark('run');
      else if (s.kind === 'next') this.mark('next');
      else if (s.kind === 'buy') this.mark('buy-belt');
      else if (s.kind === 'sell') this.mark('sell');
      else if (s.kind === 'offers') this.mark('reroll');
      else if (s.kind === 'cell') {
        ring(s.x * CELL, s.y * CELL, `cell:${s.x},${s.y}`, s.soft);
      } else {
        const { px, py } = binSlotXY(s.i);
        ring(px - GRID_X, py - GRID_Y, `shelf:${slotOfBin(s.i)}`);
      }
    }
    this.spotLayer.replaceChildren(...rings, ...(this.inspectRing ? [this.inspectRing] : []));
  }
  private mark(tid: string) {
    this.root.querySelector(`[data-testid="${tid}"]`)?.classList.add('jd-spot');
  }
  /** A refusal or a warning at a cell (0.9.3): above the cell, below it on the top row; null hides it. Never on a timer: the scene clears it on the next action. */
  setToast(toast: { text: string; kind: 'refusal' | 'warning' | 'note'; x: number; y: number } | null) {
    const el = this.toastEl;
    if (!toast) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    // relative to the grid's top-left (the slot's --bx/--by), in board-logical px
    const cx = Math.min(GRID_W - 150, Math.max(150, toast.x * CELL + CELL / 2));
    const below = toast.y === 0;
    const cy = below ? CELL + 10 : toast.y * CELL - 10;
    el.className = `jd-toast jd-toast-${toast.kind}${below ? ' jd-toast-below' : ''}`;
    el.dataset.kind = toast.kind;
    el.style.cssText = `display:block; left:calc(var(--bx, 0px) + ${em(cx)}); top:calc(var(--by, 0px) + ${em(cy)}); transform:translate(-50%, ${below ? '0' : '-100%'})`;
    el.textContent = toast.text;
    // on the screen whatever the cell: on a phone a note centred near the yard's edge ran off it (the fourth panel), so it slides in
    // and its arrow stays over the cell
    const r = el.getBoundingClientRect();
    const right = document.documentElement.clientWidth - 6;
    const shift = Math.round(Math.max(6 - r.left, Math.min(0, right - r.right)));
    if (shift) {
      el.style.marginLeft = `${shift}px`;
      el.style.setProperty('--arrow', `${-shift}px`);
    }
  }
  /** The inspector's card, anchored at a spot (board-logical px of its top-left); null closes it. */
  showInspector(card: HTMLElement | null, at?: { x: number; y: number }) {
    const el = this.inspectEl;
    this.inspectRing?.remove();
    this.inspectRing = null;
    if (!card || !at) {
      el.style.display = 'none';
      el.replaceChildren();
      return;
    }
    const below = at.y < GRID_H / 2;
    el.replaceChildren(card);
    el.classList.toggle('jd-inspect-top', !below);
    this.inspectRing = h('div', { class: 'jd-ring jd-ring-inspect', style: `left:${em(at.x)}; top:${em(at.y)}; width:${em(CELL)}; height:${em(CELL)}` });
    this.spotLayer.append(this.inspectRing);
    el.style.cssText = `display:block; left:clamp(0px, calc(var(--bx, 0px) + ${em(at.x + CELL / 2)} - 10em), calc(100% - 20em)); top:calc(var(--by, 0px) + ${em(below ? at.y + CELL + 6 : at.y - 6)}); transform:translateY(${below ? '0' : '-100%'})`;
  }
  private lastState: PanelState | null = null;

  // ---------- per-frame ----------
  setProgress(tick: number, earned: number) {
    if (this.progress && tick !== this.lastTick) {
      this.lastTick = tick;
      this.progress.style.width = `${(100 * tick) / RULES.ticksPerRound}%`;
    }
    if (this.earned && earned !== this.lastEarned) {
      this.lastEarned = earned;
      const before = this.lastState?.run.score ?? 0; // with nothing yet this shift, the game's money is still there: say so
      this.earned.textContent =
        before > 0 ? t('game.earnedOf', { amount: money(earned), total: money(before + earned) }) : t('game.earned', { amount: money(earned) });
    }
  }

  // ---------- side panel ----------
  private keyOf(s: PanelState): string {
    const sel = s.selected;
    return JSON.stringify([
      s.mode,
      s.run.phase,
      s.run.round,
      s.run.offers,
      s.run.rerolledRound,
      s.run.score,
      s.challenge?.hash ?? null,
      s.run.bin.length,
      s.run.layout.machines.map((m) => `${m.kind}${m.x}.${m.y}.${m.dir}`).join(), // where and which way: the forecast reads them
      s.lessonPick,
      s.lessonReady,
      s.lessonWants,
      s.speed,
      s.replayLabel,
      !!s.replayRounds,
      sel ? [sel.id, sel.kind, sel.dir, sel.x >= 0] : null,
      s.playbackPending,
      s.canUndo,
      s.canRedo,
      s.tipsBadge,
      s.tipsOpen,
      s.lesson,
      this.bannerForeman,
    ]);
  }
  /** Pick, Build, Run: where this moment sits in a shift. */
  private steps(s: PanelState, right: HTMLElement | null): HTMLElement {
    const r = s.run;
    const at = s.mode === 'running' || s.mode === 'paused' || r.phase === 'result' ? 2 : r.phase === 'build' ? 1 : 0;
    const labels = [t('coach.stepPick'), t('coach.stepBuild'), t('coach.stepRun')];
    return h(
      'div',
      { class: 'jd-steps-row' },
      h(
        'ol',
        { class: 'jd-steps', tid: 'steps', ariaLabel: t('coach.steps') },
        ...labels.map((l, i) => h('li', { class: i === at ? 'on' : i < at ? 'done' : '' }, l)),
      ),
      right,
    );
  }
  /** What last shift taught, kept on screen through the pick and the build: what the job is missing first, then what held the line. */
  private lastShift(r: RunState): HTMLElement | null {
    const last = r.rounds[r.rounds.length - 1];
    if (!last) return null;
    const b = analyseRound(last.layout, last.result, r.round);
    const missing = missingForJob(r);
    const before = r.rounds[r.rounds.length - 2];
    if (!missing && before && sameLimit(b, analyseRound(before.layout, before.result, r.round - 1))) return null; // said last shift: the banner keeps it short
    const here = !missing && b.machine ? r.layout.machines.find((m) => m.id === b.machine!.id) : undefined;
    return h(
      'div',
      { class: 'jd-advice', tid: 'last-shift' },
      h('div', { class: 'jd-advice-text' }, h('b', {}, `${t('coach.lastShift')}: `), missing ?? bottleneckLine(b)),
      // named, because a "Show me" beside a suggested Tuner read as a way to place the Tuner (the fifth panel)
      here ? btn(t('coach.showMachine', { name: machineName(here.kind) }), 'show-me', () => this.actions.showMachine(here.id), { small: true }) : null,
    );
  }
  /** The recipe as a checklist, gone once the line has it all. */
  private recipe(r: RunState): HTMLElement | null {
    if (!r.job) return null;
    const placed = (k: string) => r.layout.machines.some((m) => m.kind === k);
    if (jobRecipe(r.job).every(placed)) return null;
    return recipeRow(r.job, placed);
  }
  /** Rebuild the side panel if its inputs changed. */
  /** The yard in words for a screen reader (0.12.4): it changes with the layout, so not during a shift. */
  private drawMirror(s: PanelState) {
    if (s.mode === 'running') return;
    const lines = yardLines(s.run);
    const text = lines.join('\n');
    if (text === this.mirrorText) return;
    this.mirrorText = text;
    this.mirrorEl.replaceChildren(...lines.map((l) => h('li', {}, l)));
  }
  announceCell(run: RunState, x: number, y: number, held: MachineKind | null) {
    this.cursorEl.textContent = cellLine(run, x, y, held);
  }
  focusControls() {
    this.root.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }
  render(s: PanelState) {
    this.drawMirror(s);
    const key = this.keyOf(s);
    if (key === this.key && this.side.childElementCount > 0) return;
    this.key = key;
    this.lastState = s;
    this.replayMode = !!s.replayLabel;
    this.side.replaceChildren();
    this.progress = null;
    this.earned = null;
    this.lastEarned = -1;
    this.lastTick = -1;
    const r = s.run;
    const tipsBtn = s.replayLabel
      ? null
      : btn(s.tipsBadge ? t('game.tipsBadge') : t('game.tips'), 'tips', () => this.actions.openTips(), {
          small: true,
        });
    const replayBanner = s.replayLabel ? h('span', { class: 'jd-replay-banner jd-blue', tid: 'replay-banner' }, t('game.recordingBanner')) : null;
    const tools =
      r.phase === 'build' && s.mode === 'build' && !s.replayLabel
        ? h(
            'div',
            { class: 'jd-row jd-steps-tools', style: 'gap:0.3em' },
            btn(t(r.actions[r.actions.length - 1]?.t === 'pick' ? 'game.undoPick' : 'game.undo'), 'undo', () => this.actions.undo(), {
              small: true,
              disabled: !s.canUndo,
            }),
            btn(t('game.redo'), 'redo', () => this.actions.redo(), { small: true, disabled: !s.canRedo }),
            tipsBtn,
          )
        : null;
    this.side.append(this.steps(s, tools ?? replayBanner ?? tipsBtn), this.coachEl, this.aboutEl);
    if (s.challenge) {
      // PLAN-v4 0.7.1: the challenger's earnings, shift by shift, next to yours
      const c = s.challenge;
      const idx = Math.min(r.round, c.rounds.length) - 1;
      const done = r.rounds.length >= RULES.rounds;
      const text = done
        ? t('game.challengeDone', { player: c.player, score: money(c.score), yours: money(r.score) })
        : t('game.challengeLive', {
            player: c.player,
            theirs: money(c.rounds[idx] ?? 0),
            round: r.round,
            total: money(challengerTotal(c, r.round)),
            yours: money(r.score),
          });
      this.side.append(
        h(
          'div',
          {
            class: 'jd-amber',
            tid: 'challenge-line',
            style: 'font-size:0.75em; margin-top:0.4em',
            title: t('game.challengeTitle', { player: c.player, score: money(c.score) }),
          },
          text,
        ),
      );
    }
    if (s.mode === 'running' || s.mode === 'paused') this.renderRunning(s, r);
    else if (r.phase === 'draft') this.renderPick(s, r);
    else if (r.phase === 'build') this.renderBuild(s, r);
    else if (r.phase === 'result') this.renderSummary(s, r);
    if (s.lesson) {
      const way = (tid: string, text: string, onClick: () => void) => h('button', { class: 'jd-link jd-skip', tid, type: 'button', onClick }, text);
      this.side.append(
        h(
          'div',
          { class: 'jd-lesson-ways' },
          r.actions.length ? way('restart-lesson', t('menu.startOverLesson'), () => this.actions.startOver()) : null,
          way('skip-lesson', t('menu.skip'), () => this.actions.skipLesson()),
        ),
      );
    }
    this.applySpots();
  }

  private renderRunning(s: PanelState, r: RunState) {
    this.progress = h('div', { class: 'jd-progress-fill', tid: 'progress' });
    this.side.append(h('div', { class: 'jd-progress' }, this.progress));
    this.earned = h('div', { class: 'jd-gold jd-earned', tid: 'earned' }, t('game.earned', { amount: money(0) }));
    this.side.append(this.earned);
    if (s.replayRounds) {
      const idx = r.round - 1;
      const orig = s.replayRounds[idx] ?? 0;
      const total = s.replayRounds.slice(0, idx + 1).reduce((a, b) => a + b, 0);
      this.side.append(
        h(
          'div',
          { class: 'jd-blue', tid: 'replay-original', style: 'font-size:0.6875em; margin-top:0.25em' },
          t('game.original', { orig: money(orig), total: money(total), n: r.round, final: money(s.replayRounds.reduce((a, b) => a + b, 0)) }),
        ),
      );
    }
    this.side.append(
      h(
        'div',
        { class: 'jd-row', style: 'margin-top:0.6em' },
        h('span', { class: 'jd-dim', style: 'font-size:0.75em' }, t('game.speed')),
        ...[1, 2, 4].map((sp) =>
          btn(t('game.speedX', { n: sp }), `speed-${sp}`, () => this.actions.setSpeed(sp), { small: true, variant: s.speed === sp ? 'primary' : 'dark' }),
        ),
      ),
    );
    this.side.append(
      h(
        'div',
        { class: 'jd-row', style: 'margin-top:0.6em' },
        btn(s.mode === 'paused' ? t('game.resume') : t('game.pauseEsc'), 'pause', () => this.actions.setPaused(s.mode !== 'paused'), { small: true }),
        s.mode === 'paused'
          ? btn(
              t('game.step'),
              'step',
              () => {
                this.actions.stepTick();
                (document.activeElement as HTMLElement | null)?.blur?.();
              },
              { small: true, title: t('game.stepTitle') },
            )
          : null,
        btn(t('game.skip'), 'skip', () => this.actions.finishRun(), { small: true }),
      ),
    ); // the step button gives focus back so the . key works right after a click
    if (s.replayLabel) {
      this.side.append(
        h(
          'div',
          { class: 'jd-row', style: 'margin-top:0.4em' },
          btn(t('game.stopWatching'), 'stop', () => this.actions.stopReplay(), { small: true }),
        ),
      );
      this.side.append(h('div', { class: 'jd-blue', style: 'font-size:0.75em; margin-top:0.3em; overflow-wrap:anywhere' }, s.replayLabel));
      if (s.replayHash) {
        if (this.reactions?.hash !== s.replayHash) this.reactions = { hash: s.replayHash, bar: reactionBar(this.scene, resolveVerifierUrl(), s.replayHash) };
        this.side.append(this.reactions.bar); // one bar for the whole recording: the panel redraws, the counts stay
      }
    }
    this.side.append(this.legend());
  }

  private renderPick(s: PanelState, r: RunState) {
    const advice = s.lesson ? null : this.lastShift(r);
    if (advice) this.side.append(advice);
    const recipe = this.recipe(r);
    if (recipe) this.side.append(recipe);
    const need = nextNeeded(r);
    r.offers.forEach((kind, i) => {
      const off = s.lesson && s.lessonPick !== i; // a lesson deals three and wants one: the others are there to be seen
      const card = h(
        'button',
        {
          class: `jd-offer${need === kind && !off ? ' jd-offer-need' : ''}${off ? ' jd-offer-off' : ''}`,
          tid: `offer-${i}`,
          type: 'button',
          disabled: off,
          onClick: () => {
            if (!s.playbackPending) this.pickOffer(i);
          },
        },
        textureImg(this.scene.game, machineTexture(kind), machineName(kind)),
        h(
          'div',
          { class: 'jd-offer-text' },
          h('div', { class: 'jd-offer-name' }, cardName(kind, r)),
          need === kind ? h('div', { class: 'jd-offer-badge', tid: `offer-need-${i}` }, t('job.needed')) : null,
          h('div', { class: 'jd-dim jd-offer-blurb' }, cardBlurb(kind, r)),
          s.lesson ? null : this.cardWorth(r, i),
        ),
      );
      this.side.append(card);
    });
    if (r.job?.orders && r.round >= RULES.job.secondBuyerFrom)
      this.side.append(
        h(
          'div',
          { class: 'jd-amber', tid: 'second-buyer', style: 'font-size:0.8125em; margin-top:0.35em' },
          t('job.buyer', { n: RULES.job.secondBuyerFrom, mat: materialMany(otherMaterial(r.job)), price: money(priceOf(r.layout, otherMaterial(r.job))) }),
        ),
      );
    // a yard's offers are fixed, so a second try knows them anyway: everyone gets to plan on them
    if (!s.lesson && r.round < RULES.rounds)
      this.side.append(
        h(
          'div',
          { class: 'jd-dim', tid: 'next-cards', style: 'font-size:0.8125em; margin-top:0.4em' },
          t('game.nextCards', {
            cards: draftOffers(r.seed, r.round + 1)
              .map((k) => cardName(k, r))
              .join(' · '),
          }),
        ),
      );
    const why = canReroll(r);
    if (!s.replayLabel && !s.lesson && !why) {
      const rerollBtn = btn(
        t('game.newOffers', { cost: money(RULES.rerollCost) }),
        'reroll',
        () => {
          if (!s.playbackPending) this.actions.reroll();
        },
        { small: true, disabled: s.playbackPending, title: t('game.newOffersTitle') },
      );
      this.side.append(
        h(
          'div',
          { class: 'jd-row', style: 'margin-top:0.5em; gap:0.6em; align-items:center' },
          rerollBtn,
          h('span', { class: 'jd-dim', tid: 'reroll-note', style: 'font-size:0.75em; flex:1 1 8em' }, t('game.newOffersNote', { score: money(r.score) })),
        ),
      );
    }
    this.side.append(this.legend());
  }
  /** Whether the card adds to this line right now, on its own, in its best spot. How much stays the player's to judge: the exact figure made
   * the pick a matter of reading the biggest number, and a player who only did that came within 4 % of the search's best game. */
  private cardWorth(r: RunState, i: number): HTMLElement {
    const { gain, room, little } = offerWorths(r)[i];
    return h(
      'div',
      { class: (gain > 0 && !little) || room ? 'jd-green jd-offer-worth' : 'jd-dim jd-offer-worth', tid: `offer-worth-${i}` },
      t(
        little
          ? 'game.cardLittle'
          : gain > 0
            ? 'game.cardHelps'
            : room
              ? 'game.cardRoom'
              : pressPaysLess(r, r.offers[i])
                ? 'game.cardPaysLess'
                : 'game.cardNoGain',
      ),
    );
  }
  /** Keep a card: the other two slide away, so "the other two go back on the truck" is something you see. The pick itself is immediate. */
  private pickOffer(i: number) {
    const cards = [...this.side.querySelectorAll<HTMLElement>('.jd-offer')];
    const box = this.side.getBoundingClientRect();
    const scroll = this.side.scrollTop;
    const ghosts = prefs.reducedMotion
      ? []
      : cards
          .filter((_, k) => k !== i)
          .map((c) => {
            const b = c.getBoundingClientRect();
            const g = c.cloneNode(true) as HTMLElement;
            g.removeAttribute('data-testid');
            g.querySelectorAll('[data-testid]').forEach((e) => e.removeAttribute('data-testid'));
            g.setAttribute('aria-hidden', 'true');
            g.classList.remove('jd-spot');
            g.classList.add('jd-offer-gone');
            g.style.cssText = `left:${b.left - box.left}px; top:${b.top - box.top + scroll}px; width:${b.width}px`;
            return g;
          });
    this.actions.pick(i);
    for (const g of ghosts) {
      this.side.append(g);
      setTimeout(() => g.remove(), 420);
    }
  }

  private renderBuild(s: PanelState, r: RunState) {
    // once the line changes the advice is old news, and the forecast speaks for the new line; it fades rather than goes, because taking it
    // away moved every button under it by its height, and a tap meant for Turn bought a belt (the fifth panel)
    const advice = s.lesson ? null : this.lastShift(r);
    if (advice) {
      if (this.lineChanged(r)) advice.classList.add('jd-advice-old');
      this.side.append(advice);
    }
    const recipe = this.recipe(r);
    if (recipe) this.side.append(recipe);
    const sel = s.lesson && s.lessonWants !== 'sell' ? null : s.selected; // in a lesson the card would push the lit button off a phone
    if (sel) {
      const img = textureImg(this.scene.game, machineTexture(sel.kind), machineName(sel.kind));
      img.style.transform = `rotate(${sel.dir * 90}deg)`;
      this.side.append(
        h(
          'div',
          { class: 'jd-sel', tid: 'selected' },
          img,
          h(
            'div',
            { style: 'flex:1; min-width:0' },
            h('div', { class: 'jd-offer-name' }, machineName(sel.kind)),
            h('div', { class: 'jd-dim', style: 'font-size:0.8125em' }, machineBlurb(sel.kind, r.layout)),
            // which way it sends, in words: the marks on a machine are small, and players turned by counting presses (the fifth panel)
            sel.kind === 'dock' ? null : h('div', { class: 'jd-amber', tid: 'sends', style: 'font-size:0.8125em' }, sendsLine(sel.kind, sel.dir)),
            h(
              'div',
              { class: 'jd-row', style: 'margin-top:0.4em; gap:0.4em' },
              btn(t('game.rotate'), 'rotate', () => this.actions.rotateSelected(), { small: true }),
              s.lesson ? null : btn(t('game.rotateBack'), 'rotate-back', () => this.actions.rotateBack(), { small: true }),
              sel.x >= 0 && !s.lesson ? btn(t('game.move'), 'move', () => this.actions.moveSelected(), { small: true }) : null,
              sel.x >= 0
                ? btn(t('game.toShelf'), 'tobin', () => this.actions.toBin(sel.id), { small: true })
                : s.lesson && s.lessonWants !== 'sell'
                  ? null
                  : btn(t('game.sellFor', { amount: money(RULES.sellValue) }), 'sell', () => this.actions.sell(sel.id), { small: true }),
            ),
          ),
        ),
      );
    } else if (!s.lesson)
      this.side.append(
        h(
          'div',
          { class: 'jd-dim', tid: 'build-help', style: 'font-size:0.8125em; margin-top:0.4em' },
          t(coarsePointer() ? 'game.buildHelpTouch' : 'game.buildHelp'),
        ),
      );
    // Buy a belt stands beside Start, in the row that stays at the panel's foot on a phone: as its own row above, the sticky row covered
    // it on a 360-pixel phone (the ninth panel: "half hidden behind the forecast line")
    const buy =
      (s.lesson ? s.lessonWants === 'buy' : !s.playbackPending) &&
      btn(t('game.buyBelt', { cost: money(RULES.beltCost) }), 'buy-belt', () => this.actions.buyBelt(), {
        disabled: canBuyBelt(r) != null,
        title: t('game.buyBeltTitle'),
      });
    this.side.append(
      h(
        'div',
        { class: 'jd-run-row' }, // sticky at the panel's bottom on a phone: the primary action stays in reach while the panel scrolls (0.10.0)
        this.forecast(r),
        h(
          'div',
          { class: 'jd-run-actions' },
          buy || null,
          h(
            'button',
            { class: 'jd-btn jd-btn-dark jd-run', tid: 'run', type: 'button', disabled: s.lesson && !s.lessonReady, onClick: () => this.actions.startRun() },
            t('game.startShift', { n: r.round }),
          ),
        ),
      ),
    );
    this.side.append(this.legend());
  }

  /** What this line will do, worked out by running it: the shift is exact, so a part that helps or a belt that breaks the line shows at once. */
  private forecast(r: RunState): HTMLElement {
    const will = runLayout(r.layout);
    const last = r.rounds[r.rounds.length - 1]?.earned;
    const change = last === undefined ? 0 : will.earned - last;
    const pay = t('game.forecast', { amount: money(will.earned) });
    const job = r.job;
    const onCourse = job ? shippedTotal(r, job.material) + will.shipped[job.material] * (shiftsOf(r.seed) - r.round + 1) : 0;
    const order = orderFor(r);
    if (order !== null) {
      const fills = will.earned >= order;
      return h(
        'div',
        { class: 'jd-forecast', tid: 'forecast', role: 'status' },
        h(
          'div',
          { class: will.earned > 0 ? 'jd-gold' : 'jd-red', tid: 'forecast-pay' },
          change > 0
            ? `${pay} ${t('game.forecastUp', { amount: money(change) })}`
            : change < 0
              ? `${pay} ${t('game.forecastDown', { amount: money(-change) })}`
              : pay,
        ),
        h(
          'div',
          { class: fills ? 'jd-green' : 'jd-amber', tid: 'forecast-job' },
          fills ? t('game.forecastFills', { order: money(order) }) : t('game.forecastShort', { amount: money(order - will.earned), order: money(order) }),
        ),
        planUnderway(r) ? h('div', { class: 'jd-dim', tid: 'forecast-dip', style: 'font-size:0.8125em' }, t('game.planDip')) : null,
      );
    }
    return h(
      'div',
      { class: 'jd-forecast', tid: 'forecast', role: 'status' },
      h(
        'div',
        { class: will.earned > 0 ? 'jd-gold' : 'jd-red', tid: 'forecast-pay' },
        change > 0
          ? `${pay} ${t('game.forecastUp', { amount: money(change) })}`
          : change < 0
            ? `${pay} ${t('game.forecastDown', { amount: money(-change) })}`
            : pay,
      ),
      job
        ? h(
            'div',
            { class: 'jd-dim', tid: 'forecast-job' },
            t('game.forecastJob', {
              marks: starMarks(starsFor(job, onCourse)),
              n: int(onCourse),
              target: int(jobTarget(job)),
              mat: materialMany(job.material),
            }),
          )
        : null,
    );
  }

  private lineChanged(r: RunState): boolean {
    const was = r.rounds[r.rounds.length - 1]?.layout;
    const sig = (machines: readonly Machine[]) =>
      machines
        .map((m) => `${m.id}.${m.x}.${m.y}.${m.dir}`)
        .sort()
        .join();
    return !!was && sig(was.machines) !== sig(r.layout.machines);
  }

  /** What things sell for: built once and re-appended (it never changes on one yard); closed until asked. */
  private legend(): HTMLElement {
    // the prices as they stand now: each order filled raises them, and a list stuck at the first shift's did not add up (the fourth panel)
    const now = this.lastState?.run.layout;
    const key = `${now?.rate ?? 100}:${now?.premium ?? ''}:${now?.premium2 ?? ''}`;
    if (this.legendEl && this.legendKey === key) return this.legendEl;
    this.legendKey = key;
    const mats: Material[] = ['scrap', 'shards', 'plate', 'ingot', 'slag'];
    const notes: Record<Material, string> = {
      scrap: t('game.valueScrap'),
      shards: t('game.valueShards'),
      plate: t('game.valuePlate', { n: RULES.pressShards }),
      ingot: t('game.valueIngot'),
      slag: t('game.valueSlag'),
    };
    const premium = now ?? { premium: undefined };
    const details = h(
      'details',
      { class: 'jd-legend' },
      h('summary', { class: 'jd-head jd-legend-head' }, t('game.values')),
      ...mats.map((m) =>
        h(
          'div',
          { class: 'jd-row', style: 'gap:0.5em; margin-top:0.15em; font-size:0.8125em' },
          textureImg(this.scene.game, `i-${m}`, materialName(m)),
          h('span', { style: 'width:6.5em' }, t('game.valueRow', { name: cap(materialName(m)), price: money(priceOf(premium, m)) })),
          h('span', { class: 'jd-dim', style: 'font-size:0.9em' }, notes[m]),
        ),
      ),
      h(
        'div',
        { class: 'jd-dim', style: 'font-size:0.6875em; margin-top:0.4em' },
        t('game.timing', {
          hopper: RULES.hopperPeriod,
          crusher: RULES.process.crusher,
          press: RULES.process.press,
          furnace: RULES.process.furnace,
          round: RULES.ticksPerRound,
        }),
      ),
    );
    this.legendEl = details;
    return details;
  }

  // ---------- the shift's result in the panel, a badge on each machine in the yard ----------
  private renderSummary(s: PanelState, r: RunState) {
    const rec = r.rounds[r.rounds.length - 1];
    const res = rec.result;
    this.side.append(this.shiftCard(r));
    this.side.append(h('div', { class: 'jd-head', style: 'margin-top:0.6em' }, t('game.shippedHead')));
    const mats: Material[] = ['ingot', 'plate', 'shards', 'scrap', 'slag'];
    let any = false;
    for (const m of mats)
      if (res.shipped[m]) {
        any = true;
        const each = priceOf(rec.layout, m);
        this.side.append(
          h(
            'div',
            { class: 'jd-row', style: 'gap:0.5em; margin-top:0.25em; font-size:0.875em' },
            textureImg(this.scene.game, `i-${m}`, materialName(m)),
            t('game.shippedRow', { n: res.shipped[m], mat: materialName(m), each: money(each), total: money(res.shipped[m] * each) }),
          ),
        );
      }
    if (!any) this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, t('game.nothing')));
    if (!s.lesson) {
      // what held the line (production roadmap 0.8.8), after what the job is missing; the pick and the build keep showing it
      const bottleneck = analyseRound(rec.layout, res, rec.round + 1);
      const missing = missingForJob(r);
      const prior = r.rounds[r.rounds.length - 2];
      const again = !missing && !!prior && sameLimit(bottleneck, analyseRound(prior.layout, prior.result, rec.round));
      this.side.append(h('div', { class: 'jd-head', style: 'margin-top:0.6em' }, t('game.heldHead')));
      this.side.append(
        h(
          'div',
          { class: !missing && bottleneck.kind === 'balanced' ? 'jd-green' : 'jd-amber', tid: 'bottleneck', style: 'font-size:0.8125em' },
          missing ?? (again ? againLine(bottleneck) : bottleneckLine(bottleneck)),
        ),
      );
    }
    if (r.rounds.length > 1) {
      this.side.append(h('div', { class: 'jd-head', style: 'margin-top:0.6em' }, t('game.historyHead')));
      this.side.append(
        h(
          'div',
          { class: 'jd-history' },
          ...r.rounds.map((rr, i) =>
            h('span', { class: i === r.rounds.length - 1 ? 'jd-gold' : '' }, t('game.historyCell', { n: rr.round, score: money(rr.earned) })),
          ),
        ),
      );
    }
    if (r.sold) this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('game.soldParts', { amount: money(r.sold) })));
    const spent = r.rerolls * RULES.rerollCost + r.belts * RULES.beltCost;
    if (spent) this.side.append(h('div', { class: 'jd-dim', tid: 'spent', style: 'font-size:0.8125em' }, t('game.spent', { amount: money(spent) })));
    this.side.append(this.legend());
  }
  /** Where the job stands after this shift, in a line; nothing on a yard with no job. */
  private jobNote(r: RunState): HTMLElement | null {
    const rec = r.rounds[r.rounds.length - 1];
    const order = r.job?.orders?.[rec.round - 1];
    const note = (...parts: (string | HTMLElement)[]) => h('div', { class: 'jd-banner-job', tid: 'job-pace' }, ...parts);
    if (order !== undefined) {
      const won = rec.earned >= order;
      return note(
        h(
          'span',
          { class: won ? 'jd-gold jd-banner-won' : 'jd-amber' },
          won ? t('job.filled', { raise: RULES.job.raise }) : t('job.missed', { amount: money(order - rec.earned) }),
        ),
        ` ${t('job.filledCount', { n: r.filled, total: r.job?.orders?.length ?? 0 })}`,
      );
    }
    const p = paceOf(r);
    if (!p || !r.job) return null;
    const done = t('job.shift', { n: int(p.thisShift), mat: materialOf(r.job.material, p.thisShift) });
    return note(p.nextStar == null ? `${done} · ${t('job.got')}` : done);
  }
  /** Against Sal's game on this yard, money for money. His game is worked out the first time it is asked for, so a saved game picks it up by its next shift. */
  private salRace(r: RunState): HTMLElement | null {
    if (!r.job?.orders || this.replayMode) return null;
    const sal = salKnown(r.seed);
    if (!sal) {
      salLater(r.seed, () => {});
      return null;
    }
    const lead = r.score - (sal.after[r.rounds.length - 1] ?? 0); // his money as it stood, as yours does: what he paid for new offers counts (the sixth panel)
    const text = lead > 0 ? t('job.salAhead', { amount: money(lead) }) : lead < 0 ? t('job.salBehind', { amount: money(-lead) }) : t('job.salLevel');
    return h('div', { class: lead >= 0 ? 'jd-green jd-banner-job' : 'jd-dim jd-banner-job', tid: 'sal-race' }, text);
  }
  /** Against the shift before: a pick that worked has to show. */
  private shiftChange(r: RunState): HTMLElement | null {
    const n = r.rounds.length;
    if (n < 2) return null;
    const change = r.rounds[n - 1].earned - r.rounds[n - 2].earned;
    return h(
      'div',
      { class: change > 0 ? 'jd-green' : 'jd-dim', tid: 'shift-change', style: 'font-size:0.875em; font-weight:600' },
      change > 0 ? t('game.shiftUp', { amount: money(change) }) : change < 0 ? t('game.shiftDown', { amount: money(-change) }) : t('game.shiftSame'),
    );
  }
  /** A shift that beat the last one: the gain lands on the yard, big, where the eyes are. */
  cheer(gain: number) {
    this.cheerText(t('game.cheer', { amount: money(gain) }));
  }
  private cheerText(text: string) {
    const el = h('div', { class: 'jd-star-pop jd-star-pop-quiet jd-cheer', tid: 'cheer' }, h('span', { class: 'jd-gold' }, text));
    this.boardEl.append(el);
    setTimeout(() => el.remove(), prefs.reducedMotion ? 2600 : 1900);
  }
  /** The shift's result: what it made, where the job stands, and the way on. */
  private shiftCard(r: RunState): HTMLElement {
    const rec = r.rounds[r.rounds.length - 1];
    const last = r.round >= RULES.rounds;
    const note = this.jobNote(r);
    return h(
      'div',
      { class: 'jd-banner', tid: 'shift-card' },
      h(
        'div',
        { style: 'min-width:0; flex:1 1 12em' },
        h('div', { class: 'jd-head' }, t('game.roundResult', { n: rec.round })),
        h(
          'div',
          { class: 'jd-row', style: 'gap:0.6em; align-items:baseline; flex-wrap:nowrap' },
          h('span', { class: 'jd-gold jd-banner-money' }, money(rec.earned)),
          h(
            'span',
            { class: 'jd-dim', style: 'font-size:0.8125em' },
            r.rounds.length > 1 ? t('game.thisRoundTotal', { total: money(r.score) }) : t('game.thisRound'),
          ),
        ),
        this.shiftChange(r),
        note,
        this.salRace(r),
        this.bannerForeman
          ? h(
              'div',
              { class: 'jd-foreman-text jd-dim jd-banner-foreman', tid: 'foreman-banner', title: this.bannerForeman },
              `${t('foreman.name')}: ${this.bannerForeman}`,
            )
          : null,
      ),
      btn(last ? t('game.finalScore') : t('game.nextRound'), 'next', () => this.actions.nextRound(), { variant: 'primary' }),
      this.replayMode && !last
        ? btn(t('game.tryHere', { n: r.rounds.length }), 'fork-here', () => this.actions.forkHere(), { small: true, title: t('game.tryHereTitle') })
        : null, // PLAN-v4 0.7.3
      this.replayMode && this.actions.reportName
        ? btn(t('game.reportName'), 'report-name', () => this.actions.reportName!(), { small: true, title: t('game.reportNameTitle') })
        : null,
    );
  }
  /** A badge on each machine: what it actually did this shift. */
  showSummaryOverlay(r: RunState) {
    const rec = r.rounds[r.rounds.length - 1];
    const res = rec.result;
    const g = r.layout;
    const layer = this.gridLayer;
    layer.replaceChildren();
    layer.append(h('div', { class: 'jd-grid-dim' }));
    const limit = analyseRound(rec.layout, res, rec.round + 1);
    const culprit = limit.machine?.id;
    // a machine that sat idle for want of scrap did not hold anything back: the badge says what it waited for, as the summary does (the fifth panel)
    const heldUp = limit.kind === 'starved' ? t('game.badgeStarved') : t('game.badgeHeldUp');
    for (const m of g.machines) {
      const st = res.cellStats[cellIndex(m.x, m.y, g.width)];
      let line1 = '';
      let line2 = '';
      let cls = '';
      let warn = true;
      if (m.kind === 'hopper') {
        if (!st) line1 = t('game.badgeIdle');
        else if (m.id === culprit) line2 = t('game.badgeBlocked', { n: int(st.blockedTicks) });
        if (!st) cls = 'jd-dim';
      } else if (m.kind === 'dock') {
        if (st && st.shipped) {
          line1 = money(st.earned);
          cls = 'jd-green';
          warn = false;
        } else {
          line1 = t('game.badgeNoItems');
          cls = 'jd-dim';
        }
      } else if (m.kind === 'crusher' || m.kind === 'furnace' || m.kind === 'press') {
        if (!st || !st.passed) line1 = t('game.badgeUnused'); // the rest is on the machine: a tap says what it made, and a phone has no room for it
        if (!st || !st.processed) cls = 'jd-dim';
        if (st && m.id === culprit) line2 = heldUp;
        else if (m.kind === 'press' && st && st.stored) {
          line2 = t('game.badgeHeld', { n: int(st.stored) });
          warn = false;
        }
      } else if (m.kind === 'tuner') {
        if (st && st.tuned) {
          line1 = t('game.badgeSped', { n: int(st.tuned) });
          cls = 'jd-green';
          warn = false;
        } else {
          line1 = t('game.badgeNothingToTune');
          cls = 'jd-dim';
        }
      } else {
        if (st && m.id === culprit) line2 = heldUp;
        else if (!st || !st.passed) {
          line1 = t('game.badgeUnused');
          cls = 'jd-dim';
        }
      }
      if (!line1 && !line2) continue;
      const top = m.id === culprit; // the one that matters stands clear of the labels along the bottom of the cells beside it
      layer.append(
        h(
          'div',
          {
            class: `jd-badge${top ? ' jd-badge-top' : ''}`,
            style: `left:${em(m.x * CELL + CELL / 2)}; top:${em(top ? m.y * CELL + 2 : (m.y + 1) * CELL - 2)}`,
          }, // inside the grid layer, which sits on the drawn grid
          line1 ? h('div', { class: cls }, line1) : null,
          line2 ? h('div', { class: warn ? 'jd-red' : 'jd-dim' }, line2) : null,
        ),
      );
    }
  }
  showPauseVeil(on: boolean, tick?: number) {
    this.gridLayer.replaceChildren();
    if (on)
      this.gridLayer.append(
        h(
          'div',
          { class: 'jd-grid-dim jd-grid-dim-strong' },
          h(
            'div',
            { class: 'jd-paused', tid: 'paused-veil' },
            t('game.pausedVeil'),
            h(
              'div',
              { style: 'font-size:0.5em; font-weight:400' },
              tick != null ? t('game.pausedHelp', { tick: int(tick), total: RULES.ticksPerRound }) : t('game.pausedHelpNoTick'),
            ),
          ),
        ),
      );
  }
  clearGridLayer() {
    this.gridLayer.replaceChildren();
  }
}

/** Stylesheet for the game chrome (appended to the shared one by dom.ts consumers). */
export const GAME_STYLE = `
#ui .jd-screen.jd-game { position: absolute; inset: 0; pointer-events: none; overflow: hidden; display: grid; padding: 0.5em; gap: 0.5em; max-width: 1400px; margin: 0 auto;
  grid-template-columns: minmax(0, 1fr) clamp(19em, 34%, 27em); grid-template-rows: auto minmax(0, 1fr); grid-template-areas: ${areas([
    ['hud', 'hud'],
    ['board', 'side'],
  ])}; }
#ui .jd-game > * { pointer-events: auto; min-width: 0; }
#ui .jd-hud { grid-area: hud; min-height: 3.6em; background: var(--jd-glass); border: 1px solid var(--jd-line); border-radius: var(--jd-radius); box-shadow: var(--jd-shadow); display: flex; align-items: center; gap: 1em; padding: 0.35em 0.8em; }
#ui .jd-hud-where { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; flex: 0 1 auto; }
#ui .jd-hud-seed { font-size: 0.75em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 14em; }
#ui .jd-hud-round { font-family: var(--jd-display); font-weight: 700; letter-spacing: 0.02em; font-size: 1.125em; white-space: nowrap; }
#ui .jd-hud-scoreblock { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; flex: 0 1 auto; overflow: hidden; text-align: right; align-items: flex-end; }
#ui .jd-hud-score { font-family: var(--jd-display); font-size: 1.5em; font-weight: 700; display: inline-block; transform-origin: right center; }
#ui .jd-hud-best, #ui .jd-hud-stall { font-size: 0.6875em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 16em; }
#ui .jd-pulse { animation: jd-pulse 0.3s ease-out; }
@keyframes jd-pulse { from { transform: scale(1.35); } to { transform: scale(1); } }
#ui .jd-job { flex: 1 1 14em; min-width: 0; display: flex; flex-direction: column; gap: 0.25em; }
#ui .jd-job-top { display: flex; align-items: baseline; gap: 0.75em; min-width: 0; }
#ui .jd-job-goal-line { font-family: var(--jd-display); font-weight: 700; font-size: 1.125em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
#ui .jd-job-count { font-size: 0.75em; color: ${'#a89d88'}; white-space: nowrap; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; min-width: 0; margin-right: auto; }
#ui .jd-pips { display: inline-flex; gap: 0.25em; flex: 0 0 auto; margin-left: auto; }
#ui .jd-pip { width: 0.6em; height: 0.6em; border-radius: 50%; border: 1px solid #6b6252; display: inline-block; }
#ui .jd-pip.on { background: #f5c542; border-color: #f5c542; box-shadow: 0 0 0.3em rgba(245, 197, 66, 0.7); }
#ui .jd-pip.off { background: #eb6757; border-color: #eb6757; opacity: 0.7; }
#ui .jd-pip.now { border-color: #f5c542; }
#ui .jd-job-track { position: relative; height: 1.15em; display: flex; align-items: center; }
#ui .jd-job-bar { position: relative; flex: 1; height: 0.5em; border-radius: 0.25em; background: #15120e; box-shadow: inset 0 1px 2px rgba(0,0,0,0.6); overflow: hidden; }
#ui .jd-job-star { position: absolute; top: 50%; transform: translate(-50%, -50%); font-size: 1.125em; line-height: 1; color: #6b6252; text-shadow: 0 0 2px #15120e, 0 0 2px #15120e; }
#ui .jd-job-star.on { color: #f5c542; text-shadow: 0 0 0.5em rgba(245, 197, 66, 0.6), 0 0 2px #15120e; }
#ui .jd-job-star.jd-pulse { animation: jd-star 0.45s ease-out; }
@keyframes jd-star { from { transform: translate(-50%, -50%) scale(2); } to { transform: translate(-50%, -50%) scale(1); } }
#ui .jd-job-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: linear-gradient(90deg, #d08a22, #f5c542); transition: width 0.25s ease-out; }
#ui .jd-board { grid-area: board; position: relative; min-height: 0; min-width: 0; pointer-events: none; --px: calc(var(--cell, 72px) / 72); }
#ui .jd-board > * { pointer-events: none; }
#ui .jd-side { grid-area: side; position: relative; min-height: 0; background: var(--jd-glass); border: 1px solid var(--jd-line); border-radius: var(--jd-radius); box-shadow: var(--jd-shadow); padding: 0.75em 0.9em; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
#ui .jd-side > * { flex-shrink: 0; } /* the 44 px touch minimum replaces the content-based minimum, so without this the column would squeeze the cards */
#ui .jd-steps-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; }
#ui .jd-steps { display: flex; gap: 0.2em; list-style: none; margin: 0; padding: 0; font-family: var(--jd-display); font-weight: 600; letter-spacing: 0.04em; }
#ui .jd-steps li { padding: 0.1em 0.65em; border-radius: 1em; color: #7d7364; font-size: 0.9375em; }
#ui .jd-steps li + li::before { content: '›'; margin: 0 0.45em 0 -0.35em; color: #5f574a; }
#ui .jd-steps li.done { color: #a89d88; }
#ui .jd-steps li.on { background: #f0a830; color: #1a1612; }
#ui .jd-steps li.on::before { color: transparent; margin-left: -0.9em; }
#ui .jd-coach { display: flex; gap: 0.6em; align-items: center; margin-top: 0.55em; padding: 0.55em 0.65em; border-radius: 0.5em; background: linear-gradient(90deg, rgba(240,168,48,0.2), rgba(240,168,48,0.07)); border: 1px solid rgba(240,168,48,0.4); }
#ui .jd-coach-face { flex: 0 0 auto; width: 2.5em; height: 2.5em; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--jd-display); font-weight: 700; font-size: 0.8125em; letter-spacing: 0.04em; color: #1a1612; background: radial-gradient(circle at 35% 30%, #ffd98a, #d08a22); box-shadow: 0 1px 3px rgba(0,0,0,0.5); }
#ui .jd-coach-text { font-weight: 600; font-size: 1em; line-height: 1.28; min-width: 0; }
#ui .jd-advice { display: flex; gap: 0.5em; align-items: center; margin-top: 0.45em; padding: 0.4em 0.6em; border-radius: 0.4em; background: rgba(90, 169, 230, 0.1); border: 1px solid rgba(90, 169, 230, 0.32); font-size: 0.8125em; }
#ui .jd-advice-text { min-width: 0; flex: 1; }
#ui .jd-advice .jd-btn { flex: 0 0 auto; }
#ui .jd-advice-old { opacity: 0.5; }
#ui .jd-toast { position: absolute; max-width: min(92%, 22em); background: rgba(30, 26, 21, 0.98); border: 1px solid #3f382d; border-left: 3px solid #eb6757; padding: 0.45em 0.7em; font-size: 0.8125em; line-height: 1.3; border-radius: 0.4em; box-shadow: 0 2px 10px rgba(0,0,0,0.5); pointer-events: none; z-index: 3; }
#ui .jd-toast-warning { border-left-color: #f0a830; }
#ui .jd-toast-note { border-left-color: #8fb3d0; }
#ui .jd-toast::after { content: ''; position: absolute; left: calc(50% + var(--arrow, 0px)); bottom: -${em(7)}; margin-left: -${em(6)}; border: ${em(6)} solid transparent; border-top-color: #3f382d; border-bottom: 0; }
#ui .jd-toast-below::after { bottom: auto; top: -${em(7)}; border-top: 0; border-bottom: ${em(6)} solid #3f382d; }
#ui .jd-board > .jd-inspect { position: absolute; width: 20em; max-width: 100%; z-index: 4; pointer-events: auto; background: rgba(30, 26, 21, 0.98); border: 1px solid #5f574a; border-radius: 0.6em; box-shadow: 0 6px 18px rgba(0,0,0,0.55); padding: 0.6em 0.7em; font-size: 0.8125em; }
#ui .jd-inspect-body { display: flex; flex-direction: column; gap: 0.3em; }
#ui .jd-inspect-head { display: flex; gap: 0.6em; align-items: flex-start; }
#ui .jd-inspect-head img { width: 3em; height: 3em; flex: 0 0 auto; }
#ui .jd-inspect-name { font-family: var(--jd-display); font-weight: 700; font-size: 1.25em; line-height: 1.1; }
#ui .jd-inspect-row { display: flex; gap: 0.6em; }
#ui .jd-inspect-row > :first-child { flex: 0 0 5.2em; }
#ui .jd-inspect .jd-btn { align-self: flex-end; }
#ui .jd-gridlayer, #ui .jd-spotlayer { position: absolute; left: var(--bx, 0px); top: var(--by, 0px); width: ${em(GRID_W)}; height: ${em(GRID_H)}; pointer-events: none; }
#ui .jd-spotlayer { z-index: 2; }
#ui .jd-gridlayer > * { pointer-events: none; }
#ui .jd-ring-soft { opacity: 0.6; animation: none; }
#ui .jd-ring-inspect { border-color: #f5c542; box-shadow: 0 0 0.6em rgba(245,197,66,0.7); animation: none; }
#ui .jd-ring { position: absolute; border: ${em(4)} solid #6fe0ff; border-radius: ${em(10)}; box-shadow: 0 0 ${em(16)} ${em(2)} rgba(111,224,255,0.75), inset 0 0 ${em(12)} rgba(111,224,255,0.4); animation: jd-ring 1.1s ease-in-out infinite; }
@keyframes jd-ring { 50% { transform: scale(1.06); opacity: 0.65; } }
#ui .jd-spot { outline: 3px solid #6fe0ff; outline-offset: 2px; box-shadow: 0 0 1.1em rgba(111,224,255,0.75); animation: jd-spot 1.1s ease-in-out infinite; }
@keyframes jd-spot { 50% { outline-color: rgba(111,224,255,0.35); box-shadow: 0 0 0.4em rgba(111,224,255,0.3); } }
#ui.jd-reduced-motion .jd-ring, #ui.jd-reduced-motion .jd-spot, #ui.jd-reduced-motion .jd-offer-gone, #ui.jd-reduced-motion .jd-star-pop { animation: none; }
#ui .jd-star-pop { position: absolute; left: 50%; top: 30%; transform: translate(-50%, -50%); z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 0.1em; padding: 0.5em 1.4em; border-radius: 0.8em; background: rgba(20, 17, 13, 0.92); border: 2px solid #f5c542; font-family: var(--jd-display); font-weight: 700; font-size: 1.5em; white-space: nowrap; box-shadow: 0 0 2em rgba(245,197,66,0.5); animation: jd-star-pop 1.9s ease-out forwards; }
#ui .jd-cheer { top: 58%; font-size: 1.75em; white-space: nowrap; }
#ui .jd-star-pop-quiet { padding: 0; border: 0; background: none; box-shadow: none; font-size: 2.25em; text-shadow: 0 0 0.5em rgba(245,197,66,0.8), 0 2px 4px #1a1612; }
@keyframes jd-star-pop { 0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } 12% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; } 20% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { transform: translate(-50%, -80%) scale(1); opacity: 0; } }
#ui .jd-grid-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.3); }
#ui .jd-grid-dim-strong { background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }
#ui .jd-paused { font-family: var(--jd-display); font-size: 2em; font-weight: 700; text-align: center; }
#ui .jd-badge { position: absolute; transform: translate(-50%, -100%); background: rgba(0,0,0,0.82); border-radius: 0.3em; padding: 0.1em 0.35em; font-size: max(0.625em, 9px); font-weight: 700; line-height: 1.2; white-space: nowrap; text-align: center; }
#ui .jd-banner { margin-top: 0.5em; background: rgba(20, 17, 13, 0.6); border: 2px solid #f0a830; border-radius: 0.5em; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5em 0.75em; padding: 0.4em 0.7em; }
#ui .jd-banner-money { font-family: var(--jd-display); font-size: 2em; font-weight: 700; line-height: 1; }
#ui .jd-banner-job { font-size: 0.8125em; font-weight: 600; color: #f1e8d8; }
#ui .jd-banner-won { font-family: var(--jd-display); font-size: 1.3em; font-weight: 700; display: block; }
#ui .jd-ribbon { position: absolute; left: 0; right: 0; top: 36%; z-index: 5; pointer-events: none; text-align: center; padding: 0.3em 0 0.35em; background: linear-gradient(90deg, rgba(245, 197, 66, 0) 0%, rgba(245, 197, 66, 0.94) 10%, rgba(255, 228, 140, 0.98) 50%, rgba(245, 197, 66, 0.94) 90%, rgba(245, 197, 66, 0) 100%); color: #2a1e08; font-family: var(--jd-display); font-weight: 700; font-size: 1.875em; line-height: 1.05; text-transform: uppercase; letter-spacing: 0.03em; box-shadow: 0 0 1.4em rgba(245, 197, 66, 0.55); animation: jd-ribbon 1.5s ease-out both; }
#ui .jd-ribbon small { display: block; font-family: var(--jd-body, inherit); font-size: 0.5em; font-weight: 600; text-transform: none; letter-spacing: 0; }
@keyframes jd-ribbon { 0% { transform: scaleX(0.15); opacity: 0; } 12% { transform: scaleX(1.05); opacity: 1; } 22% { transform: scaleX(1); } 78% { opacity: 1; } 100% { opacity: 0; } }
#ui.jd-reduced-motion .jd-ribbon { animation: none; }
#ui .jd-banner-foreman { font-size: 0.75em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui .jd-progress { height: 0.6em; border-radius: 0.3em; overflow: hidden; background: #15120e; margin-top: 0.75em; }
#ui .jd-progress-fill { height: 100%; width: 0; background: linear-gradient(90deg, #d08a22, #f0a830); }
#ui .jd-earned { font-family: var(--jd-display); font-size: 1.5em; font-weight: 700; margin-top: 0.3em; }
#ui .jd-offer { display: flex; align-items: center; gap: 0.75em; width: 100%; text-align: left; font: inherit; color: inherit; background: linear-gradient(180deg, #37302a, #2a241d); border: 2px solid #4a4235; border-radius: 0.6em; padding: 0.5em 0.7em; margin-top: 0.5em; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.35); transition: transform 0.12s ease, border-color 0.12s ease; }
#ui .jd-offer:hover { border-color: #f0a830; transform: translateY(-1px); }
#ui .jd-offer-need { border-color: #8f6b2a; }
#ui .jd-offer-off { opacity: 0.45; cursor: default; }
#ui .jd-offer-off:hover { border-color: inherit; transform: none; }
#ui .jd-about { display: flex; flex-direction: column; gap: 0.45em; margin-top: 0.5em; }
#ui .jd-about:empty { display: none; }
#ui .jd-about-row { display: flex; gap: 0.6em; align-items: center; font-size: 0.875em; line-height: 1.25; }
#ui .jd-about-row img { width: 2.6em; height: 2.6em; flex: 0 0 auto; }
#ui .jd-offer img { width: 3.6em; height: 3.6em; flex: 0 0 auto; }
#ui .jd-badge-top { transform: translate(-50%, 0); z-index: 1; }
#ui .jd-offer-text { flex: 1; min-width: 0; }
#ui .jd-offer-name { font-family: var(--jd-display); font-weight: 700; font-size: 1.25em; line-height: 1.1; }
#ui .jd-offer-blurb { font-size: 0.8125em; line-height: 1.25; margin-top: 0.1em; }
#ui .jd-offer-worth { font-size: 0.8125em; font-weight: 600; margin-top: 0.1em; }
#ui .jd-offer-badge { display: inline-block; font-size: 0.6875em; font-weight: 700; color: #1a1612; background: #f5c542; border-radius: 0.3em; padding: 0.02em 0.45em; margin-top: 0.15em; }
#ui .jd-offer-gone { position: absolute; margin: 0; pointer-events: none; animation: jd-truck 0.4s cubic-bezier(0.55, 0, 0.85, 0.35) forwards; z-index: 2; }
@keyframes jd-truck { to { transform: translateX(120%) rotate(4deg); opacity: 0; } }
#ui .jd-sel { display: flex; gap: 0.75em; align-items: flex-start; background: #2a241d; border: 1px solid #4a4235; border-radius: 0.5em; padding: 0.5em 0.7em; margin-top: 0.45em; }
#ui .jd-sel img { width: 3.2em; height: 3.2em; flex: 0 0 auto; }
#ui .jd-run-row { margin-top: 0.6em; }
#ui .jd-forecast { font-size: 0.875em; font-weight: 600; margin-bottom: 0.35em; line-height: 1.25; }
#ui .jd-forecast .jd-dim { font-size: 0.875em; font-weight: 400; }
#ui .jd-run { width: 100%; font-family: var(--jd-display); font-size: 1.375em; padding: 0.5em 0; letter-spacing: 0.02em; }
#ui .jd-run-actions { display: flex; gap: 0.5em; align-items: stretch; }
#ui .jd-run-actions .jd-run { flex: 1 1 auto; min-width: 0; }
#ui .jd-run-actions > [data-testid=buy-belt] { flex: 0 0 auto; white-space: nowrap; }
#ui .jd-coach > .jd-btn { flex: 0 0 auto; white-space: nowrap; }
#ui .jd-run.jd-spot { background: linear-gradient(180deg, #ffc24d, #e0932a); color: #1a1612; border-color: rgba(0, 0, 0, 0.35); }
#ui .jd-lesson-ways { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 1.4em; }
#ui .jd-skip { align-self: center; margin-top: 0.5em; font-size: 0.8125em; color: #a89d88; }
#ui .jd-legend { margin-top: auto; padding-top: 0.75em; }
#ui .jd-legend-head { font-size: 0.75em; cursor: pointer; list-style-position: inside; }
#ui .jd-legend img { width: 1.1em; height: 1.1em; }
#ui .jd-history { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.2em 0.5em; font-size: 0.875em; }
#ui .jd-replay-banner { font-size: 0.6875em; font-weight: 700; letter-spacing: 0.08em; border: 1px solid #5aa9e6; background: rgba(90,169,230,0.18); padding: 0.2em 0.5em; border-radius: 0.3em; white-space: nowrap; }
@media ${COMPACT_MQ} {
  #ui .jd-screen.jd-game { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr); grid-template-areas: ${areas([['hud'], ['board'], ['side']])}; padding: 0.35em; gap: 0.35em; }
  #ui .jd-board { height: min(calc((100vw - 0.7em) * ${BOARD_H / BOARD_W}), 50dvh); }
  #ui .jd-hud { min-height: 2.75em; padding: 0.25em 0.5em; gap: 0.3em 0.6em; flex-wrap: wrap; }
  #ui .jd-hud-best { display: none; }
  #ui .jd-hud-seed { display: none; }
  #ui .jd-hud-where { flex: 1 1 auto; }
  #ui .jd-hud-scoreblock { flex: 0 0 auto; overflow: visible; } /* the score stays whole, and its pulse keeps its dollar sign */
  #ui .jd-job { order: 5; flex: 1 1 100%; }
  #ui .jd-banner-foreman { display: none; }
  #ui .jd-offer { padding: 0.25em 0.55em; margin-top: 0.3em; gap: 0.55em; }
  #ui .jd-offer-name { font-size: 1.0625em; }
  #ui .jd-offer-blurb { font-size: 0.75em; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
  #ui .jd-offer-badge { margin-top: 0; }
  #ui .jd-sel { padding: 0.3em 0.5em; align-items: center; margin-top: 0.3em; }
  #ui .jd-sel img { width: 2.4em; height: 2.4em; }
  #ui .jd-sel .jd-dim { display: none; }
  #ui .jd-sel .jd-row { margin-top: 0.15em !important; }
  #ui .jd-coach { margin-top: 0.3em; padding: 0.3em 0.5em; }
  #ui .jd-coach-text { font-size: 0.9375em; }
  #ui .jd-run { font-size: 1.1875em; padding: 0.35em 0; }
  #ui .jd-board > .jd-inspect { left: 0 !important; right: 0; top: auto !important; bottom: 0; width: auto; transform: none !important; } /* a sheet: the piece stays in view */
  #ui .jd-board > .jd-inspect.jd-inspect-top { top: 0 !important; bottom: auto; }
  #ui .jd-offer img { width: 2.5em; height: 2.5em; }
  #ui .jd-side { padding: 0.5em 0.6em; border-radius: 0.8em 0.8em 0 0; }
  #ui .jd-banner { padding: 0.3em 0.6em; gap: 0.3em 0.5em; }
  #ui .jd-run-row { position: sticky; bottom: -0.5em; padding: 0.4em 0; background: rgba(36, 32, 26, 0.97); z-index: 1; }
}
@media ${TABLET_MQ} {
  #ui .jd-board { height: min(calc((100vw - 0.7em) * ${BOARD_H / BOARD_W}), 46dvh); } /* a portrait tablet: the sheet keeps room for three offers at 130 % */
}
@media ${LANDSCAPE_MQ} {
  #ui .jd-screen.jd-game { grid-template-columns: minmax(0, 1fr) clamp(15em, 38%, 22em); grid-template-rows: auto minmax(0, 1fr); grid-template-areas: ${areas([
    ['hud', 'side'],
    ['board', 'side'],
  ])}; padding: 0.35em; gap: 0.35em; }
  #ui .jd-hud { min-height: 2.5em; padding: 0.2em 0.5em; gap: 0.5em; flex-wrap: nowrap; }
  #ui .jd-hud-where, #ui .jd-hud-best { display: none; }
  #ui .jd-job-count { display: none; }
  #ui .jd-side { padding: 0.5em 0.6em; }
  #ui .jd-run-row { position: sticky; bottom: -0.5em; padding: 0.4em 0; background: rgba(36, 32, 26, 0.97); z-index: 1; }
}
`;
