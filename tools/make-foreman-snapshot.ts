/**
 * Pin the foreman's chosen line per (situation, day) (production roadmap 0.9.1): writes tests/fixtures/foreman-snapshot.json,
 * which tests/foreman.test.ts compares against, so a change of wording or of the choice is a deliberate one.
 *   node --import tsx tools/make-foreman-snapshot.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { SITUATIONS, foremanLine } from '../game/src/content/foreman';

export const SNAPSHOT_DAYS = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-12-25'];
export const SNAPSHOT_PATH = 'tests/fixtures/foreman-snapshot.json';

export function buildSnapshot(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const day of SNAPSHOT_DAYS) { out[day] = {}; for (const s of SITUATIONS) out[day][s] = foremanLine(s, {}, day); }
  return out;
}

const isMain = process.argv[1] && /make-foreman-snapshot\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const file = path.resolve(SNAPSHOT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(buildSnapshot(), null, 1)}\n`);
  console.log(`wrote ${SNAPSHOT_PATH} (${SNAPSHOT_DAYS.length} days × ${SITUATIONS.length} situations)`);
}
