/**
 * أثر — منصة توثيق الفعاليات والمبادرات
 * المديرية العامة للخدمات الصحية بمحافظة ظفار
 * التجمع الصحي (2) - مركز صحي حاسك
 *
 * الخادم (Code.gs) — Google Apps Script (V8)
 */

// ============================ إعدادات عامة ============================
var APP_NAME = 'منصة أثر للمبادرات الصحية';
var SHEET_NAME = 'أثر - قاعدة بيانات الفعاليات';
var PHOTO_ROOT_NAME = 'أثر - صور الفعاليات';
var PROP = PropertiesService.getScriptProperties();
var CACHE = CacheService.getScriptCache();

var ACTS_CACHE_TTL = 300;
function actsVersion_() { return CACHE.get('acts_ver') || '0'; }
function bumpActsVersion_() {
  var v = (parseInt(CACHE.get('acts_ver') || '0', 10) + 1) % 1000000;
  CACHE.put('acts_ver', String(v), 21600);
}
function actsCacheKey_(prefix, parts) {
  var raw = actsVersion_() + '|' + JSON.stringify(parts || null);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return prefix + '_' + Utilities.base64Encode(digest);
}

var SHEETS = {
  CONFIG: 'Config',
  USERS: 'Users',
  ACTIVITIES: 'Activities',
  AUDIT_LOG: 'AuditLog'
};

var AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                 'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ترويسة جدول الفعاليات (الترتيب مهم)
var ACT_HEADERS = ['id','created_at','created_by_no','created_by_name',
  'executor_no','executor_name','type','world_day','title','objective',
  'target_groups','event_date','year','month','month_name','quarter',
  'location','mechanism','beneficiaries','has_partnership','partners',
  'photo_folder_id','photo_ids','notes','status','type_custom','client_request_id'];

var LIST_SEP = ' ، ';
var OTHER_VALUE = 'أخرى';
var OFFICIAL_LETTER_NAME = 'officiallyletter.jpg';
var REPORT_ROOT_NAME = 'أثر - تقارير PDF';
var EXCEL_REPORT_ROOT_NAME = 'أثر - تقارير Excel';
var APP_LOGO_NAME = 'logo.png';
var LOGIN_LOGO_NAME = 'logo-login.png';
var OFFICIAL_APP_URL = 'https://officerhasikhc.github.io/health-activities/';
var GITHUB_ORIGIN = 'https://officerhasikhc.github.io';
var REQUIRED_FIELD_CATEGORY = 'required_field';
var INLINE_DOWNLOAD_MAX_BYTES = 30 * 1024 * 1024;
var ZIP_INLINE_DOWNLOAD_MAX_BYTES = 30 * 1024 * 1024;
var ZIP_INLINE_MAX_COUNT = 12;
var ZIP_DRIVE_MAX_COUNT = 35;
var PERIOD_PDF_MAX_COUNT = 35;
var REQUIRED_LOCKED_FIELDS = ['type','title','event_date','executor_no'];
var REQUIRED_FIELD_DEFAULTS = {
  objective: true,
  target_groups: false,
  mechanism: false,
  beneficiaries: false,
  location: false,
  photos: true,
  world_day: false,
  partners: false,
  notes: false
};
var REQUIRED_FIELD_LABELS = {
  type: 'نوع الفعالية',
  title: 'عنوان الفعالية',
  event_date: 'تاريخ التنفيذ',
  executor_no: 'المنفّذة',
  objective: 'الهدف',
  target_groups: 'الفئة المستهدفة',
  mechanism: 'آلية التنفيذ',
  beneficiaries: 'عدد المستفيدين',
  location: 'المكان',
  photos: 'الصور',
  world_day: 'اسم اليوم العالمي',
  partners: 'الجهات الشريكة',
  notes: 'ملاحظات'
};

// ============================ نقطة الدخول ============================
function doGet(e) {
  e = e || {};
  if (e.parameter && e.parameter.bridge === '1') {
    var b = HtmlService.createTemplateFromFile('Bridge');
    b.ALLOWED_ORIGIN = GITHUB_ORIGIN;
    return b
      .evaluate()
      .setTitle(APP_NAME + ' - Bridge')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return officialAppPage_();
}

// قائمة بيضاء بالعمليات المسموح استدعاؤها من الواجهة عبر fetch (JSON)
var API_METHODS = {
  init: true,
  saveActivity: true,
  getActivities: true,
  deleteActivity: true,
  exportActivityPdf: true,
  exportActivityPdfDownload: true,
  exportActivitiesExcel: true,
  exportActivitiesExcelDownload: true,
  exportActivitiesPdfDownload: true,
  exportActivitiesZipDownload: true,
  getDashboard: true,
  getDashboardItems: true,
  getActivityReportReadiness: true,
  getPeriodReportReadiness: true,
  getRecentActivitiesForAdmin: true,
  addConfigItem: true,
  removeConfigItem: true,
  setRequiredField: true,
  changePassword: true,
  logClientError: true
};

// بريد المالك الذي تصله تقارير الأخطاء (افتراضيًا مالك السكربت)
function ownerEmail_() {
  var saved = PROP.getProperty('OWNER_EMAIL');
  if (saved) return saved;
  try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; }
}

/**
 * يستقبل تقرير خطأ من الواجهة (الهاتف/المتصفح) ويرسله بريدًا للمالك.
 * مع تحديد معدّل الإرسال ومنع التكرار لتفادي إغراق البريد.
 */
