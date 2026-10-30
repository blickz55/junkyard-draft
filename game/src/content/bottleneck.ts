/**
 * The bottleneck line (production roadmap 0.8.8): one sentence naming the machine that held the line last round and
 * the fixes that exist in the draft pool, from the data game/src/sim/bottleneck.ts derives. Shown on the round summary
 * and repeated as the hint in the next draft; the foreman will say it later (0.9.1). Presentation only: no rules here.
 */
import { RULES } from '../sim/rules';
import type { Bottleneck } from '../sim/bottleneck';
import type { Machine, MachineKind } from '../sim/types';

const SHORT: Record<MachineKind, string> = { hopper: 'hopper', conveyor: 'conveyor', splitter: 'splitter', crusher: 'crusher', furnace: 'furnace', press: 'press', dock: 'dock', tuner: 'tuner', sieve: 'sieve' };
const pos = (m: Machine) => `${m.x + 1},${m.y + 1}`;
const name = (m: Machine) => SHORT[m.kind];
/** "A tuner beside it, or a second furnace behind a splitter, would clear it." from the fix phrases that apply. */
const would = (phrases: string[], verb: string): string => {
  if (!phrases.length) return '';
  const [first, ...rest] = phrases;
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length ? `${cap}, or ${rest.join(', or ')}, ${verb}.` : `${cap} ${verb}.`;
};

export function bottleneckLine(b: Bottleneck): string {
  const m = b.machine;
  switch (b.kind) {
    case 'disconnected':
      return 'Nothing reached a dock. Items enter crushers, furnaces, presses and splitters only from behind; conveyors take them from behind or the side.';
    case 'dead-end':
      if (m!.kind === 'hopper') return `The hopper at ${pos(m!)} was blocked on ${b.heldTicks} of its ${b.count} tries: nothing ahead takes its scrap. Point it into a conveyor or the back of a machine (R rotates).`;
      return `The ${name(m!)} at ${pos(m!)} is a dead end: items waited there for ${b.heldTicks} of ${b.ticks} ticks. Point it on toward the dock (R rotates).`;
    case 'slag':
      return `The furnace at ${pos(m!)} melted ${b.count} raw scrap into slag at $${RULES.value.slag} each. ${b.fixes.includes('crusher') ? `A crusher before it turns the scrap into shards first, worth $${RULES.value.ingot} each as ingots.` : 'Shards have to reach it, not raw scrap.'}`;
    case 'saturated': {
      if (m!.kind === 'conveyor') {
        const fixes = [b.fixes.includes('dock') ? 'a second dock on one of the branches' : '', b.fixes.includes('press') ? 'a press to halve the traffic' : ''].filter(Boolean);
        return `The conveyor at ${pos(m!)} held the line for ${b.heldTicks} of ${b.ticks} ticks: ${b.feeders} lines squeeze into one belt. ${would(fixes, 'would clear it') || 'Give each line its own way to a dock.'}`;
      }
      const fixes = [b.fixes.includes('tuner') ? 'a tuner beside it' : '', b.fixes.includes('splitter') ? `a second ${name(m!)} behind a splitter` : ''].filter(Boolean);
      return `The ${name(m!)} at ${pos(m!)} held the line for ${b.heldTicks} of ${b.ticks} ticks. ${would(fixes, 'would clear it') || 'Another line to share its work would clear it.'}`;
    }
    case 'starved':
      return `Supply held the line: the ${name(m!)} at ${pos(m!)} was idle ${Math.round((1 - b.utilisation) * 100)} % of the round (${b.count} items in ${b.ticks} ticks). ${b.fixes.includes('hopper') ? 'A second hopper would raise the ceiling.' : 'More scrap coming in would raise the ceiling.'}`;
    default:
      return `Nothing held the line this round: every machine kept up with the hopper${b.count === 1 ? '' : 's'}. ${b.fixes.includes('hopper') ? 'The next ceiling is supply; another hopper would raise it.' : 'The next ceiling is supply.'}`;
  }
}
