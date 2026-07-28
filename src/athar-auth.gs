/**
 * أثر — مصادقة كلمة المرور.
 *
 * كلمة المرور الافتراضية للمستخدمين الحاليين هي الرقم الوظيفي، ثم يجبر النظام
 * المستخدم على تغييرها قبل تحميل القوائم وفتح التطبيق.
 */

var USER_HEADERS = ['emp_no','name','role','title','active',
  'password_hash','salt','must_reset','pwd_updated_at','email','phone'];
var PWD_ITERATIONS = 4000;
var PWD_ITERATIONS_LEGACY = 12000;
var PWD_MIN_LEN = 6;
var LOGIN_MAX_FAILS = 5;
var LOGIN_LOCK_SECONDS = 300;
var ELEVATED_ROLES = ['admin'];
var RESET_CODE_TTL_SECONDS = 600;
var RESET_CODE_MAX_ATTEMPTS = 5;
var RESET_REQUEST_COOLDOWN_SECONDS = 60;
var MAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/script.send_mail';

function pepper_() {
  var p = PROP.getProperty('PWD_PEPPER');
  if (!p) {
    p = Utilities.base64EncodeWebSafe(Utilities.getUuid() + ':' + Utilities.getUuid());
    PROP.setProperty('PWD_PEPPER', p);
  }
  return p;
}

function genSalt_() {
  return Utilities.base64EncodeWebSafe(Utilities.getUuid() + Utilities.getUuid()).slice(0, 24);
}

function hashPassword_(password, salt, iters) {
  var n = iters || PWD_ITERATIONS;
  var seed = String(salt) + '|' + pepper_() + '|' + String(password);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  for (var i = 1; i < n; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return Utilities.base64Encode(bytes);
}

function constantTimeEq_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

function verifyPassword_(user, password) {
  if (!user.password_hash) return String(password) === String(user.emp_no);
  if (!user.salt) return false;
  var stored = String(user.password_hash);
  if (constantTimeEq_(hashPassword_(password, user.salt, PWD_ITERATIONS), stored)) return true;
  if (constantTimeEq_(hashPassword_(password, user.salt, PWD_ITERATIONS_LEGACY), stored)) {
    try { rehashUserPassword_(user, password); } catch (e) {}
    return true;
  }
  return false;
}

function rehashUserPassword_(user, password) {
  var sh = ss_().getSheetByName(SHEETS.USERS);
  if (!sh) return;
  ensureSheetHeaders_(sh, USER_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var iNo = head.indexOf('emp_no');
  var iHash = head.indexOf('password_hash');
  var iSalt = head.indexOf('salt');
  var iUpd = head.indexOf('pwd_updated_at');
  if (iNo < 0 || iHash < 0 || iSalt < 0) return;
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][iNo]) === String(user.emp_no)) {
      var newSalt = genSalt_();
      var newHash = hashPassword_(password, newSalt, PWD_ITERATIONS);
      sh.getRange(r + 2, iHash + 1).setValue(newHash);
      sh.getRange(r + 2, iSalt + 1).setValue(newSalt);
      if (iUpd >= 0) sh.getRange(r + 2, iUpd + 1).setValue(new Date());
      CACHE.remove('users');
      return;
    }
  }
}

function failKey_(empNo) { return 'loginfail_' + empNo; }
function lockUntilKey_(empNo) { return 'loginlock_' + empNo; }
function isLocked_(empNo) {
  return parseInt(CACHE.get(failKey_(empNo)) || '0', 10) >= LOGIN_MAX_FAILS;
}
function lockSecondsLeft_(empNo) {
  var until = parseInt(CACHE.get(lockUntilKey_(empNo)) || '0', 10);
  if (!until) return LOGIN_LOCK_SECONDS;
  var left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}
function registerFail_(empNo) {
  var k = failKey_(empNo);
  var n = parseInt(CACHE.get(k) || '0', 10) + 1;
  CACHE.put(k, String(n), LOGIN_LOCK_SECONDS);
  if (n >= LOGIN_MAX_FAILS) {
    CACHE.put(lockUntilKey_(empNo), String(Date.now() + LOGIN_LOCK_SECONDS * 1000), LOGIN_LOCK_SECONDS);
  }
}
function clearFails_(empNo) {
  CACHE.remove(failKey_(empNo));
  CACHE.remove(lockUntilKey_(empNo));
}

