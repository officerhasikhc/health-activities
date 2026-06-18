/* ====================== حالة عامة ====================== */
var USER = null;          // {no,name,role,title}
var CONFIG = null;        // {activity_type, target_group, mechanism, users?}
var FORM = null;
var DRAFT_KEY = 'athar_draft';
var REC_CACHE = {};       // ذاكرة مؤقتة للسجل حسب (سنة|شهر)
var DASH_CACHE = {};      // ذاكرة مؤقتة للمؤشرات حسب الفترة
var REC_PENDING = {};
var DASH_PENDING = {};
var deferredInstallPrompt = null;
var REMEMBER_KEY = 'athar_remember_emp';
var SAVED_EMP_KEY = 'athar_saved_emp';
var SESSION_MSG_KEY = 'athar_session_msg';
var SESSION_KEY = 'athar_session';
var SUBMITTING = false;
var PHOTO_VIEW = { ids:[], index:0, title:'' };
var AR_MONTHS_UI = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
var PENDING_RECORD_FILTER = null;
var PENDING_FORM_MISSING = null;
var _lastSessionTouch = 0;
var IDLE_LIMIT_MS = 10 * 60 * 1000;
var idleTimer = null;
var idleEvents = ['click','keydown','touchstart','mousemove','scroll','input'];

function invalidateCaches(){ REC_CACHE = {}; DASH_CACHE = {}; REC_PENDING = {}; DASH_PENDING = {}; }

/* ====================== مساعد استدعاء الخادم ====================== */
function run(fn){
  var args = Array.prototype.slice.call(arguments,1);
  if (window.AtharServer && typeof window.AtharServer.run === 'function') {
    return window.AtharServer.run(fn, args);
  }
  return new Promise(function(res,rej){
    google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn].apply(null,args);
  });
}

/* ====================== التنبيهات ====================== */
var toastT;
function toast(msg, type, detail){
  var t=document.getElementById('toast');
  if(!t) return;
  var icons={ok:'✓', err:'✕', warn:'!'};
  var icon=icons[type]||'ℹ';
  var ic=t.querySelector('.toast-icon');
  var m=t.querySelector('.toast-msg');
  t.setAttribute('role', type==='err'?'alert':'status');
  t.setAttribute('aria-live', type==='err'?'assertive':'polite');
  t.setAttribute('aria-atomic','true');
  if(ic) ic.textContent=icon;
  if(m){
    m.innerHTML='<span class="toast-title">'+esc(msg||'')+'</span>'+
      (detail?'<span class="toast-detail">'+esc(detail)+'</span>':'');
  }
  t.className='show '+(type||'');
  clearTimeout(toastT);
  toastT=setTimeout(function(){ t.className=''; }, detail?4200:3200);
}

/* ====================== الدخول وكلمة المرور ====================== */
var _pendingPassword = '';
var _authUxReady = false;

function setAuthError(id, msg){
  var el=document.getElementById(id);
  if(el) el.textContent=msg || '';
}
function setButtonBusy(btn, on, busyText){
  if(!btn) return;
  if(!btn.getAttribute('data-idle-text')) btn.setAttribute('data-idle-text', btn.textContent);
  btn.disabled=!!on;
  btn.textContent=on ? busyText : btn.getAttribute('data-idle-text');
}
function wireAuthUx(){
  if(_authUxReady) return;
  _authUxReady = true;
  Array.prototype.forEach.call(document.querySelectorAll('.pw-toggle'), function(btn){
    btn.addEventListener('click', function(){
      var field=document.getElementById(btn.getAttribute('data-for'));
      if(!field) return;
      var show=field.type==='password';
      field.type=show ? 'text' : 'password';
      btn.textContent=show ? 'إخفاء' : 'إظهار';
    });
  });
  var pw=document.getElementById('pw');
  var caps=document.getElementById('capsHint');
  if(pw && caps){
    pw.addEventListener('keyup', function(e){
      caps.textContent=(e.getModifierState && e.getModifierState('CapsLock')) ? 'مفتاح Caps Lock مُفعّل' : '';
    });
  }
}
function finishLogin(no, r){
  USER=r.user; CONFIG=r.config;
  saveRememberedEmp(no);
  persistSession(no);
  enterApp();
  boot();
}
function doLogin(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  var btn=document.getElementById('loginBtn');
  if(btn && btn.disabled) return;
  var no=document.getElementById('empNo').value.trim();
  var pw=document.getElementById('pw');
  var pass=pw ? pw.value : '';
  setAuthError('loginErr','');
  if(!no || !pass){ setAuthError('loginErr','أدخل الرقم الوظيفي وكلمة المرور.'); return; }
  setButtonBusy(btn,true,'جارٍ التحقق…');
  run('init', no, pass).then(function(r){
    if(!r || !r.ok){ setAuthError('loginErr',(r && r.msg) || 'تعذّر الدخول.'); return; }
    if(r.mustReset){
      USER=r.user; CONFIG=null; _pendingPassword=pass;
      document.getElementById('resetUser').value=no;
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('resetScreen').classList.remove('hidden');
      var next=document.getElementById('newPw');
      if(next) next.focus();
      return;
    }
    if(r.mustReset !== false || !r.config){
      clearSession();
      setAuthError('loginErr','تعذّر إكمال الدخول لأن الخادم لم يفعّل تغيير كلمة المرور بعد. أعد نشر تطبيق الويب ثم حاول مجددًا.');
      return;
    }
    finishLogin(no, r);
  }).catch(function(e){
    setAuthError('loginErr',(e && e.message) ? e.message : 'تعذّر الاتصال، أعد المحاولة.');
  }).finally(function(){
    setButtonBusy(btn,false,'');
  });
}
function doChangePassword(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  var no=document.getElementById('resetUser').value;
  var p1=document.getElementById('newPw').value || '';
  var p2=document.getElementById('newPw2').value || '';
  var btn=document.getElementById('resetBtn');
  setAuthError('resetErr','');
  if(p1 !== p2){ setAuthError('resetErr','كلمتا المرور غير متطابقتين.'); return; }
  if(p1.length < 6){ setAuthError('resetErr','كلمة المرور يجب ألا تقل عن ٦ أحرف.'); return; }
  if(/\s/.test(p1)){ setAuthError('resetErr','لا تستخدم مسافات في كلمة المرور.'); return; }
  if(!/[A-Za-z\u0600-\u06FF]/.test(p1) || !/[0-9]/.test(p1)){
    setAuthError('resetErr','كلمة المرور يجب أن تحتوي على حرف ورقم.');
    return;
  }
  if(String(p1) === String(no)){ setAuthError('resetErr','لا يمكن أن تكون كلمة المرور هي الرقم الوظيفي.'); return; }
  setButtonBusy(btn,true,'جارٍ الحفظ…');
  run('changePassword', no, _pendingPassword, p1).then(function(r){
    if(!r || !r.ok){ setAuthError('resetErr',(r && r.msg) || 'تعذّر تغيير كلمة المرور.'); return null; }
    _pendingPassword='';
    return run('init', no, p1);
  }).then(function(full){
    if(!full) return;
    if(!full.ok){ setAuthError('resetErr',full.msg || 'تعذّر الدخول بعد تغيير كلمة المرور.'); return; }
    if(full.mustReset !== false || !full.config){
      setAuthError('resetErr','تم تغيير كلمة المرور، لكن الخادم لم يرجع تهيئة كاملة. أعد تحميل الصفحة وسجّل الدخول بكلمة المرور الجديدة.');
      return;
    }
    document.getElementById('resetScreen').classList.add('hidden');
    finishLogin(no, full);
  }).catch(function(e){
    setAuthError('resetErr',(e && e.message) ? e.message : 'تعذّر الاتصال، أعد المحاولة.');
  }).finally(function(){
    setButtonBusy(btn,false,'');
  });
}
function logout(){
  confirmModal('تأكيد الخروج','هل تريد تسجيل الخروج من منصة أثر؟',function(){
    forceLogout('');
  });
}
function forceLogout(message){
  stopSessionGuard();
  USER=null; CONFIG=null; FORM=null;
  clearSession();
  if(message) sessionStorage.setItem(SESSION_MSG_KEY, message);
  location.reload();
}

/* ====================== استمرارية الجلسة عبر التحديث ====================== */
function persistSession(no){
  try{
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      authVersion: 3, no: no || (USER && USER.no), user: USER, config: CONFIG, ts: Date.now()
    }));
    _lastSessionTouch = Date.now();
  }catch(e){}
}
function touchSession(){
  if(!USER) return;
  var now = Date.now();
  if(now - _lastSessionTouch < 20000) return; // تقليل عدد الكتابات
  persistSession(USER.no);
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }
function enterApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  var reset=document.getElementById('resetScreen');
  if(reset) reset.classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('whoName').textContent=USER.name;
  document.getElementById('whoTitle').textContent=USER.title;
  startSessionGuard();
}
function restoreSession(){
  var raw;
  try{ raw = localStorage.getItem(SESSION_KEY); }catch(e){ return false; }
  if(!raw) return false;
  var s;
  try{ s = JSON.parse(raw); }catch(e){ clearSession(); return false; }
  if(!s || !s.user || !s.config){ clearSession(); return false; }
  if(s.authVersion !== 3){ clearSession(); return false; }
  if(Date.now() - (s.ts||0) > IDLE_LIMIT_MS){ clearSession(); return false; }
  USER = s.user; CONFIG = s.config;
  enterApp();
  boot();
  return true;
}
function initLoginPrefs(){
  var emp=document.getElementById('empNo');
  var remember=document.getElementById('rememberEmp');
  var err=document.getElementById('loginErr');
  if(!emp || !remember) return;
  var shouldRemember=localStorage.getItem(REMEMBER_KEY)==='1';
  remember.checked=shouldRemember;
  if(shouldRemember) emp.value=localStorage.getItem(SAVED_EMP_KEY)||'';
  var msg=sessionStorage.getItem(SESSION_MSG_KEY);
  if(msg && err){ err.textContent=msg; sessionStorage.removeItem(SESSION_MSG_KEY); }
}
function saveRememberedEmp(no){
  var remember=document.getElementById('rememberEmp');
  if(remember && remember.checked){
    localStorage.setItem(REMEMBER_KEY,'1');
    localStorage.setItem(SAVED_EMP_KEY,no);
  } else {
    localStorage.removeItem(REMEMBER_KEY);
    localStorage.removeItem(SAVED_EMP_KEY);
  }
}
function startSessionGuard(){
  stopSessionGuard();
  idleEvents.forEach(function(ev){ window.addEventListener(ev,onSessionActivity,{passive:true}); });
  resetIdleTimer();
}
function stopSessionGuard(){
  clearTimeout(idleTimer);
  idleEvents.forEach(function(ev){ window.removeEventListener(ev,onSessionActivity); });
}
function onSessionActivity(){
  if(USER) resetIdleTimer();
}
function resetIdleTimer(){
  clearTimeout(idleTimer);
  touchSession();
  idleTimer=setTimeout(function(){
    forceLogout('');
  }, IDLE_LIMIT_MS);
}
function bootstrapAuth(){
  wireAuthUx();
  initLoginPrefs();
  restoreSession();
}
document.addEventListener('DOMContentLoaded', bootstrapAuth);
if(document.readyState!=='loading') bootstrapAuth();

