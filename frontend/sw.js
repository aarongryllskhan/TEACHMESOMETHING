/**
 * Pocket Topics — Service Worker
 * Handles push notifications and offline caching.
 *
 * Notification format (always):
 *   Title : "Random Daily Topic! 🧠"
 *   Body  : the lesson title sent from the server
 */

const CACHE_NAME = 'pocket-topics-v1';

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// ── Push notification received ────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  // Always use our own title — never the lesson title as the header
  const title      = 'Random Daily Topic! 🧠';
  const lessonTitle = data.lessonTitle || data.title || 'Tap to see today\'s lesson';
  const folder     = data.folder || '';
  const id         = data.id     || '';

  const options = {
    body:              lessonTitle,
    icon:              '/images/pockettopics.png',
    badge:             '/images/pockettopics.png',
    tag:               'daily-lesson',          // replaces any previous daily notif
    renotify:          true,
    requireInteraction: false,
    data:              { folder, id, url: self.registration.scope }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { folder, id, url } = event.notification.data || {};
  const target = folder && id
    ? `${url}?open=${encodeURIComponent(folder)}/${encodeURIComponent(id)}`
    : (url || '/');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If app already open, focus it and navigate
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_LESSON', folder, id });
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(target);
    })
  );
});