function logClientError(report) {
  try {
    report = report || {};
    var email = ownerEmail_();
    if (!email) return { ok: false, error: 'no owner email' };

    // منع التكرار: نفس التوقيع خلال 10 دقائق
    var sig = String(report.message || '') + '|' + String(report.action || '') + '|' + String(report.user || '');
    var sigKey = 'errsig_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig));
    if (CACHE.get(sigKey)) return { ok: true, deduped: true };
    CACHE.put(sigKey, '1', 600);

    // سقف الإرسال: 30 رسالة في الساعة
    var cntKey = 'errcount';
    var cnt = parseInt(CACHE.get(cntKey) || '0', 10);
    if (cnt >= 30) return { ok: true, throttled: true };
    CACHE.put(cntKey, String(cnt + 1), 3600);

    var subject = '[أثر] خطأ: ' + String(report.message || 'غير محدد').slice(0, 90);
    var lines = [
      'تقرير خطأ من تطبيق أثر',
      '──────────────────────',
      'الوقت: ' + (report.ts || new Date().toISOString()),
      'المستخدم: ' + (report.user || 'غير معروف'),
      'الإجراء: ' + (report.action || '-'),
      'المستوى: ' + (report.level || '-'),
      'الرسالة: ' + (report.message || '-'),
      'الموضع: ' + (report.source || '-'),
      'الرابط: ' + (report.url || '-'),
      'الجهاز: ' + (report.ua || '-'),
      '',
      'Stack:',
      String(report.stack || '-'),
      '',
      'آخر السجلات:',
      String(report.logs || '-')
    ];
    MailApp.sendEmail({ to: email, subject: subject, body: lines.join('\n') });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * نقطة اتصال JSON مباشرة (بديل الجسر/الـ iframe).
 * تستقبل { fn, args } كنص JSON وترجع نتيجة الدالة كـ JSON.
 * تعمل عبر النطاقات دون كوكيز الطرف الثالث (تحل مشكلة الدخول على الهاتف والتطبيق المثبّت).
 */
function doPost(e) {
  var out = { ok: false };
  try {
    var body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
    var fn = body.fn;
    var args = body.args || [];
    var target = (typeof globalThis !== 'undefined') ? globalThis[fn] : this[fn];
    if (!fn || !API_METHODS[fn] || typeof target !== 'function') {
      out.error = 'العملية غير مسموحة.';
    } else {
      out = { ok: true, data: target.apply(null, args) };
    }
  } catch (err) {
    out = { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function officialAppPage_() {
  var logo = getAssetDataUri_(LOGIN_LOGO_NAME);
  var html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + APP_NAME + '</title><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#123a46,#1a4d5c 58%,#315b62);font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#1d2733;text-align:center;padding:18px;box-sizing:border-box}' +
    '.card{background:#fff;border-top:4px solid #9a7b3f;border-radius:10px;box-shadow:0 14px 50px rgba(0,0,0,.28);max-width:420px;width:100%;padding:30px}' +
    'img{width:112px;height:112px;object-fit:contain}.brand{font-size:27px;font-weight:700;color:#1a4d5c}.sub{color:#9a7b3f;font-weight:600;margin-top:2px}.org{color:#5b6b7b;font-size:13px;line-height:1.8;margin:12px 0 22px}' +
    'a{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:42px;background:#1a4d5c;color:#fff;text-decoration:none;border-radius:6px;font-weight:700}' +
    '.hint{font-size:12px;color:#5b6b7b;margin-top:14px;line-height:1.7}</style></head><body><main class="card">' +
    (logo ? '<img src="' + logo + '" alt="شعار وزارة الصحة">' : '') +
    '<div class="brand">منصة أثر</div><div class="sub">للمبادرات الصحية</div>' +
    '<div class="org">المديرية العامة للخدمات الصحية بمحافظة ظفار<br>التجمّع الصحي (٢) — مركز صحي حاسك</div>' +
    '<a href="' + OFFICIAL_APP_URL + '" target="_top">فتح الرابط الرسمي</a>' +
    '<div class="hint">هذا الرابط يعمل كخادم خلفي فقط. الرابط الرسمي للمستخدمين هو GitHub Pages.</div>' +
    '</main></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function legacyDoGet_() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.APP_LOGO_URI = getAssetDataUri_(APP_LOGO_NAME);
  t.LOGIN_LOGO_URI = getAssetDataUri_(LOGIN_LOGO_NAME);
  return t
    .evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function getAssetDataUri_(name) {
  try {
    var propKey = 'ASSET_' + name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase() + '_ID';
    var fileId = PROP.getProperty(propKey);
    var file;
    if (fileId) {
      try { file = DriveApp.getFileById(fileId); } catch (e) { file = null; }
    }
    if (!file) {
      var files = DriveApp.getFilesByName(name);
      if (!files.hasNext()) return '';
      file = files.next();
      PROP.setProperty(propKey, file.getId());
    }
    return blobDataUri_(file.getBlob());
  } catch (e2) {
    return '';
  }
}

// ============================ التهيئة الأولى ============================
/**
 * شغّل هذه الدالة مرة واحدة يدويًا من المحرر بعد اللصق:
 *   تنشئ جدول البيانات + مجلد الصور + المستخدمين والقوائم الافتراضية.
 */
function setup() {
  var ss;
  var existingId = PROP.getProperty('SHEET_ID');
  if (existingId) {
    try { ss = SpreadsheetApp.openById(existingId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    PROP.setProperty('SHEET_ID', ss.getId());
    var def = ss.getSheets()[0];
    def.setName(SHEETS.CONFIG);
  }

  // --- Config ---
  var cfg = getOrCreateSheet_(ss, SHEETS.CONFIG, ['category','value','active','order']);
  if (cfg.getLastRow() < 2) {
    var seed = [];
    var types = ['محاضرة','ندوة','ورشة عمل','نشاط','فعالية','ركن صحي','يوم عالمي','مبادرة'];
    var groups = ['طلاب','طالبات','مراجعون','موظفون','المجتمع','كبار السن','أمهات','أطفال'];
    var mechs  = ['محاضرة','محاضرة + معرض','حوارات نقاشية','معرض توعوي','تدريب عملي','توزيع منشورات'];
    types.forEach(function(v,i){ seed.push(['activity_type', v, true, i+1]); });
    groups.forEach(function(v,i){ seed.push(['target_group', v, true, i+1]); });
    mechs.forEach(function(v,i){ seed.push(['mechanism', v, true, i+1]); });
    Object.keys(REQUIRED_FIELD_DEFAULTS).forEach(function(k,i){
      seed.push([REQUIRED_FIELD_CATEGORY, k, REQUIRED_FIELD_DEFAULTS[k], i+1]);
    });
    cfg.getRange(2,1,seed.length,4).setValues(seed);
  }

  // --- Users ---
  var users = getOrCreateSheet_(ss, SHEETS.USERS, ['emp_no','name','role','title','active']);
  if (users.getLastRow() < 2) {
    users.getRange(2,1,3,5).setValues([
      ['65886','عبدالباقي عبدالهادي مرزوق بيت مرواس','admin','المشرف الإداري / مسؤول النظام', true],
      ['67204','آمنة عبدالهادي مرزوق','staff','القائمة بأعمال التثقيف', true],
      ['57609','عائشة سعيد بخيت السليمي المهري','staff','ممرضة الصحة المدرسية', true]
    ]);
  }

  // --- Activities ---
  var act = getOrCreateSheet_(ss, SHEETS.ACTIVITIES, ACT_HEADERS);
  ensureSheetHeaders_(act, ACT_HEADERS);

  // --- مجلد الصور ---
  var folderId = PROP.getProperty('PHOTO_ROOT_ID');
  var ok = false;
  if (folderId) { try { DriveApp.getFolderById(folderId); ok = true; } catch (e) {} }
  if (!ok) {
    var f = DriveApp.createFolder(PHOTO_ROOT_NAME);
    PROP.setProperty('PHOTO_ROOT_ID', f.getId());
  }

  CACHE.removeAll(['cfg', 'users']);
  return 'تمت التهيئة بنجاح. جدول البيانات: ' + ss.getUrl();
}

function getOrCreateSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && headers) {
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (headers) {
    ensureSheetHeaders_(sh, headers);
  }
  return sh;
}

function ensureSheetHeaders_(sh, headers) {
  if (!headers || !headers.length) return;
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return;
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var current = sh.getRange(1,1,1,lastCol).getValues()[0].filter(function(h){ return h !== ''; });
  var missing = headers.filter(function(h){ return current.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1,current.length + 1,1,missing.length).setValues([missing]).setFontWeight('bold');
  }
  sh.setFrozenRows(1);
}

function ss_() {
  var id = PROP.getProperty('SHEET_ID');
  if (!id) throw new Error('النظام غير مهيّأ. شغّل دالة setup أولًا.');
  return SpreadsheetApp.openById(id);
}

function activitiesSheet_() {
  var sh = ss_().getSheetByName(SHEETS.ACTIVITIES);
  if (!sh) sh = ss_().insertSheet(SHEETS.ACTIVITIES);
  ensureSheetHeaders_(sh, ACT_HEADERS);
  return sh;
}

/**
 * فحص سريع من محرر Apps Script بعد التهيئة.
 * لا ينشئ أو يغيّر بيانات؛ فقط يساعد على التأكد أن النشر مرتبط بالمشروع الصحيح.
 */
function diagnoseSetup() {
  var out = {
    scriptId: '',
    sheetId: PROP.getProperty('SHEET_ID') || '',
    photoRootId: PROP.getProperty('PHOTO_ROOT_ID') || '',
    sheetOk: false,
    photoRootOk: false,
    sheets: [],
    admin65886Ok: false,
    errors: []
  };

  try { out.scriptId = ScriptApp.getScriptId(); }
  catch (e) { out.errors.push('scriptId: ' + e.message); }

  if (out.sheetId) {
    try {
      var ss = SpreadsheetApp.openById(out.sheetId);
      out.sheetOk = true;
      out.sheets = ss.getSheets().map(function (sh) { return sh.getName(); });
      var users = ss.getSheetByName(SHEETS.USERS);
      if (users && users.getLastRow() > 1) {
        var data = users.getDataRange().getValues();
        var head = data.shift();
        var empIdx = head.indexOf('emp_no');
        var activeIdx = head.indexOf('active');
        out.admin65886Ok = data.some(function (r) {
          return String(r[empIdx]) === '65886' && r[activeIdx] !== false;
        });
      }
    } catch (e2) {
      out.errors.push('sheet: ' + e2.message);
    }
  } else {
    out.errors.push('SHEET_ID is missing. Run setup() in this script project.');
  }

  if (out.photoRootId) {
    try {
      DriveApp.getFolderById(out.photoRootId);
      out.photoRootOk = true;
    } catch (e3) {
      out.errors.push('photoRoot: ' + e3.message);
    }
  } else {
    out.errors.push('PHOTO_ROOT_ID is missing. Run setup() in this script project.');
  }

  return out;
}

// مصادقة الدخول بكلمة المرور موجودة في ملف athar-auth.gs.
function getUsers_() {
  var cached = CACHE.get('users');
  if (cached) return JSON.parse(cached);
  var sh = ss_().getSheetByName(SHEETS.USERS);
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var rows = data.filter(function(r){ return r[0] !== ''; }).map(function(r){
    var o = {}; head.forEach(function(h,i){ o[h] = r[i]; }); 
    o.emp_no = String(o.emp_no); return o;
  });
  CACHE.put('users', JSON.stringify(rows), 21600);
  return rows;
}

function isActive_(v) {
  return v === true || String(v).toLowerCase() === 'true' || String(v) === '1';
}

function findActiveUser_(empNo) {
  empNo = String(empNo || '').trim();
  var users = getUsers_();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].emp_no) === empNo && isActive_(users[i].active)) return users[i];
  }
  return null;
}

function requireActiveUser_(empNo) {
  var user = findActiveUser_(empNo);
  if (!user) throw new Error('المستخدم غير مخوّل أو غير نشط.');
  return user;
}

function requireAdmin_(empNo) {
  var user = requireActiveUser_(empNo);
  if (user.role !== 'admin') throw new Error('هذه العملية متاحة للمسؤول فقط.');
  return user;
}

function getActiveUsersForAdmin_() {
  return getUsers_().filter(function(u){ return isActive_(u.active); }).map(function(u){
    return { no:String(u.emp_no), name:u.name, role:u.role, title:u.title };
  });
}

// ============================ القوائم (Config) ============================
function getConfig() {
  var cached = CACHE.get('cfg');
  if (cached) {
    var parsed = JSON.parse(cached);
    if (parsed.required_fields) return parsed;
  }
  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  var data = sh.getDataRange().getValues();
  data.shift();
  var out = { activity_type: [], target_group: [], mechanism: [] };
  var required = defaultRequiredFields_();
  data.forEach(function(r){
    var category = String(r[0] || '');
    if (!category) return;
    if (category === REQUIRED_FIELD_CATEGORY) {
      var field = String(r[1] || '');
      if (Object.prototype.hasOwnProperty.call(required, field)) required[field] = isActive_(r[2]);
      return;
    }
    if (r[2] === false) return;
    if (!out[category]) out[category] = [];
    out[category].push({ value: r[1], order: r[3] || 0 });
  });
  Object.keys(out).forEach(function(k){
    if (Array.isArray(out[k])) {
      out[k].sort(function(a,b){ return a.order - b.order; });
      out[k] = out[k].map(function(x){ return x.value; });
    }
  });
  out.required_fields = required;
  out.required_meta = requiredFieldMeta_(required);
  CACHE.put('cfg', JSON.stringify(out), 21600);
  return out;
}

function defaultRequiredFields_() {
  var out = {};
  Object.keys(REQUIRED_FIELD_DEFAULTS).forEach(function(k){ out[k] = !!REQUIRED_FIELD_DEFAULTS[k]; });
  return out;
}

function requiredFieldMeta_(required) {
  var keys = REQUIRED_LOCKED_FIELDS.concat(Object.keys(REQUIRED_FIELD_DEFAULTS));
  return keys.map(function(k){
    return {
      key: k,
      label: REQUIRED_FIELD_LABELS[k] || k,
      locked: REQUIRED_LOCKED_FIELDS.indexOf(k) > -1,
      required: REQUIRED_LOCKED_FIELDS.indexOf(k) > -1 ? true : !!required[k]
    };
  });
}

function getRequiredFields_() {
  var cfg = getConfig();
  return cfg.required_fields || defaultRequiredFields_();
}

// إدارة فقط: إضافة عنصر لقائمة وينعكس في كل الصفحات
function addConfigItem(category, value, actorEmpNo) {
  requireAdmin_(actorEmpNo);
  value = String(value || '').trim();
  if (!value) return { ok:false, msg:'القيمة فارغة.' };
  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  var data = sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++){
    if (data[i][0]===category && String(data[i][1]).trim()===value)
      return { ok:false, msg:'القيمة موجودة مسبقًا.' };
  }
  var max = 0;
  data.forEach(function(r){ if(r[0]===category && r[3]>max) max=r[3]; });
  sh.appendRow([category, value, true, max+1]);
  CACHE.remove('cfg');
  var config = getConfig();
  config.users = getActiveUsersForAdmin_();
  return { ok:true, config:config };
}

function removeConfigItem(category, value, actorEmpNo) {
  requireAdmin_(actorEmpNo);
  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  var data = sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++){
    if (data[i][0]===category && String(data[i][1]).trim()===String(value).trim()){
      sh.getRange(i+1,3).setValue(false); // تعطيل بدل حذف للحفاظ على السجلات القديمة
      CACHE.remove('cfg');
      var config = getConfig();
      config.users = getActiveUsersForAdmin_();
      return { ok:true, config:config };
    }
  }
  return { ok:false, msg:'لم يُعثر على العنصر.' };
}

function setRequiredField(field, required, actorEmpNo) {
  requireAdmin_(actorEmpNo);
  field = String(field || '').trim();
  if (REQUIRED_LOCKED_FIELDS.indexOf(field) > -1) {
    return { ok:false, msg:'هذا الحقل أساسي ولا يمكن جعله اختياريا.' };
  }
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_FIELD_DEFAULTS, field)) {
    return { ok:false, msg:'الحقل غير معروف.' };
  }

  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  var data = sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++){
    if (String(data[i][0]) === REQUIRED_FIELD_CATEGORY && String(data[i][1]) === field) {
      sh.getRange(i+1,3).setValue(!!required);
      CACHE.remove('cfg');
      var updated = getConfig();
      updated.users = getActiveUsersForAdmin_();
      return { ok:true, config:updated };
    }
  }

  var max = 0;
  data.forEach(function(r){ if (String(r[0]) === REQUIRED_FIELD_CATEGORY && r[3] > max) max = r[3]; });
  sh.appendRow([REQUIRED_FIELD_CATEGORY, field, !!required, max + 1]);
  CACHE.remove('cfg');
  var config = getConfig();
  config.users = getActiveUsersForAdmin_();
  return { ok:true, config:config };
}

