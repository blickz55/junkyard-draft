// Production roadmap 0.9.0: the string table, its renderer, the banned-word glossary and the prose-literal lint over
// the DOM screens and the content modules (every player-facing sentence must come from the table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS, render, t, type Entry } from '../game/src/content/strings';
import { MORE_STRINGS } from '../game/src/content/strings-more';
import { SAL_STRINGS } from '../game/src/content/sal-posts';
import { BANNED_WORDS, bannedWordsIn, GLOSSARY } from '../game/src/content/glossary';
import { pseudo, setLocale, PSEUDO_GROWTH } from '../game/src/content/locale';
import { money, int, utcDateTime, utcDate, utcDay } from '../game/src/content/format';
import { lintProseLiterals, LINTED_DIRS } from '../tools/strings-lint';

const ALL: Record<string, Entry> = { ...STRINGS, ...MORE_STRINGS, ...SAL_STRINGS };
const KEYS = Object.keys(ALL);

test('string table: every entry has text and a note; keys are grouped by screen; the renderer fills placeholders and English plurals', () => {
  assert.ok(KEYS.length > 300, `${KEYS.length} strings`);
  for (const k of KEYS) {
    const e = ALL[k];
    assert.ok(e.en.length > 0, `${k} has text`);
    assert.ok(e.note.length > 2, `${k} has a note`);
    assert.match(k, /^[a-z]+\.[A-Za-z0-9.]+$/, `${k} is screen.key`);
  }
  assert.equal(render('Round {n} / {total}', { n: 2, total: 6 }), 'Round 2 / 6');
  assert.equal(render('{n, plural, one {# day played} other {# days played}}', { n: 1 }), '1 day played');
  assert.equal(render('{n, plural, one {# day played} other {# days played}}', { n: 12 }), '12 days played');
  assert.equal(render('{n, plural, =0 {none} one {# game} other {# games}}', { n: 0 }), 'none');
  assert.equal(render('{a}{b}', { a: 'x' }), 'x{b}', 'an unknown placeholder stays visible rather than vanishing');
  assert.equal(t('share.days', { n: 3 }), '3 days played');
  assert.equal(t('results.pctFew', { n: 1, rank: 1 }), '1 game so far · you are #1');
  assert.equal(
    t('privacy.deleted', { n: 1, r: 0, days: 14 }),
    'Deleted. 1 entry anonymised, 0 archived recordings dropped; this device has a new key and no name. Backups age out within 14 days.',
  );
});

