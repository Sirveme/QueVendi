/**
 * Service Worker para QueVendí PRO
 * Permite funcionamiento offline básico
 */

const CACHE_NAME = 'quevendi-v1';
const urlsToCache = [
  '/static/css/styles.css',
  '/static/js/app.js',
  '/static/js/voice.js'
];

// Instalación
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Service Worker: Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activación
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Eliminando cache antiguo', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Intercepción de peticiones
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - retornar respuesta
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});