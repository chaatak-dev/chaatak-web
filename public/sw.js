/**
 * Service worker for Web Push.
 *
 * Its only job is to turn a push message into a notification. The payload is
 * already rendered from the template catalogue server-side — nothing here
 * composes, translates, or reformats a warning, because the text that left the
 * server is the text that has to arrive.
 */

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
