/**
 * The bottleneck line (production roadmap 0.8.8, strings in the table since 0.9.0): one sentence naming the machine that
 * held the line last round and the fixes that exist in the draft pool, from the data game/src/sim/bottleneck.ts derives.
 * Shown on the round summary and repeated as the hint in the next draft; the foreman will say it later (0.9.1).
 */
import { RULES } from '../sim/rules';
import type { Bottleneck } from '../sim/bottleneck';
import { t } from './strings';
import { money, int } from './format';
import { machineWord } from './machines';

/** "A tuner beside it, or a second furnace behind a splitter, would clear it." from the fix phrases that apply. */
const would = (phrases: string[]): string => {
  if (!phrases.length) return '';
  const [first, ...rest] = phrases;
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length ? `${cap}, or ${rest.join(', or ')}, ${t('bottleneck.wouldClear')}.` : `${cap} ${t('bottleneck.wouldClear')}.`;
};

export function bottleneckLine(b: Bottleneck): string {
  const m = b.machine;
  switch (b.kind) {
    case 'disconnected':
      return t('bottleneck.disconnected');
    case 'dead-end':
      if (m!.kind === 'hopper') return t('bottleneck.deadEndHopper', { held: int(b.heldTicks), tries: int(b.count) });
      return t('bottleneck.deadEnd', { name: machineWord(m!.kind), held: int(b.heldTicks), total: int(b.ticks) });
    case 'slag':
      return t('bottleneck.slag', {
        n: int(b.count),
        slag: money(RULES.value.slag),
        fix: b.fixes.includes('crusher') ? t('bottleneck.slagFix') : t('bottleneck.slagNoFix'),
      });
    case 'saturated': {
      if (m!.kind === 'conveyor') {
        const fixes = [b.fixes.includes('dock') ? t('bottleneck.mergeDock') : '', b.fixes.includes('press') ? t('bottleneck.mergePress') : ''].filter(Boolean);
        return t('bottleneck.merge', {
          held: int(b.heldTicks),
          total: int(b.ticks),
          feeders: int(b.feeders),
          fix: would(fixes) || t('bottleneck.mergeNoFix'),
        });
      }
      const name = machineWord(m!.kind);
      const fixes = [b.fixes.includes('tuner') ? t('bottleneck.fixTuner') : '', b.fixes.includes('splitter') ? t('bottleneck.fixSecond', { name }) : ''].filter(
        Boolean,
      );
      return t('bottleneck.saturated', { name, held: int(b.heldTicks), total: int(b.ticks), fix: would(fixes) || t('bottleneck.fixNone') });
    }
    case 'starved':
      return t('bottleneck.starved', {
        name: machineWord(m!.kind),
        pct: int(Math.round((1 - b.utilisation) * 100)),
        fix: b.fixes.includes('hopper') ? t('bottleneck.starvedFix') : t('bottleneck.starvedNoFix'),
      });
    default:
      return t('bottleneck.balanced', {
        hoppers: b.count === 1 ? t('common.hopperOne') : t('common.hopperMany'),
        fix: b.fixes.includes('hopper') ? t('bottleneck.balancedFix') : t('bottleneck.balancedNoFix'),
      });
  }
}
