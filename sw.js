// Service worker FOOTVAULT : notifications push, installation de l'application et page « hors ligne ».
// Seule la page offline.html est mise en cache : le site, l'API et les soldes ne le sont jamais (ils restent toujours à jour).
const OFFLINE_CACHE = 'fv-offline-v1';
const OFFLINE_URL = 'offline.html';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(OFFLINE_CACHE).then(c => c.addAll([OFFLINE_URL, 'footvault-icon.svg'])).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('fv-offline-') && k !== OFFLINE_CACHE).map(k => caches.delete(k)))).catch(() => {}).then(() => self.clients.claim())
));
// Pages visitées sans réseau : page hors ligne. Toute autre requête (scripts, API, images) passe directement au réseau.
// Une réponse du serveur, même en erreur (503 pendant un redémarrage), n'est jamais remplacée.
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(async () => (await caches.match(OFFLINE_URL)) || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
});
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