window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  deferredInstallPrompt = e;
});
function installApp(){
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(function(){ deferredInstallPrompt=null; });
    return;
  }
  openModal('تثبيت التطبيق',
    '<div class="install-help">'+
      '<p>يمكن تثبيت منصة أثر كاختصار دائم على الهاتف من المتصفح.</p>'+
      '<div class="dl-row"><span>Android</span><span>من قائمة المتصفح اختر: إضافة إلى الشاشة الرئيسية.</span></div>'+
      '<div class="dl-row"><span>iPhone</span><span>من زر المشاركة اختر: إضافة إلى الشاشة الرئيسية.</span></div>'+
      '<div class="dl-row"><span>Windows</span><span>من قائمة المتصفح اختر: تثبيت التطبيق أو إنشاء اختصار.</span></div>'+
    '</div>');
}

/* ====================== الإقلاع ====================== */
function boot(){
  renderTabs();
  show('register');
  syncOutbox();      // رفع أي محفوظ محليًا من جلسة سابقة
  updatePending();
  updateBellAndBadges();
  Warmup.afterLogin();
}

function renderTabs(){
  var tabs=[
    {id:'register', label:'تسجيل فعالية'},
    {id:'records',  label:'البرامج والمبادرات'},
    {id:'dashboard',label:'المؤشرات'}
  ];
  if(USER.role==='admin') tabs.push({id:'admin', label:'الإدارة'});
  document.getElementById('tabsBar').innerHTML=tabs.map(function(t){
    var warm=(t.id==='records'||t.id==='dashboard')?' onpointerenter="Warmup.intent(\''+t.id+'\')" ontouchstart="Warmup.intent(\''+t.id+'\')"':'';
    var badgeHtml = t.id==='records' ? '<span id="tabBadge_records" class="nav-badge hidden">جديد</span>' : '';
    return '<button class="tab" data-tab="'+t.id+'" onclick="onTabClick(\''+t.id+'\')"'+warm+'>'+t.label+' '+badgeHtml+'</button>';
  }).join('');
}
function setActiveTab(id){
  document.querySelectorAll('.tab').forEach(function(el){
    el.classList.toggle('active', el.getAttribute('data-tab')===id);
  });
}
function onTabClick(tab) {
  if (tab === 'records') {
    localStorage.setItem('new_activity_count', 0);
    updateBellAndBadges();
  }
  show(tab);
}
function show(tab){
  setActiveTab(tab);
  if(tab==='register') renderForm();
  else if(tab==='records') renderRecords();
  else if(tab==='dashboard') renderDashboard();
  else if(tab==='admin') renderAdmin();
}

function updateBellAndBadges(addedCount) {
  var c = parseInt(localStorage.getItem('new_activity_count') || '0', 10);
  if (addedCount) {
    c += addedCount;
    localStorage.setItem('new_activity_count', c);
  }
  var b = document.getElementById('bellIcon');
  var bdg = document.getElementById('bellBadge');
  var tBdg = document.getElementById('tabBadge_records');
  // الجرس يبقى ظاهراً دائماً — فقط الشارة تظهر/تختفي
  if(b) b.classList.remove('hidden');
  if (c > 0) {
    if(bdg) { bdg.classList.remove('hidden'); bdg.innerText = c; }
    if(tBdg) { tBdg.classList.remove('hidden'); tBdg.innerText = c; }
  } else {
    if(bdg) bdg.classList.add('hidden');
    if(tBdg) tBdg.classList.add('hidden');
  }
}

function onBellClick() {
  localStorage.setItem('new_activity_count', 0);
  updateBellAndBadges();
  show('records');
}

/* ====================== الفترة والمعرّفات ====================== */
function makeId(prefix){
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}
function currentPeriod(){
  var d=new Date();
  return { year:d.getFullYear(), month:d.getMonth()+1, quarter:Math.floor(d.getMonth()/3)+1, half:(d.getMonth()<6?1:2) };
}
function yearOptions(sel){
  var now=new Date().getFullYear(), out='';
  for(var i=0;i<6;i++){
    var y=now-i; out+='<option value="'+y+'" '+(String(sel)===String(y)?'selected':'')+'>'+y+'</option>';
  }
  return out;
}
function periodControlsHtml(prefix){
  var p=currentPeriod();
  var monthsHtml = AR_MONTHS_UI.map(function(m,i){ return '<option value="m'+(i+1)+'">'+m+'</option>'; }).join('');
  
  var empHtml = '';
  if(window.USER && USER.role === 'admin' && window.CONFIG && CONFIG.users) {
    var opts = '<option value="">الجميع</option>';
    CONFIG.users.forEach(function(u){ opts += '<option value="'+u.no+'">'+u.name+'</option>'; });
    empHtml = '<div class="field"><label>الموظف</label><select id="'+prefix+'_emp" onchange="periodReload(\''+prefix+'\')">'+opts+'</select></div>';
  }

  return '<div class="filters period-filters" style="display:flex;gap:15px;flex-wrap:wrap;">'+
    '<div class="field" id="'+prefix+'_yearWrap"><label>السنة</label><select id="'+prefix+'_year" onchange="periodReload(\''+prefix+'\')">'+yearOptions(p.year)+'</select></div>'+
    '<div class="field"><label>الفترة</label><select id="'+prefix+'_period" onchange="onPeriodChange(\''+prefix+'\')">'+
      '<option value="year">كامل السنة</option>'+
      '<optgroup label="نصف سنوي">'+
        '<option value="h1">النصف الأول</option><option value="h2">النصف الثاني</option>'+
      '</optgroup>'+
      '<optgroup label="ربع سنوي">'+
        '<option value="q1">الربع الأول</option><option value="q2">الربع الثاني</option><option value="q3">الربع الثالث</option><option value="q4">الربع الرابع</option>'+
      '</optgroup>'+
      '<optgroup label="شهري">'+monthsHtml+'</optgroup>'+
      '<option value="all">جميع البرامج (كل السنوات)</option>'+
    '</select></div>'+
    '<div class="period-count-chip hidden" id="'+prefix+'_periodCount" aria-live="polite"></div>'+
    empHtml +
  '</div>';
}
function initPeriodControls(prefix, initial){
  var p=Object.assign(currentPeriod(), initial||{});
  var y=document.getElementById(prefix+'_year'); if(y) y.value=String(p.year);
  
  var per = document.getElementById(prefix+'_period');
  if(per){
    var mode = p.mode || 'month';
    if(mode === 'all') per.value = 'all';
    else if(mode === 'year') per.value = 'year';
    else if(mode === 'half') per.value = 'h' + p.half;
    else if(mode === 'quarter') per.value = 'q' + p.quarter;
    else per.value = 'm' + p.month;
  }
  var yearWrap = document.getElementById(prefix+'_yearWrap');
  if(yearWrap) yearWrap.classList.toggle('hidden', (p.mode||'month')==='all');
}
function onPeriodChange(prefix){
  var per = val(prefix+'_period');
  var yearWrap = document.getElementById(prefix+'_yearWrap');
  if(yearWrap) yearWrap.classList.toggle('hidden', per==='all');
  periodReload(prefix);
}
function periodReload(prefix){
  if(prefix==='fl') loadRecords(true);
  else if(prefix==='dash') loadDashboard(true);
}
function periodFilter(prefix){
  var p=currentPeriod();
  var per=val(prefix+'_period') || ('m'+p.month);
  var year=parseInt(val(prefix+'_year'),10)||p.year;
  
  var mode='month', m=p.month, q=p.quarter, h=p.half;
  if(per==='all') mode='all';
  else if(per==='year') mode='year';
  else if(per.startsWith('h')) { mode='half'; h=parseInt(per.substring(1),10); }
  else if(per.startsWith('q')) { mode='quarter'; q=parseInt(per.substring(1),10); }
  else if(per.startsWith('m')) { mode='month'; m=parseInt(per.substring(1),10); }
  
  var emp = val(prefix+'_emp');
  
  return {
    mode: mode,
    year: year,
    month: m,
    quarter: q,
    half: h,
    emp: emp
  };
}
function periodKey(prefix){ return JSON.stringify(periodFilter(prefix)); }
function periodCountLabel(filter){
  if(!filter) return 'عدد الفعاليات';
  if(filter.mode==='month') return AR_MONTHS_UI[(filter.month||1)-1] || 'الشهر';
  if(filter.mode==='quarter') return 'الربع '+(['','الأول','الثاني','الثالث','الرابع'][filter.quarter]||'');
  if(filter.mode==='half') return filter.half===1?'النصف الأول':'النصف الثاني';
  if(filter.mode==='year') return 'سنة '+filter.year;
  return 'كل السنوات';
}
function updatePeriodCountChip(prefix, list){
  var chip=document.getElementById(prefix+'_periodCount');
  if(!chip) return;
  var count=(list||[]).filter(function(o){ return !o._pending; }).length;
  var filter=periodFilter(prefix);
  chip.textContent=periodCountLabel(filter)+': '+count+' '+(count===1?'فعالية':'فعاليات')+' · عدد الفعاليات';
  chip.classList.remove('hidden');
}
function dateParts(s){
  var m=String(s||'').match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(m) return { year:parseInt(m[1],10), month:parseInt(m[2],10), day:parseInt(m[3],10) };
  var d=new Date(s);
  if(!isNaN(d)) return { year:d.getFullYear(), month:d.getMonth()+1, day:d.getDate() };
  return null;
}
function displayDate(s){
  var p=dateParts(s);
  if(!p) return s||'';
  return p.year+'/'+('0'+p.month).slice(-2)+'/'+('0'+p.day).slice(-2);
}
function filterFromDate(s){
  var p=dateParts(s)||currentPeriod();
  return { mode:'month', year:p.year, month:p.month, quarter:Math.floor((p.month-1)/3)+1, half:p.month<=6?1:2 };
}
function recordMatchesFilter(o, filter){
  filter=filter||currentPeriod();
  if(filter.mode==='all') return true;
  var p=dateParts(o.event_date);
  if(!p) return false;
  if(filter.mode==='month') return p.year===filter.year && p.month===filter.month;
  if(filter.mode==='quarter') return p.year===filter.year && Math.floor((p.month-1)/3)+1===filter.quarter;
  if(filter.mode==='half') return p.year===filter.year && (p.month<=6?1:2)===filter.half;
  if(filter.mode==='year') return p.year===filter.year;
  return true;
}

