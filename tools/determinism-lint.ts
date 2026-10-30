/**
 * Determinism lint for the simulation (production roadmap 0.8.11): the sim must give every engine the same answer, so
 * nothing under game/src/sim/ may call what engines are free to implement differently or what depends on the clock or
 * the locale. Forbidden: Math.random and the transcendental functions (sin, cos, tan, exp, pow, log, atan and their
 * relatives: their last bits are implementation-defined), Date, Intl, toLocale*, performance.now, and a sort without a
 * comparator (the default compares strings, which is deterministic, but a bare sort on numbers is a classic bug and the
 * spec forbids it). Allowed: Math.floor/ceil/round/min/max/abs/imul and friends (exact), and `Date` inside the two
 * calendar modules (daily.ts, weekly.ts), which derive labels from a date the caller passes. A line that ends in a
 * `// determinism: <why>` comment is allowed (used for a replay's createdAt timestamp, metadata the sim never reads).
 * Comments are stripped before matching, so prose may mention these names.
 *   node --import tsx tools/determinism-lint.ts [dir]      # exit 1 with one line per hit
 * tests/determinism-lint.test.ts runs it over the sim and over injected offenders.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface LintHit {
  file: string;
  line: number;
  rule: string;
  text: string;
}
export const CALENDAR_MODULES: readonly string[] = ['daily.ts', 'weekly.ts'];
export const ALLOW_MARK = /\/\/\s*determinism:\s*\S/;
export const LINT_RULES: readonly { rule: string; re: RegExp; calendarOk?: boolean }[] = [
  {
    rule: 'Math.random or a transcendental function',
    re: /\bMath\.(random|sin|cos|tan|exp|expm1|pow|log|log2|log10|log1p|atan|atan2|asin|acos|sinh|cosh|tanh|asinh|acosh|atanh)\b/,
  },
  { rule: 'Date (the clock)', re: /\bDate\b/, calendarOk: true },
  { rule: 'Intl (the locale)', re: /\bIntl\b/ },
  { rule: 'toLocale* (the locale)', re: /\.toLocale\w*\s*\(/ },
  { rule: 'performance.now (the clock)', re: /\bperformance\.now\b/ },
  { rule: 'sort without a comparator', re: /\.(sort|toSorted)\(\s*\)/ },
];

/** Block comments become newlines (line numbers stay right), line comments go; the allow marker is read from the original line first. */
export function lintSource(file: string, source: string): LintHit[] {
  const base = path.basename(file);
  const original = source.split(/\r?\n/);
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''));
  const hits: LintHit[] = [];
  stripped.forEach((line, i) => {
    if (ALLOW_MARK.test(original[i] ?? '')) return;
    for (const r of LINT_RULES) {
      if (r.calendarOk && CALENDAR_MODULES.includes(base)) continue;
      if (r.re.test(line)) hits.push({ file, line: i + 1, rule: r.rule, text: (original[i] ?? '').trim().slice(0, 120) });
    }
  });
  return hits;
}

export function lintDir(dir: string): LintHit[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .flatMap((f) => lintSource(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8')));
}

const isMain = process.argv[1] && /determinism-lint\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const dir = path.resolve(process.argv[2] ?? 'game/src/sim');
  const hits = lintDir(dir);
  for (const h of hits) console.error(`${path.relative(process.cwd(), h.file)}:${h.line}: ${h.rule}: ${h.text}`);
  console.log(
    hits.length
      ? `${hits.length} determinism hit(s) under ${path.relative(process.cwd(), dir)}`
      : `determinism lint clean: ${path.relative(process.cwd(), dir)}`,
  );
  process.exitCode = hits.length ? 1 : 0;
}
