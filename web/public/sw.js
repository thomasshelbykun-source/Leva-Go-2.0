// Service worker simples: guarda a "casca" da aplicação para abrir sem rede.
// Os pedidos à API nunca são guardados em cache (dados pessoais e estados em tempo real).
// v4: só guarda ficheiros JavaScript, CSS e imagens que chegaram bem (nunca uma página HTML no lugar de um ficheiro).
const CACHE = 'levago-shell-v4';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/icon.svg', '/manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
function cacheable(res) {
  const type = res.headers.get('content-type') || '';
  return res.ok && !type.includes('text/html');
}
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    // Rede primeiro. A última página que abriu bem fica guardada para quando não há rede.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/img/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (cacheable(res)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          }),
      ),
    );
  }
});