/* ====================== التسخين والكاش ====================== */
function filterKey(filter){ return JSON.stringify(filter || currentPeriod()); }
function clonePeriod(filter){
  var p=currentPeriod(), f=filter||{};
  return {
    mode:f.mode||'month',
    year:parseInt(f.year,10)||p.year,
    month:parseInt(f.month,10)||p.month,
    quarter:parseInt(f.quarter,10)||p.quarter,
    half:parseInt(f.half,10)||p.half
  };
}
function shiftedMonthFilter(filter, delta){
  var f=clonePeriod(filter);
  var d=new Date(f.year, (f.month||1)-1 + delta, 1);
  var month=d.getMonth()+1;
  return { mode:'month', year:d.getFullYear(), month:month, quarter:Math.floor((month-1)/3)+1, half:month<=6?1:2 };
}
function idleWork(fn){
  if('requestIdleCallback' in window) requestIdleCallback(fn, { timeout:1800 });
  else setTimeout(fn, 250);
}
function fetchRecordsForFilter(filter, force){
  filter=clonePeriod(filter);
  var key=filterKey(filter);
  if(!force && REC_CACHE[key]) return Promise.resolve(REC_CACHE[key]);
  if(REC_PENDING[key]) return REC_PENDING[key];
  REC_PENDING[key]=run('getActivities', USER.no, filter).then(function(list){
    return mergePendingRecords(list, filter).then(function(merged){
      REC_CACHE[key]=merged;
      delete REC_PENDING[key];
      return merged;
    });
  }).catch(function(e){
    delete REC_PENDING[key];
    throw e;
  });
  return REC_PENDING[key];
}
function fetchDashboardForFilter(filter, force){
  filter=clonePeriod(filter);
  var key=filterKey(filter);
  if(!force && DASH_CACHE[key]) return Promise.resolve(DASH_CACHE[key]);
  if(DASH_PENDING[key]) return DASH_PENDING[key];
  DASH_PENDING[key]=run('getDashboard', USER.no, filter).then(function(d){
    DASH_CACHE[key]=d;
    delete DASH_PENDING[key];
    return d;
  }).catch(function(e){
    delete DASH_PENDING[key];
    throw e;
  });
  return DASH_PENDING[key];
}
function warmRecordFilters(seed){
  var f=clonePeriod(seed), list=[f];
  if(f.mode==='month'){
    list.push(shiftedMonthFilter(f,-1), shiftedMonthFilter(f,1));
    list.push({mode:'quarter',year:f.year,month:f.month,quarter:f.quarter,half:f.half});
    list.push({mode:'half',year:f.year,month:f.month,quarter:f.quarter,half:f.half});
  } else if(f.mode==='quarter' || f.mode==='half'){
    list.push({mode:'month',year:f.year,month:f.month,quarter:f.quarter,half:f.half});
    list.push({mode:'year',year:f.year,month:f.month,quarter:f.quarter,half:f.half});
  }
  list.forEach(function(x){ fetchRecordsForFilter(x, false).catch(function(){}); });
  // تسخين كامل السنة دائماً
  var yearFilter={mode:'year',year:f.year,month:f.month,quarter:f.quarter,half:f.half};
  fetchRecordsForFilter(yearFilter, false).catch(function(){});
}
function warmDashboardFilters(seed){
  var f=clonePeriod(seed), list=[f];
  if(f.mode==='month') list.push({mode:'quarter',year:f.year,month:f.month,quarter:f.quarter,half:f.half});
  if(f.mode==='quarter' || f.mode==='half') list.push({mode:'year',year:f.year,month:f.month,quarter:f.quarter,half:f.half});
  list.forEach(function(x){ fetchDashboardForFilter(x, false).catch(function(){}); });
  var yearFilter={mode:'year',year:f.year,month:f.month,quarter:f.quarter,half:f.half};
  fetchDashboardForFilter(yearFilter, false).catch(function(){});
}
var Warmup = {
  afterLogin:function(){
    if(!USER) return;
    idleWork(function(){
      var f=Object.assign({mode:'month'}, currentPeriod());
      fetchRecordsForFilter(f, false).catch(function(){});
      fetchDashboardForFilter(f, false).catch(function(){});
    });
  },
  records:function(filter){ if(USER) idleWork(function(){ warmRecordFilters(filter||periodFilter('fl')); }); },
  dashboard:function(filter){ if(USER) idleWork(function(){ warmDashboardFilters(filter||periodFilter('dash')); }); },
  intent:function(area){
    if(!USER) return;
    if(area==='records' || area==='export') this.records();
    else if(area==='dashboard') this.dashboard();
  }
};

/* ====================== نموذج التسجيل ====================== */
function newForm(){
  return { id:null, type:'', type_custom:'', world_day:'', title:'', objective:'',
    target_groups:[], event_date:todayIso(), location:'', mechanism:'', mechanisms:[],
    beneficiaries:'', has_partnership:false, partners:[],
    photos:[], existing_photo_ids:[], photo_folder_id:'', notes:'', client_request_id:'',
    executor_no:USER.no, executor_name:USER.name };
}
function opt(list, sel){
  return '<option value=""></option>'+(list||[]).map(function(v){
    return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+v+'</option>';
  }).join('');
}
function typeOptions(){
  var list=(CONFIG.activity_type||[]).slice();
  if(list.indexOf('أخرى')<0) list.push('أخرى');
  return opt(list, FORM.type);
}
function ensureFormShape(){
  FORM.target_groups=FORM.target_groups||[];
  FORM.partners=FORM.partners||[];
  FORM.photos=FORM.photos||[];
  FORM.existing_photo_ids=FORM.existing_photo_ids||[];
  FORM.mechanisms=FORM.mechanisms&&FORM.mechanisms.length ? FORM.mechanisms : splitList(FORM.mechanism);
  if(FORM.type==='أخرى') FORM.type_custom=FORM.type_custom||'';
}
function requiredFields(){
  return (CONFIG && CONFIG.required_fields) || { objective:true, photos:true };
}
function isRequiredField(key){
  if(['type','title','event_date','executor_no'].indexOf(key)>-1) return true;
  return !!requiredFields()[key];
}
function reqMark(key){
  return isRequiredField(key)?' <span class="req">*</span>':'';
}
function fieldLabel(key){
  var labels={
    type:'نوع الفعالية', type_custom:'نوع آخر', title:'عنوان الفعالية',
    event_date:'تاريخ التنفيذ', executor_no:'المنفّذة', objective:'الهدف',
    target_groups:'الفئة المستهدفة', mechanism:'آلية التنفيذ',
    beneficiaries:'عدد المستفيدين', location:'المكان', photos:'الصور',
    world_day:'اسم اليوم العالمي', partners:'الجهات الشريكة', notes:'ملاحظات'
  };
  return labels[key]||key;
}

function renderForm(editing){
  if(!editing){
    FORM=newForm();
    var saved=restoreDraft();
    if(saved){ Object.assign(FORM, saved); }
  }
  ensureFormShape();
  var v=document.getElementById('view');
  var execField = USER.role==='admin'
    ? '<div class="field"><label>المنفّذة'+reqMark('executor_no')+'</label><select id="f_exec">'+execOptions()+'</select></div>'
    : '<div class="field"><label>المنفّذة'+reqMark('executor_no')+'</label><div class="readonly-box">'+esc(USER.name)+'<small>'+esc(USER.title||'')+'</small></div></div>';
  v.innerHTML =
  '<div class="card">'+
    '<h2>'+(FORM.id?'تعديل فعالية':'تسجيل فعالية / مبادرة')+'</h2>'+
    '<p class="sub">سجّل الفعالية لحظة تنفيذها مع صورها وبياناتها. الحقول المعلّمة (<span style="color:var(--err)">*</span>) إلزامية.</p>'+
    '<div id="validationPanel" class="validation-panel hidden"></div>'+
    '<div class="grid">'+
      '<div class="field"><label>نوع الفعالية'+reqMark('type')+'</label>'+
        '<select id="f_type" onchange="onTypeChange()">'+typeOptions()+'</select></div>'+
      '<div class="field '+(FORM.type==='أخرى'?'':'hidden')+'" id="typeOtherWrap">'+
        '<label>نوع آخر <span class="req">*</span></label>'+
        '<input type="text" id="f_type_custom" value="'+esc(FORM.type_custom)+'" placeholder="اكتب نوع الفعالية"></div>'+
      '<div class="field '+(FORM.type==='يوم عالمي'?'':'hidden')+'" id="worldDayWrap">'+
        '<label>اسم اليوم العالمي'+reqMark('world_day')+'</label>'+
        '<input type="text" id="f_world" value="'+esc(FORM.world_day)+'" placeholder="مثال: اليوم العالمي لغسل اليدين"></div>'+
      execField+
      '<div class="field '+(FORM.type==='يوم عالمي'?'hidden':'')+'" id="titleWrap"><label>عنوان الفعالية'+reqMark('title')+'</label>'+
        '<input type="text" id="f_title" value="'+esc(FORM.title)+'"></div>'+
      '<div class="field full"><label>الهدف'+reqMark('objective')+'</label>'+
        '<textarea id="f_obj">'+esc(FORM.objective)+'</textarea></div>'+
      '<div class="field"><label>تاريخ التنفيذ'+reqMark('event_date')+'</label>'+
        '<input type="date" id="f_date" value="'+esc(FORM.event_date)+'"></div>'+
      '<div class="field"><label>المكان'+reqMark('location')+'</label>'+
        '<input type="text" id="f_loc" value="'+esc(FORM.location)+'" placeholder="المركز / اسم المدرسة…"></div>'+
      '<div class="field"><label>عدد المستفيدين'+reqMark('beneficiaries')+'</label>'+
        '<input type="number" id="f_ben" min="0" value="'+esc(FORM.beneficiaries)+'"></div>'+
    '</div>'+
    '<div class="section-divider"></div>'+
    '<div class="field full"><label>آلية التنفيذ'+reqMark('mechanism')+'</label>'+
      '<div class="hint">يمكن اختيار أكثر من آلية وإضافة آلية غير موجودة.</div>'+
      '<div class="chips soft" id="mechChoices">'+mechanismChoicesHtml()+'</div>'+
      '<div class="tags" id="mechTags">'+mechanismTags()+'</div>'+
      '<div class="add-row" style="margin-top:8px"><input type="text" id="mechInput" placeholder="إضافة آلية تنفيذ أخرى">'+
        '<button class="btn btn-ghost btn-sm" onclick="addMechanismFree()">+ إضافة</button></div></div>'+
    '<div class="section-divider"></div>'+
    '<div class="field full"><label>الفئة المستهدفة'+reqMark('target_groups')+'</label>'+
      '<div class="chips" id="chips">'+ chipsHtml() +'</div></div>'+
    '<div class="section-divider"></div>'+
    '<div class="toggle-row"><label class="switch"><input type="checkbox" id="f_part" '+
      (FORM.has_partnership?'checked':'')+' onchange="onPartToggle()"><span class="slider"></span></label>'+
      '<label style="margin:0">هل توجد شراكة مع جهات أخرى؟</label></div>'+
    '<div id="partWrap" class="'+(FORM.has_partnership?'':'hidden')+'" style="margin-top:12px">'+
      '<label>الجهات الشريكة'+reqMark('partners')+'</label>'+
      '<div class="add-row"><input type="text" id="partInput" placeholder="اسم الجهة المشاركة">'+
        '<button class="btn btn-ghost btn-sm" onclick="addPartner()">+ إضافة</button></div>'+
      '<div class="tags" id="partTags">'+partnerTags()+'</div></div>'+
    '<div class="section-divider"></div>'+
    '<div class="field full"><label>الصور'+reqMark('photos')+'</label>'+
      '<div class="hint">تُضغط الصور تلقائيًا قبل الرفع. يمكنك إضافة عدة صور.</div>'+
      '<input type="file" id="f_photos" accept="image/*" multiple onchange="onPhotos(this)" style="margin-top:8px">'+
      '<div class="photo-grid" id="photoGrid">'+photoGridHtml()+'</div></div>'+
    '<div class="section-divider"></div>'+
    '<div class="field full"><label>ملاحظات'+reqMark('notes')+'</label><textarea id="f_notes">'+esc(FORM.notes)+'</textarea></div>'+
    '<div class="actions">'+
      '<button class="btn btn-primary" id="saveBtn" onclick="submitForm()">'+(FORM.id?'حفظ التعديلات':'حفظ الفعالية')+'</button>'+
      '<button class="btn btn-ghost" onclick="resetForm()">تفريغ النموذج</button>'+
    '</div>'+
    '<div class="hint" id="autosaveNote" style="margin-top:10px"></div>'+
  '</div>';
  if(USER.role==='admin' && FORM.executor_no){
    var es=document.getElementById('f_exec'); if(es) es.value=FORM.executor_no;
  }
  attachAutosave();
  applyPendingMissingFields();
}

