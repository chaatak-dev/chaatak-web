/**
 * Service worker: push notifications, and the offline app shell.
 *
 * The shell matters as much as the push does. "Show the last known warning
 * when the network is gone" is impossible if the app itself cannot load — a
 * cold start offline would otherwise reach the browser's error page and the
 * cached warning would never be seen at all.
 *
 * Nothing here composes, translates, or reformats a warning. The text that
 * left the server is the text that arrives.
 */

const SHELL_CACHE = 'chaatak-shell-v1';

// Kept deliberately small: the document and the brand marks. Everything else
// is fetched fresh when there is a network and simply absent when there is not.
const SHELL_URLS = ['/', '/brand/chaatak-app-icon.svg', '/brand/chaatak-favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      // A shell that fails to pre-cache must not block activation; the runtime
      // handler below fills the cache on the first successful load anyway.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses are never served from cache. A stale weather value handed
  // back as if it were live is the exact lie the staleness rules exist to
  // prevent — the cached ANSWER is rendered by the app, with its age stated.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first so a connected user always gets the current
  // build, falling back to the cached shell so an offline one gets the app
  // rather than a browser error page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() =>
          caches.match('/', { ignoreSearch: true }).then(
            (cached) =>
              cached ||
              new Response('', { status: 503, statusText: 'Offline' }),
          ),
        ),
    );
    return;
  }

  // Static assets: cache first, since a hashed build asset never changes.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Chaatak';
  const body = payload.body || '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/brand/chaatak-app-icon.svg',
      badge: '/brand/chaatak-favicon.svg',
      // A warning should persist until it is looked at, not fade away while
      // the phone is in a pocket.
      requireInteraction: true,
      tag: payload.tag || 'chaatak-warning',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
