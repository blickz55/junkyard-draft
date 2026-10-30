/**
 * Balance probe for one machine (PLAN-v2 0.5.1): paired per-seed comparison of identical offers with the machine allowed,
 * banned and under tuning variants, two search policies, replay-verified action lists and an executable gate.
 *
 *   node --import tsx tools/balance.ts --reroll [--seeds 40] [--tries 120] [--gate --rate-min 0.1 --rate-max 0.3] [--json out]   # reroll study
 *   node --import tsx tools/balance.ts [--machine press] [--seeds 40] [--tries 120] [--prefix bal] [--policy greedy|neutral|both]
 *                                      [--variants file.json] [--json out.json] [--gate] [--pick-min 0.25 --pick-max 0.5] [--build <label>]
 * `--variants` is a JSON array of { label, ban?, rules? } where rules maps dotted RULES paths to numbers (e.g. {"process.press": 1}).
 * `--gate` exits 1 when a threshold fails (0 seeds worse vs ban, mean lift > 0, optional pick-rate band, every score replay-verified,
 * nothing above the derived sanity bound). Diagnostic evidence: shipping a variant means editing rules.ts and bumping RULES_VERSION.
 */
import fs from 'node:fs';
import type { MachineKind } from '../game/src/sim/types';
import { runBalance, gateVerdict, defaultVariants, runRerollStudy, gateReroll, type Variant } from './balance-lib';
import type { SearchPolicy } from './autoplay-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
if (args.includes('--reroll')) {
  // reroll study (PLAN-v2 0.5.4): the same seeds with and without the greedy reroll policy
  const study = runRerollStudy({
    seeds: Number(opt('seeds', '40')),
    tries: Number(opt('tries', '120')),
    prefix: opt('prefix', 'rr'),
    policy: opt('policy', 'greedy') === 'neutral' ? 'neutral' : 'greedy',
  });
  const { actions: _a, ...summary } = study;
  void _a;
  console.log(JSON.stringify(summary, null, 1));
  const out = opt('json', '');
  if (out) fs.writeFileSync(out, JSON.stringify(study, null, 1));
  if (args.includes('--gate')) {
    const v = gateReroll(study, { rate: [Number(opt('rate-min', '0.1')), Number(opt('rate-max', '0.3'))] });
    for (const r of v.reasons) console.log(`GATE FAIL ${r}`);
    console.log(v.ok ? 'GATE PASS' : 'GATE FAIL');
    process.exit(v.ok ? 0 : 1);
  }
  process.exit(0);
}
const machine = opt('machine', 'press') as MachineKind;
const policyArg = opt('policy', 'both');
const policies: SearchPolicy[] = policyArg === 'both' ? ['greedy', 'neutral'] : [policyArg as SearchPolicy];
const variants: Variant[] = args.includes('--variants')
  ? (JSON.parse(fs.readFileSync(opt('variants', ''), 'utf8')) as Variant[])
  : machine === 'press'
    ? [
        ...defaultVariants('press'),
        { label: 'hold 1 tick', rules: { 'process.press': 1 } },
        { label: 'plate $9', rules: { 'value.plate': 9 } },
        { label: 'plate $10', rules: { 'value.plate': 10 } },
        { label: 'hold 1 + plate $9', rules: { 'process.press': 1, 'value.plate': 9 } },
      ]
    : defaultVariants(machine);

const result = runBalance({
  machine,
  seeds: Number(opt('seeds', '40')),
  tries: Number(opt('tries', '120')),
  prefix: opt('prefix', 'bal'),
  variants,
  policies,
  build: args.includes('--build') ? opt('build', 'dev') : undefined,
});
const { actions, ...summary } = result;
console.log(JSON.stringify(summary, null, 1));
const out = opt('json', '');
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
if (args.includes('--gate')) {
  const pick =
    args.includes('--pick-min') || args.includes('--pick-max') ? ([Number(opt('pick-min', '0')), Number(opt('pick-max', '1'))] as [number, number]) : undefined;
  const verdict = gateVerdict(result, { pickRate: pick, policy: policies[0] });
  for (const r of verdict.reasons) console.log(`GATE FAIL ${r}`);
  console.log(verdict.ok ? 'GATE PASS' : 'GATE FAIL');
  process.exit(verdict.ok ? 0 : 1);
}
