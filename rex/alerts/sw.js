self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  let problem = '';
  try { data = event.data ? event.data.json() : {}; } catch (error) { problem = String(error); }
  event.waitUntil((async () => {
    const seen = (stage, extra = '') => fetch('/api/push/seen', { method: 'POST', headers: { 'x-rex-phone': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: String(data.tag ?? ''), stage, problem: problem || extra }) }).catch(() => {});
    await seen('received');
    await self.registration.showNotification(data.title || 'An agent needs you', {
      body: data.body || 'Open Asks to answer.',
      tag: data.tag,
      icon: '/icon-192.png',
      data: { url: data.url || '/' },
    }).then(() => seen('shown'), (error) => seen('failed', String(error)));
    if (Number.isInteger(data.count) && self.navigator.setAppBadge) await self.navigator.setAppBadge(data.count);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
