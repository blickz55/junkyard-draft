/**
 * First-session funnel report from the verifier's opt-in event store (PLAN-v1 0.3.7).
 *   node --import tsx tools/funnel.ts [server/data/events.jsonl]
 * Prints unique installs per funnel step with the share of app_start, then the breakdowns the Measurement
 * plan asks for: tutorial steps reached, first-placement rejection reasons, completed-game modes, submission
 * results, tips opened, session length. Reads the JSON-lines file directly; the verifier's GET /funnel serves
 * the same step table live.
 */
import path from 'node:path';
import { EventStore } from '../server/verify';

const file = process.argv[2] || path.join(process.cwd(), 'server', 'data', 'events.jsonl');
const store = new EventStore(file);
const rows = store.rows();
const f = store.funnel(rows);
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)} %` : '—');
const installsWhere = (name: string, pred: (p: Record<string, unknown>) => boolean = () => true) => new Set(rows.filter((r) => r.name === name && pred(r.props)).map((r) => r.installId)).size;
const groupBy = (name: string, key: string) => { const m = new Map<string, number>(); for (const r of rows) if (r.name === name) { const k = String(r.props[key] ?? '?'); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };

console.log(`events: ${rows.length} rows, ${f.installs} installs, file ${file}\n`);
console.log('FIRST-SESSION FUNNEL (unique installs)');
const base = f.steps[0]?.installs ?? 0;
for (const s of f.steps) console.log(`  ${s.name.padEnd(26)} ${String(s.installs).padStart(6)}   ${pct(s.installs, base).padStart(5)} of app_start`);
console.log('\nTUTORIAL (installs reaching each step)');
for (let n = 1; n <= 5; n++) console.log(`  step ${n}: started ${installsWhere('tutorial_step_start', (p) => p.n === n)}, completed ${installsWhere('tutorial_step_complete', (p) => p.n === n)}`);
const section = (title: string, pairs: [string, number][]) => { console.log(`\n${title}`); if (!pairs.length) console.log('  (none)'); for (const [k, v] of pairs) console.log(`  ${k.padEnd(24)} ${v}`); };
section('FIRST PLACEMENT REJECTED (reason)', groupBy('first_place_rejected', 'reason'));
section('GAMES COMPLETED (mode)', groupBy('game_complete', 'mode'));
section('SUBMISSIONS (result)', groupBy('daily_submit_result', 'result'));
section('SHARES (variant)', groupBy('share_copied', 'variant'));
section('TIPS OPENED (id)', groupBy('tip_opened', 'id'));
section('SETTINGS CHANGED (key)', groupBy('settings_changed', 'key'));
const minutes = rows.filter((r) => r.name === 'session_end').map((r) => Number(r.props.minutes)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
console.log(`\nSESSIONS: ${minutes.length} ended; median length ${minutes.length ? minutes[Math.floor(minutes.length / 2)] : '—'} min`);
console.log(`\nretention: rows older than ${store.retentionDays} days are pruned by the verifier at start and hourly; this report never shows seeds, layouts or addresses because none are stored.`);
