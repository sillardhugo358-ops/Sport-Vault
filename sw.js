// Service worker FOOTVAULT : notifications push et installation de l'application. Aucune mise en cache : le site reste toujours à jour.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Réseau seul (obligatoire pour que certains navigateurs proposent l'installation).
self.addEventListener('fetch', () => {});
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'FOOTVAULT', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(m.title || 'FOOTVAULT').slice(0, 120), {
    body: String(m.body || '').slice(0, 300), icon: 'footvault-icon-192.png', badge: 'footvault-icon-192.png', tag: m.tag || undefined, data: { url: typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (new URL(c.url).origin === self.location.origin && 'focus' in c) return c.focus().then(w => { if ('navigate' in w) return w.navigate(target); });
    return self.clients.openWindow(target);
  }));
});
