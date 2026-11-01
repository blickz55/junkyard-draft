/**
 * The community as plain web pages (production roadmaps 0.11.5 and 0.11.10): the hub at /community/, a category, a topic, and a closed
 * day at /community/day/<date or week>. Readable with no game, no script and no key; an open day's talk stays behind its reveal gate,
 * in the game. Everything a player wrote goes through esc() and the pages' policy allows nothing but their own stylesheet.
 */
import { categoryLead, categoryName, sal, SAL_STRINGS } from '../game/src/content/sal-posts';
import { money } from '../game/src/content/format';
import { OPERATOR } from '../game/src/content/operator';
import type { HubCategory } from '../game/src/content/hub';

export const SITE_POLICY = "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const SITE_CSS = `:root { color-scheme: dark; --bg: #16181d; --card: #20242c; --line: #343a46; --text: #e8e6e1; --dim: #a5a9b3; --amber: #f2b84b; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; color: var(--amber); }
article { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; }
article.sal { border-color: var(--amber); }
.who, .count { color: var(--dim); font-size: 0.875rem; }
article.sal .who { color: var(--amber); font-weight: 600; }
.words { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.15rem 0 0; }
.game { margin: 0.35rem 0 0; font-size: 0.875rem; }
ul.list { list-style: none; margin: 0; padding: 0; }
ul.list li { padding: 0.45rem 0; border-top: 1px solid var(--line); }
a { color: var(--amber); }
nav { margin-bottom: 0.75rem; font-size: 0.875rem; }
footer { margin-top: 1.25rem; }
`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
export interface PagePost {
  author: string;
  body: string;
  createdAt: number;
  edited: boolean;
  /** a game attached to the post: a line and a link into the game, never the recording */ game?: { player: string; score: number; hash: string } | null;
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
const back = `<nav><a href="/community/">${esc(sal('sal.hub.back'))}</a></nav>`;
const salPost = (words: string) => `<article class="sal"><div class="who">${esc(sal('sal.pageName'))}</div><p class="words">${esc(words)}</p></article>`;
const game = (g: NonNullable<PagePost['game']>) =>
  `<p class="game">${esc(sal('sal.hub.game', { player: g.player, score: money(g.score) }))} · <a href="${esc(OPERATOR.siteUrl)}/?challenge=${encodeURIComponent(g.hash)}">${esc(sal('sal.hub.watch'))}</a></p>`;
const post = (p: PagePost) =>
  `<article><div class="who">${esc(p.author)} · ${day(p.createdAt)} UTC${p.edited ? ` · ${esc(sal('sal.pageEdited'))}` : ''}</div><p class="words">${esc(p.body)}</p>${p.game ? game(p.game) : ''}</article>`;
const talk = (posts: PagePost[]) => (posts.length ? posts.map(post).join('\n') : `<p class="who">${esc(sal('sal.pageEmpty'))}</p>`);
const count = (n: number) => `<span class="count">${esc(sal('sal.hub.posts', { n }))}</span>`;

export const missingPage = () => page(SAL_STRINGS['sal.pageMissing'].en, `${back}<h1>${esc(sal('sal.pageMissing'))}</h1>`);

/** The front of the hub: the four categories and the days with a talk. */
export function hubPage(o: { categories: { key: HubCategory; posts: number }[]; days: { key: string; weekly: boolean; posts: number }[] }): string {
  const name = sal('sal.hub');
  const categories = o.categories
    .map(
      (c) => `<li><a href="/community/hub/${c.key}">${esc(categoryName(c.key))}</a> ${count(c.posts)}<div class="who">${esc(categoryLead(c.key))}</div></li>`,
    )
    .join('\n');
  const days = o.days
    .map((d) => `<li><a href="/community/day/${esc(d.key)}">${esc(sal(d.weekly ? 'sal.pageWeek' : 'sal.pageDay', { key: d.key }))}</a> ${count(d.posts)}</li>`)
    .join('\n');
  return page(
    name,
    `<h1>${esc(name)}</h1><p class="who">${esc(sal('sal.hub.lead'))}</p>\n<ul class="list">${categories}</ul>\n${days ? `<h2>${esc(sal('sal.hub.days'))}</h2><ul class="list">${days}</ul>` : ''}`,
  );
}

/** A category: its own thread, and the topics started in it. */
export function categoryPage(o: { category: HubCategory; posts: PagePost[]; topics: { key: string; title: string; posts: number }[] }): string {
  const name = categoryName(o.category);
  const topics = o.topics
    .map((t) => `<li><a href="/community/topic/${esc(t.key.slice('topic:'.length))}">${esc(t.title)}</a> ${count(t.posts)}</li>`)
    .join('\n');
  return page(
    name,
    `${back}<h1>${esc(name)}</h1><p class="who">${esc(categoryLead(o.category))}</p>\n${topics ? `<h2>${esc(sal('sal.hub.topics'))}</h2><ul class="list">${topics}</ul>\n` : ''}${talk(o.posts)}`,
  );
}

export const topicPage = (o: { title: string; posts: PagePost[] }): string => page(o.title, `${back}<h1>${esc(o.title)}</h1>\n${talk(o.posts)}`);

/** A day. `posts` is null while the yard is open: the page says so and shows none of them. */
export function dayPage(o: { key: string; weekly: boolean; opening: string; closing: string | null; posts: PagePost[] | null }): string {
  const yard = sal(o.weekly ? 'sal.pageWeek' : 'sal.pageDay', { key: o.key });
  const title = sal('sal.pageTitle', { yard });
  const heading = `${back}<h1>${esc(title)}</h1>`;
  if (!o.posts) return page(title, `${heading}<p>${esc(sal('sal.pageOpen'))}</p>`);
  return page(title, `${heading}\n${salPost(o.opening)}\n${o.closing ? salPost(o.closing) : ''}\n${talk(o.posts)}`);
}
