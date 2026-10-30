// Junkyard Draft service worker (production roadmap 0.10.3). scripts/build-lib.mjs writes it into dist/ with __VERSION__ and
// __PRECACHE__ filled for that build (the dev server never serves it). The shell (the page, the hashed bundle, the art, the
// sounds, the texts, the icons) is cached on install, so a practice game plays offline; the daily needs our server and the
// title says so. Navigations go to the network first (a new deploy arrives on the next load) and fall back to the cached
// page; everything else from this origin is answered from the cache first; nothing from another origin is cached (our
// server is live or absent). A new worker waits until the page asks it to take over (the title's restart button), so an
// update never lands in the middle of a run.
const VERSION = '__VERSION__';
const CACHE = `jd-shell-${VERSION}`;
/* global __PRECACHE__ */
const PRECACHE = __PRECACHE__; // the build writes the array here
const PAGE = new URL('index.html', self.location.href).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new URL(p, self.location.href).href))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
// the daily reminder (0.10.4): our server sends one message a day to those who asked; a tap opens the yard
self.addEventListener('push', (e) => {
  let data;
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data ? e.data.text() : '' };
  }
  const icon = new URL('icons/icon-192.png', self.location.href).href;
  e.waitUntil(
    self.registration.showNotification(data.title || 'Junkyard Draft', {
      body: data.body || 'The yard is open.',
      icon,
      badge: icon,
      tag: data.tag || 'jd-daily',
      data: { url: new URL(data.url || './', self.location.href).href },
    }),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.location.href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // our server and anything else: live only, never cached
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(PAGE, copy));
          }
          return r;
        })
        .catch(() => caches.match(PAGE)),
    );
    return;
  }
  if (url.pathname.endsWith('/build.json')) {
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return r;
        }),
    ),
  );
});