// ============================ الفعاليات ============================
function getSheetHeaders_(sh) {
  if (sh.getLastRow() === 0) return [];
  return sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
}

function rowObject_(sh, rowIndex) {
  var head = getSheetHeaders_(sh);
  var values = sh.getRange(rowIndex,1,1,head.length).getValues()[0];
  var o = {};
  head.forEach(function(h,i){ if (h) o[h] = values[i]; });
  return o;
}

function normalizeList_(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map(function(x){ return String(x || '').trim(); }).filter(Boolean);
  }
  return String(v).split(/[،,]/).map(function(x){ return String(x || '').trim(); }).filter(Boolean);
}

function uniqueList_(arr) {
  var seen = {};
  return (arr || []).filter(function(v){
    v = String(v || '').trim();
    if (!v || seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

function storedList_(v) {
  return uniqueList_(normalizeList_(v)).join(LIST_SEP);
}

function activityDisplayType_(o) {
  if (String(o.type || '') === OTHER_VALUE && o.type_custom) return o.type_custom;
  return o.type || '';
}

function normalizeActivityTitle_(payload) {
  payload = payload || {};
  if (String(payload.type || '') === 'يوم عالمي') {
    payload.world_day = String(payload.world_day || payload.title || '').trim();
    payload.title = payload.world_day;
  } else {
    payload.title = String(payload.title || '').trim();
    payload.world_day = '';
  }
}

function activityTitle_(o) {
  if (String((o && o.type) || '') === 'يوم عالمي') {
    return String((o && (o.world_day || o.title)) || '').trim();
  }
  return String((o && o.title) || '').trim();
}

function saveActivity(payload, actorEmpNo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return saveActivityLocked_(payload, actorEmpNo);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function saveActivityLocked_(payload, actorEmpNo) {
  payload = payload || {};
  normalizeActivityTitle_(payload);
  var actor = requireActiveUser_(actorEmpNo || payload.created_by_no || payload.executor_no);
  var isAdmin = actor.role === 'admin';
  if (!isAdmin) {
    payload.executor_no = actor.emp_no;
    payload.executor_name = actor.name;
  }
  var missing = missingRequiredFields_(payload);
  if (missing.length) return { ok:false, msg:'حقول إلزامية ناقصة: ' + missing.join('، ') };
  if (String(payload.type) === OTHER_VALUE && !String(payload.type_custom || '').trim()) {
    return { ok:false, msg:'اكتب نوع الفعالية عند اختيار أخرى.' };
  }

  var sh = activitiesSheet_();
  var requestId = String(payload.client_request_id || '').trim();
  var duplicateRowIndex = -1;
  if (requestId) {
    duplicateRowIndex = findRowByClientRequestId_(sh, requestId);
    if (duplicateRowIndex > 0) {
      var duplicate = rowObject_(sh, duplicateRowIndex);
      if (!isAdmin && String(duplicate.executor_no) !== String(actor.emp_no)) {
        return { ok:false, msg:'لا يمكنك تعديل سجل مستخدم آخر.' };
      }
      if (!(String(duplicate.status || '') === 'جارٍ رفع الصور' && payload.photos && payload.photos.length)) {
        return { ok:true, id:duplicate.id, deduped:true };
      }
      payload.id = duplicate.id;
    }
  }

  var id = payload.id || ('ACT-' + Date.now());
  var oldRowIndex = duplicateRowIndex > 0 ? duplicateRowIndex : findRowById_(sh, id);
  var isNew = oldRowIndex < 0;
  var oldRow = oldRowIndex > 0 ? rowObject_(sh, oldRowIndex) : null;

  if (!isNew && oldRow && !isAdmin && String(oldRow.executor_no) !== String(actor.emp_no)) {
    return { ok:false, msg:'لا يمكنك تعديل سجل مستخدم آخر.' };
  }

  var executor = actor;
  if (isAdmin) {
    executor = findActiveUser_(payload.executor_no);
    if (!executor) return { ok:false, msg:'المنفّذ المختار غير نشط أو غير موجود.' };
  } else {
    payload.executor_no = actor.emp_no;
    payload.executor_name = actor.name;
  }

  // معالجة التاريخ
  var d = new Date(payload.event_date);
  if (isNaN(d)) return { ok:false, msg:'تاريخ التنفيذ غير صالح.' };
  var year = d.getFullYear();
  var month = d.getMonth() + 1;
  var monthName = AR_MONTHS[d.getMonth()];
  var quarter = 'الربع ' + ['الأول','الثاني','الثالث','الرابع'][Math.floor((month-1)/3)];
  var mechanisms = storedList_(payload.mechanisms || payload.mechanism);

  var folderId = payload.photo_folder_id || '';
  var photoIds = payload.existing_photo_ids ? payload.existing_photo_ids.slice() : [];
  var hasNewPhotos = !!(payload.photos && payload.photos.length);

  var row = {
    id: id,
    created_at: isNew ? new Date() : ((oldRow && oldRow.created_at) || payload.created_at || new Date()),
    created_by_no: isNew ? actor.emp_no : ((oldRow && oldRow.created_by_no) || actor.emp_no),
    created_by_name: isNew ? actor.name : ((oldRow && oldRow.created_by_name) || actor.name),
    executor_no: executor.emp_no,
    executor_name: executor.name,
    type: payload.type,
    type_custom: String(payload.type) === OTHER_VALUE ? String(payload.type_custom || '').trim() : '',
    world_day: payload.type === 'يوم عالمي' ? (payload.world_day || '') : '',
    title: payload.title,
    objective: payload.objective,
    target_groups: storedList_(payload.target_groups),
    event_date: payload.event_date,
    year: year, month: month, month_name: monthName, quarter: quarter,
    location: payload.location || '',
    mechanism: mechanisms,
    beneficiaries: payload.beneficiaries || '',
    has_partnership: !!payload.has_partnership,
    partners: payload.has_partnership ? storedList_(payload.partners) : '',
    photo_folder_id: folderId,
    photo_ids: photoIds.join(','),
    notes: payload.notes || '',
    status: hasNewPhotos ? 'جارٍ رفع الصور' : 'محفوظ',
    client_request_id: requestId || ((oldRow && oldRow.client_request_id) || '')
  };

  var rowIndex = writeActivityRow_(sh, row, oldRowIndex);

  // رفع الصور بعد تثبيت الصف حتى يظهر النشاط في السجل حتى لو كان الاتصال بطيئًا.
  if (hasNewPhotos) {
    if (!folderId) {
      var root = DriveApp.getFolderById(PROP.getProperty('PHOTO_ROOT_ID'));
      var sub = root.createFolder(id + ' - ' + (payload.title || '').substring(0,40));
      folderId = sub.getId();
    }
    var folder = DriveApp.getFolderById(folderId);
    payload.photos.forEach(function(p, idx){
      var bytes = Utilities.base64Decode(p.data);
      var blob = Utilities.newBlob(bytes, p.mime || 'image/jpeg', p.name || (id+'_'+idx+'.jpg'));
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoIds.push(file.getId());
    });
    row.photo_folder_id = folderId;
    row.photo_ids = photoIds.join(',');
    row.status = 'محفوظ';
    writeActivityRow_(sh, row, rowIndex);
  }
  
  logAudit_(actor, isNew ? 'إضافة' : 'تعديل', activityTitle_(row));
  bumpActsVersion_();

  return { ok:true, id:id };
}

function logAudit_(actor, action, targetTitle) {
  try {
    var ss = ss_();
    var sh = getOrCreateSheet_(ss, SHEETS.AUDIT_LOG, ['Timestamp', 'EmpNo', 'EmpName', 'Action', 'Target']);
    var now = new Date();
    sh.appendRow([now.toISOString(), actor.emp_no || '', actor.name || '', action, targetTitle]);
    
    if (Math.random() < 0.1) {
      var data = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
      var cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 2);
      var rowsToDelete = 0;
      for (var i = 1; i < data.length; i++) {
        if (new Date(data[i][0]) < cutoff) rowsToDelete++;
        else break;
      }
      if (rowsToDelete > 0) sh.deleteRows(2, rowsToDelete);
    }
  } catch(e) {}
}

function writeActivityRow_(sh, row, rowIndex) {
  var values = ACT_HEADERS.map(function(h){ return row[h]; });
  if (rowIndex && rowIndex > 0) {
    sh.getRange(rowIndex, 1, 1, values.length).setValues([values]);
    return rowIndex;
  }
  sh.appendRow(values);
  return sh.getLastRow();
}

function missingRequiredFields_(payload) {
  normalizeActivityTitle_(payload);
  var required = getRequiredFields_();
  var missing = [];
  function add(key) { missing.push(REQUIRED_FIELD_LABELS[key] || key); }
  function hasText(v) { return String(v == null ? '' : v).trim() !== ''; }

  if (!hasText(payload.type)) add('type');
  if (String(payload.type) === 'يوم عالمي') {
    if (!hasText(payload.world_day)) add('world_day');
  } else if (!hasText(payload.title)) {
    add('title');
  }
  if (!hasText(payload.event_date)) add('event_date');
  if (!hasText(payload.executor_no)) add('executor_no');
  if (String(payload.type) === OTHER_VALUE && !hasText(payload.type_custom)) missing.push('نوع آخر');

  if (required.objective && !hasText(payload.objective)) add('objective');
  if (required.target_groups && !normalizeList_(payload.target_groups).length) add('target_groups');
  if (required.mechanism && !normalizeList_(payload.mechanisms || payload.mechanism).length) add('mechanism');
  if (required.beneficiaries && !hasText(payload.beneficiaries)) add('beneficiaries');
  if (required.location && !hasText(payload.location)) add('location');
  if (required.partners && payload.has_partnership && !normalizeList_(payload.partners).length) add('partners');
  if (required.notes && !hasText(payload.notes)) add('notes');

  var hasPhotos = (payload.photos && payload.photos.length) ||
    (payload.existing_photo_ids && payload.existing_photo_ids.length);
  if (required.photos && !hasPhotos) add('photos');
  return missing;
}

function readinessIssue_(code, label, severity, detail) {
  return {
    code: code,
    label: label || code,
    severity: severity || 'blocking',
    detail: detail || ''
  };
}

function hasPhotoRefs_(activity) {
  if (!activity) return false;
  if (activity.photos && activity.photos.length) return true;
  if (activity.existing_photo_ids && activity.existing_photo_ids.length) return true;
  return String(activity.photo_ids || '').split(',').filter(Boolean).length > 0;
}

function reportReadinessForActivity_(activity, required) {
  activity = activity || {};
  required = required || {};
  normalizeActivityTitle_(activity);

  var blocking = [];
  var warnings = [];
  function hasText(v) { return String(v == null ? '' : v).trim() !== ''; }
  function block(code, label, detail) { blocking.push(readinessIssue_(code, label, 'blocking', detail)); }
  function warn(code, label, detail) { warnings.push(readinessIssue_(code, label, 'warning', detail)); }

  if (!hasText(activity.type)) block('type', REQUIRED_FIELD_LABELS.type, 'نوع الفعالية مطلوب قبل التصدير.');
  if (String(activity.type) === 'يوم عالمي') {
    if (!hasText(activity.world_day)) block('world_day', REQUIRED_FIELD_LABELS.world_day, 'اسم اليوم العالمي مطلوب في التقرير.');
  } else if (!hasText(activity.title)) {
    block('title', REQUIRED_FIELD_LABELS.title, 'عنوان الفعالية مطلوب في التقرير.');
  }
  if (!hasText(activity.event_date)) block('event_date', REQUIRED_FIELD_LABELS.event_date, 'تاريخ التنفيذ مطلوب في التقرير.');
  if (!hasText(activity.executor_no) && !hasText(activity.executor_name)) block('executor_no', REQUIRED_FIELD_LABELS.executor_no, 'اسم أو رقم المنفذة مطلوب في التقرير.');
  if (required.photos && !hasPhotoRefs_(activity)) block('photos', REQUIRED_FIELD_LABELS.photos, 'الصور مطلوبة حسب إعدادات الإدارة.');
  if (required.objective && !hasText(activity.objective)) block('objective', REQUIRED_FIELD_LABELS.objective, 'الهدف مطلوب حسب إعدادات الإدارة.');
  if (required.location && !hasText(activity.location)) block('location', REQUIRED_FIELD_LABELS.location, 'المكان مطلوب حسب إعدادات الإدارة.');
  if (required.beneficiaries && !hasText(activity.beneficiaries)) block('beneficiaries', REQUIRED_FIELD_LABELS.beneficiaries, 'عدد المستفيدين مطلوب حسب إعدادات الإدارة.');
  if (required.target_groups && !normalizeList_(activity.target_groups).length) block('target_groups', REQUIRED_FIELD_LABELS.target_groups, 'الفئة المستهدفة مطلوبة حسب إعدادات الإدارة.');
  if (required.mechanism && !normalizeList_(activity.mechanism || activity.mechanisms).length) block('mechanism', REQUIRED_FIELD_LABELS.mechanism, 'آلية التنفيذ مطلوبة حسب إعدادات الإدارة.');
  if (required.partners && (activity.has_partnership === true || activity.has_partnership === 'true') && !normalizeList_(activity.partners).length) {
    block('partners', REQUIRED_FIELD_LABELS.partners, 'الجهات الشريكة مطلوبة عند تفعيل الشراكة.');
  }
  if (String(activity.status || '') === 'جارٍ رفع الصور') {
    warn('uploading', 'رفع الصور', 'قد لا يحتوي التقرير على كل الصور لأن الرفع لم يكتمل بعد.');
  }

  return {
    ok: blocking.length === 0,
    blocking: blocking,
    warnings: warnings,
    issueCount: blocking.length + warnings.length
  };
}

function reportReadinessForRows_(rows, required) {
  rows = rows || [];
  var issueCounts = {};
  var items = [];
  var ready = 0;
  var blockingCount = 0;
  var warningCount = 0;

  rows.forEach(function(row) {
    var readiness = reportReadinessForActivity_(row, required);
    if (readiness.ok && readiness.warnings.length === 0) ready++;
    if (!readiness.ok) blockingCount++;
    if (readiness.warnings.length) warningCount++;
    readiness.blocking.concat(readiness.warnings).forEach(function(issue) {
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
    });
    if (!readiness.ok || readiness.warnings.length) {
      items.push({
        id: row.id,
        title: activityTitle_(row),
        event_date: formatDate_(row.event_date),
        blocking: readiness.blocking,
        warnings: readiness.warnings
      });
    }
  });

  return {
    ok: blockingCount === 0,
    total: rows.length,
    ready: ready,
    blockingCount: blockingCount,
    warningCount: warningCount,
    issueCounts: issueCounts,
    items: items.slice(0, 30),
    truncated: items.length > 30
  };
}

function findRowById_(sh, id) {
  var ids = sh.getRange(1,1,sh.getLastRow(),1).getValues();
  for (var i=1;i<ids.length;i++){ if (String(ids[i][0])===String(id)) return i+1; }
  return -1;
}

function findRowByClientRequestId_(sh, requestId) {
  requestId = String(requestId || '').trim();
  if (!requestId || sh.getLastRow() < 2) return -1;
  var head = getSheetHeaders_(sh);
  var idx = head.indexOf('client_request_id');
  if (idx < 0) return -1;
  var values = sh.getRange(2, idx + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === requestId) return i + 2;
  }
  return -1;
}

function normalizePeriodFilter_(filterOrYear, month) {
  var now = new Date();
  var current = { mode:'month', year:now.getFullYear(), month:now.getMonth() + 1 };
  if (filterOrYear && typeof filterOrYear === 'object') {
    var f = {
      mode: String(filterOrYear.mode || 'month'),
      year: parseInt(filterOrYear.year, 10) || current.year,
      month: parseInt(filterOrYear.month, 10) || current.month,
      quarter: parseInt(filterOrYear.quarter, 10) || Math.floor((current.month - 1) / 3) + 1,
      half: parseInt(filterOrYear.half, 10) || (current.month <= 6 ? 1 : 2),
      emp: filterOrYear.emp
    };
    if (['current_month','month','quarter','half','year','all'].indexOf(f.mode) < 0) f.mode = 'month';
    return f;
  }
  if (filterOrYear || month) {
    return {
      mode: month ? 'month' : 'year',
      year: parseInt(filterOrYear, 10) || current.year,
      month: parseInt(month, 10) || current.month,
      quarter: Math.floor(((parseInt(month, 10) || current.month) - 1) / 3) + 1,
      half: (parseInt(month, 10) || current.month) <= 6 ? 1 : 2,
      emp: null
    };
  }
  return current;
}

function activityYearMonth_(o) {
  var y = parseInt(o.year, 10);
  var m = parseInt(o.month, 10);
  if (!y || !m) {
    var d = new Date(o.event_date);
    if (!isNaN(d)) { y = d.getFullYear(); m = d.getMonth() + 1; }
  }
  return { year:y, month:m };
}

function filterActivityRows_(rows, filter) {
  filter = normalizePeriodFilter_(filter);
  
  var resultRows = rows || [];
  if (filter.emp && filter.emp !== 'all' && filter.emp !== '') {
    resultRows = resultRows.filter(function(o) {
      return String(o.executor_no) === String(filter.emp);
    });
  }
  
  if (filter.mode === 'all') return resultRows;
  
  return resultRows.filter(function(o){
    var ym = activityYearMonth_(o);
    if (!ym.year || !ym.month) return false;
    if (filter.mode === 'current_month' || filter.mode === 'month') {
      return ym.year === filter.year && ym.month === filter.month;
    }
    if (filter.mode === 'quarter') {
      return ym.year === filter.year && (Math.floor((ym.month - 1) / 3) + 1) === filter.quarter;
    }
    if (filter.mode === 'half') {
      return ym.year === filter.year && (ym.month <= 6 ? 1 : 2) === filter.half;
    }
    if (filter.mode === 'year') return ym.year === filter.year;
    return true;
  });
}

function periodLabel_(filter) {
  filter = normalizePeriodFilter_(filter);
  if (filter.mode === 'all') return 'جميع البرامج والمبادرات';
  if (filter.mode === 'year') return 'سنة ' + filter.year;
  if (filter.mode === 'half') {
    var halfName = filter.half === 1 ? 'النصف الأول' : 'النصف الثاني';
    var halfRange = filter.half === 1 ? 'يناير – يونيو' : 'يوليو – ديسمبر';
    return halfName + ' ' + filter.year + ' (' + halfRange + ')';
  }
  if (filter.mode === 'quarter') {
    var qNames = ['','الأول','الثاني','الثالث','الرابع'];
    var qRanges = ['','يناير – مارس','أبريل – يونيو','يوليو – سبتمبر','أكتوبر – ديسمبر'];
    return 'الربع ' + qNames[filter.quarter] + ' ' + filter.year + ' (' + qRanges[filter.quarter] + ')';
  }
  return AR_MONTHS[filter.month - 1] + ' ' + filter.year;
}

function getActivities(empNo, filterOrYear, month) {
  var user = requireActiveUser_(empNo);
  var key = actsCacheKey_('acts', {u:String(user.emp_no), r:user.role, f:filterOrYear||null, m:month||null});
  var hit = CACHE.get(key);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }

  var rows = getVisibleActivityRows_(user);
  rows = filterActivityRows_(rows, normalizePeriodFilter_(filterOrYear, month));
  rows.sort(function(a,b){ return new Date(b.event_date) - new Date(a.event_date); });
  var result = rows.map(activityClientRow_);
  try { CACHE.put(key, JSON.stringify(result), ACTS_CACHE_TTL); } catch(e) {}
  return result;
}

function getVisibleActivityRows_(user) {
  var sh = activitiesSheet_();
  if (sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var rows = data.map(function(r){
    var o = {}; head.forEach(function(h,i){ o[h]=r[i]; }); return o;
  }).filter(function(o){ return o.id; });
  if (user.role !== 'admin') {
    rows = rows.filter(function(o){ return String(o.executor_no)===String(user.emp_no); });
  }
  return rows;
}

function activityClientRow_(o) {
  var displayType = activityDisplayType_(o);
  return {
    id:o.id, type:o.type, type_custom:o.type_custom || '', display_type:displayType,
    world_day:o.world_day, title:activityTitle_(o),
    objective:o.objective, target_groups:o.target_groups,
    event_date:formatDate_(o.event_date), month_name:o.month_name,
    quarter:o.quarter, year:o.year, month:o.month,
    executor_no:o.executor_no, executor_name:o.executor_name, location:o.location,
    mechanism:o.mechanism, beneficiaries:o.beneficiaries,
    has_partnership:o.has_partnership, partners:o.partners,
    notes:o.notes, photo_ids:o.photo_ids ? String(o.photo_ids).split(',').filter(Boolean) : [],
    photo_folder_id:o.photo_folder_id, status:o.status || ''
  };
}

function deleteActivity(id, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var sh = activitiesSheet_();
  var rowIndex = findRowById_(sh, id);
  if (rowIndex < 0) return { ok:false, msg:'غير موجود.' };
  var row = rowObject_(sh, rowIndex);
  if (user.role !== 'admin' && String(row.executor_no) !== String(user.emp_no)) {
    return { ok:false, msg:'لا يمكنك حذف سجل مستخدم آخر.' };
  }
  var targetTitle = activityTitle_(row);
  sh.deleteRow(rowIndex);
  logAudit_(user, 'حذف', targetTitle);
  bumpActsVersion_();
  return { ok:true };
}

function formatDate_(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.getFullYear() + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + ('0'+d.getDate()).slice(-2);
}

// ============================ لوحة المؤشرات ============================
function getDashboard(empNo, filter) {
  var user = requireActiveUser_(empNo);
  var key = actsCacheKey_('dash', {u:String(user.emp_no), r:user.role, f:filter||null});
  var hit = CACHE.get(key);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }

  var out = { total:0, beneficiaries:0, byType:{}, byMonth:{}, byHalf:{}, byQuarter:{}, byMechanism:{}, partnerships:0, byExecutor:{} };
  var rows = filterActivityRows_(getVisibleActivityRows_(user), normalizePeriodFilter_(filter));

  rows.forEach(function(o){
    out.total++;
    var b = parseInt(o.beneficiaries,10); if(!isNaN(b)) out.beneficiaries += b;
    var t = activityDisplayType_(o) || 'غير محدد';
    out.byType[t] = (out.byType[t]||0)+1;
    var m = o.month_name || ''; if(m) out.byMonth[m] = (out.byMonth[m]||0)+1;
    var monthNo = parseInt(o.month,10);
    if (!isNaN(monthNo)) {
      var half = monthNo <= 6 ? 'النصف الأول' : 'النصف الثاني';
      out.byHalf[half] = (out.byHalf[half] || 0) + 1;
    }
    var q = o.quarter || ''; if(q) out.byQuarter[q] = (out.byQuarter[q]||0)+1;
    normalizeList_(o.mechanism).forEach(function(mech){
      out.byMechanism[mech] = (out.byMechanism[mech] || 0) + 1;
    });
    if (o.has_partnership===true || o.has_partnership==='true') out.partnerships++;
    var ex = o.executor_name || ''; if(ex) out.byExecutor[ex] = (out.byExecutor[ex]||0)+1;
  });
  
  var auditLogs = [];
  try {
    var auditSh = ss_().getSheetByName(SHEETS.AUDIT_LOG);
    if (auditSh && auditSh.getLastRow() > 1) {
      var raw = auditSh.getDataRange().getValues();
      for (var i = raw.length - 1; i > 0; i--) {
        var r = raw[i];
        if (user.role !== 'admin' && String(r[1]) !== String(user.emp_no)) continue;
        auditLogs.push({ ts: r[0], empNo: r[1], empName: r[2], action: r[3], target: r[4] });
        if (auditLogs.length >= 50) break;
      }
    }
  } catch(e) {}
  out.auditLogs = auditLogs;

  try { CACHE.put(key, JSON.stringify(out), ACTS_CACHE_TTL); } catch(e) {}
  return out;
}

function getRecentActivitiesForAdmin(empNo, sinceMs) {
  var user = requireActiveUser_(empNo);
  if (user.role !== 'admin') return { items: [], serverNow: Date.now() };
  var since = parseInt(sinceMs || 0, 10);
  var cacheKey = actsCacheKey_('recent', {u:String(user.emp_no), s:since});
  var hit = CACHE.get(cacheKey);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }

  var rows = getVisibleActivityRows_(user);
  var items = [];
  rows.forEach(function(o){
    if (!o.created_at) return;
    var ts = new Date(o.created_at).getTime();
    if (isNaN(ts) || ts <= since) return;
    if (String(o.created_by_no) === String(user.emp_no)) return;
    items.push({
      id: o.id,
      title: activityTitle_(o),
      executor_name: o.executor_name || o.created_by_name || '',
      type: activityDisplayType_(o),
      event_date: formatDate_(o.event_date),
      created_at_ms: ts
    });
  });
  items.sort(function(a,b){ return b.created_at_ms - a.created_at_ms; });
  if (items.length > 20) items = items.slice(0, 20);
  var result = { items: items, serverNow: Date.now() };
  try { CACHE.put(cacheKey, JSON.stringify(result), 60); } catch(e) {}
  return result;
}

function getDashboardItems(empNo, dimension, key, filter) {
  var user = requireActiveUser_(empNo);
  var rows = filterActivityRows_(getVisibleActivityRows_(user), normalizePeriodFilter_(filter)).filter(function(o){
    if (dimension === 'type') return String(activityDisplayType_(o) || 'غير محدد') === String(key);
    if (dimension === 'mechanism') return normalizeList_(o.mechanism).indexOf(String(key)) > -1;
    if (dimension === 'month') return String(o.month_name) === String(key);
    if (dimension === 'half') {
      var m = parseInt(o.month,10);
      return (!isNaN(m) && (m <= 6 ? 'النصف الأول' : 'النصف الثاني') === String(key));
    }
    if (dimension === 'quarter') return String(o.quarter) === String(key);
    if (dimension === 'executor') return String(o.executor_name) === String(key);
    if (dimension === 'partnership') return o.has_partnership === true || o.has_partnership === 'true';
    return false;
  });
  rows.sort(function(a,b){ return new Date(b.event_date) - new Date(a.event_date); });
  return rows.map(activityClientRow_);
}

// ============================ التصدير PDF ============================
function getActivityReportReadiness(id, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var activity = getActivityForExport_(id, user);
  return {
    ok: true,
    readiness: reportReadinessForActivity_(activity, getRequiredFields_())
  };
}

function getPeriodReportReadiness(filter, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var rows = filterActivityRows_(getVisibleActivityRows_(user), normalizePeriodFilter_(filter));
  rows.sort(function(a,b){ return new Date(a.event_date) - new Date(b.event_date); });
  return {
    ok: true,
    period: periodLabel_(filter),
    readiness: reportReadinessForRows_(rows, getRequiredFields_())
  };
}

function exportActivityPdf(id, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var activity = getActivityForExport_(id, user);
  var pdf = buildActivityPdfBlob_(activity);
  return driveDownloadResponse_(pdf, getReportRoot_(), {});
}

function exportActivityPdfDownload(id, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var activity = getActivityForExport_(id, user);
  var pdf = buildActivityPdfBlob_(activity);
  return downloadableBlobResponse_(pdf, getReportRoot_(), {}, INLINE_DOWNLOAD_MAX_BYTES);
}

function exportActivitiesPdfDownload(filter, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var period = normalizePeriodFilter_(filter);
  var periodLabel = periodLabel_(period);
  var rows = filterActivityRows_(getVisibleActivityRows_(user), period);
  rows.sort(function(a,b){ return new Date(a.event_date) - new Date(b.event_date); });
  if (!rows.length) return { ok:false, msg:'لا توجد فعاليات ضمن الفترة المختارة.' };
  if (rows.length > PERIOD_PDF_MAX_COUNT) {
    return { ok:false, msg:'عدد التقارير كبير جدًا للتجهيز في PDF واحد. اختر فترة أصغر أو صدّر Excel.' };
  }
  var blob = buildActivitiesPeriodPdfBlob_(rows, periodLabel, user);
  var response = downloadableBlobResponse_(blob, getReportRoot_(), {
    count: rows.length,
    period: periodLabel
  }, INLINE_DOWNLOAD_MAX_BYTES);
  response.count = rows.length;
  response.period = periodLabel;
  return response;
}

function getActivityForExport_(id, user) {
  var sh = activitiesSheet_();
  var rowIndex = findRowById_(sh, id);
  if (rowIndex < 0) throw new Error('لم يُعثر على الفعالية.');
  var activity = rowObject_(sh, rowIndex);
  if (user.role !== 'admin' && String(activity.executor_no) !== String(user.emp_no)) {
    throw new Error('لا يمكنك تحميل سجل مستخدم آخر.');
  }
  activity.display_type = activityDisplayType_(activity);
  return activity;
}

function buildActivityPdfBlob_(activity, fileNameOverride) {
  activity.display_type = activity.display_type || activityDisplayType_(activity);
  var letter = getOfficialLetterBlob_();
  var letterDataUri = letter ? blobDataUri_(letter) : '';
  var photos = String(activity.photo_ids || '').split(',').filter(Boolean).map(function(pid){
    try { return blobDataUri_(DriveApp.getFileById(pid).getBlob()); }
    catch (e) { return ''; }
  }).filter(Boolean);

  var html = buildActivityPdfHtml_(activity, letterDataUri, photos);
  var activityTitle = activityTitle_(activity);
  var fileName = fileNameOverride ||
    (safeFileName_('تقرير ' + formatDate_(activity.event_date) + ' - ' + activityTitle) + '.pdf');
  return Utilities.newBlob(html, 'text/html', fileName.replace(/\.pdf$/,'') + '.html')
    .getAs(MimeType.PDF)
    .setName(fileName);
}

function periodPdfFingerprint_(rows, periodLabel, user) {
  var parts = rows.map(function(a){
    return [a.id, a.event_date, a.photo_ids, a.title, a.objective, a.notes,
            a.target_groups, a.mechanism, a.beneficiaries, a.partners, a.status].join('');
  });
  parts.sort();
  var seed = (user ? user.emp_no : '') + '' + periodLabel + '' + parts.join('\n');
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, seed)
  );
}