function execOptions(){
  var staff=CONFIG.users||[];
  return '<option value=""></option>'+staff.map(function(s){
    return '<option value="'+s.no+'" '+(FORM.executor_no===s.no?'selected':'')+'>'+s.name+' ('+s.no+')</option>';
  }).join('');
}
function chipsHtml(){
  return CONFIG.target_group.map(function(g){
    var on=FORM.target_groups.indexOf(g)>-1;
    return '<span class="chip'+(on?' on':'')+'" onclick="toggleChip(\''+esc(g)+'\')">'+g+'</span>';
  }).join('');
}
function toggleChip(g){
  var i=FORM.target_groups.indexOf(g);
  if(i>-1) FORM.target_groups.splice(i,1); else FORM.target_groups.push(g);
  document.getElementById('chips').innerHTML=chipsHtml(); saveDraft();
}
function onTypeChange(){
  FORM.type=document.getElementById('f_type').value;
  document.getElementById('worldDayWrap').classList.toggle('hidden', FORM.type!=='يوم عالمي');
  document.getElementById('titleWrap').classList.toggle('hidden', FORM.type==='يوم عالمي');
  document.getElementById('typeOtherWrap').classList.toggle('hidden', FORM.type!=='أخرى');
  if(FORM.type!=='أخرى') FORM.type_custom='';
  if(FORM.type==='يوم عالمي') FORM.title=FORM.world_day||'';
  saveDraft();
}
function mechanismChoicesHtml(){
  return (CONFIG.mechanism||[]).map(function(m){
    var on=FORM.mechanisms.indexOf(m)>-1;
    return '<span class="chip'+(on?' on muted':'')+'" onclick="toggleMechanism(\''+esc(m)+'\')">'+esc(m)+'</span>';
  }).join('');
}
function toggleMechanism(m){
  var i=FORM.mechanisms.indexOf(m);
  if(i>-1) FORM.mechanisms.splice(i,1); else FORM.mechanisms.push(m);
  refreshMechanisms(); saveDraft();
}
function addMechanismFree(){
  var inp=document.getElementById('mechInput'); var v=inp.value.trim(); if(!v) return;
  if(FORM.mechanisms.indexOf(v)===-1) FORM.mechanisms.push(v);
  inp.value=''; refreshMechanisms(); saveDraft();
}
function rmMechanism(i){ FORM.mechanisms.splice(i,1); refreshMechanisms(); saveDraft(); }
function refreshMechanisms(){
  document.getElementById('mechChoices').innerHTML=mechanismChoicesHtml();
  document.getElementById('mechTags').innerHTML=mechanismTags();
}
function mechanismTags(){
  return (FORM.mechanisms||[]).map(function(m,i){
    return '<span class="tag-item">'+esc(m)+'<span class="x" onclick="rmMechanism('+i+')">×</span></span>';
  }).join('');
}
function onPartToggle(){
  FORM.has_partnership=document.getElementById('f_part').checked;
  document.getElementById('partWrap').classList.toggle('hidden', !FORM.has_partnership); saveDraft();
}
function addPartner(){
  var inp=document.getElementById('partInput'); var v=inp.value.trim(); if(!v) return;
  if(FORM.partners.indexOf(v)===-1) FORM.partners.push(v);
  inp.value=''; document.getElementById('partTags').innerHTML=partnerTags(); saveDraft();
}
function rmPartner(i){ FORM.partners.splice(i,1);
  document.getElementById('partTags').innerHTML=partnerTags(); saveDraft(); }
function partnerTags(){
  return FORM.partners.map(function(p,i){
    return '<span class="tag-item">'+esc(p)+'<span class="x" onclick="rmPartner('+i+')">×</span></span>';
  }).join('');
}

/* صور: ضغط ومعاينة */
function onPhotos(input){
  var files=Array.prototype.slice.call(input.files);
  Promise.all(files.map(function(file){
    return compressImage(file).then(function(data){
      FORM.photos.push({ name:file.name, mime:'image/jpeg', data:data });
    });
  })).then(function(){
    input.value=''; document.getElementById('photoGrid').innerHTML=photoGridHtml();
  });
}
function compressImage(file){
  return new Promise(function(res){
    var img=new Image(), rd=new FileReader();
    rd.onload=function(e){ img.onload=function(){
      var max=1600, w=img.width, h=img.height;
      if(w>max||h>max){ if(w>h){ h=Math.round(h*max/w); w=max; } else { w=Math.round(w*max/h); h=max; } }
      var c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      res(c.toDataURL('image/jpeg',0.8).split(',')[1]);
    }; img.src=e.target.result; };
    rd.readAsDataURL(file);
  });
}
function photoGridHtml(){
  var html='';
  (FORM.existing_photo_ids||[]).forEach(function(id,i){
    html+='<div class="photo-thumb"><img loading="lazy" src="https://drive.google.com/thumbnail?id='+id+'&sz=w200">'+
      '<button class="rm" onclick="rmExisting('+i+')">×</button></div>';
  });
  (FORM.photos||[]).forEach(function(p,i){
    html+='<div class="photo-thumb"><img loading="lazy" src="data:image/jpeg;base64,'+p.data+'">'+
      '<button class="rm" onclick="rmNewPhoto('+i+')">×</button></div>';
  });
  return html;
}
function rmNewPhoto(i){ FORM.photos.splice(i,1); document.getElementById('photoGrid').innerHTML=photoGridHtml(); }
function rmExisting(i){ FORM.existing_photo_ids.splice(i,1); document.getElementById('photoGrid').innerHTML=photoGridHtml(); }

/* ====================== autosave (مع debounce) ====================== */
var _draftT;
function attachAutosave(){
  ['f_type_custom','f_world','f_title','f_obj','f_date','f_loc','f_ben','f_notes'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.addEventListener('input',saveDraft);
  });
}
function collectForm(){
  FORM.type=val('f_type'); FORM.type_custom=FORM.type==='أخرى'?val('f_type_custom'):'';
  FORM.world_day=val('f_world');
  FORM.title=FORM.type==='يوم عالمي' ? FORM.world_day : val('f_title');
  FORM.objective=val('f_obj'); FORM.event_date=val('f_date'); FORM.location=val('f_loc');
  FORM.mechanisms=FORM.mechanisms||[];
  FORM.mechanism=FORM.mechanisms.join(' ، ');
  FORM.beneficiaries=val('f_ben'); FORM.notes=val('f_notes');
  if(USER.role==='admin'){
    var es=document.getElementById('f_exec');
    if(es){ FORM.executor_no=es.value; FORM.executor_name=es.options[es.selectedIndex].text.replace(/\s*\(.+\)$/,''); }
  } else {
    FORM.executor_no=USER.no; FORM.executor_name=USER.name;
  }
}
function saveDraft(){
  collectForm(); if(FORM.id) return;
  clearTimeout(_draftT); _draftT=setTimeout(writeDraft,400);
}
function draftKey(){ return DRAFT_KEY + '_' + (USER ? USER.no : 'guest'); }
function writeDraft(){
  var d=Object.assign({},FORM); delete d.photos;
  try{ localStorage.setItem(draftKey(), JSON.stringify(d));
    var n=document.getElementById('autosaveNote'); if(n) n.textContent='حُفظت مسودة تلقائيًا · '+nowTime(); }catch(e){}
}
function restoreDraft(){
  try{
    localStorage.removeItem(DRAFT_KEY); // مفتاح قديم قبل فصل المسودات حسب المستخدم
    var s=localStorage.getItem(draftKey());
    return s?JSON.parse(s):null;
  }catch(e){ return null; }
}
function clearDraft(){ try{ localStorage.removeItem(draftKey()); localStorage.removeItem(DRAFT_KEY); }catch(e){} }

/* ====================== حفظ (محلي أولًا ثم الخادم) ====================== */
function submitForm(){
  if(SUBMITTING) return;
  collectForm();
  var miss=missingFormFields();
  if(miss.length){ showValidationErrors(miss); return; }
  clearValidationErrors();

  var isEdit=!!FORM.id && !FORM._new_unsaved;
  if(!FORM.id){ FORM.id=makeId('ACT'); FORM._new_unsaved=true; }
  FORM.client_request_id=FORM.client_request_id||makeId('REQ');
  var photoCount=(FORM.photos||[]).length+(FORM.existing_photo_ids||[]).length;
  var payload=Object.assign({},FORM);
  payload._actor_no=USER.no;
  payload._was_edit=isEdit;
  payload._upload_title=FORM.title||'';
  payload._upload_photos=photoCount;
  var okMsg=isEdit?'تم حفظ التعديل بنجاح.':'تم حفظ الفعالية بنجاح.';
  var btn=document.getElementById('saveBtn');
  SUBMITTING=true;
  btn.disabled=true; btn.textContent='جارٍ الحفظ…';

  if(Outbox.available && !isEdit){
    if(Outbox.setActive) Outbox.setActive(payload,true);
    Outbox.add(payload).then(function(localId){
      clearDraft(); updatePending();
      rememberSavedPeriod(payload);
      onSavedLocal({ silent:true }, isEdit);
      run('saveActivity', payload, USER.no).then(function(r){
        if(r && r.ok){
          Outbox.remove(localId).then(function(){
            if(Outbox.setActive) Outbox.setActive(payload,false);
            invalidateCaches(); updatePending();
            if(document.getElementById('recList')) loadRecords(true);
          });
        }
        else {
          if(Outbox.setActive) Outbox.setActive(payload,false);
          updatePending();
        }
      }).catch(function(){
        if(Outbox.setActive) Outbox.setActive(payload,false);
        updatePending();
      });
    }).catch(function(){
      if(Outbox.setActive) Outbox.setActive(payload,false);
      directSave(payload,btn,okMsg);
    });
  } else {
    directSave(payload,btn,okMsg);
  }
}
function missingFormFields(){
  var miss=[];
  function add(key,id){ miss.push({ key:key, id:id, label:fieldLabel(key) }); }
  function has(v){ return String(v==null?'':v).trim()!==''; }
  if(!has(FORM.type)) add('type','f_type');
  if(FORM.type==='أخرى' && !has(FORM.type_custom)) add('type_custom','f_type_custom');
  if(FORM.type==='يوم عالمي'){
    if(!has(FORM.world_day)) add('world_day','f_world');
  } else if(!has(FORM.title)) {
    add('title','f_title');
  }
  if(isRequiredField('objective') && !has(FORM.objective)) add('objective','f_obj');
  if(!has(FORM.event_date)) add('event_date','f_date');
  if(!has(FORM.executor_no)) add('executor_no', USER.role==='admin'?'f_exec':'whoName');
  if(isRequiredField('location') && !has(FORM.location)) add('location','f_loc');
  if(isRequiredField('beneficiaries') && !has(FORM.beneficiaries)) add('beneficiaries','f_ben');
  if(isRequiredField('mechanism') && !(FORM.mechanisms||[]).length) add('mechanism','mechChoices');
  if(isRequiredField('target_groups') && !(FORM.target_groups||[]).length) add('target_groups','chips');
  if(isRequiredField('partners') && FORM.has_partnership && !(FORM.partners||[]).length) add('partners','partInput');
  if(isRequiredField('photos') && ((FORM.photos||[]).length+(FORM.existing_photo_ids||[]).length)===0) add('photos','f_photos');
  if(isRequiredField('notes') && !has(FORM.notes)) add('notes','f_notes');
  return miss;
}
function clearValidationErrors(){
  document.querySelectorAll('.invalid').forEach(function(e){ e.classList.remove('invalid'); });
  var p=document.getElementById('validationPanel');
  if(p){ p.classList.add('hidden'); p.innerHTML=''; }
}
function showValidationErrors(miss){
  clearValidationErrors();
  miss.forEach(function(m){
    var e=document.getElementById(m.id);
    if(e) e.classList.add('invalid');
  });
  var p=document.getElementById('validationPanel');
  if(p){
    p.innerHTML='<b>أكمل الحقول التالية</b><ul>'+miss.map(function(m){
      return '<li>'+esc(m.label)+'</li>';
    }).join('')+'</ul>';
    p.classList.remove('hidden');
  }
  var first=document.getElementById(miss[0].id);
  if(first){
    first.scrollIntoView({ behavior:'smooth', block:'center' });
    if(typeof first.focus==='function') setTimeout(function(){ first.focus(); }, 350);
  }
  toast('حقول ناقصة: '+miss.map(function(m){ return m.label; }).join('، '),'err');
}
function directSave(payload,btn,okMsg){
  var wasEdit = (payload && payload._was_edit);
  var fallbackLabel=wasEdit?'حفظ التعديلات':'حفظ الفعالية';
  run('saveActivity',payload,USER.no).then(function(r){
    if(r&&r.ok){ clearDraft(); onSaved(okMsg||'تم الحفظ بنجاح.', wasEdit); }
    else { SUBMITTING=false; btn.disabled=false; btn.textContent=fallbackLabel; toast((r&&r.msg)||'تعذّر الحفظ.','err'); }
  }).catch(function(){
    SUBMITTING=false;
    btn.disabled=false; btn.textContent=fallbackLabel;
    toast('انقطع الاتصال. بياناتك محفوظة كمسودة، أعد المحاولة.','err');
  });
}
function rememberSavedPeriod(payload){ PENDING_RECORD_FILTER=filterFromDate(payload && payload.event_date); }
function onSaved(msg, wasEdit){ SUBMITTING=false; if(FORM) FORM._new_unsaved=false; rememberSavedPeriod(FORM); invalidateCaches(); updatePending(); if(!wasEdit) updateBellAndBadges(1); toast(msg,'ok'); show('records'); }
function onSavedLocal(options, wasEdit){ invalidateCaches(); updatePending();
  SUBMITTING=false;
  if(!wasEdit) updateBellAndBadges(1);
  show('records');
  if(typeof options==='string') options={ message:options };
  if(options && options.silent) return;
  toast((options && options.message)||'تم الحفظ محليًا','warn','جارٍ رفع الصور والبيانات عند توفر الاتصال.');
}

