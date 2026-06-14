/**
 * أثر — مصادقة كلمة المرور.
 *
 * كلمة المرور الافتراضية للمستخدمين الحاليين هي الرقم الوظيفي، ثم يجبر النظام
 * المستخدم على تغييرها قبل تحميل القوائم وفتح التطبيق.
 */

var USER_HEADERS = ['emp_no','name','role','title','active',
  'password_hash','salt','must_reset','pwd_updated_at'];
var PWD_ITERATIONS = 12000;
var PWD_MIN_LEN = 6;
var LOGIN_MAX_FAILS = 5;
var LOGIN_LOCK_SECONDS = 900;
var ELEVATED_ROLES = ['admin'];

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

function hashPassword_(password, salt) {
  var seed = String(salt) + '|' + pepper_() + '|' + String(password);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  for (var i = 1; i < PWD_ITERATIONS; i++) {
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
  return constantTimeEq_(hashPassword_(password, user.salt), String(user.password_hash));
}

function failKey_(empNo) { return 'loginfail_' + empNo; }
function isLocked_(empNo) {
  return parseInt(CACHE.get(failKey_(empNo)) || '0', 10) >= LOGIN_MAX_FAILS;
}
function registerFail_(empNo) {
  var k = failKey_(empNo);
  var n = parseInt(CACHE.get(k) || '0', 10) + 1;
  CACHE.put(k, String(n), LOGIN_LOCK_SECONDS);
}
function clearFails_(empNo) { CACHE.remove(failKey_(empNo)); }

function login(empNo, password) {
  empNo = String(empNo || '').trim();
  if (!empNo) return { ok: false, msg: 'أدخل الرقم الوظيفي.' };

  if (isLocked_(empNo)) {
    return { ok: false, msg: 'تم إيقاف المحاولات مؤقتًا بسبب تكرار الخطأ. حاول بعد قليل.' };
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

function changePassword(empNo, oldPassword, newPassword) {
  empNo = String(empNo || '').trim();
  var u = findActiveUser_(empNo);
  if (!u) return { ok: false, msg: 'المستخدم غير موجود أو غير نشط.' };
  if (!verifyPassword_(u, oldPassword)) return { ok: false, msg: 'كلمة المرور الحالية غير صحيحة.' };

  var err = passwordStrengthError_(newPassword, empNo);
  if (err) return { ok: false, msg: err };

  var sh = ss_().getSheetByName(SHEETS.USERS);
  ensureSheetHeaders_(sh, USER_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var iNo = head.indexOf('emp_no');
  var iHash = head.indexOf('password_hash');
  var iSalt = head.indexOf('salt');
  var iReset = head.indexOf('must_reset');
  var iUpd = head.indexOf('pwd_updated_at');
  if (iNo < 0 || iHash < 0 || iSalt < 0 || iReset < 0) {
    return { ok: false, msg: 'أعمدة المصادقة غير موجودة — شغّل upgradeAuth() أولًا.' };
  }

  var salt = genSalt_();
  var hash = hashPassword_(newPassword, salt);
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][iNo]) === empNo) {
      var row = r + 2;
      sh.getRange(row, iHash + 1).setValue(hash);
      sh.getRange(row, iSalt + 1).setValue(salt);
      sh.getRange(row, iReset + 1).setValue(false);
      if (iUpd >= 0) sh.getRange(row, iUpd + 1).setValue(new Date());
      break;
    }
  }
  CACHE.remove('users');
  try { logAudit_({ emp_no: u.emp_no, name: u.name }, 'password_changed', ''); } catch (e2) {}
  return { ok: true };
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

function upgradeAuth() {
  var sh = ss_().getSheetByName(SHEETS.USERS);
  if (!sh) throw new Error('ورقة Users غير موجودة — شغّل setup() أولًا.');
  ensureSheetHeaders_(sh, USER_HEADERS);
  pepper_();
  CACHE.remove('users');
  return 'تمت ترقية المصادقة بنجاح. كلمة المرور الافتراضية لكل مستخدم = رقمه الوظيفي حتى أول تغيير.';
}
