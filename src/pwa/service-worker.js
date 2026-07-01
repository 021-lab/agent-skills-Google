// service-worker.js: cache-first for same-origin framework/app assets,
// network-first for Google/Firebase API calls, offline fallback for
// navigation. See SPEC.md "Target Platform & Limitations": no install
// prompt on iOS, limited background execution, web-push only on 16.4+.

const CACHE_NAME = 'voiceframe-v1';
const API_HOSTS = [
  'googleapis.com',
  'firebaseio.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'accounts.google.com',
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return API_HOSTS.some((host) => url.hostname.endsWith(host));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    cacheFirst(request).catch(async () => {
      if (request.mode === 'navigate') {
        const cachedIndex = await caches.match('/');
        if (cachedIndex) return cachedIndex;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});
