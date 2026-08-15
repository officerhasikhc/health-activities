// عامل خدمة مؤقت لوضع الصيانة: يمسح كل الكاش ويلغي تسجيل نفسه
// حتى لا تظهر النسخة القديمة من التطبيق للمستخدمين الذين ثبّتوه.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll({ type: 'window' }); })
      .then(function (clients) {
        clients.forEach(function (client) { client.navigate(client.url); });
      })
  );
});
