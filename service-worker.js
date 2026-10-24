/* Small network-first offline shell. Third-party ad/analytics requests are never intercepted. */
'use strict';

const CACHE_NAME = 'domainfits-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/css/style.css',
  '/assets/js/site-config.js',
  '/assets/js/ads-config.js',
  '/assets/js/platform.js',
  '/assets/js/ad-manager.js',
  '/assets/js/pwa.js',
  '/assets/js/main.js',
  '/assets/js/domain-generator-data.js',
  '/assets/js/domain-generator.js',
  '/tools/domain-generator.html',
  '/blog/index.html',
  '/blog/blog-config.json',
  '/assets/img/logo.svg',
  '/assets/img/favicon.svg',
  '/assets/img/pwa-192.png',
  '/assets/img/pwa-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok && response.type === 'basic') await cache.put(url, response);
      } catch (error) {
        // An unavailable optional page should not prevent installation of the shell.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('domainfits-pwa-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/ads/') || url.pathname.includes('adsbygoogle')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true })
        || await cache.match(url.pathname, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return await cache.match('/offline.html') || await cache.match('/index.html');
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