function periodPdfCacheKey_(user, periodLabel) {
  var seed = (user ? user.emp_no : '') + '' + periodLabel;
  return 'pdf_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, seed)
  );
}

function buildActivitiesPeriodPdfBlob_(rows, periodLabel, user) {
  var fp = periodPdfFingerprint_(rows, periodLabel, user);
  var cacheKey = periodPdfCacheKey_(user, periodLabel);
  var hit = CACHE.get(cacheKey);
  if (hit) {
    try {
      var meta = JSON.parse(hit);
      if (meta && meta.fp === fp && meta.fileId) {
        var cached = DriveApp.getFileById(meta.fileId).getBlob();
        return cached.setName(meta.name || cached.getName());
      }
    } catch (e) {}
  }

  var letter = getOfficialLetterBlob_();
  var letterDataUri = letter ? blobDataUri_(letter) : '';
  var photosById = {};
  rows.forEach(function(activity){
    activity.display_type = activity.display_type || activityDisplayType_(activity);
    String(activity.photo_ids || '').split(',').filter(Boolean).forEach(function(pid){
      if (photosById[pid]) return;
      try { photosById[pid] = blobDataUri_(DriveApp.getFileById(pid).getBlob()); }
      catch (e) { photosById[pid] = ''; }
    });
  });
  var html = buildActivitiesPeriodPdfHtml_(rows, letterDataUri, photosById);
  var fileName = safeFileName_('تقرير أثر PDF - ' + (user.name || user.emp_no) + ' - ' + periodLabel) + '.pdf';
  var blob = Utilities.newBlob(html, 'text/html', fileName.replace(/\.pdf$/,'') + '.html')
    .getAs(MimeType.PDF)
    .setName(fileName);

  try {
    var folder = getPdfCacheFolder_();
    if (hit) {
      try {
        var prev = JSON.parse(hit);
        if (prev && prev.fileId) {
          try { DriveApp.getFileById(prev.fileId).setTrashed(true); } catch (e) {}
        }
      } catch (e) {}
    }
    var saved = folder.createFile(blob);
    CACHE.put(cacheKey, JSON.stringify({ fp: fp, fileId: saved.getId(), name: fileName }), 21600);
  } catch (e) {}

  return blob;
}

