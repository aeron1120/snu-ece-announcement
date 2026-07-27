const CACHE_NAME = 'ece-notices-v2';
const APP_SHELL = ['/', '/css/style.css', '/js/app.js', '/js/config.js'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin || !APP_SHELL.includes(url.pathname)) return;
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    event.waitUntil(
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
                    );
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data?.json() || {};
    } catch {
        data = { body: event.data?.text() || '' };
    }
    event.waitUntil(self.registration.showNotification(data.title || 'SNU ECE 공지', {
        body: data.body || '새 공지가 등록되었습니다.',
        icon: '/icons/app-icon.svg',
        badge: '/icons/badge-icon.svg',
        tag: data.tag || undefined,
        data: { url: data.url || '/' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'));
});
