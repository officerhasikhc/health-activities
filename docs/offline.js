/* ============================================================
   Offline.js — حفظ محلي أولًا ثم مزامنة مع الخادم
   يخزّن كل إرسال (مع الصور) في IndexedDB، ثم يحاول الرفع.
   عند انقطاع الشبكة يبقى محليًا ويُعاد رفعه تلقائيًا لاحقًا.
   ============================================================ */
var Outbox = (function () {
  var DB = 'atharDB', STORE = 'outbox', VER = 1;
  var ready = open();

  function open() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej('no-idb');
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: true });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode) {
    return ready.then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }
  function add(payload) {
    return tx('readwrite').then(function (st) {
      return new Promise(function (res, rej) {
        var rec = { payload: payload, ts: Date.now() };
        var r = st.add(rec);
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function all() {
    return tx('readonly').then(function (st) {
      return new Promise(function (res) {
        var out = [], c = st.openCursor();
        c.onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { out.push(cur.value); cur.continue(); } else res(out);
        };
        c.onerror = function () { res(out); };
      });
    });
  }
  function remove(localId) {
    return tx('readwrite').then(function (st) {
      return new Promise(function (res) { st.delete(localId).onsuccess = function () { res(); }; });
    });
  }
  function count() { return all().then(function (a) { return a.length; }); }

  // محاولة رفع كل العناصر المعلّقة إلى الخادم
  function flush() {
    if (!navigator.onLine) return Promise.resolve({ sent: 0, pending: 0 });
    return all().then(function (items) {
      var sent = 0;
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () {
          return run('saveActivity', it.payload, it.payload._actor_no || it.payload.created_by_no || it.payload.executor_no)
            .then(function (r) {
              if (r && r.ok) {
                return remove(it.localId).then(function () { sent++; });
              }
            })
            .catch(function () {
              return null;
            });
        });
      });
      return chain.then(function () {
        return count().then(function (p) { return { sent: sent, pending: p }; });
      });
    });
  }

  return { add: add, all: all, remove: remove, count: count, flush: flush, available: !!window.indexedDB };
})();

// إعادة المحاولة تلقائيًا عند عودة الاتصال
window.addEventListener('online', function () {
  toast('عاد الاتصال — جارٍ رفع المحفوظ محليًا…');
  syncOutbox();
});

// رفع تلقائي عند عودة التطبيق للواجهة (مهم لـ iOS الذي لا يدعم Background Sync)
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && navigator.onLine) syncOutbox();
});
window.addEventListener('focus', function () {
  if (navigator.onLine) syncOutbox();
});

// عند طلب Service Worker المزامنة في الخلفية
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'athar-sync') syncOutbox();
  });
}

// تسجيل Background Sync عند توفّره (Chrome/أندرويد) لرفع المحفوظ حتى بعد إغلاق التطبيق
function registerBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  navigator.serviceWorker.ready.then(function (reg) {
    if (reg.sync) reg.sync.register('athar-outbox').catch(function () {});
  }).catch(function () {});
}

function syncOutbox() {
  if (!Outbox.available) return;
  Outbox.flush().then(function (r) {
    updatePending();
    if (r.sent > 0) {
      toast('تم رفع ' + r.sent + ' فعالية محفوظة محليًا.', 'ok');
      if (typeof loadRecords === 'function' && document.getElementById('recList')) loadRecords(true);
    }
  });
}

function updatePending() {
  if (!Outbox.available) return;
  Outbox.count().then(function (n) {
    var el = document.getElementById('pending');
    if (n > 0) registerBackgroundSync();
    if (!el) return;
    if (n > 0) { el.textContent = 'بانتظار الرفع: ' + n; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });
}
