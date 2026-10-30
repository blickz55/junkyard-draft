/**
 * Prose-literal lint (production roadmap 0.9.0): every sentence a player reads must come from the string table
 * (game/src/content/strings.ts), so the DOM screens and the content modules may not hold a string literal that reads
 * like prose. A literal is prose when, after dropping `${…}` interpolations, it holds two or more words of letters
 * separated by a space or punctuation, and it is not a CSS declaration list (`a:b; c:d` or `prop:value`), a class list
 * (`jd-foo jd-bar`), a selector (`[data-testid=…]`), a key (`screen.key`), a URL, a placeholder (`{"format":1,…}`) or
 * a regular-expression-like string. Comments are stripped first. The table and the glossary are exempt (they are the
 * words); so is the operator module (names and addresses).
 *   node --import tsx tools/strings-lint.ts            # exit 1 with one line per hit
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ProseHit {
  file: string;
  line: number;
  text: string;
}
export const LINTED_DIRS = ['game/src/ui', 'game/src/content'];
export const EXEMPT_FILES = new Set(['strings.ts', 'glossary.ts', 'operator.ts']);

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** Remove `${…}` interpolations, brace-aware (an interpolation may hold an object literal). */
function stripInterpolations(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 0;
      let k = i + 1;
      for (; k < body.length; k++) {
        if (body[k] === '{') depth++;
        else if (body[k] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      i = k + 1;
    } else {
      out += body[i];
      i++;
    }
  }
  return out;
}
/** Code that takes a literal as data, not as something a player reads. */
const CODE_BEFORE =
  /(includes|startsWith|endsWith|matchAll|match|querySelector|querySelectorAll|getElementById|setAttribute|getItem|setItem|removeItem|new Error|RegExp|indexOf|split|replace)(<[^>]*>)?\s*\(\s*$|(===|!==)\s*$|case\s+$/;

export function isProse(literal: string, before = ''): boolean {
  if (CODE_BEFORE.test(before)) return false;
  const quote = literal[0];
  let body = literal.slice(1, -1);
  if (quote === '`') body = stripInterpolations(body);
  if (!/[A-Za-z]{2,}[^\sA-Za-z]*\s+[^\sA-Za-z]*[A-Za-z]{2,}/.test(body)) return false; // prose has at least two words separated by whitespace
  if (/^[a-z0-9 -]+$/.test(body) && /^(jd-|data-)/.test(body.trim())) return false; // class lists
  if (/^[a-z-]+\s*:\s*[^;{}]*(;\s*[a-z-]+\s*:\s*[^;{}]*)*;?\s*$/.test(body) && !/[.!?]\s/.test(body)) return false; // CSS declarations (values may be interpolations, stripped above)
  if (/^[a-z-]+\(/.test(body)) return false; // CSS functions: calc(…), rotate(…)
  if (/^\s*\[?data-testid/.test(body) || /^#/.test(body)) return false; // selectors
  if (/^(https?:\/\/|\.{1,2}\/)/.test(body) || /^\{"/.test(body)) return false; // URLs, paths, JSON placeholders
  if (/\//.test(body) && !/[.!?,]\s/.test(body)) return false; // a path or URL template with no sentence punctuation
  if (/^(image|video|text|application)\//.test(body)) return false; // MIME types
  return true;
}

export function lintSource(file: string, source: string): ProseHit[] {
  const hits: ProseHit[] = [];
  const stripped = stripComments(source);
  const lines = stripped.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LITERAL))
      if (isProse(m[0], line.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0)))
        hits.push({ file, line: i + 1, text: m[0].length > 90 ? `${m[0].slice(0, 87)}…` : m[0] });
  });
  return hits;
}

export function lintProseLiterals(dirs: string[]): ProseHit[] {
  const out: ProseHit[] = [];
  for (const dir of dirs)
    for (const f of fs
      .readdirSync(dir)
      .filter((x) => x.endsWith('.ts') && !EXEMPT_FILES.has(x))
      .sort())
      out.push(...lintSource(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8')));
  return out;
}

const isMain = process.argv[1] && /strings-lint\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const hits = lintProseLiterals(LINTED_DIRS.map((d) => path.resolve(d)));
  for (const h of hits) console.error(`${path.relative(process.cwd(), h.file)}:${h.line}: ${h.text}`);
  console.log(hits.length ? `${hits.length} prose literal(s) outside the string table` : 'strings lint clean: every sentence comes from the table');
  process.exitCode = hits.length ? 1 : 0;
}
