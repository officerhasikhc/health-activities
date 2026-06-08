/* ============================================================
   server-bridge.js — اتصال مباشر بخادم Apps Script عبر fetch
   يرجع JSON من doPost دون iframe أو كوكيز طرف ثالث،
   فيعمل على iOS وأندرويد وداخل التطبيق المثبّت (PWA).
   ============================================================ */
(function(){
  var EXEC_URL = window.ATHAR_EXEC_URL ||
    (window.ATHAR_BRIDGE_URL ? window.ATHAR_BRIDGE_URL.replace(/([?&])bridge=1(&|$)/, '$1').replace(/[?&]$/, '') : '');
  var TIMEOUT_MS = 90000;

  function callServer(fn, args){
    if (!EXEC_URL) {
      return Promise.reject(new Error('لم يُضبط رابط الخادم.'));
    }
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if (controller) controller.abort(); }, TIMEOUT_MS);

    // text/plain لتفادي preflight (طلب CORS بسيط مع Apps Script)
    return fetch(EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }),
      redirect: 'follow',
      credentials: 'omit'
    }).then(function(res){
      clearTimeout(timer);
      if (!res.ok) throw new Error('تعذّر الاتصال بالخادم (' + res.status + ').');
      return res.text();
    }).then(function(text){
      var payload;
      try { payload = JSON.parse(text); }
      catch (e) { throw new Error('استجابة غير متوقعة من الخادم.'); }
      if (payload && payload.ok) return payload.data;
      throw new Error((payload && payload.error) || 'تعذّر الاتصال بالخادم.');
    }).catch(function(err){
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new Error('انتهت مهلة الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.');
      }
      throw (err instanceof Error) ? err : new Error('تعذّر الاتصال بالخادم.');
    });
  }

  window.AtharServer = {
    run: function(fn, args){ return callServer(fn, args); },
    reload: function(){},
    isReady: function(){ return !!EXEC_URL; }
  };
})();
