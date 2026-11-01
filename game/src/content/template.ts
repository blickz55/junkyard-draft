/** The little template language of the strings (production roadmap 0.9.0), apart from the table so the server can use it alone. */
import { int } from './format';

export type Params = Record<string, string | number>;

/** Render a template: `{name}` placeholders and `{n, plural, one {…} other {…}}` with `#` for the number. */
export function render(template: string, params: Params): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matchBrace(template, open);
    if (close < 0) {
      out += template.slice(open);
      break;
    }
    const inner = template.slice(open + 1, close);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural) {
      const n = Number(params[plural[1]] ?? 0);
      out += render(pluralBranch(plural[2], n).replace(/#/g, int(n)), params);
    } else {
      const name = inner.trim();
      const v = params[name];
      out += v === undefined ? `{${name}}` : String(v);
    }
    i = close + 1;
  }
  return out;
}
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}
/** `one {…} other {…}` (and `=N {…}`): the branch for n, English rules. */
function pluralBranch(spec: string, n: number): string {
  const branches: Record<string, string> = {};
  let i = 0;
  while (i < spec.length) {
    const m = /\s*(=\d+|\w+)\s*\{/.exec(spec.slice(i));
    if (!m) break;
    const start = i + m.index + m[0].length - 1;
    const end = matchBrace(spec, start);
    if (end < 0) break;
    branches[m[1]] = spec.slice(start + 1, end);
    i = end + 1;
  }
  return branches[`=${n}`] ?? (n === 1 ? branches.one : undefined) ?? branches.other ?? '';
}