function resetForm(){
  confirmModal('تفريغ النموذج','سيُمسح ما أدخلته في هذا النموذج. متابعة؟',function(){
    clearDraft(); FORM=newForm(); renderForm(true); toast('تم تفريغ النموذج.');
  });
}

/* ====================== السجل ====================== */
function renderRecords(){
  document.getElementById('view').innerHTML=
    '<div class="card">'+
    '<h2>سجل البرامج والمبادرات الصحية</h2>'+
    '<p class="sub">'+(USER.role==='admin'?'جميع البرامج والمبادرات المسجلة.':'برامجك ومبادراتك المسجلة.')+'</p>'+
    periodControlsHtml('fl')+
    '<div class="filters action-filters">'+
      '<div class="field" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="loadRecords(true)">تحديث</button></div>'+
      '<div class="field" style="justify-content:flex-end"><button class="btn btn-excel btn-sm" id="excelBtn" onclick="exportExcel()" onpointerenter="Warmup.intent(\'export\')" ontouchstart="Warmup.intent(\'export\')">تصدير Excel</button></div>'+
      '<div class="field" style="justify-content:flex-end"><button class="btn btn-pdf btn-sm" id="periodPdfBtn" onclick="exportPeriodPdf()" onpointerenter="Warmup.intent(\'export\')" ontouchstart="Warmup.intent(\'export\')">تصدير PDF</button></div>'+
    '</div>'+
    '<div id="recList"><div class="loading"><span class="spin"></span> جارٍ التحميل…</div></div>'+
  '</div>';
  var initial=PENDING_RECORD_FILTER;
  PENDING_RECORD_FILTER=null;
  initPeriodControls('fl', initial);
  loadRecords();
}
function loadRecords(force){
  var filter=periodFilter('fl');
  var key=filterKey(filter);
  if(REC_CACHE[key]){
    paintRecords(REC_CACHE[key]);
    updatePeriodCountChip('fl', REC_CACHE[key]);
    Warmup.records(filter);
    if(!force) return;
  } else {
    document.getElementById('recList').innerHTML='<div class="loading"><span class="spin"></span> جارٍ التحميل…</div>';
  }
  fetchRecordsForFilter(filter, !!force).then(function(merged){
    paintRecords(merged);
    updatePeriodCountChip('fl', merged);
    Warmup.records(filter);
  }).catch(function(e){
    var box=document.getElementById('recList');
    if(box) box.innerHTML='<div class="empty">تعذّر تحميل السجل: '+esc((e&&e.message)||'خطأ غير معروف')+'<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadRecords(true)">إعادة المحاولة</button></div>';
  });
}
function mergePendingRecords(list, filter){
  list=list||[];
  if(!window.Outbox || !Outbox.available || !Outbox.all) return Promise.resolve(list);
  return Outbox.all().then(function(items){
    var seen={};
    list.forEach(function(o){ seen[o.id]=true; });
    var pending=items.map(function(it){ return pendingRecordFromPayload(it.payload); })
      .filter(function(o){ return o && !seen[o.id] && recordMatchesFilter(o, filter); });
    pending.sort(function(a,b){ return String(b.event_date).localeCompare(String(a.event_date)); });
    return pending.concat(list);
  }).catch(function(){ return list; });
}
function pendingRecordFromPayload(p){
  if(!p) return null;
  var parts=dateParts(p.event_date);
  var month=parts&&parts.month;
  var photoCount=(p.photos&&p.photos.length?p.photos.length:0)+(p.existing_photo_ids&&p.existing_photo_ids.length?p.existing_photo_ids.length:0);
  return {
    id:p.id||p.client_request_id,
    type:p.type, type_custom:p.type_custom||'', display_type:p.type==='أخرى'?(p.type_custom||p.type):p.type,
    world_day:p.world_day||'', title:p.type==='يوم عالمي'?(p.world_day||p.title):p.title,
    objective:p.objective||'', target_groups:(p.target_groups||[]).join?p.target_groups.join(' ، '):(p.target_groups||''),
    event_date:displayDate(p.event_date), month_name:month?AR_MONTHS_UI[month-1]:'',
    quarter:month?('الربع '+['الأول','الثاني','الثالث','الرابع'][Math.floor((month-1)/3)]):'',
    executor_no:p.executor_no||USER.no, executor_name:p.executor_name||USER.name, location:p.location||'',
    mechanism:p.mechanism||((p.mechanisms||[]).join?p.mechanisms.join(' ، '):''), beneficiaries:p.beneficiaries||'',
    has_partnership:p.has_partnership, partners:(p.partners||[]).join?p.partners.join(' ، '):(p.partners||''),
    notes:p.notes||'', photo_ids:(p.existing_photo_ids||[]).slice(), photo_folder_id:p.photo_folder_id||'',
    status:'محفوظ محليًا',
    pending_photos_count:photoCount, local_thumb:(p.photos&&p.photos[0]&&p.photos[0].data)?p.photos[0].data:'',
    local_photos:(p.photos||[]).map(function(x){ return x.data; }), _pending:true
  };
}
function paintRecords(list){
  var box=document.getElementById('recList');
  if(!list.length){ box.innerHTML='<div class="empty">لا توجد فعاليات مسجّلة بعد.</div>'; return; }
  window._recs={};
  box.innerHTML=list.map(function(o){
    window._recs[o.id]=o;
    var typeLabel=o.display_type||o.type;
    var firstId=(o.photo_ids&&o.photo_ids.length)?o.photo_ids[0]:'';
    var isPending=o._pending||o.status==='جارٍ رفع الصور';
    var photoCount=o._pending?(o.pending_photos_count||0):(o.photo_ids?o.photo_ids.length:0);
    var thumb=o.local_thumb
      ? '<div class="rec-thumb" onclick="viewActivity(\''+o.id+'\')"><img loading="lazy" src="data:image/jpeg;base64,'+o.local_thumb+'">'+
        (photoCount>1?'<span class="rec-thumb-count">'+photoCount+'</span>':'')+'</div>'
      : firstId
      ? '<div class="rec-thumb" onclick="viewActivity(\''+o.id+'\')"><img loading="lazy" src="https://drive.google.com/thumbnail?id='+firstId+'&sz=w200">'+
        (photoCount>1?'<span class="rec-thumb-count">'+photoCount+'</span>':'')+'</div>'
      : '<div class="rec-thumb rec-thumb-empty" onclick="viewActivity(\''+o.id+'\')"><span>لا صور</span></div>';
    return '<div class="rec" id="rec_'+escAttr(o.id)+'">'+
      thumb+
      '<div class="meta">'+
        '<div class="ttl" onclick="viewActivity(\''+o.id+'\')">'+esc(o.title)+'</div>'+
        (isPending&&photoCount?'<div class="sync-note"><span class="sync-dot"></span><span>جارٍ رفع '+photoCount+' صورة</span></div>':'')+
        '<div class="row2">'+
          '<span class="badge">'+esc(typeLabel)+'</span>'+
          (isPending?'<span class="badge pending-badge">جارٍ الرفع</span>':'')+
          ((o.has_partnership===true||o.has_partnership==='true')?'<span class="badge part">شراكة</span>':'')+
        '</div>'+
        '<div class="rec-facts">'+
          '<span class="fact"><i>التاريخ</i>'+esc(o.event_date)+'</span>'+
          (USER.role==='admin'?'<span class="fact"><i>المنفّذة</i>'+esc(o.executor_name)+'</span>':'')+
          (o.beneficiaries?'<span class="fact"><i>المستفيدون</i>'+esc(o.beneficiaries)+'</span>':'')+
          (photoCount?'<span class="fact"><i>الصور</i>'+photoCount+'</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="ops record-actions" aria-label="إجراءات الفعالية">'+
        '<button class="btn btn-icon-command btn-view" title="عرض" aria-label="عرض '+escAttr(o.title)+'" onclick="viewActivity(\''+o.id+'\')"><span class="ico" aria-hidden="true">👁</span></button>'+
        (isPending?'':'<button class="btn btn-icon-command btn-edit" title="تعديل" aria-label="تعديل '+escAttr(o.title)+'" onclick="editActivity(\''+o.id+'\')"><span class="ico" aria-hidden="true">✎</span></button>')+
        (isPending?'':'<button class="btn btn-icon-command btn-print" title="طباعة" aria-label="طباعة '+escAttr(o.title)+'" id="pdfBtn_'+escAttr(o.id)+'" onclick="prepareExportPdf(\''+o.id+'\')"><span class="ico" aria-hidden="true">⎙</span></button>')+
        (isPending?'':'<button class="btn btn-icon-command btn-danger-text" title="حذف" id="delBtn_'+escAttr(o.id)+'" aria-label="حذف '+escAttr(o.title)+'" onclick="askDelete(\''+o.id+'\')"><span class="ico" aria-hidden="true">⌫</span></button>')+
      '</div></div>';
  }).join('');
}

function viewActivity(id){
  var o=window._recs[id]; if(!o) return;
  var localPhotos=(o.local_photos||[]).map(function(data,i){
    return '<button class="photo-thumb photo-open" onclick="openLocalPhotoViewer(window._recs[\''+id+'\'].local_photos,'+i+',\''+escAttr(o.title)+'\')">'+
      '<img loading="lazy" src="data:image/jpeg;base64,'+data+'"></button>';
  }).join('');
  var photos=localPhotos+(o.photo_ids||[]).map(function(pid){
    var i=(o.photo_ids||[]).indexOf(pid);
    return '<button class="photo-thumb photo-open" onclick="openPhotoViewer(window._recs[\''+id+'\'].photo_ids,'+i+',\''+escAttr(o.title)+'\')">'+
      '<img loading="lazy" src="https://drive.google.com/thumbnail?id='+pid+'&sz=w200"></button>';
  }).join('');
  var typeLabel=o.display_type||o.type;
  var titleLabel=o.type==='يوم عالمي'?'اسم اليوم العالمي':'العنوان';
  var body=
    dl('النوع', typeLabel)+
    dl(titleLabel, o.title)+ dl('الهدف', o.objective)+ dl('الفئة المستهدفة', o.target_groups)+
    dl('تاريخ التنفيذ', o.event_date+' · '+o.month_name+' · '+o.quarter)+
    dl('المكان', o.location)+ dl('آلية التنفيذ', o.mechanism)+
    dl('عدد المستفيدين', o.beneficiaries)+ dl('المنفّذة', o.executor_name)+
    ((o.has_partnership===true||o.has_partnership==='true')?dl('الجهات المشاركة', o.partners):'')+
    (o._pending?dl('الحالة','تم الحفظ - جارٍ الرفع'):(o.status==='جارٍ رفع الصور'?dl('الحالة','جارٍ رفع الصور'):''))+
    (o.notes?dl('ملاحظات', o.notes):'')+
    (photos?'<div style="margin-top:14px"><label>الصور</label><div class="photo-grid">'+photos+'</div></div>':'');
  openModal(o.title, body,
    '<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>'+
    '<button class="btn btn-primary" onclick="closeModal();editActivity(\''+id+'\')">تعديل</button>');
}
function openLocalPhotoViewer(images,index,title){
  PHOTO_VIEW={ ids:(images||[]).slice(), index:index||0, title:title||'الصور', local:true };
  paintPhotoViewer();
}
function openPhotoViewer(ids,index,title){
  PHOTO_VIEW={ ids:(ids||[]).slice(), index:index||0, title:title||'الصور', local:false };
  paintPhotoViewer();
}
function movePhoto(step){
  if(!PHOTO_VIEW.ids.length) return;
  PHOTO_VIEW.index=(PHOTO_VIEW.index+step+PHOTO_VIEW.ids.length)%PHOTO_VIEW.ids.length;
  paintPhotoViewer();
}
function paintPhotoViewer(){
  var ids=PHOTO_VIEW.ids||[];
  var pid=ids[PHOTO_VIEW.index];
  if(!pid) return;
  var src=PHOTO_VIEW.local?('data:image/jpeg;base64,'+pid):('https://drive.google.com/thumbnail?id='+escAttr(pid)+'&sz=w1600');
  var body='<div class="photo-viewer">'+
    '<img src="'+src+'" alt="صورة الفعالية">'+
    '<div class="photo-count">'+(PHOTO_VIEW.index+1)+' / '+ids.length+'</div>'+
  '</div>';
  var nav=ids.length>1
    ? '<button class="btn btn-ghost" onclick="movePhoto(-1)">السابق</button><button class="btn btn-ghost" onclick="movePhoto(1)">التالي</button>'
    : '';
  openModal(PHOTO_VIEW.title||'الصور', body,
    '<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>'+
    nav+
    (PHOTO_VIEW.local?'':'<a class="btn btn-primary" target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+escAttr(pid)+'/view">فتح الأصل</a>'));
}
function editActivity(id){
  var o=window._recs[id]; if(!o) return;
  FORM=newForm();
  FORM.id=o.id; FORM.type=o.type; FORM.type_custom=o.type_custom||''; FORM.world_day=o.world_day; FORM.title=o.title;
  FORM.objective=o.objective; FORM.event_date=isoDate(o.event_date);
  FORM.target_groups=o.target_groups?String(o.target_groups).split(' ، '):[];
  FORM.location=o.location; FORM.mechanism=o.mechanism; FORM.mechanisms=splitList(o.mechanism); FORM.beneficiaries=o.beneficiaries;
  FORM.has_partnership=(o.has_partnership===true||o.has_partnership==='true');
  FORM.partners=o.partners?String(o.partners).split(' ، '):[];
  FORM.existing_photo_ids=(o.photo_ids||[]).slice();
  FORM.photo_folder_id=o.photo_folder_id; FORM.notes=o.notes;
  FORM.executor_no=USER.role==='admin'?(o.executor_no||USER.no):USER.no;
  FORM.executor_name=o.executor_name;
  setActiveTab('register'); renderForm(true);
}
function askDelete(id){
  var o=window._recs[id];
  confirmModal('حذف الفعالية','سيُحذف سجل «'+esc(o.title)+'» نهائيًا. هل أنت متأكد؟',function(){
    var btn = document.getElementById('delBtn_'+id);
    if(btn) setBusy(btn, 'جارٍ الحذف…');
    run('deleteActivity',id,USER.no).then(function(r){
      if(r.ok){ 
        invalidateCaches(); 
        toast('تم الحذف','ok','أزيلت الفعالية من السجل.');
        var card = document.getElementById('rec_'+id);
        if(card){
          card.style.transition = 'all 0.3s ease';
          card.style.opacity = '0';
          card.style.transform = 'translateX(-50px)';
          setTimeout(function(){
            card.style.height = card.offsetHeight + 'px';
            card.style.overflow = 'hidden';
            setTimeout(function() {
              card.style.height = '0px';
              card.style.marginTop = '0px';
              card.style.marginBottom = '0px';
              card.style.paddingTop = '0px';
              card.style.paddingBottom = '0px';
              card.style.border = 'none';
            }, 10);
          }, 300);
          setTimeout(function(){ 
            card.remove(); 
            if(document.querySelectorAll('.rec').length===0){
              var box=document.getElementById('recList');
              if(box) box.innerHTML='<div class="empty">لا توجد فعاليات مسجّلة.</div>';
            }
          }, 600);
        } else {
          loadRecords(true);
        }
      }
      else {
        if(btn) restoreBusy(btn);
        toast('لم يكتمل الحذف','err','لم تتغير البيانات. أعد المحاولة.');
      }
    });
  }, true);
}

function issueFieldId(code){
  var map={
    type:'f_type', type_custom:'f_type_custom', title:'f_title',
    world_day:'f_world', event_date:'f_date',
    executor_no:USER&&USER.role==='admin'?'f_exec':'whoName',
    objective:'f_obj', location:'f_loc', beneficiaries:'f_ben',
    mechanism:'mechChoices', target_groups:'chips', partners:'partInput',
    photos:'f_photos', notes:'f_notes'
  };
  return map[code]||'saveBtn';
}
function issuesToMissing(issueCodes){
  return (issueCodes||[]).map(function(code){
    return { key:code, id:issueFieldId(code), label:fieldLabel(code) };
  });
}
function editActivityWithIssues(id, issueCodes){
  PENDING_FORM_MISSING = issuesToMissing(issueCodes);
  closeModal();
  editActivity(id);
}
function applyPendingMissingFields(){
  if(!PENDING_FORM_MISSING || !PENDING_FORM_MISSING.length) return;
  var miss=PENDING_FORM_MISSING.slice();
  PENDING_FORM_MISSING=null;
  setTimeout(function(){ showValidationErrors(miss); }, 80);
}

function readinessIssueListHtml(items, emptyText){
  items = items || [];
  if(!items.length) return '<div class="hint">'+esc(emptyText||'لا توجد ملاحظات.')+'</div>';
  return '<ul class="readiness-list">'+items.map(function(issue){
    return '<li class="readiness-item '+escAttr(issue.severity||'blocking')+'">'+
      '<b>'+esc(issue.label||issue.code||'تنبيه')+'</b>'+
      '<span>'+esc(issue.detail||'راجع بيانات الفعالية قبل التصدير.')+'</span>'+
    '</li>';
  }).join('')+'</ul>';
}

function readinessSummaryHtml(readiness){
  readiness = readiness || {};
  if(readiness.items && readiness.items.length){
    return '<div class="readiness-records">'+readiness.items.map(function(item){
      var issues=(item.blocking||[]).concat(item.warnings||[]);
      var codes=(item.blocking||[]).map(function(issue){ return issue.code; }).filter(Boolean);
      var canEdit=item.id && codes.length;
      return '<div class="readiness-record">'+
        '<b>'+esc(item.title||item.id||'فعالية')+'</b>'+
        '<span>'+esc(item.event_date||'')+'</span>'+
        readinessIssueListHtml(issues, '')+
        (canEdit?'<button class="btn btn-ghost btn-sm" onclick="editActivityWithIssues(\''+escAttr(item.id)+'\', '+escAttr(JSON.stringify(codes))+')">تعديل البيانات</button>':'')+
      '</div>';
    }).join('')+
    (readiness.truncated?'<div class="hint">تم عرض أول 30 فعالية تحتاج مراجعة.</div>':'')+
    '</div>';
  }
  return readinessIssueListHtml((readiness.blocking||[]).concat(readiness.warnings||[]), 'البيانات جاهزة للتصدير.');
}

function showReadinessModal(title, readiness, onProceed){
  readiness = readiness || {};
  var hasBlocking = (readiness.blocking && readiness.blocking.length) || readiness.blockingCount > 0;
  var hasWarnings = (readiness.warnings && readiness.warnings.length) || readiness.warningCount > 0;
  var intro = hasBlocking
    ? 'هناك بيانات ناقصة'
    : 'توجد ملاحظات غير مانعة. يمكنك المتابعة إذا كانت مقبولة.';
  var body = '<p class="readiness-intro">'+esc(intro)+'</p>'+readinessSummaryHtml(readiness);
  var footer = '<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>';
  if(hasBlocking && readiness.recordId){
    var codes=(readiness.blocking||[]).map(function(issue){ return issue.code; }).filter(Boolean);
    footer += '<button class="btn btn-primary" onclick="editActivityWithIssues(\''+escAttr(readiness.recordId)+'\', '+escAttr(JSON.stringify(codes))+')">تعديل البيانات</button>';
  }
  if(!hasBlocking && hasWarnings){
    window._readinessProceed = function(){ closeModal(); onProceed(); };
    footer += '<button class="btn btn-primary" onclick="window._readinessProceed()">تصدير رغم الملاحظات</button>';
  }
  openModal(title, body, footer);
}

function shouldProceedAfterReadiness(readiness, onProceed, title){
  readiness = readiness || {};
  var hasBlocking = (readiness.blocking && readiness.blocking.length) || readiness.blockingCount > 0;
  var hasWarnings = (readiness.warnings && readiness.warnings.length) || readiness.warningCount > 0;
  if(hasBlocking || hasWarnings){
    showReadinessModal(title, readiness, onProceed);
    return false;
  }
  return true;
}

function prepareExportPdf(id){
  var o=window._recs[id]; if(!o) return;
  var btn=document.getElementById('pdfBtn_'+id);
  setBusy(btn, 'جارٍ فحص البيانات…');
  run('getActivityReportReadiness', id, USER.no).then(function(r){
    restoreBusy(btn);
    if(!r || !r.ok){ toast((r&&r.msg)||'تعذّر فحص جاهزية التقرير.','err'); return; }
    r.readiness.recordId = id;
    var proceed=function(){ exportPdfDirect(id); };
    if(shouldProceedAfterReadiness(r.readiness, proceed, 'جاهزية تقرير PDF')) return proceed();
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر فحص جاهزية التقرير.','err');
  });
}

function exportPdfDirect(id){
  var btn=document.getElementById('pdfBtn_'+id);
  setBusy(btn, 'جارٍ إنشاء PDF…');
  run('exportActivityPdfDownload', id, USER.no).then(function(r){
    restoreBusy(btn);
    if(r&&r.ok) handleDownloadResponse(r, 'PDF');
    else toast((r&&r.msg)||'تعذّر إنشاء PDF.','err');
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر إنشاء PDF.','err');
  });
}

function exportExcel(){
  var btn=document.getElementById('excelBtn');
  var filter=periodFilter('fl');
  setBusy(btn, 'جارٍ فحص البيانات…');
  run('getPeriodReportReadiness', filter, USER.no).then(function(r){
    restoreBusy(btn);
    if(!r || !r.ok){ toast((r&&r.msg)||'تعذّر فحص جاهزية التصدير.','err'); return; }
    var proceed=function(){ exportExcelDirect(filter); };
    if(shouldProceedAfterReadiness(r.readiness, proceed, 'جاهزية تصدير Excel')) return proceed();
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر فحص جاهزية التصدير.','err');
  });
}

function exportExcelDirect(filter){
  var btn=document.getElementById('excelBtn');
  setBusy(btn, 'جارٍ تجهيز الملف…');
  run('exportActivitiesExcelDownload', filter || periodFilter('fl'), USER.no).then(function(r){
    restoreBusy(btn);
    if(r&&r.ok) handleDownloadResponse(r, 'Excel');
    else toast((r&&r.msg)||'تعذّر إنشاء Excel.','err');
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر إنشاء Excel.','err');
  });
}

function exportPeriodPdf(){
  var btn=document.getElementById('periodPdfBtn');
  var filter=periodFilter('fl');
  setBusy(btn, 'جارٍ فحص البيانات…');
  run('getPeriodReportReadiness', filter, USER.no).then(function(r){
    restoreBusy(btn);
    if(!r || !r.ok){ toast((r&&r.msg)||'تعذّر فحص جاهزية التصدير.','err'); return; }
    var proceed=function(){ exportPeriodPdfDirect(filter); };
    if(shouldProceedAfterReadiness(r.readiness, proceed, 'جاهزية تصدير PDF')) return proceed();
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر فحص جاهزية التصدير.','err');
  });
}

function exportPeriodPdfDirect(filter){
  var btn=document.getElementById('periodPdfBtn');
  setBusy(btn, 'جارٍ إنشاء PDF…');
  run('exportActivitiesPdfDownload', filter || periodFilter('fl'), USER.no).then(function(r){
    restoreBusy(btn);
    if(r&&r.ok) handleDownloadResponse(r, 'PDF');
    else toast((r&&r.msg)||'تعذّر إنشاء PDF.','err');
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر إنشاء PDF.','err');
  });
}
function setBusy(btn, text){
  if(!btn) return;
  if(!btn.getAttribute('data-original-text')) btn.setAttribute('data-original-text', btn.textContent);
  btn.disabled=true;
  btn.innerHTML='<span class="spin tiny"></span>'+esc(text||'جارٍ التجهيز…');
}
function restoreBusy(btn){
  if(!btn) return;
  btn.disabled=false;
  btn.textContent=btn.getAttribute('data-original-text')||btn.textContent;
  btn.removeAttribute('data-original-text');
}
function handleDownloadResponse(r, label){
  if(r.delivery==='inline' && r.base64){
    var blob=base64ToBlob(r.base64, r.mime||'application/octet-stream');
    triggerBlobDownload(blob, r.fileName||r.name||('athar-'+String(label||'file').toLowerCase()));
    showInlineDownloadFallback(blob, r.fileName||r.name||('athar-'+String(label||'file').toLowerCase()), label);
    return;
  }
  var url=r.downloadUrl||r.url;
  if(url){
    triggerDownload(url, r.fileName||r.name||'athar-report');
    showDownloadFallback(r, label);
    return;
  }
  toast('تعذّر تجهيز رابط التحميل.','err');
}
function showDownloadFallback(r, label){
  var url=r.downloadUrl||r.url;
  var reason=r.reason==='count'?'عدد الملفات كبير، لذلك سيتم التحميل عبر الرابط الاحتياطي.':'الملف كبير، لذلك سيتم التحميل عبر الرابط الاحتياطي.';
  var meta=[];
  if(r.period) meta.push('الفترة: '+r.period);
  if(r.count!=null) meta.push('عدد البرامج: '+r.count);
  openModal('تحميل '+esc(label||'الملف'),
    '<p style="margin:0 0 10px">'+esc(reason)+'</p>'+
    (meta.length?'<div class="hint">'+esc(meta.join(' · '))+'</div>':''),
    '<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>'+
    '<a class="btn btn-primary" target="_blank" rel="noopener" href="'+escAttr(url)+'">تحميل الملف</a>');
}
function showInlineDownloadFallback(blob, name, label){
  var url=URL.createObjectURL(blob);
  var safeName=name||('athar-'+String(label||'file').toLowerCase());
  openModal('تحميل '+esc(label||'الملف'),
    '<p style="margin:0 0 10px">إذا لم يبدأ التحميل تلقائيًا، استخدم زر التحميل اليدوي.</p>',
    '<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>'+
    '<a class="btn btn-primary" download="'+escAttr(safeName)+'" href="'+escAttr(url)+'">تحميل الملف</a>');
  setTimeout(function(){ URL.revokeObjectURL(url); }, 120000);
}
function base64ToBlob(base64, mime){
  var bin=atob(base64), len=bin.length, chunks=[];
  for(var i=0;i<len;i+=8192){
    var slice=bin.slice(i,i+8192), arr=new Uint8Array(slice.length);
    for(var j=0;j<slice.length;j++) arr[j]=slice.charCodeAt(j);
    chunks.push(arr);
  }
  return new Blob(chunks, { type:mime||'application/octet-stream' });
}
function triggerBlobDownload(blob,name){
  var url=URL.createObjectURL(blob);
  triggerDownload(url,name);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 30000);
}
function triggerDownload(url,name){
  if(!url) return;
  try{
    var a=document.createElement('a');
    a.href=url; a.download=name||''; a.rel='noopener';
    if(!String(url).match(/^blob:/)) a.target='_blank';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); }, 100);
  }catch(e){}
}

