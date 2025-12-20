// Service Worker for Push Notifications ONLY
// No caching, no offline storage - notifications only

const SW_VERSION = '6.0.9';

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installed for notifications v' + SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activated for notifications');
  event.waitUntil(self.clients.claim());
});

// No fetch caching - let all requests pass through to network
self.addEventListener('fetch', (event) => {
  return;
});

// Handle push notifications from server
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('Error parsing push data:', e);
  }

  const title = data.title || 'ACCESS Network';
  const options = {
    body: data.body || 'New transaction received',
    icon: '/access-logo-1ipfs.png',
    badge: '/access-logo-1ipfs.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'access-transaction',
    requireInteraction: true,
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification.tag);
  event.notification.close();

  // Open the app or focus existing window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus existing window
        for (let client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// Handle messages from the main page to show notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, icon, data } = event.data;
    
    self.registration.showNotification(title, {
      body: body,
      icon: icon || '/access-logo-1ipfs.png',
      badge: '/access-logo-1ipfs.png',
      tag: tag || 'access-notification',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: data || {}
    });
  }
});
