/* ============================================================
   debug.js — أدوات تشخيص على الهاتف (بدون كمبيوتر)
   - يلتقط كل الأخطاء وأحداث الجسر في سجل دائم.
   - عند التفعيل (?debug=1) يعرض كونسول Eruda + لوحة سجل بزر نسخ/مشاركة.
   - يجب تحميله أولًا قبل بقية السكربتات لالتقاط أبكر الأخطاء.
   التفعيل:  افتح الرابط مع ?debug=1   (مثال: .../health-activities/?debug=1)
   الإيقاف:  افتح الرابط مع ?debug=0
   ============================================================ */
(function () {
  var MAX = 400;
  var DEBUG_KEY = 'athar_debug';
  var DEBUG_LOG_KEY = 'athar_debug_log';
  var buf = loadStoredLogs();

  function loadStoredLogs() {
    try {
      var raw = localStorage.getItem(DEBUG_LOG_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-MAX) : [];
    } catch (e) {
      return [];
    }
  }

  function persistLogs() {
    try { localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(buf.slice(-MAX))); } catch (e) {}
  }

  function nowStr() {
    var d = new Date();
    return d.toLocaleTimeString('en-GB') + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function stringifyArg(a) {
    if (a instanceof Error) return (a.name || 'Error') + ': ' + a.message + (a.stack ? '\n' + a.stack : '');
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }

  var lastAction = '-';
  function push(level, tag, args) {
    var text = Array.prototype.map.call(args, stringifyArg).join(' ');
    var line = '[' + nowStr() + '] [' + level + ']' + (tag ? ' (' + tag + ')' : '') + ' ' + text;
    buf.push(line);
    if (buf.length > MAX) buf.shift();
    persistLogs();
    if (tag === 'bridge' && /^(fetch ->|طلب)/.test(text)) lastAction = text;
    refreshPanel();
    maybeReport(level, tag, text);
  }

  /* ---------------- إرسال الأخطاء للمالك بالبريد (يعمل دائمًا) ---------------- */
  var reporting = false;          // حماية من التكرار اللانهائي
  var recentSig = {};             // منع تكرار نفس الخطأ
  var sentThisMinute = 0, minuteStamp = 0;

  function currentUser() {
    try { return (window.USER && window.USER.no) ? (window.USER.no + ' / ' + (window.USER.name || '')) : 'زائر'; }
    catch (e) { return 'غير معروف'; }
  }

  function maybeReport(level, tag, text) {
    if (reporting) return;
    var isError = level === 'ERROR' || level === 'PROMISE';
    var isBridgeFail = tag === 'bridge' && /فشل|انتهت مهلة/.test(text);
    if (!isError && !isBridgeFail) return;
    sendReport(level, text);
  }

  function sendReport(level, message) {
    var now = Date.now();
    if (now - minuteStamp > 60000) { minuteStamp = now; sentThisMinute = 0; }
    if (sentThisMinute >= 8) return;            // سقف عميل: 8 رسائل/دقيقة
    var sig = level + '|' + message.slice(0, 120);
    if (recentSig[sig] && now - recentSig[sig] < 60000) return;  // منع التكرار 60ث
    recentSig[sig] = now;
    sentThisMinute++;

    var report = {
      level: level,
      message: message.slice(0, 300),
      action: lastAction,
      user: currentUser(),
      ua: navigator.userAgent,
      url: location.href,
      ts: new Date().toISOString(),
      logs: buf.slice(-40).join('\n')
    };
    reporting = true;
    try {
      if (window.AtharServer && window.AtharServer.run) {
        window.AtharServer.run('logClientError', [report])
          .catch(function () { /* تجاهل فشل الإرسال */ })
          .then(function(){ reporting = false; });
      } else { reporting = false; }
    } catch (e) { reporting = false; }
  }

  // واجهة عامة للتسجيل من بقية الملفات
  window.AtharLog = function (tag) {
    push('LOG', tag, Array.prototype.slice.call(arguments, 1));
  };

  // التقاط الأخطاء العامة (تعمل دائمًا حتى دون تفعيل اللوحة)
  window.addEventListener('error', function (e) {
    if (e && e.message) push('ERROR', 'window', [e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')]);
    else if (e && e.target && e.target.src) push('ERROR', 'resource', ['فشل تحميل: ' + e.target.src]);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    push('PROMISE', 'reject', [e && e.reason ? e.reason : 'rejection']);
  });

  // اعتراض console للأخطاء/التحذيرات
  ['error', 'warn'].forEach(function (m) {
    var orig = console[m];
    console[m] = function () {
      push(m.toUpperCase(), 'console', arguments);
      if (orig) orig.apply(console, arguments);
    };
  });

  // لقطة بيئة التشغيل (تفيد كثيرًا لتشخيص فروق الهاتف عن الكمبيوتر)
  function envSnapshot() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    push('ENV', 'init', [JSON.stringify({
      ua: navigator.userAgent,
      online: navigator.onLine,
      cookies: navigator.cookieEnabled,
      standalone: standalone,
      lang: navigator.language,
      vw: window.innerWidth, vh: window.innerHeight,
      url: location.href
    })]);
  }

  /* ---------------- التفعيل عبر ?debug=1 ---------------- */
  if (location.search.indexOf('debug=1') > -1) localStorage.setItem(DEBUG_KEY, '1');
  if (location.search.indexOf('debug=0') > -1) localStorage.removeItem(DEBUG_KEY);
  var DEBUG_ON = localStorage.getItem(DEBUG_KEY) === '1';

  /* ---------------- لوحة السجل + Eruda ---------------- */
  var panel, logArea;
  var erudaVisible = false;

  function refreshPanel() {
    if (logArea) {
      logArea.value = buf.join('\n');
      logArea.scrollTop = logArea.scrollHeight;
    }
  }

  function copyLogs() {
    var text = buf.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash('تم نسخ السجل ✔'); },
        function () { selectArea(); });
    } else { selectArea(); }
  }

  function shareLogs() {
    var text = buf.join('\n');
    if (navigator.share) navigator.share({ title: 'سجل أثر', text: text }).catch(function () {});
    else copyLogs();
  }

  function clearLogs() {
    buf.length = 0;
    persistLogs();
    refreshPanel();
    flash('تم مسح السجل');
  }

  function toggleEruda() {
    if (!window.eruda) { flash('Eruda غير جاهز'); return; }
    try {
      if (erudaVisible) { eruda.hide(); erudaVisible = false; flash('تم إخفاء Eruda'); }
      else { eruda.show(); erudaVisible = true; flash('تم عرض Eruda'); }
    } catch (e) {
      eruda.show(); erudaVisible = true;
    }
  }

  function selectArea() {
    if (!logArea) return;
    logArea.focus(); logArea.select();
    try { document.execCommand('copy'); flash('تم نسخ السجل ✔'); } catch (e) { flash('حدّد النص وانسخه يدويًا'); }
  }

  var flashT;
  function flash(msg) {
    var f = document.getElementById('athar-dbg-flash');
    if (!f) return;
    f.textContent = msg; f.style.opacity = '1';
    clearTimeout(flashT);
    flashT = setTimeout(function () { f.style.opacity = '0'; }, 1800);
  }

  var sizeMode = 'normal'; // 'normal' | 'max'
  function applySize() {
    if (!panel) return;
    if (sizeMode === 'max') panel.style.cssText = panelBase + 'inset:8px 8px 8px 8px;max-height:none;';
    else panel.style.cssText = panelBase + 'inset:auto 8px 84px 8px;max-height:50vh;';
    panel.style.display = 'flex';
  }
  var panelBase = 'position:fixed;z-index:2147483647;flex-direction:column;background:#0e1c22;color:#cfe0e3;border:1px solid #2a4750;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-family:monospace;font-size:11px;direction:ltr;';

  function openPanel() { applySize(); refreshPanel(); }
  function closePanel() { if (panel) panel.style.display = 'none'; }

  function buildPanel() {
    var btn = document.createElement('button');
    btn.textContent = '🐞';
    btn.title = 'سجل التشخيص';
    btn.style.cssText = 'position:fixed;z-index:2147483646;bottom:14px;left:14px;width:46px;height:46px;border-radius:50%;border:0;background:#1a4d5c;color:#fff;font-size:20px;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    btn.onclick = function () { if (panel.style.display === 'none') openPanel(); else closePanel(); };
    document.body.appendChild(btn);

    panel = document.createElement('div');
    panel.style.cssText = panelBase + 'display:none;inset:auto 8px 84px 8px;max-height:50vh;';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:6px;padding:8px;border-bottom:1px solid #2a4750;align-items:center';
    head.innerHTML =
      '<b style="color:#fff;font-family:sans-serif">سجل التشخيص</b>' +
      '<span id="athar-dbg-flash" style="margin-inline-start:auto;color:#7fd1a0;font-family:sans-serif;opacity:0;transition:.2s"></span>';
    head.appendChild(mkIcon('⤢', 'تكبير/تصغير اللوحة', function () { sizeMode = (sizeMode === 'max' ? 'normal' : 'max'); applySize(); }));
    head.appendChild(mkIcon('−', 'إخفاء اللوحة مع حفظ السجل', closePanel));
    panel.appendChild(head);

    logArea = document.createElement('textarea');
    logArea.readOnly = true;
    logArea.style.cssText = 'flex:1;min-height:26vh;width:100%;box-sizing:border-box;background:#0e1c22;color:#cfe0e3;border:0;padding:8px;resize:none;outline:none';
    panel.appendChild(logArea);

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;padding:8px;border-top:1px solid #2a4750';
    bar.appendChild(mkBtn('نسخ', copyLogs));
    bar.appendChild(mkBtn('مشاركة', shareLogs));
    bar.appendChild(mkBtn('مسح السجل', clearLogs));
    bar.appendChild(mkBtn('Eruda', toggleEruda));
    panel.appendChild(bar);
    document.body.appendChild(panel);
  }

  function mkIcon(label, title, fn) {
    var b = document.createElement('button');
    b.textContent = label; b.title = title; b.onclick = fn;
    b.style.cssText = 'width:30px;height:30px;border:0;border-radius:6px;background:#234a55;color:#fff;font-size:15px;line-height:1;margin-inline-start:4px';
    return b;
  }

  function mkBtn(label, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    b.style.cssText = 'flex:1;padding:8px;border:0;border-radius:6px;background:#1a4d5c;color:#fff;font-family:sans-serif;font-size:13px';
    return b;
  }

  function loadEruda() {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda@3';
    s.onload = function () { if (window.eruda) eruda.init(); push('DBG', 'eruda', ['Eruda جاهز']); };
    s.onerror = function () { push('DBG', 'eruda', ['تعذّر تحميل Eruda (تحقق من الاتصال)']); };
    document.head.appendChild(s);
  }

  // تتبّع النقرات يعمل دائمًا لتحديد آخر إجراء في تقرير الخطأ
  function trackTaps() {
    document.addEventListener('pointerup', function (e) {
      var t = e.target.closest('button,a,[onclick]');
      if (!t) return;
      var label = (t.tagName || '') + (t.id ? '#' + t.id : '') + ' "' + (t.textContent || '').trim().slice(0, 24) + '"';
      lastAction = label;
      if (DEBUG_ON) push('TAP', '', [label]);
    }, true);
  }

  function start() {
    envSnapshot();
    trackTaps();
    if (!DEBUG_ON) return;
    buildPanel();
    loadEruda();
    push('DBG', 'init', ['وضع التشخيص مُفعّل']);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
