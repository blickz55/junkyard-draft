/**
 * Sieve fixture (PLAN-v2 0.5.2): does a Sieve earn its slot on a same-inventory mixed-material puzzle? Two inventories of
 * eleven machines differ in exactly one part (a Sieve vs one more Conveyor). Each is searched from the empty grid with the
 * neutral policy over several rng streams; the best layout and earnings of each are printed, together with a hand-authored
 * Sieve line (so a weak search cannot hide a good Sieve) and a second hypothesis: an Export Dock that pays double for
 * ingots and nothing for anything else, priced from the ship events, which would give sorting a reason to exist.
 *   node --import tsx tools/sieve-fixture.ts [--tries 400] [--streams 6]
 */
import { RULES } from '../game/src/sim/rules';
import { runLayout, cellIndex } from '../game/src/sim/sim';
import { Rng } from '../game/src/sim/rng';
import type { Dir, Layout, Machine, MachineKind } from '../game/src/sim/types';
import { improve, score } from './autoplay-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const TRIES = Number(opt('tries', '400'));
const STREAMS = Number(opt('streams', '6'));

let nid = 1;
const m = (kind: MachineKind, x = -1, y = -1, dir: Dir = 0): Machine => ({ id: nid++, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: RULES.gridWidth, height: RULES.gridHeight, machines });
const empty = (): Layout => lay();

/** eleven machines: the five starters plus six picks; the two inventories differ only in the last pick */
const base = () => [m('hopper'), m('conveyor'), m('conveyor'), m('conveyor'), m('dock'), m('hopper'), m('crusher'), m('furnace'), m('dock'), m('conveyor')];
const withSieve = () => [...base(), m('sieve')];
const withConveyor = () => [...base(), m('conveyor')];

function searchBest(bin: Machine[], label: string, scorer: (l: Layout) => number = score) {
  let best: { layout: Layout; earned: number } | null = null;
  for (let k = 0; k < STREAMS; k++) {
    const r = improveWith(empty(), bin, new Rng(`sieve-fixture:${label}:${k}`), TRIES, scorer);
    if (!best || r.earned > best.earned) best = r;
  }
  return best!;
}
/** improve() scores with runLayout earnings; for the export-dock hypothesis we re-score the found layouts with a custom pricer */
function improveWith(baseL: Layout, bin: Machine[], rng: Rng, tries: number, scorer: (l: Layout) => number) {
  if (scorer === score) return improve(baseL, bin, rng, tries, 8, 'neutral');
  // custom scorer: run the standard search, then re-score its best under the hypothesis (a cheap proxy; the search still optimises plain money)
  const r = improve(baseL, bin, rng, tries, 8, 'neutral');
  return { layout: r.layout, earned: scorer(r.layout) };
}

/** Export Dock hypothesis: the SECOND dock in a layout pays 2× for ingots and $0 for everything else. */
function exportPricing(l: Layout): number {
  const docks = l.machines.filter((x) => x.kind === 'dock');
  if (docks.length < 2) return score(l);
  const exportCell = cellIndex(docks[1].x, docks[1].y, l.width);
  const res = runLayout(l);
  let earned = 0;
  for (const e of res.events) if (e.kind === 'ship' && e.value != null) earned += e.cell === exportCell ? (e.from === 'ingot' ? e.value * 2 : 0) : e.value;
  return earned;
}

const draw = (l: Layout) => {
  const g: string[][] = Array.from({ length: l.height }, () => Array(l.width).fill('.'));
  const sym: Record<MachineKind, string> = {
    hopper: 'H',
    conveyor: '>',
    splitter: 'S',
    crusher: 'C',
    furnace: 'F',
    press: 'P',
    dock: 'D',
    sieve: 'V',
    tuner: 'T',
  };
  const arrow = ['>', 'v', '<', '^'];
  for (const x of l.machines) g[x.y][x.x] = x.kind === 'conveyor' ? arrow[x.dir] : sym[x.kind] + '';
  return g.map((r) => r.join('')).join('\n');
};

// hand-authored Sieve line: hopper B → crusher side-loads shards onto hopper A's belt; the Sieve sends scrap on to dock 1 and shards right into a furnace that ships ingots into dock 2
const hand = lay(
  m('hopper', 0, 2, 0),
  m('conveyor', 1, 2, 0),
  m('sieve', 2, 2, 0),
  m('conveyor', 3, 2, 0),
  m('dock', 4, 2),
  m('hopper', 1, 0, 1),
  m('crusher', 1, 1, 1),
  m('furnace', 2, 3, 1),
  m('dock', 2, 4),
  m('conveyor', 6, 5, 0),
  m('conveyor', 7, 5, 0),
);
// hand-authored separated routes with the same inventory minus the Sieve plus a conveyor
const handSep = lay(
  m('hopper', 0, 2, 0),
  m('conveyor', 1, 2, 0),
  m('conveyor', 2, 2, 0),
  m('conveyor', 3, 2, 0),
  m('dock', 4, 2),
  m('hopper', 0, 4, 0),
  m('crusher', 1, 4, 0),
  m('furnace', 2, 4, 0),
  m('dock', 3, 4),
  m('conveyor', 6, 5, 0),
  m('conveyor', 7, 5, 0),
);

const t0 = Date.now();
const sieve = searchBest(withSieve(), 'sieve');
const sep = searchBest(withConveyor(), 'conveyor');
const sieveExport = searchBest(withSieve(), 'sieve-export', exportPricing);
const sepExport = searchBest(withConveyor(), 'conveyor-export', exportPricing);
const out = {
  tries: TRIES,
  streams: STREAMS,
  ms: Date.now() - t0,
  plain: {
    hand: { sieve: score(hand), separated: score(handSep) },
    search: { sieve: sieve.earned, separated: sep.earned },
    liftPct: Math.round((100 * (Math.max(sieve.earned, score(hand)) - Math.max(sep.earned, score(handSep)))) / Math.max(sep.earned, score(handSep))),
  },
  exportDock: {
    hand: { sieve: exportPricing(hand), separated: exportPricing(handSep) },
    search: { sieve: sieveExport.earned, separated: sepExport.earned },
    liftPct: Math.round(
      (100 * (Math.max(sieveExport.earned, exportPricing(hand)) - Math.max(sepExport.earned, exportPricing(handSep)))) /
        Math.max(sepExport.earned, exportPricing(handSep)),
    ),
  },
};
console.log(JSON.stringify(out, null, 1));
console.log('\nhand Sieve line ($' + score(hand) + '):\n' + draw(hand));
console.log('\nhand separated ($' + score(handSep) + '):\n' + draw(handSep));
console.log('\nbest searched with Sieve ($' + sieve.earned + '):\n' + draw(sieve.layout));
console.log('\nbest searched without ($' + sep.earned + '):\n' + draw(sep.layout));