/* ====================== لوحة المؤشرات ====================== */
function renderDashboard(){
  document.getElementById('view').innerHTML=
    '<div class="card">'+
      '<h2>المؤشرات العامة</h2>'+
      '<p class="sub">'+(USER.role==='admin'?'ملخّص الفعاليات حسب الفترة المختارة.':'ملخّص فعالياتك حسب الفترة المختارة.')+'</p>'+
      periodControlsHtml('dash')+
      '<div class="filters action-filters"><div class="field" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="loadDashboard(true)">تحديث</button></div></div>'+
      '<div id="dashBody"><div class="loading"><span class="spin"></span> جارٍ حساب المؤشرات…</div></div>'+
    '</div>';
  initPeriodControls('dash', { mode: 'all' });
  loadDashboard();
}
function loadDashboard(force){
  var filter=periodFilter('dash');
  var key=filterKey(filter);
  var body=document.getElementById('dashBody');
  if(DASH_CACHE[key]){
    paintDash(DASH_CACHE[key]);
    Warmup.dashboard(filter);
    if(!force) return;
  } else if(body) {
    body.innerHTML='<div class="loading"><span class="spin"></span> جارٍ حساب المؤشرات…</div>';
  }
  fetchDashboardForFilter(filter, !!force).then(function(d){
    paintDash(d);
    Warmup.dashboard(filter);
  }).catch(function(e){
    var v=document.getElementById('dashBody');
    if(v) v.innerHTML='<div class="empty">تعذّر تحميل المؤشرات: '+esc((e&&e.message)||'خطأ غير معروف')+'<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadDashboard(true)">إعادة المحاولة</button></div>';
  });
}
function paintDash(d){
  d = d || {};
  d.byType = d.byType || {}; d.byMechanism = d.byMechanism || {};
  d.byMonth = d.byMonth || {}; d.byHalf = d.byHalf || {};
  d.byQuarter = d.byQuarter || {}; d.byExecutor = d.byExecutor || {};
  var filter = typeof periodFilter==='function' ? periodFilter('dash') : {};
  var mode = filter.mode || 'all';
  var host=document.getElementById('dashBody')||document.getElementById('view');
  var html =
    '<div class="kpis">'+
      kpi(d.total,'إجمالي الفعاليات')+ kpi(d.beneficiaries,'إجمالي المستفيدين')+
      kpi(d.partnerships,'فعاليات بشراكات')+ kpi(Object.keys(d.byType).length,'أنواع مختلفة')+
    '</div>'+
    dashBlock('التوزيع حسب النوع', d.byType, 'type', '', 'grid')+
    dashBlock('التوزيع حسب آلية التنفيذ', d.byMechanism, 'mechanism', '', 'grid');
    
  if (mode === 'all' || mode === 'year' || mode === 'half' || mode === 'quarter') {
    html += dashBlock('التوزيع حسب الشهر', d.byMonth, 'month', '', 'bars');
  }
  if (mode === 'all' || mode === 'year') {
    html += dashBlock('التوزيع حسب نصف السنة', d.byHalf, 'half', '', 'bars');
  }
  if (mode === 'all' || mode === 'year' || mode === 'half') {
    html += dashBlock('التوزيع حسب الربع', d.byQuarter, 'quarter', 'الربع الأول: يناير-مارس، الثاني: أبريل-يونيو، الثالث: يوليو-سبتمبر، الرابع: أكتوبر-ديسمبر. شهر يونيو يقع في الربع الثاني والنصف الأول.', 'bars');
  }

  if (USER.role === 'admin') {
    html += dashBlock('حسب المنفّذة', d.byExecutor, 'executor', '', 'bars');
  }
  
  if (d.auditLogs && d.auditLogs.length > 0) {
    var logsHtml = d.auditLogs.map(function(lg) {
      var dStr = new Date(lg.ts);
      var formattedTs = isNaN(dStr) ? lg.ts : (dStr.getFullYear()+'/'+(dStr.getMonth()+1)+'/'+dStr.getDate()+' '+('0'+dStr.getHours()).slice(-2)+':'+('0'+dStr.getMinutes()).slice(-2));
      var badgeCls = lg.action==='حذف' ? 'part' : (lg.action==='إضافة' ? 'pending-badge' : '');
      return '<div class="mini-rec" style="grid-template-columns:auto 120px 70px 1fr;gap:12px;">'+
        '<span class="hint" style="white-space:nowrap" dir="ltr">'+esc(formattedTs)+'</span>'+
        '<b class="truncate" title="'+esc(lg.empName)+'">'+esc(lg.empName)+'</b>'+
        '<span class="badge '+badgeCls+'" style="text-align:center">'+esc(lg.action)+'</span>'+
        '<span class="truncate" title="'+esc(lg.target)+'">'+esc(lg.target)+'</span>'+
      '</div>';
    }).join('');
    
    html += '<div class="section-divider"></div>'+
      '<div class="dash-head"><label>سجل أنشطة النظام (الحديثة)</label></div>'+
      '<div class="mini-records" style="max-height:300px;overflow-y:auto;padding:5px 0;">'+logsHtml+'</div>';
  }

  html += '<div id="dashDetails"></div>';
  host.innerHTML = html;
}
function kpi(n,l){ return '<div class="kpi"><div class="n">'+(n||0)+'</div><div class="l">'+l+'</div></div>'; }
function dashBlock(title,obj,dimension,hint, type){
  return '<div class="section-divider"></div><div class="dash-head"><label>'+title+'</label>'+
    (hint?'<span class="hint">'+hint+'</span>':'')+'</div>'+ 
    (type==='grid' ? gridBars(obj,dimension) : type==='vertical' ? verticalBars(obj,dimension) : bars(obj,dimension));
}
function gridBars(obj, dimension) {
  var keys=Object.keys(obj||{}); if(!keys.length) return '<div class="empty">لا بيانات.</div>';
  var max=Math.max.apply(null,keys.map(function(k){return obj[k];}));
  var colors = ['#2188ff', '#3fb950', '#a371f7', '#ff7b72', '#f2cc60', '#ffbdf0', '#d2a8ff'];
  return '<div class="grid-cards">'+keys.map(function(k, i){
    var pct=max?Math.round(obj[k]/max*100):0;
    var c = colors[i % colors.length];
    return '<button class="grid-card bar-click" onclick="showDashItems(\''+dimension+'\',decodeURIComponent(\''+encodeURIComponent(k)+'\'))">'+
      '<div class="gc-head"><span class="gc-lbl">'+esc(k)+'</span><span class="gc-v" style="color:'+c+'">'+obj[k]+'</span></div>'+
      '<div class="gc-track"><div class="gc-fill" style="width:'+pct+'%; background:'+c+'"></div></div>'+
    '</button>';
  }).join('')+'</div>';
}
function verticalBars(obj, dimension) {
  var keys=Object.keys(obj||{}); if(!keys.length) return '<div class="empty">لا بيانات.</div>';
  var max=Math.max.apply(null,keys.map(function(k){return obj[k];}));
  return '<div class="vertical-chart">'+keys.map(function(k){
    var pct=max?Math.round(obj[k]/max*100):0;
    return '<button class="v-bar-col bar-click" title="'+obj[k]+' فعالية في '+esc(k)+'" onclick="showDashItems(\''+dimension+'\',decodeURIComponent(\''+encodeURIComponent(k)+'\'))">'+
      '<span class="v-val" style="display:flex;flex-direction:column;align-items:center;"><span>'+obj[k]+'</span><span style="font-size:9px;font-weight:normal;opacity:0.8">فعالية</span></span>'+
      '<span class="v-track"><span class="v-fill" style="height:'+pct+'%"></span></span>'+
      '<span class="v-lbl">'+esc(k)+'</span>'+
    '</button>';
  }).join('')+'</div>';
}
function bars(obj,dimension){
  var keys=Object.keys(obj||{}); if(!keys.length) return '<div class="empty">لا بيانات.</div>';
  var max=Math.max.apply(null,keys.map(function(k){return obj[k];}));
  return '<div class="bars">'+keys.map(function(k){
    var pct=max?Math.round(obj[k]/max*100):0;
    return '<button class="bar-row bar-click" onclick="showDashItems(\''+dimension+'\',decodeURIComponent(\''+encodeURIComponent(k)+'\'))"><span class="lbl">'+esc(k)+'</span>'+
      '<span class="bar-track"><span class="bar-fill" style="width:'+pct+'%"></span></span>'+
      '<span class="v">'+obj[k]+'</span></button>';
  }).join('')+'</div>';
}
function showDashItems(dimension,key){
  var box=document.getElementById('dashDetails');
  if(!box) return;
  box.innerHTML='<div class="section-divider"></div><div class="loading"><span class="spin"></span> جارٍ جلب الأنشطة…</div>';
  run('getDashboardItems',USER.no,dimension,key,periodFilter('dash')).then(function(list){
    if(!list.length){
      box.innerHTML='<div class="section-divider"></div><div class="empty">لا توجد أنشطة لهذا الاختيار.</div>';
      return;
    }
    box.innerHTML='<div class="section-divider"></div><div class="dash-result-head">'+
      '<h3>الأنشطة المطابقة: '+esc(key)+'</h3>'+
      '<button class="btn btn-ghost btn-sm" onclick="clearDashItems()">مسح التصفية</button></div>'+
      '<div class="mini-records">'+list.map(miniRecord).join('')+'</div>';
  }).catch(function(e){
    box.innerHTML='<div class="section-divider"></div><div class="empty">'+esc((e&&e.message)||'تعذّر جلب الأنشطة.')+'</div>';
  });
}
function clearDashItems(){ var box=document.getElementById('dashDetails'); if(box) box.innerHTML=''; }
function miniRecord(o){
  var typeLabel=o.display_type||o.type;
  return '<div class="mini-rec"><b>'+esc(o.title)+'</b><span>'+esc(typeLabel||'')+'</span><span>'+esc(o.event_date||'')+'</span>'+
    (USER.role==='admin'?'<span>'+esc(o.executor_name||'')+'</span>':'')+'</div>';
}

