/**
 * The job card (rules v4): the first thing a game says. Where am I (the yard), what's the point (the job and its three stars),
 * how (the recipe), and one button. The same words stay on screen afterwards in the HUD.
 */
import type Phaser from 'phaser';
import { h } from './dom';
import { choiceDialog } from './choice';
import type { Job } from '../sim/yard';
import { isTutorialSeed } from '../sim/yard';
import { isWeeklySeed } from '../sim/weekly';
import { isMintedDailySeed } from '../sim/daily';
import { RULES } from '../sim/rules';
import { t } from '../content/strings';
import { int, money } from '../content/format';
import { jobFlavour, jobLine, jobRecipe, materialMany, starMarks } from '../content/job';
import { machineShort } from '../content/machines';

/** Stars as marks: the three targets side by side. */
export const starRow = (job: Job) =>
  h(
    'div',
    { class: 'jd-job-marks' },
    ...job.stars.map((n, i) =>
      h('span', { class: 'jd-job-mark' }, h('span', { class: 'jd-gold' }, starMarks(i + 1)), h('b', {}, `${int(n)} ${materialMany(job.material)}`)),
    ),
  );
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

export function openJobCard(scene: Phaser.Scene, seed: string, job: Job, onStart: () => void) {
  const head = isTutorialSeed(seed) ? 'job.headLesson' : isWeeklySeed(seed) ? 'job.headWeek' : isMintedDailySeed(seed) ? 'job.headToday' : 'job.head';
  choiceDialog(scene, {
    title: t(head),
    tid: 'job-card',
    lead: [
      h('div', { class: 'jd-job-flavour jd-dim' }, jobFlavour(seed, job)),
      h('div', { class: 'jd-job-goal', tid: 'job-goal' }, jobLine(job)),
      starRow(job),
      recipeRow(job),
      h('div', { class: 'jd-dim', tid: 'job-why' }, `${t('job.pays', { price: money(RULES.job.price) })} ${t('job.why')}`),
    ],
    choices: [{ label: t('job.start'), tid: 'job-start', primary: true, run: onStart }],
    onDismiss: onStart,
  });
}