// تُشغَّل يدويًا من محرّر السكربت لفكّ القفل عن رقم وظيفي
function clearLoginLock(empNo) {
  clearFails_(String(empNo || '').trim());
  return 'تم فك القفل عن: ' + empNo;
}

// تُشغَّل يدويًا من محرّر السكربت لفكّ القفل عن جميع المستخدمين دفعة واحدة
function clearAllLoginLocks() {
  var users = getUsers_();
  users.forEach(function(u){ clearFails_(String(u.emp_no)); });
  return 'تم فك جميع الأقفال (' + users.length + ' مستخدم).';
}

function login(empNo, password) {
  empNo = String(empNo || '').trim();
  if (!empNo) return { ok: false, msg: 'أدخل الرقم الوظيفي.' };

  if (isLocked_(empNo)) {
    var secs = lockSecondsLeft_(empNo);
    var mins = Math.max(1, Math.ceil(secs / 60));
    return { ok: false, msg: 'تم إيقاف المحاولات مؤقتًا بسبب تكرار الخطأ. حاول بعد ' + mins + ' دقيقة.' };
  }

  var u = findActiveUser_(empNo);
  if (!u || !verifyPassword_(u, password)) {
    registerFail_(empNo);
    try { logAudit_({ emp_no: empNo, name: (u ? u.name : '') }, 'login_failed', ''); } catch (e) {}
    return { ok: false, msg: 'الرقم الوظيفي أو كلمة المرور غير صحيحة.' };
  }

  clearFails_(empNo);
  var mustReset = isActive_(u.must_reset) || !u.password_hash;
  try { logAudit_({ emp_no: u.emp_no, name: u.name }, 'login_ok', ''); } catch (e2) {}
  return {
    ok: true,
    mustReset: mustReset,
    user: { no: u.emp_no, name: u.name, role: u.role, title: u.title }
  };
}

function init(empNo, password) {
  var lr = login(empNo, password);
  if (!lr.ok) return lr;
  if (lr.mustReset) return { ok: true, mustReset: true, user: lr.user };

  var config = getConfig();
  if (ELEVATED_ROLES.indexOf(lr.user.role) >= 0) config.users = getActiveUsersForAdmin_();
  return { ok: true, mustReset: false, user: lr.user, config: config };
}

function passwordStrengthError_(pw, empNo) {
  pw = String(pw == null ? '' : pw);
  if (pw.length < PWD_MIN_LEN) return 'كلمة المرور يجب ألا تقل عن ' + PWD_MIN_LEN + ' أحرف.';
  if (/\s/.test(pw)) return 'لا تستخدم مسافات في كلمة المرور.';
  if (!/[A-Za-z\u0600-\u06FF]/.test(pw)) return 'يجب أن تحتوي على حرف واحد على الأقل.';
  if (!/[0-9]/.test(pw)) return 'يجب أن تحتوي على رقم واحد على الأقل.';
  if (String(pw) === String(empNo)) return 'لا يمكن أن تكون كلمة المرور هي الرقم الوظيفي.';
  return '';
}

// يكتب كلمة مرور جديدة (هاش + ملح) لمستخدم، ويلغي إلزام إعادة التعيين. يُستخدم من changePassword وresetPasswordWithCode.
function setUserPassword_(empNo, newPassword) {
  var sh = ss_().getSheetByName(SHEETS.USERS);
  ensureSheetHeaders_(sh, USER_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var iNo = head.indexOf('emp_no');
  var iHash = head.indexOf('password_hash');
  var iSalt = head.indexOf('salt');
  var iReset = head.indexOf('must_reset');
  var iUpd = head.indexOf('pwd_updated_at');
  if (iNo < 0 || iHash < 0 || iSalt < 0 || iReset < 0) return false;

  var salt = genSalt_();
  var hash = hashPassword_(newPassword, salt);
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][iNo]) === empNo) {
      var row = r + 2;
      sh.getRange(row, iHash + 1).setValue(hash);
      sh.getRange(row, iSalt + 1).setValue(salt);
      sh.getRange(row, iReset + 1).setValue(false);
      if (iUpd >= 0) sh.getRange(row, iUpd + 1).setValue(new Date());
      CACHE.remove('users');
      return true;
    }
  }
  return false;
}

