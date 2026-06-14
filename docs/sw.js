var CACHE_NAME = 'athar-shell-v20';
var THUMB_CACHE = 'athar-thumbs-v1';
var THUMB_MAX_AGE = 24 * 60 * 60 * 1000; // يوم واحد
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
});ِ

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(key){
        return key !== CACHE_NAME && key !== THUMB_CACHE;
      }).map(function(key){ return caches.delete(key); }));
    })
  );
  self.clients.claim();
});

// هل الطلب صورة مصغرة من Drive؟
function isDriveThumbnail(url) {
  return url.indexOf('drive.google.com/thumbnail') > -1 ||
         url.indexOf('lh3.googleusercontent.com') > -1;
}

// الشبكة أولًا للأصول البرمجية + كاش مخصص لصور Drive
self.addEventListener('fetch', function(event){
  if (event.request.method !== 'GET') return;
  var url = event.request.url;

  // كاش خاص لصور Drive المصغرة: cache-first مع TTL يوم
  if (isDriveThumbnail(url)) {
    event.respondWith(
      caches.open(THUMB_CACHE).then(function(cache){
        return cache.match(event.request).then(function(hit){
          if (hit) {
            // تحديث في الخلفية إن مضى أكثر من يوم
            var cachedDate = hit.headers.get('sw-cached-at');
            if (cachedDate && (Date.now() - parseInt(cachedDate, 10)) > THUMB_MAX_AGE) {
              fetch(event.request).then(function(fresh){
                if (fresh && fresh.ok) {
                  var headers = new Headers(fresh.headers);
                  headers.set('sw-cached-at', String(Date.now()));
                  fresh.clone().blob().then(function(body){
                    cache.put(event.request, new Response(body, {
                      status: fresh.status,
                      statusText: fresh.statusText,
                      headers: headers
                    }));
                  });
                }
              }).catch(function(){});
            }
            return hit;
          }
          // لا يوجد في الكاش: جلب من الشبكة وحفظه
          return fetch(event.request).then(function(response){
            if (response && response.ok) {
              var headers = new Headers(response.headers);
              headers.set('sw-cached-at', String(Date.now()));
              response.clone().blob().then(function(body){
                cache.put(event.request, new Response(body, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: headers
                }));
              });
            }
            return response;
          }).catch(function(){
            return new Response('', { status: 503 });
          });
        });
      })
    );
    return;
  }

  // أصول التطبيق: الشبكة أولًا مع رجوع للكاش
  var reqUrl = new URL(url);
  if (reqUrl.origin !== self.location.origin) return;
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
