/**
 * Measure the moderation pipeline against the labelled corpus (tests/fixtures/moderation-corpus.json, production roadmap 0.11.2).
 * The filter always runs. With --live and ANTHROPIC_API_KEY every string the filter lets through also goes to the classifier, about
 * 140 calls and a few cents, and the report says which band each landed in against its label. tests/moderation.test.ts holds the
 * filter to the corpus on every run; only this tool measures the classifier, because a test must not call a paid service.
 *   node --import tsx tools/moderation-corpus.ts [--live] [--limit N] [--json out.json]
 * Exit 1 when the filter disagrees, or live when a post labelled hide landed in publish or one labelled publish landed in hide.
 * Those are the two mistakes that matter: the rest of the disagreements land in front of a person.
 */
import fs from 'node:fs';
import { bandFor, claudeClassifier, DEFAULT_SETTINGS, TriageError, textProblem, type Band, type Triage } from '../server/moderation';

interface Item {
  id: number;
  text: string;
  band: 'refuse' | Band;
  category: string;
  problem?: string;
}
const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const live = args.includes('--live');
const corpus = (JSON.parse(fs.readFileSync('tests/fixtures/moderation-corpus.json', 'utf8')) as { items: Item[] }).items;

const filterMisses = corpus.filter((i) => textProblem(i.text) !== (i.band === 'refuse' ? i.problem : null));
console.log(`filter: ${corpus.length - filterMisses.length} of ${corpus.length} as labelled`);
for (const i of filterMisses)
  console.log(`  #${i.id} labelled ${i.band}${i.problem ? ` (${i.problem})` : ''}, filter says ${textProblem(i.text)}: ${JSON.stringify(i.text.slice(0, 70))}`);
let bad = filterMisses.length > 0;

async function measure() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error('--live needs ANTHROPIC_API_KEY');
    process.exit(2);
  }
  const classify = claudeClassifier({ apiKey: key, model: process.env.MODERATION_MODEL || undefined, url: process.env.ANTHROPIC_API_URL || undefined });
  const items = corpus.filter((i) => i.band !== 'refuse').slice(0, Number(opt('limit') ?? Infinity));
  const rows: (Item & { got: Band | 'unread'; answer: Triage | null })[] = [];
  let input = 0,
    output = 0;
  for (let at = 0; at < items.length; at += 4)
    await Promise.all(
      items.slice(at, at + 4).map(async (i) => {
        try {
          const answer = await classify(i.text);
          input += answer.inputTokens ?? 0;
          output += answer.outputTokens ?? 0;
          rows.push({ ...i, got: bandFor(answer, DEFAULT_SETTINGS, false), answer });
        } catch (e) {
          if (!(e instanceof TriageError)) throw e;
          console.log(`  #${i.id}: ${e.message}`);
          rows.push({ ...i, got: 'unread', answer: null });
        }
      }),
    );
  const bands = ['publish', 'queue', 'hide', 'unread'];
  console.log(`\nclassifier: ${rows.filter((r) => r.got === r.band).length} of ${rows.length} in the labelled band\n`);
  console.log(`labelled   ${bands.map((b) => b.padStart(8)).join('')}`);
  for (const label of bands.slice(0, 3))
    console.log(`${label.padEnd(10)} ${bands.map((b) => String(rows.filter((r) => r.band === label && r.got === b).length).padStart(8)).join('')}`);
  const wrong = rows.filter((r) => r.got !== r.band).sort((a, b) => a.id - b.id);
  if (wrong.length) console.log('\nnot as labelled:');
  for (const r of wrong)
    console.log(`  #${r.id} ${r.band} → ${r.got} (${r.answer?.category ?? '-'} ${r.answer?.score ?? '-'}): ${JSON.stringify(r.text.slice(0, 70))}`);
  const serious = rows.filter((r) => (r.band === 'hide' && r.got === 'publish') || (r.band === 'publish' && r.got === 'hide'));
  console.log(`\n${serious.length} serious: labelled hide and left up, or labelled publish and taken down`);
  console.log(`tokens: ${input} in, ${output} out, about $${((input * 0.1 + output * 0.5) / 1e6).toFixed(4)} at Haiku 5.5 prices`);
  bad ||= serious.length > 0;
  const out = opt('json');
  if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), filterMisses: filterMisses.length, rows, input, output }, null, 1));
}
if (live) await measure();
else console.log('classifier: not measured (pass --live with ANTHROPIC_API_KEY)');
process.exit(bad ? 1 : 0);