function changePassword(empNo, oldPassword, newPassword) {
  empNo = String(empNo || '').trim();
  var u = findActiveUser_(empNo);
  if (!u) return { ok: false, msg: 'المستخدم غير موجود أو غير نشط.' };
  if (!verifyPassword_(u, oldPassword)) return { ok: false, msg: 'كلمة المرور الحالية غير صحيحة.' };

  var err = passwordStrengthError_(newPassword, empNo);
  if (err) return { ok: false, msg: err };

  if (!setUserPassword_(empNo, newPassword)) {
    return { ok: false, msg: 'أعمدة المصادقة غير موجودة — شغّل upgradeAuth() أولًا.' };
  }
  try { logAudit_({ emp_no: u.emp_no, name: u.name }, 'password_changed', ''); } catch (e2) {}
  return { ok: true };
}

// ============================ نسيت كلمة المرور ============================
function resetCodeKey_(empNo) { return 'pwdreset_' + empNo; }
function resetCooldownKey_(empNo) { return 'pwdresetcd_' + empNo; }

// رسالة عامة موحّدة في كل الحالات (مسجّل/غير مسجّل/بلا بريد) لمنع استكشاف الأرقام الوظيفية.
var RESET_REQUEST_GENERIC_MSG = 'إذا كان بريدك الإلكتروني مسجّلاً في ملفك الشخصي، فسيصلك رمز التحقق خلال لحظات.';

function auditPasswordReset_(user, action, target) {
  try {
    logAudit_({ emp_no: user.emp_no || '', name: user.name || '' }, action, target || '');
  } catch (e) {
    logServerError_('password reset audit failed: ' + action, e);
  }
}

function safeErrorText_(e) {
  var msg = (e && e.message) ? e.message : String(e || 'unknown error');
  return msg.slice(0, 180);
}

function requestPasswordReset(empNo) {
  empNo = String(empNo || '').trim();
  var generic = { ok: true, msg: RESET_REQUEST_GENERIC_MSG };
  if (!empNo) return generic;

  var u = findActiveUser_(empNo);
  if (!u) return generic;
  if (!u.email) {
    auditPasswordReset_(u, 'password_reset_no_email', '');
    return generic;
  }
  if (CACHE.get(resetCooldownKey_(empNo))) {
    auditPasswordReset_(u, 'password_reset_rate_limited', '');
    return generic;
  }

  var code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    MailApp.sendEmail({
      to: u.email,
      subject: 'رمز إعادة تعيين كلمة المرور — منصة أثر',
      body: 'مرحبًا ' + u.name + '،\n\n' +
        'رمز إعادة تعيين كلمة المرور الخاص بك هو: ' + code + '\n' +
        'الرمز صالح لمدة 10 دقائق ولا يُستخدم إلا مرة واحدة.\n\n' +
        'إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة ولا حاجة لأي إجراء.\n\n' +
        'منصة أثر — المديرية العامة للخدمات الصحية بمحافظة ظفار'
    });
    CACHE.put(resetCodeKey_(empNo), JSON.stringify({ code: code, attempts: 0 }), RESET_CODE_TTL_SECONDS);
    CACHE.put(resetCooldownKey_(empNo), '1', RESET_REQUEST_COOLDOWN_SECONDS);
    auditPasswordReset_(u, 'password_reset_requested', '');
  } catch (e) {
    CACHE.remove(resetCodeKey_(empNo));
    CACHE.remove(resetCooldownKey_(empNo));
    auditPasswordReset_(u, 'password_reset_send_failed', safeErrorText_(e));
    logServerError_('password reset email send failed for ' + empNo, e);
  }
  return generic;
}

