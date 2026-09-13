const CACHE = 'ana-shell-v1'
const APP_SHELL = ['/', '/index.html', '/ana-app-icon.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ana-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then(response => {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put('/', copy)).catch(() => {})
        return response
      })
      .catch(async () => (await caches.match(request)) || (await caches.match('/'))))
    return
  }

  event.respondWith(caches.match(request).then(cached => {
    const refresh = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone())).catch(() => {})
      return response
    }).catch(() => cached)
    return cached || refresh
  }))
})
