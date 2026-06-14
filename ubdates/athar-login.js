/* =====================================================================
   أثر — منطق الدخول وكلمة المرور (يُدمج داخل ملف JavaScript الـ include)
   ---------------------------------------------------------------------
   تعليمات الدمج (مهمّة):
   1) في ملف JavaScript الحالي لديك: ابحث عن دالتك القديمة doLogin().
      انقل منها منطق "إظهار التطبيق + تحميل القوائم" إلى الدالة enterApp(r) أدناه،
      ثم احذف doLogin() القديمة (حتى لا تتعارض مع الجديدة هنا).
   2) اضبط الدالة serverCall() لتستخدم نفس وسيلة الاتصال التي يستعملها تطبيقك حاليًا
      للوصول إلى الخادم (نفس الجسر الذي كانت doLogin القديمة تستدعي عبره init).
   ===================================================================== */

// ---------------------------------------------------------------------
// (أ) نقطة الاتصال بالخادم — اربطها بوسيلتك الحالية
// ---------------------------------------------------------------------
async function serverCall(fn, args) {
  // --- الحالة (A): إذا كان تطبيقك يقدَّم من Apps Script مباشرة عبر google.script.run ---
  // return new Promise(function (resolve, reject) {
  //   google.script.run
  //     .withSuccessHandler(resolve)
  //     .withFailureHandler(function (e) { reject(new Error(e && e.message ? e.message : 'فشل الاتصال')); })
  //     [fn].apply(google.script.run, args);
  // });

  // --- الحالة (B): إذا كانت الواجهة على GitHub Pages وتتصل عبر fetch/الجسر إلى doPost ---
  // استبدل BACKEND_URL برابط تطبيق الويب المنتهي بـ /exec (أو استخدم جسر postMessage الموجود لديك).
  var BACKEND_URL = window.ATHAR_BACKEND_URL || 'ضع_رابط_/exec_هنا';
  var res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain يتجنّب preflight
    body: JSON.stringify({ fn: fn, args: args })
  });
  var out = await res.json();
  if (!out.ok) throw new Error(out.error || 'تعذّر الاتصال بالخادم.');
  return out.data;
}

// ---------------------------------------------------------------------
// (ب) أدوات مساعدة
// ---------------------------------------------------------------------
var ATHAR_REMEMBER_KEY = 'athar_emp_no';
var _pendingPwd = '';   // كلمة المرور المؤقّتة بين الدخول وإجبار التغيير
var _currentUser = null;

function _q(id) { return document.getElementById(id); }
function _setErr(id, m) { var el = _q(id); if (el) el.textContent = m || ''; }
function _busy(id, on, label) { var b = _q(id); if (b) { b.disabled = on; b.textContent = on ? '...جارٍ' : label; } }

// حفظ بيانات الدخول في مدير كلمات المرور / حساب جوجل (كروم/إيدج)
async function storeCredential(id, password, name) {
  try {
    if (window.PasswordCredential) {
      await navigator.credentials.store(
        new PasswordCredential({ id: String(id), password: String(password), name: name || '' })
      );
    }
  } catch (e) {} // في بقية المتصفّحات يتولّى الحفظ سمات autocomplete + الـ form
}

// ملء الرقم الوظيفي تلقائيًا: من حساب جوجل/المتصفّح، أو من التخزين المحلّي
async function prefillEmp() {
  try {
    if (navigator.credentials && window.PasswordCredential) {
      var cred = await navigator.credentials.get({ password: true, mediation: 'optional' });
      if (cred) {
        if (_q('empNo')) _q('empNo').value = cred.id || '';
        if (cred.password && _q('pw')) _q('pw').value = cred.password;
        if (_q('rememberEmp')) _q('rememberEmp').checked = true;
        return;
      }
    }
  } catch (e) {}
  var saved = localStorage.getItem(ATHAR_REMEMBER_KEY);
  if (saved && _q('empNo')) { _q('empNo').value = saved; if (_q('rememberEmp')) _q('rememberEmp').checked = true; }
}