// شغّل هذه الدالة يدويًا من محرّر Apps Script بعد إضافة صلاحية البريد.
// ليست ضمن API_METHODS أو Bridge؛ وظيفتها إجبار شاشة التفويض ثم إرسال اختبار اختياري.
function authorizeMailForAthar(testEmail) {
  var email = String(testEmail || ownerEmail_() || '').trim();
  var out = {
    ok: false,
    requiredScope: MAIL_SEND_SCOPE,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
    testEmailSent: false,
    to: email
  };

  if (email) {
    if (!isValidEmail_(email)) {
      out.msg = 'صيغة البريد غير صحيحة.';
      return out;
    }
    MailApp.sendEmail({
      to: email,
      subject: 'اختبار تفويض بريد منصة أثر',
      body: 'تم تفويض صلاحية إرسال البريد لمنصة أثر بنجاح.'
    });
    out.testEmailSent = true;
  }

  out.ok = true;
  return out;
}

// دالة يدوية من محرّر Apps Script فقط؛ ليست ضمن API_METHODS أو Bridge.
function diagnoseMailSetup(testEmail) {
  var out = {
    ok: false,
    requiredScope: MAIL_SEND_SCOPE,
    authorizationStatus: 'unknown',
    authorizationUrl: '',
    authorizedScopes: null,
    hasMailScope: false,
    authorizationRequired: false,
    remainingDailyQuota: null,
    testEmailSent: false,
    errors: []
  };

  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [MAIL_SEND_SCOPE]);
    var status = authInfo.getAuthorizationStatus();
    out.authorizationStatus = String(status);
    out.authorizationUrl = authInfo.getAuthorizationUrl ? (authInfo.getAuthorizationUrl() || '') : '';
    out.authorizedScopes = authInfo.getAuthorizedScopes ? authInfo.getAuthorizedScopes() : null;
    out.hasMailScope = out.authorizedScopes ?
      out.authorizedScopes.indexOf(MAIL_SEND_SCOPE) >= 0 :
      status === ScriptApp.AuthorizationStatus.NOT_REQUIRED;
    out.authorizationRequired =
      String(status) === String(ScriptApp.AuthorizationStatus.REQUIRED) || !out.hasMailScope;
  } catch (e) {
    out.errors.push('authorization: ' + safeErrorText_(e));
    logServerError_('diagnoseMailSetup authorization check failed', e);
    return out;
  }

  if (out.authorizationRequired) {
    out.errors.push('التفويض مطلوب لصلاحية إرسال البريد. افتح رابط authorizationUrl أو شغّل الدالة بعد إعادة التفويض.');
    return out;
  }

  try {
    out.remainingDailyQuota = MailApp.getRemainingDailyQuota();
  } catch (e2) {
    out.errors.push('quota: ' + safeErrorText_(e2));
    logServerError_('diagnoseMailSetup quota check failed', e2);
  }

  testEmail = String(testEmail || '').trim();
  if (testEmail) {
    if (!isValidEmail_(testEmail)) {
      out.errors.push('testEmail: صيغة البريد غير صحيحة.');
    } else {
      try {
        MailApp.sendEmail({
          to: testEmail,
          subject: 'اختبار بريد منصة أثر',
          body: 'هذه رسالة اختبار من diagnoseMailSetup في منصة أثر.\nإذا وصلتك، فصلاحية إرسال البريد تعمل.'
        });
        out.testEmailSent = true;
      } catch (e3) {
        out.errors.push('send: ' + safeErrorText_(e3));
        logServerError_('diagnoseMailSetup test email failed', e3);
      }
    }
  }

  out.ok = out.errors.length === 0 &&
    out.remainingDailyQuota !== null &&
    (out.hasMailScope || out.authorizationStatus === String(ScriptApp.AuthorizationStatus.NOT_REQUIRED)) &&
    (!testEmail || out.testEmailSent);
  return out;
}