function getPdfCacheFolder_() {
  var folderId = PROP.getProperty('PDF_CACHE_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var root = getReportRoot_();
  var f = root.createFolder('_cache');
  PROP.setProperty('PDF_CACHE_FOLDER_ID', f.getId());
  return f;
}

function getReportRoot_() {
  var folderId = PROP.getProperty('REPORT_ROOT_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var f = DriveApp.createFolder(REPORT_ROOT_NAME);
  PROP.setProperty('REPORT_ROOT_ID', f.getId());
  return f;
}

function downloadableBlobResponse_(blob, folder, meta, inlineMaxBytes) {
  meta = meta || {};
  var fileName = blob.getName() || meta.name || 'athar-report';
  blob = blob.setName(fileName);
  var bytes = blob.getBytes();
  var base = {
    ok:true,
    name:fileName,
    fileName:fileName,
    mime:blob.getContentType() || 'application/octet-stream',
    size:bytes.length
  };
  Object.keys(meta).forEach(function(k){ base[k] = meta[k]; });
  if (bytes.length <= inlineMaxBytes) {
    base.delivery = 'inline';
    base.base64 = Utilities.base64Encode(bytes);
    return base;
  }
  var drive = driveDownloadResponse_(blob, folder, meta);
  drive.size = bytes.length;
  drive.reason = drive.reason || 'large';
  return drive;
}

function driveDownloadResponse_(blob, folder, meta) {
  meta = meta || {};
  var fileName = blob.getName() || meta.name || 'athar-report';
  var outFile = folder.createFile(blob.setName(fileName));
  outFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var response = {
    ok:true,
    delivery:'drive',
    name:fileName,
    fileName:fileName,
    mime:blob.getContentType() || 'application/octet-stream',
    url:outFile.getUrl(),
    downloadUrl:'https://drive.google.com/uc?export=download&id=' + outFile.getId(),
    id:outFile.getId()
  };
  Object.keys(meta).forEach(function(k){ response[k] = meta[k]; });
  return response;
}

function exportActivitiesExcel(filter, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var built = buildActivitiesExcelBlob_(filter, user);
  var response = driveDownloadResponse_(built.blob, getExcelReportRoot_(), {
    count:built.count,
    period:built.period
  });
  response.count = built.count;
  response.period = built.period;
  return response;
}

function exportActivitiesExcelDownload(filter, actorEmpNo) {
  var user = requireActiveUser_(actorEmpNo);
  var built = buildActivitiesExcelBlob_(filter, user);
  var response = downloadableBlobResponse_(built.blob, getExcelReportRoot_(), {
    count:built.count,
    period:built.period
  }, INLINE_DOWNLOAD_MAX_BYTES);
  response.count = built.count;
  response.period = built.period;
  return response;
}

function activitiesExcelLayout_(dataLength) {
  var count = Math.max(0, parseInt(dataLength, 10) || 0);
  var summaryStart = 1;
  var summaryRows = 5;
  var headerRow = summaryStart + summaryRows + 1;
  var dataStart = headerRow + 1;
  return {
    summaryStart: summaryStart,
    headerRow: headerRow,
    dataStart: dataStart,
    preparedStart: dataStart + count + 1,
    tableRows: 1 + count
  };
}

function buildActivitiesExcelBlob_(filter, user) {
  var period = normalizePeriodFilter_(filter);
  var periodLabel = periodLabel_(period);
  var rows = filterActivityRows_(getVisibleActivityRows_(user), period);
  rows.sort(function(a,b){ return new Date(a.event_date) - new Date(b.event_date); });

  var preparedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Muscat', 'yyyy/MM/dd HH:mm');
  var temp = SpreadsheetApp.create('تقرير أثر مؤقت - ' + preparedAt);
  var sh = temp.getSheets()[0];
  sh.setName('البرامج والمبادرات الصحية');
  try { sh.setRightToLeft(true); } catch (e) {}

  var headers = [
    'م','تاريخ التنفيذ','الشهر','الربع','نصف السنة','النوع','العنوان / اسم اليوم العالمي',
    'الهدف','الفئة المستهدفة','المكان','آلية التنفيذ','عدد المستفيدين',
    'شراكات','الجهات المشاركة','المنفذة','ملاحظات','عدد الصور'
  ];
  var totalBeneficiaries = 0;
  var totalPhotos = 0;
  var data = rows.map(function(o, idx){
    var ym = activityYearMonth_(o);
    var ben = parseInt(o.beneficiaries, 10);
    if (!isNaN(ben)) totalBeneficiaries += ben;
    var pCount = String(o.photo_ids || '').split(',').filter(Boolean).length;
    totalPhotos += pCount;
    return [
      idx + 1,
      formatDate_(o.event_date),
      o.month_name || (ym.month ? AR_MONTHS[ym.month - 1] : ''),
      o.quarter || '',
      ym.month ? (ym.month <= 6 ? 'النصف الأول' : 'النصف الثاني') : '',
      activityDisplayType_(o),
      activityTitle_(o),
      o.objective || '',
      o.target_groups || '',
      o.location || '',
      o.mechanism || '',
      o.beneficiaries || '',
      (o.has_partnership === true || o.has_partnership === 'true') ? 'نعم' : 'لا',
      o.partners || '',
      o.executor_name || '',
      o.notes || '',
      pCount
    ];
  });
  var layout = activitiesExcelLayout_(data.length);

  // بيانات التقرير أعلى الجدول.
  sh.getRange(layout.summaryStart, 1).setValue('تقرير البرامج والمبادرات الصحية').setFontWeight('bold').setFontSize(12).setFontColor('#1a4d5c');
  sh.getRange(layout.summaryStart + 1, 1).setValue('الفترة: ' + periodLabel).setFontColor('#3a5a66');
  sh.getRange(layout.summaryStart + 2, 1).setValue('عدد البرامج والمبادرات الصحية المنفذة: ' + rows.length).setFontColor('#3a5a66');
  sh.getRange(layout.summaryStart + 3, 1).setValue('إجمالي المستفيدين: ' + totalBeneficiaries).setFontColor('#3a5a66');
  sh.getRange(layout.summaryStart + 4, 1).setValue('إجمالي الصور: ' + totalPhotos).setFontColor('#3a5a66');

  // صف العناوين بعد ملخص التقرير.
  sh.getRange(layout.headerRow, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
    .setBackground('#1a4d5c').setFontColor('#ffffff').setHorizontalAlignment('center')
    .setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.setRowHeight(layout.headerRow, 36);

  // البيانات تبدأ بعد صف العناوين.
  if (data.length) {
    sh.getRange(layout.dataStart, 1, data.length, headers.length).setValues(data);
    // ألوان صفوف متناوبة
    for (var r = 0; r < data.length; r++) {
      if (r % 2 === 1) {
        sh.getRange(layout.dataStart + r, 1, 1, headers.length).setBackground('#f4f8f9');
      }
    }
    // محاذاة عمود م (الترقيم) وعدد الصور والمستفيدين
    sh.getRange(layout.dataStart, 1, data.length, 1).setHorizontalAlignment('center');
    sh.getRange(layout.dataStart, 12, data.length, 1).setHorizontalAlignment('center');
    sh.getRange(layout.dataStart, 17, data.length, 1).setHorizontalAlignment('center');
  }

  // حدود الجدول
  if (layout.tableRows > 0) {
    sh.getRange(layout.headerRow, 1, layout.tableRows, headers.length).setBorder(true, true, true, true, true, true,
      '#d0d7db', SpreadsheetApp.BorderStyle.SOLID);
  }

  // بيانات الإعداد تبقى أسفل الجدول.
  sh.getRange(layout.preparedStart, 1).setValue('إعداد: ' + (user.name || user.emp_no)).setFontColor('#5b6b7b');
  sh.getRange(layout.preparedStart + 1, 1).setValue('تاريخ الإعداد: ' + preparedAt).setFontColor('#5b6b7b');

  sh.setFrozenRows(layout.headerRow);
  sh.autoResizeColumns(1, headers.length);
  // عرض أدنى لعمود م
  sh.setColumnWidth(1, 40);
  SpreadsheetApp.flush();

  var fileName = safeFileName_('تقرير أثر - ' + (user.name || user.emp_no) + ' - ' + periodLabel) + '.xlsx';
  var tempId = temp.getId();
  try {
    var blob = exportSpreadsheetAsXlsx_(tempId, fileName);
    return { blob:blob, count:rows.length, period:periodLabel };
  } finally {
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e2) {}
  }
}

function exportActivitiesZipDownload(filter, actorEmpNo, options) {
  var user = requireActiveUser_(actorEmpNo);
  options = options || {};
  var period = normalizePeriodFilter_(filter);
  if (options.scope === 'year') {
    var year = parseInt(options.year, 10);
    if (!year) {
      year = period.mode === 'all' ? new Date().getFullYear() : period.year;
    }
    period = { mode:'year', year:year, month:1, quarter:1, half:1 };
  }
  var periodLabel = periodLabel_(period);
  var rows = filterActivityRows_(getVisibleActivityRows_(user), period);
  rows.sort(function(a,b){ return new Date(a.event_date) - new Date(b.event_date); });
  if (!rows.length) return { ok:false, msg:'لا توجد فعاليات ضمن الفترة المختارة.' };
  if (rows.length > ZIP_DRIVE_MAX_COUNT) {
    return { ok:false, msg:'عدد التقارير كبير جدًا للتجهيز دفعة واحدة. اختر فترة أصغر أو صدّر Excel.' };
  }

  var blobs = rows.map(function(o){
    o.display_type = activityDisplayType_(o);
    var entryName = safeFileName_(
      formatDate_(o.event_date) + ' - ' + activityTitle_(o) + ' - ' + (o.executor_name || '')
    ) + '.pdf';
    return buildActivityPdfBlob_(o, entryName);
  });
  var zipName = safeFileName_('تقارير أثر - ' + (user.name || user.emp_no) + ' - ' + periodLabel) + '.zip';
  var zip = Utilities.zip(blobs, zipName).setName(zipName);
  var inlineLimit = rows.length > ZIP_INLINE_MAX_COUNT ? 0 : ZIP_INLINE_DOWNLOAD_MAX_BYTES;
  var response = downloadableBlobResponse_(zip, getReportRoot_(), {
    count:rows.length,
    period:periodLabel
  }, inlineLimit);
  response.count = rows.length;
  response.period = periodLabel;
  if (rows.length > ZIP_INLINE_MAX_COUNT && response.delivery === 'drive') response.reason = 'count';
  return response;
}

function getExcelReportRoot_() {
  var folderId = PROP.getProperty('EXCEL_REPORT_ROOT_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var f = DriveApp.createFolder(EXCEL_REPORT_ROOT_NAME);
  PROP.setProperty('EXCEL_REPORT_ROOT_ID', f.getId());
  return f;
}

function exportSpreadsheetAsXlsx_(spreadsheetId, fileName) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('تعذّر إنشاء ملف Excel: HTTP ' + res.getResponseCode());
  }
  return res.getBlob().setName(fileName);
}

/**
 * يجلب قالب الخطاب الرسمي من Drive.
 * يبحث بالمُعرّف المحفوظ ثم بالاسم (jpg/png/jpeg). يرجع null عند الغياب
 * حتى لا يفشل تصدير PDF كليًا (يُصدَّر بلا خلفية رسمية).
 * لتفعيل القالب: ارفع الملف officiallyletter.jpg إلى Google Drive للحساب الخادم.
 */
function getOfficialLetterBlob_() {
  var fileId = PROP.getProperty('OFFICIAL_LETTER_ID');
  if (fileId) {
    try { return DriveApp.getFileById(fileId).getBlob(); } catch (e) {}
  }
  var names = [OFFICIAL_LETTER_NAME, 'officiallyletter.png', 'officiallyletter.jpeg'];
  for (var i = 0; i < names.length; i++) {
    var files = DriveApp.getFilesByName(names[i]);
    if (files.hasNext()) {
      var file = files.next();
      PROP.setProperty('OFFICIAL_LETTER_ID', file.getId());
      return file.getBlob();
    }
  }
  return null;
}

function blobDataUri_(blob) {
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function safeFileName_(name) {
  return String(name || 'تقرير أثر')
    .replace(/[\\\/:*?"<>|#%\{\}\[\]~&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 140);
}

function html_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function pdfRow_(label, value) {
  if (value == null || value === '') return '';
  return '<div class="row"><span>' + html_(label) + '</span><b>' + html_(value) + '</b></div>';
}

function pdfDocumentCss_(letterDataUri) {
  var pageBgCss = letterDataUri ? '' : 'background:#fff;border:1px solid #dfe4ea;';
  return '@page{size:A4;margin:0}html,body{margin:0;padding:0;font-family:Arial,Tahoma,sans-serif;color:#1d2733}.page{width:210mm;height:297mm;position:relative;box-sizing:border-box;page-break-after:always;' + pageBgCss + 'overflow:hidden}.page:last-child{page-break-after:auto}.period-break{page-break-before:always}.page-bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:-1;object-fit:cover;display:block}.pdf-header{position:absolute;top:45mm;right:13mm;font-size:13pt;font-weight:bold;color:#123a46;text-align:right;line-height:1.4;z-index:2}.pdf-footer{position:absolute;bottom:30mm;left:30mm;right:15mm;font-size:12.5pt;color:#123a46;z-index:2}.pdf-footer .prep{position:absolute;right:0;bottom:0;font-weight:bold}.pdf-footer .appr{position:absolute;left:0;bottom:0;font-weight:bold}.content{position:absolute;inset:55mm 15mm 30mm 15mm;z-index:1}.first h1{position:relative;top:10mm;right:7mm;font-size:19pt;margin:0 0 8mm;text-align:center;color:#123a46}.row{display:grid;grid-template-columns:38mm 1fr;gap:5mm;border-bottom:1px solid #dfe4ea;padding:3.8mm 0;font-size:11.5pt;line-height:1.6}.row span{color:#5b6b7b;font-weight:bold}.row b{font-weight:500;white-space:pre-wrap}.photos h2{font-size:15pt;margin:0 0 6mm;text-align:center;color:#123a46}.photo-list{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:minmax(100px, 1fr);gap:10mm;height:190mm}figure{margin:0;border:1px solid #dfe4ea;padding:2.5mm;background:rgba(255,255,255,.92);display:flex;flex-direction:column;gap:1.5mm;box-shadow:0 2px 6px rgba(0,0,0,.05)}figure img{width:100%;height:80mm;object-fit:contain}figcaption{text-align:center;color:#5b6b7b;font-size:11pt;font-weight:bold}';
}

function activityPdfSectionsHtml_(a, letterDataUri, photoDataUris, forceBreak) {
  var typeLabel = a.display_type || a.type || '';
  var title = activityTitle_(a);
  var titleLabel = String(a.type || '') === 'يوم عالمي' ? 'اسم اليوم العالمي' : 'العنوان';
  var details =
    pdfRow_('نوع الفعالية', typeLabel) +
    pdfRow_(titleLabel, title) +
    pdfRow_('الهدف', a.objective) +
    pdfRow_('الفئة المستهدفة', a.target_groups) +
    pdfRow_('تاريخ التنفيذ', formatDate_(a.event_date) + ' - ' + (a.month_name || '') + ' - ' + (a.quarter || '')) +
    pdfRow_('المكان', a.location) +
    pdfRow_('آلية التنفيذ', a.mechanism) +
    pdfRow_('عدد المستفيدين', a.beneficiaries) +
    pdfRow_('المنفّذة', a.executor_name) +
    ((a.has_partnership === true || a.has_partnership === 'true') ? pdfRow_('الجهات المشاركة', a.partners) : '') +
    pdfRow_('ملاحظات', a.notes);

  var bgImg = letterDataUri ? '<img class="page-bg" src="' + letterDataUri + '">' : '';
  var headerHtml = '<div class="pdf-header">المديرية العامة للخدمات الصحية بمحافظة ظفار<br>التجمع الصحي (2)- مركز حاسك الصحي</div>';
  var footerHtml = '<div class="pdf-footer"><div class="appr">اعتماد:</div><div class="prep">تم الاعداد : ' + html_(a.executor_name) + '</div></div>';
  var firstClass = forceBreak ? 'page period-break' : 'page';
  var pages = [];
  pages.push('<section class="' + firstClass + '">' + bgImg + headerHtml + '<main class="content first"><h1>تقرير توثيق فعالية</h1>' + details + '</main>' + footerHtml + '</section>');

  for (var i = 0; i < photoDataUris.length; i += 4) {
    var chunk = photoDataUris.slice(i, i + 4).map(function(src, n){
      return '<figure><img src="' + src + '"><figcaption>صورة ' + (i + n + 1) + '</figcaption></figure>';
    }).join('');
    pages.push('<section class="page">' + bgImg + headerHtml + '<main class="content photos"><h2>' + html_(title) + '</h2><div class="photo-list">' + chunk + '</div></main></section>');
  }
  return pages.join('');
}

function buildActivityPdfHtml_(a, letterDataUri, photoDataUris) {
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<style>' + pdfDocumentCss_(letterDataUri) + '</style>' +
    '</head><body>' + activityPdfSectionsHtml_(a, letterDataUri, photoDataUris || [], false) + '</body></html>';
}

function buildActivitiesPeriodPdfHtml_(activities, letterDataUri, photosById) {
  activities = activities || [];
  photosById = photosById || {};
  var sections = activities.map(function(activity, index){
    activity.display_type = activity.display_type || activityDisplayType_(activity);
    var ids = String(activity.photo_ids || '').split(',').filter(Boolean);
    var photoDataUris = ids.map(function(pid){ return photosById[pid] || ''; }).filter(Boolean);
    return activityPdfSectionsHtml_(activity, letterDataUri || '', photoDataUris, index > 0);
  }).join('');
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<style>' + pdfDocumentCss_(letterDataUri) + '</style>' +
    '</head><body>' + sections + '</body></html>';
}

// مُشغّل تسخين خفيف لتقليل البدء البارد — يُربط من Triggers يدويًا (كل 5 دقائق)
function warmupKeepAlive_() {
  try { ss_().getName(); } catch (e) {}
  return true;
}
