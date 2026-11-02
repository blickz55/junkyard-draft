/**
 * The tester build as an agent panel meets it: a build folder served locally with the test link's real worker in front of a stand-in
 * database, so the play data and the survey land where the report reads them and nothing reaches the real link.
 *   node --import tsx tools/panel/site.ts [--dist dist-test] [--port 4700]
 * GET /__report is what `npm run playtest:report` would print for this panel, /__report.json the same as data.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import worker from '../../deploy/test-link/worker';
import { standInD1 } from '../../tests/e2e/d1';
import { render, summarize, type EventRow, type FeedbackRow } from '../playtest-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const dist = path.resolve(opt('dist', 'dist-test'));
const port = Number(opt('port', '4700'));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const db = standInD1();
const report = () =>
  summarize(
    db.rows<EventRow>('SELECT install, name, props, at FROM events ORDER BY install, at'),
    db.rows<FeedbackRow>('SELECT code, install, tester, answers, received FROM feedback ORDER BY received'),
  );

http
  .createServer(async (req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method === 'POST') {
      const body: Buffer[] = [];
      for await (const chunk of req) body.push(chunk as Buffer);
      const env = { DB: db, ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
      const answer = await worker.fetch(new Request(`http://x${p}`, { method: 'POST', body: Buffer.concat(body) }), env, { waitUntil: () => {} });
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(await answer.text());
      return;
    }
    if (p === '/__report' || p === '/__report.json') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(p.endsWith('.json') ? JSON.stringify(report(), null, 2) : render(report()));
      return;
    }
    const f = path.join(dist, p === '/' ? 'index.html' : decodeURIComponent(p));
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`panel site on http://127.0.0.1:${port}/ serving ${dist}`));