/* ====================== الإدارة ====================== */
function renderAdmin(){
  document.getElementById('view').innerHTML=
  '<div class="card">'+
    '<h2>إدارة القوائم</h2>'+
    '<p class="sub">أي إضافة هنا تنعكس مباشرةً في نماذج التسجيل لكل المستخدمين.</p>'+
    cfgBlock('أنواع الفعاليات','activity_type')+'<div class="section-divider"></div>'+
    cfgBlock('الفئات المستهدفة','target_group')+'<div class="section-divider"></div>'+
    cfgBlock('آليات التنفيذ','mechanism')+
  '</div>'+
  '<div class="card">'+
    '<h2>إلزام الحقول</h2>'+
    '<p class="sub">حدد الحقول التي يجب على الموظف تعبئتها قبل حفظ الفعالية. الحقول الأساسية مقفلة لحماية جودة السجل.</p>'+
    requiredFieldsBlock()+
  '</div>'+
  '<div class="card"><h2>التصدير</h2>'+
    '<p class="sub">تصدير PDF متاح من زر PDF داخل سجل البرامج والمبادرات الصحية، وتصدير Excel متاح حسب الفترة المختارة.</p>'+
    '<button class="btn btn-excel" onclick="show(\'records\')">الانتقال للبرامج</button>'+
  '</div>';
}
function requiredFieldsBlock(){
  var meta=CONFIG.required_meta||[
    {key:'type',label:'نوع الفعالية',locked:true,required:true},
    {key:'title',label:'عنوان الفعالية',locked:true,required:true},
    {key:'event_date',label:'تاريخ التنفيذ',locked:true,required:true},
    {key:'executor_no',label:'المنفّذة',locked:true,required:true},
    {key:'objective',label:'الهدف',locked:false,required:isRequiredField('objective')},
    {key:'target_groups',label:'الفئة المستهدفة',locked:false,required:isRequiredField('target_groups')},
    {key:'mechanism',label:'آلية التنفيذ',locked:false,required:isRequiredField('mechanism')},
    {key:'beneficiaries',label:'عدد المستفيدين',locked:false,required:isRequiredField('beneficiaries')},
    {key:'location',label:'المكان',locked:false,required:isRequiredField('location')},
    {key:'photos',label:'الصور',locked:false,required:isRequiredField('photos')},
    {key:'world_day',label:'اسم اليوم العالمي',locked:false,required:isRequiredField('world_day')},
    {key:'partners',label:'الجهات الشريكة',locked:false,required:isRequiredField('partners')},
    {key:'notes',label:'ملاحظات',locked:false,required:isRequiredField('notes')}
  ];
  return '<div class="required-grid">'+meta.map(function(f){
    var checked=f.locked || isRequiredField(f.key);
    return '<div class="req-setting '+(f.locked?'locked':'')+'">'+
      '<div><b>'+esc(f.label)+'</b><span>'+(f.locked?'أساسي لا يمكن تعطيله':'اختياري حسب قرار المسؤول')+'</span></div>'+
      '<label class="switch"><input type="checkbox" '+(checked?'checked':'')+' '+(f.locked?'disabled':'')+
        ' onchange="setRequiredField(\''+escAttr(f.key)+'\',this.checked)"><span class="slider"></span></label>'+
    '</div>';
  }).join('')+'</div>';
}
function setRequiredField(key,required){
  run('setRequiredField',key,!!required,USER.no).then(function(r){
    if(!r.ok){ toast(r.msg||'تعذّر تحديث الإلزام.','err'); renderAdmin(); return; }
    CONFIG=r.config;
    toast('تم تحديث إلزام الحقل.','ok');
    renderAdmin();
  }).catch(function(e){
    toast((e&&e.message)||'تعذّر تحديث الإلزام.','err');
    renderAdmin();
  });
}
function cfgBlock(title,cat){
  return '<div style="margin-top:6px"><label>'+title+'</label>'+
    '<div class="tags" id="cfg_'+cat+'">'+cfgTags(cat)+'</div>'+
    '<div class="add-row" style="margin-top:8px"><input type="text" id="add_'+cat+'" placeholder="إضافة عنصر جديد">'+
    '<button class="btn btn-ghost btn-sm" onclick="addCfg(\''+cat+'\')">+ إضافة</button></div></div>';
}
function cfgTags(cat){
  return (CONFIG[cat]||[]).map(function(v){
    return '<span class="tag-item">'+esc(v)+'<span class="x" onclick="rmCfg(\''+cat+'\',\''+esc(v)+'\')">×</span></span>';
  }).join('');
}
function addCfg(cat){
  var inp=document.getElementById('add_'+cat); var v=inp.value.trim(); if(!v) return;
  run('addConfigItem',cat,v,USER.no).then(function(r){
    if(!r.ok){ toast(r.msg,'err'); return; }
    CONFIG=r.config; inp.value=''; document.getElementById('cfg_'+cat).innerHTML=cfgTags(cat);
    toast('أُضيف العنصر.','ok');
  });
}
function rmCfg(cat,v){
  confirmModal('تعطيل عنصر','سيُخفى «'+esc(v)+'» من النماذج (تبقى السجلات القديمة سليمة). متابعة؟',function(){
    run('removeConfigItem',cat,v,USER.no).then(function(r){
      if(!r.ok){ toast(r.msg,'err'); return; }
      CONFIG=r.config; document.getElementById('cfg_'+cat).innerHTML=cfgTags(cat);
      toast('تم التعطيل.','ok');
    });
  });
}