// زر إظهار/إخفاء + تنبيه Caps Lock (يُربط مرّة عند التحميل)
function wireAuthUx() {
  Array.prototype.forEach.call(document.querySelectorAll('.pw-toggle'), function (b) {
    b.addEventListener('click', function () {
      var f = _q(b.getAttribute('data-for')); if (!f) return;
      var show = f.type === 'password';
      f.type = show ? 'text' : 'password';
      b.textContent = show ? 'إخفاء' : 'إظهار';
    });
  });
  var pw = _q('pw'), caps = _q('capsHint');
  if (pw && caps) {
    pw.addEventListener('keyup', function (e) {
      caps.textContent = (e.getModifierState && e.getModifierState('CapsLock')) ? 'مفتاح Caps Lock مُفعّل' : '';
    });
  }
}
document.addEventListener('DOMContentLoaded', function () { wireAuthUx(); prefillEmp(); });

// ---------------------------------------------------------------------
// (ج) الدخول
// ---------------------------------------------------------------------
async function doLogin(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  _setErr('loginErr', '');
  var no = (_q('empNo').value || '').trim();
  var pass = _q('pw').value || '';
  if (!no || !pass) { _setErr('loginErr', 'أدخل الرقم الوظيفي وكلمة المرور.'); return; }

  _busy('loginBtn', true, 'دخول المنصة');
  try {
    var r = await serverCall('init', [no, pass]);
    if (!r || !r.ok) { _setErr('loginErr', (r && r.msg) || 'تعذّر الدخول.'); _busy('loginBtn', false, 'دخول المنصة'); return; }

    _currentUser = r.user; _pendingPwd = pass;
    if (_q('rememberEmp') && _q('rememberEmp').checked) localStorage.setItem(ATHAR_REMEMBER_KEY, no);
    else localStorage.removeItem(ATHAR_REMEMBER_KEY);

    if (r.mustReset) {
      // أول دخول بكلمة المرور الافتراضية → إجبار التغيير قبل أي شيء
      _q('resetUser').value = no;
      _q('loginScreen').classList.add('hidden');
      _q('resetScreen').classList.remove('hidden');
      _q('newPw').focus();
    } else {
      await storeCredential(no, pass, r.user.name);
      enterApp(r);
    }
  } catch (e) {
    _setErr('loginErr', e.message || 'حدث خطأ بالاتصال.');
  }
  _busy('loginBtn', false, 'دخول المنصة');
}

// ---------------------------------------------------------------------
// (د) تغيير كلمة المرور (إجباري أول دخول)
// ---------------------------------------------------------------------
async function doChangePassword(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  _setErr('resetErr', '');
  var no = _q('resetUser').value;
  var p1 = _q('newPw').value || '', p2 = _q('newPw2').value || '';
  if (p1 !== p2) { _setErr('resetErr', 'كلمتا المرور غير متطابقتين.'); return; }
  if (p1.length < 8) { _setErr('resetErr', 'كلمة المرور يجب ألا تقل عن ٨ أحرف.'); return; }
  if (p1 === no) { _setErr('resetErr', 'لا يمكن أن تكون كلمة المرور هي الرقم الوظيفي.'); return; }

  _busy('resetBtn', true, 'حفظ ومتابعة');
  try {
    var r = await serverCall('changePassword', [no, _pendingPwd, p1]);
    if (!r || !r.ok) { _setErr('resetErr', (r && r.msg) || 'تعذّر التغيير.'); _busy('resetBtn', false, 'حفظ ومتابعة'); return; }

    await storeCredential(no, p1, _currentUser ? _currentUser.name : '');
    _pendingPwd = '';
    var full = await serverCall('init', [no, p1]); // إعادة الإقلاع لتحميل القوائم بعد التغيير
    _q('resetScreen').classList.add('hidden');
    enterApp(full);
  } catch (e) {
    _setErr('resetErr', e.message || 'حدث خطأ بالاتصال.');
  }
  _busy('resetBtn', false, 'حفظ ومتابعة');
}

// ---------------------------------------------------------------------
// (هـ) الدخول الفعلي إلى التطبيق
// ---------------------------------------------------------------------
// ضع هنا منطقك القديم الذي كان داخل doLogin بعد نجاح init:
// إظهار #app، تعبئة الاسم/الصفة، تحميل r.config، بناء التبويبات... إلخ.
function enterApp(r) {
  _q('loginScreen').classList.add('hidden');
  _q('app').classList.remove('hidden');
  if (_q('whoName')) _q('whoName').textContent = r.user.name || '';
  if (_q('whoTitle')) _q('whoTitle').textContent = r.user.title || '';
  // مثال: state.user = r.user; state.config = r.config; buildTabs(); renderView();
}
