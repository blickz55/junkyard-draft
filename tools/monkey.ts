/**
 * Nothing breaks (docs/GOALS.md, goal 11). Two monkeys:
 *   node --import tsx tools/monkey.ts rules [--actions 1000000]   random actions through the rules: a bad one must be refused in words, a
 *                                                                 game must always finish, and every game must re-simulate to its score
 *   node --import tsx tools/monkey.ts browser --url <site> [--sessions 1000] [--actions 60] [--pages 12]   random tapping on a real page: any
 *                                                                 page error is a failure, and the worst are kept
 * Exit 1 on any failure.
 */
import { apply, newRun, replay, RunError, type Action, type RunState } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION, type Dir } from '../game/src/sim/types';
import { Rng } from '../game/src/sim/rng';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);

function randomAction(s: RunState, rng: Rng): Action {
  const parts = [...s.layout.machines, ...s.bin];
  const id = parts.length && rng.next() < 0.97 ? parts[rng.int(parts.length)].id : rng.int(5000);
  const roll = rng.int(100);
  if (roll < 12) return { t: 'pick', i: rng.int(4) };
  if (roll < 55) return { t: 'place', id, x: rng.int(RULES.gridWidth + 2) - 1, y: rng.int(RULES.gridHeight + 2) - 1, dir: rng.int(4) as Dir };
  if (roll < 63) return { t: 'rotate', id };
  if (roll < 71) return { t: 'unplace', id };
  if (roll < 75) return { t: 'sell', id };
  if (roll < 83) return { t: 'run' };
  if (roll < 91) return { t: 'next' };
  if (roll < 95) return { t: 'reroll' };
  return { t: 'buy' };
}

/** Random actions until the game ends or the budget does, then the plain way to the end. */
function monkeyGame(seed: string, budget: number): { tried: number; refused: number } {
  const rng = new Rng(`monkey:${seed}`);
  const s = newRun(seed);
  let tried = 0;
  let refused = 0;
  for (; tried < budget && s.phase !== 'finished'; tried++) {
    try {
      apply(s, randomAction(s, rng));
    } catch (e) {
      if (!(e instanceof RunError)) throw e;
      refused++;
    }
  }
  for (let guard = 0; guard < 40 && s.phase !== 'finished'; guard++)
    apply(s, s.phase === 'draft' ? { t: 'pick', i: 0 } : s.phase === 'build' ? { t: 'run' } : { t: 'next' });
  if (s.phase !== 'finished') throw new Error(`${seed}: the game did not finish`);
  const again = replay(seed, s.actions, RULES_VERSION);
  if (again.score !== s.score) throw new Error(`${seed}: replay ${again.score} against ${s.score}`);
  if (!Number.isFinite(s.score)) throw new Error(`${seed}: score ${s.score}`);
  return { tried, refused };
}

function rulesMonkey() {
  const want = Number(opt('actions', '1000000'));
  const t0 = Date.now();
  let actions = 0;
  let refused = 0;
  let games = 0;
  const failures: string[] = [];
  while (actions < want) {
    const seed = games % 7 === 0 ? `classic-m${games}` : games % 11 === 0 ? `tutorial-${(games % 3) + 1}` : `m${games}`;
    try {
      const g = monkeyGame(seed, 900);
      actions += g.tried;
      refused += g.refused;
    } catch (e) {
      failures.push(`${seed}: ${String(e).slice(0, 200)}`);
      actions += 100;
    }
    games++;
  }
  console.log(
    `rules monkey: ${actions} actions in ${games} games, ${refused} refused in words, ${failures.length} failures, ${Math.round((Date.now() - t0) / 1000)} s`,
  );
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  return failures.length;
}

async function browserMonkey() {
  const { chromium, devices } = await import('playwright');
  const url = opt('url', 'http://127.0.0.1:4700/');
  const sessions = Number(opt('sessions', '1000'));
  const perSession = Number(opt('actions', '60'));
  const pages = Number(opt('pages', '12'));
  const browser = await chromium.launch();
  const failures: string[] = [];
  let done = 0;
  let next = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < sessions) {
      const n = next++;
      const rng = new Rng(`monkey:browser:${n}`);
      const phone = n % 3 !== 0;
      const ctx = await browser.newContext(phone ? devices['Pixel 7'] : { viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
      try {
        await page.goto(url);
        await page.waitForSelector('[data-testid=learn], [data-testid=daily]', { timeout: 15000 });
        const box = page.viewportSize()!;
        for (let i = 0; i < perSession && !errors.length; i++) {
          const roll = rng.int(100);
          if (roll < 60) {
            const targets = await page.locator('button:visible, a:visible').all();
            if (targets.length) await targets[rng.int(targets.length)].click({ timeout: 800, force: true }).catch(() => {});
          } else if (roll < 85) {
            const x = rng.int(box.width),
              y = rng.int(box.height);
            if (phone) await page.touchscreen.tap(x, y).catch(() => {});
            else await page.mouse.click(x, y);
          } else {
            await page.mouse.move(rng.int(box.width), rng.int(box.height));
            await page.mouse.down();
            await page.mouse.move(rng.int(box.width), rng.int(box.height), { steps: 4 });
            await page.mouse.up();
          }
          await page.waitForTimeout(rng.int(60));
        }
      } catch (e) {
        errors.push(`session: ${String(e).slice(0, 200)}`);
      }
      for (const e of errors) failures.push(`#${n} ${phone ? 'phone' : 'desk'}: ${e}`);
      await ctx.close();
      done++;
      process.stderr.write(`\r${done}/${sessions} sessions, ${failures.length} failures   `);
    }
  };
  await Promise.all(Array.from({ length: pages }, worker));
  await browser.close();
  console.log(`\nbrowser monkey: ${done} sessions of ${perSession} actions, ${failures.length} failures, ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const f of [...new Set(failures)].slice(0, 12)) console.log(`  ${f}`);
  return failures.length;
}

const which = args[0] ?? 'rules';
const failed = which === 'browser' ? await browserMonkey() : rulesMonkey();
process.exit(failed ? 1 : 0);