function resetPasswordWithCode(empNo, code, newPassword) {
  empNo = String(empNo || '').trim();
  var badCode = { ok: false, msg: 'الرمز غير صحيح أو منتهي الصلاحية. اطلب رمزًا جديدًا.' };

  var u = findActiveUser_(empNo);
  if (!u) return badCode;

  var key = resetCodeKey_(empNo);
  var raw = CACHE.get(key);
  if (!raw) return badCode;

  var state;
  try { state = JSON.parse(raw); } catch (e) { state = null; }
  if (!state) return badCode;

  if (state.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    CACHE.remove(key);
    return { ok: false, msg: 'محاولات كثيرة خاطئة. اطلب رمزًا جديدًا.' };
  }
  if (!constantTimeEq_(String(code || '').trim(), state.code)) {
    state.attempts++;
    CACHE.put(key, JSON.stringify(state), RESET_CODE_TTL_SECONDS);
    return { ok: false, msg: 'الرمز غير صحيح.' };
  }

  var err = passwordStrengthError_(newPassword, empNo);
  if (err) return { ok: false, msg: err };

  if (!setUserPassword_(empNo, newPassword)) {
    return { ok: false, msg: 'أعمدة المصادقة غير موجودة — شغّل upgradeAuth() أولًا.' };
  }
  CACHE.remove(key);
  clearFails_(empNo);
  try { logAudit_({ emp_no: u.emp_no, name: u.name }, 'password_reset_completed', ''); } catch (e2) {}
  return { ok: true };
}

// ============================ الملف الشخصي ============================
function isValidEmail_(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')); }
function isValidPhone_(phone) { return /^[0-9+\-\s]{7,20}$/.test(String(phone || '')); }

function getMyProfile(empNo) {
  var u = requireActiveUser_(empNo);
  return { no: u.emp_no, name: u.name, role: u.role, title: u.title || '', email: u.email || '', phone: u.phone || '' };
}

function updateMyProfile(empNo, email, phone) {
  empNo = String(empNo || '').trim();
  var u = requireActiveUser_(empNo);
  email = String(email || '').trim();
  phone = String(phone || '').trim();
  if (email && !isValidEmail_(email)) return { ok: false, msg: 'صيغة البريد الإلكتروني غير صحيحة.' };
  if (phone && !isValidPhone_(phone)) return { ok: false, msg: 'صيغة رقم الهاتف غير صحيحة.' };

  if (email) {
    var taken = getUsers_().some(function (x) {
      return String(x.emp_no) !== empNo && isActive_(x.active) &&
        String(x.email || '').toLowerCase() === email.toLowerCase();
    });
    if (taken) return { ok: false, msg: 'هذا البريد الإلكتروني مسجَّل لموظف آخر.' };
  }

  var sh = ss_().getSheetByName(SHEETS.USERS);
  ensureSheetHeaders_(sh, USER_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var iNo = head.indexOf('emp_no');
  var iEmail = head.indexOf('email');
  var iPhone = head.indexOf('phone');
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][iNo]) === empNo) {
      var row = r + 2;
      if (iEmail >= 0) sh.getRange(row, iEmail + 1).setValue(email);
      if (iPhone >= 0) sh.getRange(row, iPhone + 1).setValue(phone);
      break;
    }
  }
  CACHE.remove('users');
  var changed = [];
  if (String(u.email || '') !== email) changed.push('email');
  if (String(u.phone || '') !== phone) changed.push('phone');
  try { logAudit_({ emp_no: u.emp_no, name: u.name }, 'profile_updated', changed.join(',')); } catch (e2) {}
  return { ok: true, email: email, phone: phone };
}

function adminAddUser(actorEmpNo, empNo, name, role, title, institution) {
  requireAdmin_(actorEmpNo);
  empNo = String(empNo || '').trim();
  if (!empNo || !name) return { ok: false, msg: 'الرقم الوظيفي والاسم مطلوبان.' };
  var sh = ss_().getSheetByName(SHEETS.USERS);
  ensureSheetHeaders_(sh, USER_HEADERS);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var existing = getUsers_().filter(function(x){ return String(x.emp_no) === empNo; })[0];
  if (existing) return { ok: false, msg: 'الرقم الوظيفي مسجّل مسبقًا.' };

  var rowObj = {
    emp_no: empNo, name: name, role: role || 'staff', title: title || '',
    active: true, password_hash: '', salt: '', must_reset: true, pwd_updated_at: ''
  };
  if (head.indexOf('institution') >= 0) rowObj.institution = institution || '';
  sh.appendRow(head.map(function(h){ return Object.prototype.hasOwnProperty.call(rowObj, h) ? rowObj[h] : ''; }));
  CACHE.remove('users');
  logAudit_({ emp_no: actorEmpNo, name: '' }, 'user_added', empNo);
  return { ok: true };
}

