/**
 * A day's thread as a plain web page (production roadmap 0.11.5), at /community/day/<date or week>: readable with no game, no script
 * and no key, so it needs a closed day; an open day's talk stays behind its reveal gate, in the game. Everything a player wrote goes
 * through esc() and the page's policy allows nothing but its own stylesheet.
 */
import { sal, SAL_STRINGS } from '../game/src/content/sal-posts';
import { OPERATOR } from '../game/src/content/operator';

export const SITE_POLICY = "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const SITE_CSS = `:root { color-scheme: dark; --bg: #16181d; --card: #20242c; --line: #343a46; --text: #e8e6e1; --dim: #a5a9b3; --amber: #f2b84b; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; margin: 0.5rem 0 1rem; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; }
article.sal { border-color: var(--amber); }
.who { color: var(--dim); font-size: 0.875rem; }
article.sal .who { color: var(--amber); font-weight: 600; }
.words { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.15rem 0 0; }
a { color: var(--amber); }
footer { margin-top: 1.25rem; }
`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
export interface DayPost {
  author: string;
  body: string;
  createdAt: number;
  edited: boolean;
}
const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(OPERATOR.product)}</title>
<link rel="stylesheet" href="/community/site.css">
</head>
<body>
<main>
${body}
<footer><a href="${esc(OPERATOR.siteUrl)}">${esc(sal('sal.pagePlay'))}</a></footer>
</main>
</body>
</html>
`;
const salPost = (words: string) => `<article class="sal"><div class="who">${esc(sal('sal.pageName'))}</div><p class="words">${esc(words)}</p></article>`;
const post = (p: DayPost) =>
  `<article><div class="who">${esc(p.author)} · ${day(p.createdAt)} UTC${p.edited ? ` · ${esc(sal('sal.pageEdited'))}` : ''}</div><p class="words">${esc(p.body)}</p></article>`;

export const missingPage = () => page(SAL_STRINGS['sal.pageMissing'].en, `<h1>${esc(sal('sal.pageMissing'))}</h1>`);

/** A thread. `posts` is null while the yard is open: the page says so and shows none of them. */
export function dayPage(o: { key: string; weekly: boolean; opening: string; closing: string | null; posts: DayPost[] | null }): string {
  const yard = sal(o.weekly ? 'sal.pageWeek' : 'sal.pageDay', { key: o.key });
  const title = sal('sal.pageTitle', { yard });
  const heading = `<h1>${esc(title)}</h1>`;
  if (!o.posts) return page(title, `${heading}<p>${esc(sal('sal.pageOpen'))}</p>`);
  const talk = o.posts.length ? o.posts.map(post).join('\n') : `<p class="who">${esc(sal('sal.pageEmpty'))}</p>`;
  return page(title, `${heading}\n${salPost(o.opening)}\n${o.closing ? salPost(o.closing) : ''}\n${talk}`);
}
