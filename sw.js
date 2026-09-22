// Increment VERSION whenever a precached file changes; deploy all files together.
const VERSION = '2.3.13';
const BASE = new URL('./', self.location.href);
const PREFIX = `jarvislifetracker:${BASE.pathname}:`;
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './dashboard.js', './navigation.js', './rutinas.js', './descanso.js', './config.js', './auth.js', './pwa.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE);
      console.error('JarvisLifeTracker: no se pudo preparar el modo sin conexión.', error);
      throw error; // An incomplete update must not replace the previous worker.
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
    // Migrate only this app's legacy cache, leaving other Pages projects alone.
    if (keys.includes('jarvis-v1')) {
      const legacy = await caches.open('jarvis-v1');
      if (await legacy.match(new URL('./app.js', BASE).href)) {
        await caches.delete('jarvis-v1');
      }
    }
    await self.clients.claim();
  })());
});

// Activate updates on user request, or naturally when all old tabs are closed.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Authenticated/no-store requests bypass even URLs matching static assets.
  // The API must also send Cache-Control: no-store for the HTTP cache.
  if (request.method !== 'GET' || url.origin !== BASE.origin ||
      request.headers.has('Authorization') || request.cache === 'no-store') return;
  const isEntry = request.mode === 'navigate' &&
    (url.pathname === BASE.pathname || url.pathname === `${BASE.pathname}index.html`);
  // Cache only the static shell, never arbitrary requests or future private data.
  if (!isEntry && !ASSETS.includes(url.href)) return;
  const key = isEntry ? new URL('./index.html', BASE).href : url.href;
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch (error) {
      console.warn('JarvisLifeTracker: caché no disponible.', error);
    }
    try {
      return await fetch(request);
    } catch {
      return new Response('JarvisLifeTracker no está disponible sin conexión. Vuelve a intentarlo con internet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  })());
});
