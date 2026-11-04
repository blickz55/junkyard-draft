/**
 * The job card (rules v4): the first thing a game says. Where am I (the yard), what's the point (the job and its three stars),
 * how (the recipe), and one button. The same words stay on screen afterwards in the HUD.
 */
import type Phaser from 'phaser';
import { h } from './dom';
import { choiceDialog } from './choice';
import type { Job } from '../sim/yard';
import { isTutorialSeed, TUTORIAL_SEED } from '../sim/yard';
import { isWeeklySeed } from '../sim/weekly';
import { isMintedDailySeed } from '../sim/daily';
import { RULES } from '../sim/rules';
import { t } from '../content/strings';
import { int, money } from '../content/format';
import { jobFlavour, jobLine, jobPriceAfter, jobRecipe, materialMany, starMarks, truckNote, yardNote } from '../content/job';
import { machineShort } from '../content/machines';
import { salLater } from '../render/sal';
import { lightsOn, updateSettings } from '../render/storage';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Stars as marks: the three targets side by side. */
export const starRow = (job: Job) =>
  h(
    'div',
    { class: 'jd-job-marks' },
    ...job.stars.map((n, i) =>
      h(
        'span',
        { class: 'jd-job-mark' },
        h('span', { class: 'jd-gold' }, starMarks(i + 1)),
        h('b', {}, job.orders ? t('job.mark', { n }) : `${int(n)} ${materialMany(job.material)}`),
      ),
    ),
  );
/** The six orders, in a row. */
export const orderRow = (job: Job) => h('div', { class: 'jd-order-list', tid: 'order-list' }, (job.orders ?? []).map((o) => money(o)).join(' · '));
/** The chain the job needs. With `built` it is a checklist: what stands in the yard gets a tick. */
export const recipeRow = (job: Job, built?: (kind: string) => boolean) =>
  h(
    'div',
    { class: 'jd-recipe', tid: 'recipe' },
    built ? h('span', { class: 'jd-recipe-label jd-dim' }, t('job.lineNeeds')) : null,
    ...jobRecipe(job).flatMap((k, i) => {
      const on = built ? built(k) : true;
      return [
        i ? h('span', { class: 'jd-recipe-arrow' }, '›') : null,
        h('span', { class: `jd-recipe-step${on ? ' on' : ''}` }, `${built && on ? '✓ ' : ''}${machineShort(k)}`),
      ];
    }),
  );

const lightsLabel = () => t(lightsOn() ? 'job.lightsOn' : 'job.lightsOff');
/** What this yard's line starts with that another's does not (rules v9): the first good card moves with it. */
const variantLine = (seed: string, job: Job) => {
  const note = yardNote(seed, job);
  const truck = truckNote(seed);
  return [
    ...(note ? [h('div', { class: 'jd-amber', tid: 'job-variant' }, note)] : []),
    ...(truck ? [h('div', { class: 'jd-amber', tid: 'job-truck' }, truck)] : []),
  ];
};

export function openJobCard(scene: Phaser.Scene, seed: string, job: Job, onStart: () => void) {
  const salMark = h('div', { class: 'jd-amber', tid: 'sal-mark' });
  if (job.orders) salLater(seed, (g) => (salMark.textContent = t('job.salMark', { amount: money(g.score) })));
  const head =
    seed === TUTORIAL_SEED
      ? 'job.headLesson'
      : isTutorialSeed(seed)
        ? 'job.head'
        : isWeeklySeed(seed)
          ? 'job.headWeek'
          : isMintedDailySeed(seed)
            ? 'job.headToday'
            : 'job.head';
  choiceDialog(scene, {
    title: t(head),
    tid: 'job-card',
    lead: [
      h('div', { class: 'jd-job-flavour jd-dim' }, jobFlavour(seed, job)),
      h('div', { class: 'jd-job-goal', tid: 'job-goal' }, jobLine(job)),
      ...variantLine(seed, job),
      ...(job.orders ? [orderRow(job)] : []),
      starRow(job),
      ...(job.orders ? [salMark] : [recipeRow(job)]),
      h(
        'div',
        { class: 'jd-dim', tid: 'job-why' },
        job.orders
          ? t('job.ordersWhy', {
              mat: materialMany(job.material),
              first: money(jobPriceAfter(job, 0)),
              second: money(jobPriceAfter(job, 1)),
              third: money(jobPriceAfter(job, 2)),
            })
          : `${t('job.pays', { mat: cap(materialMany(job.material)), price: money(RULES.job.price) })} ${t('job.why')}`,
      ),
    ],
    choices: [
      { label: t('job.start'), tid: 'job-start', primary: true, run: onStart },
      ...(job.orders
        ? [
            {
              label: lightsLabel(),
              tid: 'job-lights',
              keepOpen: true,
              run: (b?: HTMLButtonElement) => {
                updateSettings({ lights: !lightsOn() });
                if (b) b.textContent = lightsLabel();
              },
            },
          ]
        : []),
    ],
    onDismiss: onStart,
  });
}
