// Service worker for the Scores PWA.
// - App shell (HTML/JS/CSS/icons): stale-while-revalidate, so the app opens instantly and offline.
// - Score APIs: network first, falling back to the last cached response when offline.
// - Team logos: cache first (they rarely change).
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const API = `api-${VERSION}`;
const IMG = `img-${VERSION}`;

const scope = self.registration.scope; // e.g. https://host/catchall/sports/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([scope, `${scope}manifest.webmanifest`, `${scope}icons/icon-192.png`]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, API, IMG].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const API_HOSTS = ['site.api.espn.com', 'statsapi.mlb.com', 'api-web.nhle.com'];
const IMG_HOSTS = ['a.espncdn.com', 'assets.nhle.com', 'www.mlbstatic.com'];

async function networkFirst(req) {
  const cache = await caches.open(API);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req.mode === 'navigate' ? scope : req, res.clone());
      return res;
    })
    .catch(() => hit || caches.match(scope));
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (API_HOSTS.includes(url.hostname)) return event.respondWith(networkFirst(req));
  if (IMG_HOSTS.includes(url.hostname)) return event.respondWith(cacheFirst(req));
  if (url.href.startsWith(scope)) {
    // NHL proxy calls or anything JSON from our origin should not be served stale.
    if (url.pathname.includes('/nhl-api/')) return;
    return event.respondWith(staleWhileRevalidate(req));
  }
  // Anything else (e.g. a user-configured NHL proxy) goes through network first.
  if (req.headers.get('accept')?.includes('json') || url.pathname.startsWith('/v1/')) {
    return event.respondWith(networkFirst(req));
  }
});
