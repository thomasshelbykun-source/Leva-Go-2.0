// Service worker: guarda a base da aplicação para abrir sem rede e mostra as notificações push.
// Os pedidos à API nunca ficam em cache (dados pessoais e estados em tempo real).
const CACHE = 'levago-shell-v3';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html', '/icon.svg', '/manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
  }
});

self.addEventListener('push', (e) => {
  let msg = { title: 'LevaGo', body: 'Tem uma novidade na sua encomenda.', url: '/' };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    /* mensagem sem dados: fica o texto geral */
  }
  e.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, icon: '/icon.svg', badge: '/icon.svg', data: { url: msg.url }, tag: msg.url }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const w of list) {
        if ('focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
