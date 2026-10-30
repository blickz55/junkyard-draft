// A small reader for Cloudflare Pages `_headers` files (production roadmap 0.8.5), used by tests/deploy.test.mjs to serve a
// built site the way Pages would: every rule whose path pattern matches the request path applies, in file order, and a
// later rule's value for the same header name replaces the earlier one. Patterns: `*` matches any run of characters
// (including `/`), `:name` matches one path segment, everything else is literal. Comments (#) and blank lines are skipped.
// Cloudflare's own matcher is the authority; this one covers the constructs deploy/_headers uses.

/** @returns {{ path: string, headers: Record<string, string> }[]} */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { path: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`_headers: header line before any path: ${JSON.stringify(line)}`);
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`_headers: header line without a colon: ${JSON.stringify(line)}`);
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}

/** Compile a `_headers` path pattern into a RegExp over the request path. */
export function patternToRegExp(pattern) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const src = pattern
    .split('*')
    .map((part) => escape(part).replace(/:[A-Za-z0-9_]+/g, '[^/]+'))
    .join('.*');
  return new RegExp(`^${src}$`);
}

/** The headers Pages would add to a response for `reqPath` (a pathname such as `/index.html`). */
export function headersFor(rules, reqPath) {
  const out = {};
  for (const r of rules) if (patternToRegExp(r.path).test(reqPath)) Object.assign(out, r.headers);
  return out;
}
