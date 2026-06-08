/**
 * أثر — منصة توثيق الفعاليات والمبادرات
 * المديرية العامة للخدمات الصحية بمحافظة ظفار
 * التجمع الصحي (2) - مركز صحي حاسك
 *
 * الخادم (Code.gs) — Google Apps Script (V8)
 */

// ============================ إعدادات عامة ============================
var APP_NAME = 'أثر';
var SHEET_NAME = 'أثر - قاعدة بيانات الفعاليات';
var PHOTO_ROOT_NAME = 'أثر - صور الفعاليات';
var PROP = PropertiesService.getScriptProperties();
var CACHE = CacheService.getScriptCache();

var SHEETS = {
  CONFIG: 'Config',
  USERS: 'Users',
  ACTIVITIES: 'Activities'
};

var AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                 'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ترويسة جدول الفعاليات (الترتيب مهم)
var ACT_HEADERS = ['id','created_at','created_by_no','created_by_name',
  'executor_no','executor_name','type','world_day','title','objective',
  'target_groups','event_date','year','month','month_name','quarter',
  'location','mechanism','beneficiaries','has_partnership','partners',
  'photo_folder_id','photo_ids','notes','status'];

// ============================ نقطة الدخول ============================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
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
  }
  return sh;
}

function ss_() {
  var id = PROP.getProperty('SHEET_ID');
  if (!id) throw new Error('النظام غير مهيّأ. شغّل دالة setup أولًا.');
  return SpreadsheetApp.openById(id);
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

// ============================ الإقلاع الموحّد ============================
/** استدعاء واحد بدل اثنين عند الدخول: تسجيل الدخول + القوائم معًا (أداء أفضل). */
function init(empNo) {
  var lr = login(empNo);
  if (!lr.ok) return lr;
  return { ok: true, user: lr.user, config: getConfig() };
}

// ============================ المصادقة ============================
function login(empNo) {
  empNo = String(empNo || '').trim();
  if (!empNo) return { ok: false, msg: 'أدخل الرقم الوظيفي.' };
  var users = getUsers_();
  var u = users.filter(function(x){ return String(x.emp_no) === empNo && x.active; })[0];
  if (!u) return { ok: false, msg: 'الرقم الوظيفي غير مسجّل.' };
  return { ok: true, user: { no: u.emp_no, name: u.name, role: u.role, title: u.title } };
}

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

// ============================ القوائم (Config) ============================
function getConfig() {
  var cached = CACHE.get('cfg');
  if (cached) return JSON.parse(cached);
  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  var data = sh.getDataRange().getValues();
  data.shift();
  var out = { activity_type: [], target_group: [], mechanism: [] };
  data.forEach(function(r){
    if (!r[0] || r[2] === false) return;
    if (!out[r[0]]) out[r[0]] = [];
    out[r[0]].push({ value: r[1], order: r[3] || 0 });
  });
  Object.keys(out).forEach(function(k){
    out[k].sort(function(a,b){ return a.order - b.order; });
    out[k] = out[k].map(function(x){ return x.value; });
  });
  CACHE.put('cfg', JSON.stringify(out), 21600);
  return out;
}

// إدارة فقط: إضافة عنصر لقائمة وينعكس في كل الصفحات
function addConfigItem(category, value) {
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
  return { ok:true, config:getConfig() };
}

function removeConfigItem(category, value) {
  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  var data = sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++){
    if (data[i][0]===category && String(data[i][1]).trim()===String(value).trim()){
      sh.getRange(i+1,3).setValue(false); // تعطيل بدل حذف للحفاظ على السجلات القديمة
      CACHE.remove('cfg');
      return { ok:true, config:getConfig() };
    }
  }
  return { ok:false, msg:'لم يُعثر على العنصر.' };
}

