// A small static file server for a built site (production roadmap 0.10.2 / 0.10.3): the first-interactive measurement and the
// web-app e2e serve dist/ from it. Text is gzipped on the fly (as a CDN does), the root can be swapped to play a new deploy.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};

/** Serve `root` on a free loopback port; returns { url, port, server, setRoot, close }. */
export function serveDir(root, { gzip = true } = {}) {
  let current = path.resolve(root);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(current, p);
    if (!file.startsWith(current) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const buf = fs.readFileSync(file);
    const ext = path.extname(file);
    const gz = gzip && /^\.(js|json|webmanifest|html|svg|css|txt)$/.test(ext) && /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      ...(gz ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(gz ? zlib.gzipSync(buf, { level: 9 }) : buf);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        server,
        setRoot(r) {
          current = path.resolve(r);
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    }),
  );
}