/* ====================== نوافذ منبثقة ====================== */
function openModal(title, body, foot){
  document.getElementById('modalHost').innerHTML=
  '<div class="modal-bg" onclick="if(event.target===this)closeModal()">'+
    '<div class="modal"><div class="modal-head"><h3>'+esc(title)+'</h3>'+
      '<button class="x" onclick="closeModal()">×</button></div>'+
    '<div class="modal-body">'+body+'</div>'+
    '<div class="modal-foot">'+(foot||'<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>')+'</div>'+
  '</div></div>';
}
function closeModal(){ document.getElementById('modalHost').innerHTML=''; }
function confirmModal(title,msg,onYes,danger){
  window._confirmCb=onYes;
  openModal(title,'<p style="margin:0">'+msg+'</p>',
    '<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>'+
    '<button class="btn '+(danger?'btn-danger':'btn-primary')+'" onclick="closeModal();(window._confirmCb&&window._confirmCb())">تأكيد</button>');
}

/* ====================== أدوات ====================== */
function val(id){ var e=document.getElementById(id); return e?e.value:''; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function escAttr(s){ return esc(s).replace(/'/g,'&#39;'); }
function dl(k,v){ if(v==null||v==='') return ''; return '<div class="dl-row"><span>'+k+'</span><span>'+esc(v)+'</span></div>'; }
function nowTime(){ var d=new Date(); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
function todayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function isoDate(s){ if(!s) return ''; var p=String(s).split('/'); if(p.length===3) return p[0]+'-'+('0'+p[1]).slice(-2)+'-'+('0'+p[2]).slice(-2); return s; }
function splitList(s){ return String(s||'').split(/[،,]/).map(function(x){return x.trim();}).filter(Boolean); }