test('glossary: no banned word in any player-facing string (the policy page excepted); the glossary covers every banned term', () => {
  const offenders: string[] = [];
  for (const k of KEYS) {
    if (k.startsWith('policy.')) continue;
    const bad = bannedWordsIn(ALL[k].en);
    if (bad.length) offenders.push(`${k}: ${bad.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(bannedWordsIn('Your key is this player'), [], '"your key" is the glossary\'s own term');
  assert.deepEqual(bannedWordsIn('a bearer token for the verifier'), ['verifier', 'bearer', 'token']);
  assert.deepEqual(bannedWordsIn('Rules version 3 and the rules'), ['rules version']);
  assert.deepEqual(bannedWordsIn('a seedling and a ticket'), [], 'whole words only');
  assert.ok(GLOSSARY.length >= 20);
  for (const w of ['seed', 'tick', 'verifier', 'replay', 'histogram', 'percentile', 'reroll', 'bin', 'token'])
    assert.ok(BANNED_WORDS.includes(w), `${w} is banned`);
});

test('the strings behind import() stay out of the first visit: nothing main.ts loads reaches that table or reads one of its keys', () => {
  const read = (f: string) => fs.readFileSync(f, 'utf8');
  const imports = (f: string) =>
    [...read(f).matchAll(/^(?:import|export)\s+(?!type\b)(?:[^'"\n]*?from\s+)?'(\.[^']+)'/gm)].flatMap((m) => {
      const base = path.join(path.dirname(f), m[1]);
      return [`${base}.ts`].filter((c) => fs.existsSync(c));
    });
  const first = new Set<string>();
  const stack = [path.join('game', 'src', 'main.ts')];
  while (stack.length) {
    const f = stack.pop()!;
    if (first.has(f)) continue;
    first.add(f);
    stack.push(...imports(f));
  }
  assert.ok(first.size > 80, `the walk found the game: ${first.size} modules`);
  assert.ok(first.has(path.join('game', 'src', 'ui', 'panels.ts')));
  const table = path.join('game', 'src', 'content', 'strings-more.ts');
  assert.ok(!first.has(table), 'a module a first visit loads imports the table of the panels');
  const moved = Object.keys(MORE_STRINGS);
  const offenders = [...first].flatMap((f) => {
    const src = read(f);
    return moved.filter((k) => src.includes(`'${k}'`)).map((k) => `${f}: ${k}`);
  });
  assert.deepEqual(offenders, []);
});

test('pseudo-locale: every letter accented, about 30 % longer, digits, dollar signs and glyphs untouched; t() applies it', () => {
  const p = pseudo('Round 2 / 6 · $1758 ░▒▓');
  assert.doesNotMatch(p, /[A-Za-z]/, 'no plain Latin letter survives');
  assert.ok(p.includes('2 / 6 · $1758 ░▒▓'), 'numbers, the dollar sign and the share glyphs survive');
  const letters = 'The quick brown fox jumps over the lazy dog';
  const q = pseudo(letters);
  assert.ok(q.length >= letters.length * (1 + PSEUDO_GROWTH) - 1, `${q.length} vs ${letters.length}: at least ${PSEUDO_GROWTH * 100} % longer`);
  assert.equal(pseudo('42'), '42', 'nothing to accent, nothing to pad');
  setLocale('pseudo');
  try {
    const s = t('title.daily');
    assert.doesNotMatch(s, /[A-Za-z]/);
    assert.ok(s.length > "Play today's yard".length);
  } finally {
    setLocale('en');
  }
  assert.equal(t('title.daily'), "Play today's yard");
});

test('formats: money with grouping and the typographic minus, integers without, UTC dates', () => {
  assert.equal(money(1758), '$1,758');
  assert.equal(money(0), '$0');
  assert.equal(money(-40), '−$40');
  assert.equal(int(1234567), '1234567');
  assert.match(utcDateTime('2026-10-30T00:00:00Z'), /^30 Oct 2026,? 00:00 UTC$/);
  assert.match(utcDate('2026-10-30'), /^30 Oct 2026$/);
  assert.match(utcDay('2026-03-12'), /^12 March$/);
  assert.equal(utcDateTime('nope'), 'nope', 'an unparsable input is returned as is');
});

test('prose-literal lint: no sentence is hard-coded in the DOM screens or the content modules; the lint flags an injected one', () => {
  const hits = lintProseLiterals(LINTED_DIRS.map((d) => path.resolve(d)));
  assert.deepEqual(
    hits.map((h) => `${path.relative(process.cwd(), h.file)}:${h.line}: ${h.text}`),
    [],
  );
  const scratch = fs.mkdtempSync(path.join(process.cwd(), 'tools', 'scratch-lint-'));
  try {
    fs.writeFileSync(
      path.join(scratch, 'x.ts'),
      "const a = h('div', { class: 'jd-row jd-between', style: 'font-size:0.75em; margin-top:0.3em' }, 'Hello there, player.');\nconst b = t('title.daily');\nconst c = `Round ${n} of ${m}`;\nconst d = '[data-testid=privacy-dialog]';\n",
    );
    const injected = lintProseLiterals([scratch]);
    assert.deepEqual(
      injected.map((h) => h.text),
      ["'Hello there, player.'", '`Round ${n} of ${m}`'],
      'the sentence and the template are prose; the class list, the style, the key and the selector are not',
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
