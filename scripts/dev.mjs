#!/usr/bin/env node
// Dev server: esbuild watch + serve on http://127.0.0.1:5173 with live reload.
import { context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { buildOptions, cspFor } from './esbuild-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.dev-build');
const PORT = Number(process.env.GAME_PORT || 5173);
fs.mkdirSync(OUT, { recursive: true });

const ctx = await context({
  ...buildOptions({ root: ROOT, outdir: OUT, dev: true }),
  banner: { js: 'new EventSource("/esbuild").addEventListener("change", () => location.reload());' },
});
await ctx.watch();
const { host, port: esbPort } = await ctx.serve({ servedir: OUT, host: '127.0.0.1' });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
// Front server: serves game/index.html (rewritten) and game/public, proxies bundle + live-reload to esbuild.
http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs
        .readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8')
        .replace('/src/main.ts', '/main.js')
        .replace('__BUILD__', 'dev')
        .replace('__CSP__', cspFor({ dev: true }));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    const pub = path.join(ROOT, 'game', 'public', url.pathname);
    if (pub.startsWith(path.join(ROOT, 'game', 'public')) && fs.existsSync(pub) && fs.statSync(pub).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(pub)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(pub).pipe(res);
    }
    const proxy = http.request({ hostname: host, port: esbPort, path: req.url, method: req.method, headers: req.headers }, (pr) => {
      res.writeHead(pr.statusCode, pr.headers);
      pr.pipe(res);
    });
    proxy.on('error', () => {
      res.writeHead(502);
      res.end('esbuild unavailable');
    });
    req.pipe(proxy);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`\n  JUNKYARD DRAFT dev build → http://127.0.0.1:${PORT}/\n`));
