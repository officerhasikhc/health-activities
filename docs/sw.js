var CACHE_NAME = 'athar-shell-v14';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './debug.js',
  './server-bridge.js',
  './offline.js',
  './app.js',
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/logo-login.png',
  './assets/social-preview.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache){ return cache.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(key){ return key !== CACHE_NAME; }).map(function(key){ return caches.delete(key); }));
    })
  );
  self.clients.claim();
});

// الشبكة أولًا للأصول البرمجية (لتفادي تقادم النسخة) مع رجوع للكاش عند انقطاع الشبكة.
self.addEventListener('fetch', function(event){
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(function(response){
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
      return response;
    }).catch(function(){
      return caches.match(event.request).then(function(hit){
        return hit || caches.match('./index.html');
      });
    })
  );
});

// Background Sync: إخطار الصفحات لرفع المحفوظ محليًا (outbox).
self.addEventListener('sync', function(event){
  if (event.tag === 'athar-outbox') {
    event.waitUntil(notifyClientsToSync());
  }
});

function notifyClientsToSync(){
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(clients){
    clients.forEach(function(client){ client.postMessage({ type: 'athar-sync' }); });
  });
}
