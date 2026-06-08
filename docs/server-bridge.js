/* ============================================================
   server-bridge.js — جسر Apps Script عبر iframe مخفي.
   ملاحظة: fetch المباشر إلى Apps Script من GitHub Pages يفشل بسبب CORS،
   لذلك يبقى iframe + google.script.run هو المسار المستقر.
   ============================================================ */
(function(){
  function log(){ if (window.AtharLog) window.AtharLog.apply(null, ['bridge'].concat([].slice.call(arguments))); }
  var bridgeUrl = window.ATHAR_BRIDGE_URL;
  var bridgeFrame = null;
  var bridgeWindow = null;
  var bridgeOrigin = null;
  var ready = false;
  var seq = 1;
  var pending = {};
  var readyWaiters = [];

  function trustedOrigin(origin){
    return origin === 'https://script.google.com' ||
      origin === 'https://script.googleusercontent.com' ||
      /\.googleusercontent\.com$/.test(origin);
  }

  function withCacheBust(url){
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
  }

  function ensureFrame(){
    if (bridgeFrame || !bridgeUrl) { if(!bridgeUrl) log('لا يوجد ATHAR_BRIDGE_URL'); return; }
    var src = withCacheBust(bridgeUrl);
    log('إنشاء iframe ->', src);
    bridgeFrame = document.createElement('iframe');
    bridgeFrame.src = src;
    bridgeFrame.title = 'Athar server bridge';
    bridgeFrame.setAttribute('aria-hidden', 'true');
    bridgeFrame.loading = 'eager';
    bridgeFrame.onload = function(){ log('iframe onload (تم تحميل صفحة الجسر)'); };
    bridgeFrame.onerror = function(){ log('iframe onerror (فشل تحميل صفحة الجسر)'); };
    bridgeFrame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none;border:0;right:0;bottom:0;clip-path:inset(50%);';
    document.body.appendChild(bridgeFrame);
  }

  function markReady(){
    log('وصلت إشارة ready من الجسر');
    ready = true;
    var waiters = readyWaiters.slice();
    readyWaiters = [];
    waiters.forEach(function(w){
      clearTimeout(w.timer);
      w.resolve();
    });
  }

  function reloadBridge(){
    ready = false;
    bridgeWindow = null;
    bridgeOrigin = null;
    if (!bridgeFrame) {
      ensureFrame();
      return;
    }
    bridgeFrame.src = 'about:blank';
    setTimeout(function(){ bridgeFrame.src = withCacheBust(bridgeUrl); }, 80);
  }

  function waitReady(timeoutMs){
    ensureFrame();
    if (ready && bridgeWindow) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var waiter = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function(){
          readyWaiters = readyWaiters.filter(function(w){ return w !== waiter; });
          log('انتهت مهلة الانتظار (' + timeoutMs + 'ms) دون ready — الجسر لم يستجب');
          reject(new Error('تعذّر تجهيز الاتصال. أعد تحميل الصفحة، أو افتح الرابط من متصفح Chrome/Safari مباشرة.'));
        }, timeoutMs)
      };
      readyWaiters.push(waiter);
    });
  }

  function callBridge(fn, args){
    var id = 'req_' + (seq++);
    return new Promise(function(resolve, reject){
      pending[id] = { resolve: resolve, reject: reject };
      bridgeWindow.postMessage({ source: 'athar', id: id, fn: fn, args: args || [] }, bridgeOrigin || '*');
      setTimeout(function(){
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error('انتهت مهلة الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.'));
      }, 90000);
    });
  }

  window.addEventListener('message', function(event){
    var msg = event.data || {};
    if (msg.source !== 'athar-bridge') return;
    if (!trustedOrigin(event.origin)) { log('رُفضت رسالة من أصل غير موثوق:', event.origin); return; }
    log('رسالة من الجسر:', event.origin, msg.ready ? 'ready' : ('id=' + msg.id + ' ok=' + msg.ok));
    bridgeWindow = event.source;
    bridgeOrigin = event.origin;
    if (msg.ready) {
      markReady();
      return;
    }
    if (!msg.id || !pending[msg.id]) return;
    var slot = pending[msg.id];
    delete pending[msg.id];
    if (msg.ok) slot.resolve(msg.data);
    else slot.reject(new Error(msg.error || 'تعذّر الاتصال بالخادم.'));
  });

  window.AtharServer = {
    run: function(fn, args){
      log('طلب:', fn, 'ready=' + ready);
      return waitReady(12000).catch(function(){
        log('إعادة تحميل الجسر بعد فشل أول انتظار');
        reloadBridge();
        return waitReady(18000);
      }).then(function(){
        return callBridge(fn, args);
      }).catch(function(err){
        log('فشل الطلب:', fn, '->', err && err.message);
        throw err;
      });
    },
    reload: reloadBridge,
    isReady: function(){
      return ready && !!bridgeWindow;
    }
  };

  ensureFrame();
})();