// ============================ الفعاليات ============================
function saveActivity(payload) {
  payload = payload || {};
  // التحقق من الحقول الإلزامية في الخادم أيضًا
  var required = ['type','title','objective','event_date','executor_no'];
  for (var i=0;i<required.length;i++){
    if (!payload[required[i]]) return { ok:false, msg:'حقول إلزامية ناقصة.' };
  }
  var sh = ss_().getSheetByName(SHEETS.ACTIVITIES);
  var id = payload.id || ('ACT-' + Date.now());
  var isNew = !payload.id;

  // معالجة التاريخ
  var d = new Date(payload.event_date);
  var year = d.getFullYear();
  var month = d.getMonth() + 1;
  var monthName = AR_MONTHS[d.getMonth()];
  var quarter = 'الربع ' + ['الأول','الثاني','الثالث','الرابع'][Math.floor((month-1)/3)];

  // رفع الصور (إن وُجدت صور جديدة base64)
  var folderId = payload.photo_folder_id || '';
  var photoIds = payload.existing_photo_ids ? payload.existing_photo_ids.slice() : [];
  if (payload.photos && payload.photos.length) {
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
  }

  var row = {
    id: id,
    created_at: isNew ? new Date() : (payload.created_at || new Date()),
    created_by_no: payload.created_by_no || payload.executor_no,
    created_by_name: payload.created_by_name || payload.executor_name,
    executor_no: payload.executor_no,
    executor_name: payload.executor_name,
    type: payload.type,
    world_day: payload.type === 'يوم عالمي' ? (payload.world_day || '') : '',
    title: payload.title,
    objective: payload.objective,
    target_groups: (payload.target_groups || []).join(' ، '),
    event_date: payload.event_date,
    year: year, month: month, month_name: monthName, quarter: quarter,
    location: payload.location || '',
    mechanism: payload.mechanism || '',
    beneficiaries: payload.beneficiaries || '',
    has_partnership: !!payload.has_partnership,
    partners: payload.has_partnership ? (payload.partners || []).join(' ، ') : '',
    photo_folder_id: folderId,
    photo_ids: photoIds.join(','),
    notes: payload.notes || '',
    status: 'محفوظ'
  };

  var values = ACT_HEADERS.map(function(h){ return row[h]; });

  if (isNew) {
    sh.appendRow(values);
  } else {
    var rowIndex = findRowById_(sh, id);
    if (rowIndex < 0) { sh.appendRow(values); }
    else { sh.getRange(rowIndex, 1, 1, values.length).setValues([values]); }
  }
  return { ok:true, id:id };
}

function findRowById_(sh, id) {
  var ids = sh.getRange(1,1,sh.getLastRow(),1).getValues();
  for (var i=1;i<ids.length;i++){ if (String(ids[i][0])===String(id)) return i+1; }
  return -1;
}

function getActivities(empNo, role, year, month) {
  var sh = ss_().getSheetByName(SHEETS.ACTIVITIES);
  if (sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var rows = data.map(function(r){
    var o = {}; head.forEach(function(h,i){ o[h]=r[i]; }); return o;
  }).filter(function(o){ return o.id; });

  // الموظفة ترى سجلها فقط؛ المشرف يرى الكل
  if (role !== 'admin') {
    rows = rows.filter(function(o){ return String(o.executor_no)===String(empNo); });
  }
  if (year) rows = rows.filter(function(o){ return String(o.year)===String(year); });
  if (month) rows = rows.filter(function(o){ return String(o.month)===String(month); });

  rows.sort(function(a,b){ return new Date(b.event_date) - new Date(a.event_date); });
  return rows.map(function(o){
    return {
      id:o.id, type:o.type, world_day:o.world_day, title:o.title,
      objective:o.objective, target_groups:o.target_groups,
      event_date:formatDate_(o.event_date), month_name:o.month_name,
      quarter:o.quarter, year:o.year, month:o.month,
      executor_name:o.executor_name, location:o.location,
      mechanism:o.mechanism, beneficiaries:o.beneficiaries,
      has_partnership:o.has_partnership, partners:o.partners,
      notes:o.notes, photo_ids:o.photo_ids ? String(o.photo_ids).split(',').filter(Boolean) : [],
      photo_folder_id:o.photo_folder_id
    };
  });
}

function deleteActivity(id) {
  var sh = ss_().getSheetByName(SHEETS.ACTIVITIES);
  var rowIndex = findRowById_(sh, id);
  if (rowIndex < 0) return { ok:false, msg:'غير موجود.' };
  sh.deleteRow(rowIndex);
  return { ok:true };
}

function formatDate_(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.getFullYear() + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + ('0'+d.getDate()).slice(-2);
}

// ============================ لوحة المؤشرات ============================
function getDashboard(empNo, role) {
  var sh = ss_().getSheetByName(SHEETS.ACTIVITIES);
  var out = { total:0, beneficiaries:0, byType:{}, byMonth:{}, partnerships:0, byExecutor:{} };
  if (sh.getLastRow() < 2) return out;
  var data = sh.getDataRange().getValues();
  var head = data.shift();
  var idx = {}; head.forEach(function(h,i){ idx[h]=i; });

  data.forEach(function(r){
    if (!r[idx.id]) return;
    if (role !== 'admin' && String(r[idx.executor_no]) !== String(empNo)) return;
    out.total++;
    var b = parseInt(r[idx.beneficiaries],10); if(!isNaN(b)) out.beneficiaries += b;
    var t = r[idx.type] || 'غير محدد'; out.byType[t] = (out.byType[t]||0)+1;
    var m = r[idx.month_name] || ''; if(m) out.byMonth[m] = (out.byMonth[m]||0)+1;
    if (r[idx.has_partnership]===true || r[idx.has_partnership]==='true') out.partnerships++;
    var ex = r[idx.executor_name] || ''; if(ex) out.byExecutor[ex] = (out.byExecutor[ex]||0)+1;
  });
  return out;
}
