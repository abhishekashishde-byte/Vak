const CACHE = 'ana-shell-v2'
const APP_SHELL = ['/', '/index.html', '/ana-app-icon.png']

async function cacheCurrentBuild() {
  const cache = await caches.open(CACHE)
  await cache.addAll(APP_SHELL)
  try {
    const response = await fetch('/', { cache: 'no-store' })
    const html = await response.clone().text()
    await cache.put('/', response)
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1])
      .filter(path => path.startsWith('/') && !path.startsWith('/api/'))
    await Promise.all([...new Set(assets)].map(path => cache.add(path).catch(() => {})))
  } catch {}
}

self.addEventListener('install', event => {
  event.waitUntil(cacheCurrentBuild().then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('ana-shell-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then(response => {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put('/', copy)).catch(() => {})
        return response
      })
      .catch(async () => (await caches.match(request)) || (await caches.match('/')) || (await caches.match('/index.html'))))
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
