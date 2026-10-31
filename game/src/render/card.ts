/**
 * Share card (PLAN-v4 0.7.4): a 1200×630 PNG of a run, rendered on the device and downloaded like the GIF, never
 * uploaded. It says exactly what the run is: the verified standing only when this run's replay was accepted by a
 * verifier, the medal only when the day is frozen, the group rank only when a group board is in use, the challenge
 * outcome only when one was played, and "unverified" or "practice fork" otherwise. The text is composed by a pure
 * function so a test can pin every wording; the canvas just draws it.
 */
import { roundGlyph, seedLabel, standingText, outcomeText, type Rank } from './share';
import { RULES } from '../sim/rules';
import { t } from '../content/strings';
import { money, int } from '../content/format';

export const CARD_W = 1200,
  CARD_H = 630;
export interface CardInput {
  seed: string;
  score: number;
  rounds: number[];
  rulesVersion: number;
  player?: string;
  verified: boolean;
  rank?: Rank | null;
  percentile?: number | null;
  n?: number;
  medal?: string | null;
  group?: { name: string } | null;
  challenge?: { player: string; score: number } | null;
  fork?: { player: string; round: number } | null;
  permalink?: string;
  build?: string;
  /** stars on the job (rules v4) */
  stars?: number;
}
export interface CardText {
  title: string;
  seedLine: string;
  score: string;
  glyphs: string;
  standing: string;
  extras: string[];
  footer: string;
}

export function cardText(i: CardInput): CardText {
  const extras: string[] = [];
  let standing: string;
  if (i.fork) standing = t('card.try', { player: i.fork.player, round: i.fork.round + 1 });
  else if (i.verified) standing = standingText({ rank: i.rank, percentile: i.percentile, n: i.n, player: i.player }) || t('card.checked');
  else standing = t('card.local');
  if (i.verified && i.group)
    extras.push(
      t('card.crew', { name: i.group.name, rank: i.rank ? t('card.crewRank', { n: i.rank.n != null ? int(i.rank.n) : '?', of: int(i.rank.of) }) : '' }),
    );
  if (i.verified && i.medal) extras.push(t('share.medal', { medal: i.medal }));
  if (i.challenge) extras.push(outcomeText(i.score, i.challenge));
  if (i.permalink) extras.push(i.permalink);
  const footer = i.fork
    ? t('card.footerTry')
    : i.verified
      ? t('card.footerChecked', { build: i.build ? t('card.footerBuild', { build: i.build }) : '' })
      : t('card.footerLocal');
  return {
    title: t('card.title'),
    seedLine: `${t('card.yardLine', { label: seedLabel(i.seed), rounds: RULES.rounds })}${i.stars == null ? '' : ` · ${'★'.repeat(i.stars)}${'☆'.repeat(3 - i.stars)}`}`,
    score: money(i.score),
    glyphs: i.rounds.map(roundGlyph).join(''),
    standing,
    extras,
    footer,
  };
}

const COL = {
  bg: '#1a1612',
  panel: '#241f19',
  amber: '#e0a84a',
  text: '#e8e0d0',
  dim: '#9a9080',
  gold: '#f2c94c',
  green: '#7bd389',
  bar: ['#4a4036', '#8e7a4a', '#c9a24a', '#f2c94c'],
} as const;
const SANS = 'system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  MONO = 'Consolas, Menlo, monospace';

/** Draw the card; returns the canvas and the composed text. Works wherever a 2D canvas exists (browser, Electron). */
export function renderCard(i: CardInput): { canvas: HTMLCanvasElement; text: CardText } {
  const text = cardText(i);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas for the share card');
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = COL.panel;
  ctx.fillRect(48, 48, CARD_W - 96, CARD_H - 96);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COL.amber;
  ctx.font = `bold 44px ${SANS}`;
  ctx.fillText(text.title, 88, 124);
  ctx.fillStyle = COL.dim;
  ctx.font = `26px ${MONO}`;
  ctx.fillText(text.seedLine, 88, 166);
  ctx.fillStyle = COL.gold;
  ctx.font = `bold 150px ${SANS}`;
  ctx.fillText(text.score, 80, 330);
  // six round bars, heights by the published share thresholds, glyph string underneath
  const levels = i.rounds.map((e) => ['░', '▒', '▓', '█'].indexOf(roundGlyph(e)));
  const x0 = 760,
    w = 48,
    gap = 14,
    base = 330,
    maxH = 180;
  i.rounds.forEach((_, k) => {
    const lvl = Math.max(0, levels[k]);
    const h = 30 + (lvl / 3) * (maxH - 30);
    ctx.fillStyle = COL.bar[lvl];
    ctx.fillRect(x0 + k * (w + gap), base - h, w, h);
  });
  ctx.fillStyle = COL.dim;
  ctx.font = `26px ${MONO}`;
  i.rounds.forEach((e, k) => {
    const g = roundGlyph(e);
    ctx.fillText(g, x0 + k * (w + gap) + (w - ctx.measureText(g).width) / 2, base + 36);
  }); // one glyph centred under each bar (a glyph string renders at unpredictable widths)
  ctx.font = `20px ${MONO}`;
  i.rounds.forEach((e, k) => {
    const s = `$${e}`;
    ctx.fillText(s, x0 + k * (w + gap) + (w - ctx.measureText(s).width) / 2, base + 72);
  });
  ctx.fillStyle = i.verified ? COL.green : COL.text;
  ctx.font = `bold 34px ${SANS}`;
  ctx.fillText(text.standing, 88, 420);
  ctx.fillStyle = COL.text;
  ctx.font = `24px ${SANS}`;
  text.extras.slice(0, 3).forEach((l, k) => ctx.fillText(l, 88, 462 + k * 34));
  ctx.fillStyle = COL.dim;
  ctx.font = `20px ${MONO}`;
  ctx.fillText(text.footer, 88, CARD_H - 72);
  if (i.player && i.verified) {
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.text;
    ctx.font = `24px ${SANS}`;
    ctx.fillText(i.player, CARD_W - 88, CARD_H - 72);
    ctx.textAlign = 'left';
  }
  return { canvas, text };
}

export interface CardResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  footer: string;
  text: CardText;
}
export async function makeCard(i: CardInput): Promise<CardResult> {
  const { canvas, text } = renderCard(i);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the canvas gave no PNG'))), 'image/png'));
  const filename = `junkyard-${i.seed.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)}-$${i.score}${i.fork ? '-fork' : ''}-card.png`;
  return { blob, filename, width: CARD_W, height: CARD_H, footer: text.footer, text };
}
/** Save like the clip: the desktop bridge when present, else a download. Returns where it went. */
export async function saveCard(card: CardResult): Promise<string> {
  const bridge = (window as unknown as { jdDesktop?: { saveClip?: (name: string, bytes: ArrayBuffer) => Promise<string> } }).jdDesktop;
  if (bridge?.saveClip) return bridge.saveClip(card.filename, await card.blob.arrayBuffer());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(card.blob);
  a.download = card.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return card.filename;
}