function adminResetPassword(actorEmpNo, empNo) {
  requireAdmin_(actorEmpNo);
  empNo = String(empNo || '').trim();
  var sh = ss_().getSheetByName(SHEETS.USERS);
  ensureSheetHeaders_(sh, USER_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var iNo = head.indexOf('emp_no');
  var iHash = head.indexOf('password_hash');
  var iSalt = head.indexOf('salt');
  var iReset = head.indexOf('must_reset');
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][iNo]) === empNo) {
      sh.getRange(r + 2, iHash + 1).setValue('');
      sh.getRange(r + 2, iSalt + 1).setValue('');
      sh.getRange(r + 2, iReset + 1).setValue(true);
      CACHE.remove('users');
      logAudit_({ emp_no: actorEmpNo, name: '' }, 'password_reset', empNo);
      return { ok: true, msg: 'تمت الإعادة. كلمة المرور الآن = الرقم الوظيفي.' };
    }
  }
  return { ok: false, msg: 'المستخدم غير موجود.' };
}

function getUsersForAdmin(actorEmpNo) {
  requireAdmin_(actorEmpNo);
  return getUsers_().filter(function (u) { return isActive_(u.active); }).map(function (u) {
    return { no: String(u.emp_no), name: u.name, role: u.role, title: u.title || '', email: u.email || '', phone: u.phone || '' };
  });
}

function adminUpdateUser(actorEmpNo, empNo, name, title, email, phone) {
  requireAdmin_(actorEmpNo);
  empNo = String(empNo || '').trim();
  var u = requireActiveUser_(empNo);
  name = String(name || '').trim();
  title = String(title || '').trim();
  email = String(email || '').trim();
  phone = String(phone || '').trim();
  if (!name) return { ok: false, msg: 'الاسم مطلوب.' };
  if (email && !isValidEmail_(email)) return { ok: false, msg: 'صيغة البريد الإلكتروني غير صحيحة.' };
  if (phone && !isValidPhone_(phone)) return { ok: false, msg: 'صيغة رقم الهاتف غير صحيحة.' };

  if (email) {
    var taken = getUsers_().some(function (x) {
      return String(x.emp_no) !== empNo && isActive_(x.active) &&
        String(x.email || '').toLowerCase() === email.toLowerCase();
    });
    if (taken) return { ok: false, msg: 'هذا البريد الإلكتروني مسجَّل لموظف آخر.' };
  }

  var sh = ss_().getSheetByName(SHEETS.USERS);
  ensureSheetHeaders_(sh, USER_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var iNo = head.indexOf('emp_no');
  var iName = head.indexOf('name');
  var iTitle = head.indexOf('title');
  var iEmail = head.indexOf('email');
  var iPhone = head.indexOf('phone');
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][iNo]) === empNo) {
      var row = r + 2;
      if (iName >= 0) sh.getRange(row, iName + 1).setValue(name);
      if (iTitle >= 0) sh.getRange(row, iTitle + 1).setValue(title);
      if (iEmail >= 0) sh.getRange(row, iEmail + 1).setValue(email);
      if (iPhone >= 0) sh.getRange(row, iPhone + 1).setValue(phone);
      break;
    }
  }
  CACHE.remove('users');
  var changed = [];
  if (String(u.name || '') !== name) changed.push('name');
  if (String(u.title || '') !== title) changed.push('title');
  if (String(u.email || '') !== email) changed.push('email');
  if (String(u.phone || '') !== phone) changed.push('phone');
  try { logAudit_({ emp_no: actorEmpNo, name: '' }, 'admin_profile_updated', empNo + ':' + changed.join(',')); } catch (e2) {}
  return { ok: true, name: name, title: title, email: email, phone: phone };
}

function upgradeAuth() {
  var sh = ss_().getSheetByName(SHEETS.USERS);
  if (!sh) throw new Error('ورقة Users غير موجودة — شغّل setup() أولًا.');
  ensureSheetHeaders_(sh, USER_HEADERS);
  pepper_();
  CACHE.remove('users');
  return 'تمت ترقية المصادقة بنجاح. كلمة المرور الافتراضية لكل مستخدم = رقمه الوظيفي حتى أول تغيير.';
}
