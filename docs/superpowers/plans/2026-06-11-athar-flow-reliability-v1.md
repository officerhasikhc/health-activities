# Athar Flow Reliability V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first executable slice of the internal-flow design: report-readiness checks, clearer export blocking/warning UI, and local tests for the readiness rules.

**Architecture:** Keep the source of truth in Apps Script. Add pure readiness helpers to `src/Code.gs` so the same checks can serve PDF, Excel, and ZIP exports. The GitHub Pages UI calls those helpers before export, displays blocking issues and warnings, and only proceeds when the user fixes or explicitly accepts non-blocking warnings.

**Tech Stack:** Google Apps Script V8, vanilla JavaScript/HTML/CSS, GitHub Pages files in `docs/`, mirrored Apps Script UI files in `src/`, Node's built-in `node:test` for local pure-helper tests.

---

## File Structure

- Modify: `package.json`  
  Adds `npm test` and `npm run test:readiness` commands.
- Create: `tests/report-readiness.test.cjs`  
  Loads `src/Code.gs` into a Node VM with Apps Script service stubs and tests pure readiness helpers.
- Modify: `src/Code.gs`  
  Adds `getActivityReportReadiness`, `getPeriodReportReadiness`, and pure helper functions.
- Modify: `docs/app.js`  
  Calls readiness APIs before PDF, Excel, and ZIP export and displays a modal when issues exist.
- Modify: `src/JavaScript.html`  
  Mirrors the `docs/app.js` frontend changes for Apps Script source parity.
- Modify: `docs/styles.css`  
  Adds readiness modal/list styling.
- Modify: `src/Stylesheet.html`  
  Mirrors the `docs/styles.css` styling.

## Scope

This plan implements the first high-value reliability slice only. It does not implement full server-side pagination, new charting, PIN authentication, or a new official Excel template. Those remain separate follow-up plans because they touch independent behavior and should be tested separately.

---

### Task 1: Add Local Readiness Tests

**Files:**
- Modify: `package.json`
- Create: `tests/report-readiness.test.cjs`

- [ ] **Step 1: Add test scripts**

Modify `package.json` so the `scripts` object becomes:

```json
{
  "login": "clasp login",
  "push": "clasp push -f",
  "pull": "clasp pull",
  "open": "clasp open",
  "deploy": "clasp push -f && clasp deploy -i %DEPLOYMENT_ID% -d auto",
  "test": "node --test tests/*.test.cjs",
  "test:readiness": "node --test tests/report-readiness.test.cjs"
}
```

- [ ] **Step 2: Write failing readiness tests**

Create `tests/report-readiness.test.cjs`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCodeGs() {
  const codePath = path.join(__dirname, '..', 'src', 'Code.gs');
  const code = fs.readFileSync(codePath, 'utf8');
  const context = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    HtmlService: { XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
    ContentService: { MimeType: { JSON: 'application/json' } },
    Utilities: {
      base64EncodeWebSafe: (value) => Buffer.from(String(value)).toString('base64url'),
      computeDigest: () => []
    },
    Session: { getScriptTimeZone: () => 'Asia/Muscat', getEffectiveUser: () => ({ getEmail: () => '' }) },
    MailApp: { sendEmail: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    DriveApp: {},
    SpreadsheetApp: {},
    UrlFetchApp: {},
    MimeType: { PDF: 'application/pdf' },
    Blob: function Blob() {}
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: codePath });
  return context;
}

test('activity readiness blocks required report fields', () => {
  const ctx = loadCodeGs();
  assert.equal(typeof ctx.reportReadinessForActivity_, 'function');

  const readiness = ctx.reportReadinessForActivity_({
    type: 'محاضرة',
    title: '',
    event_date: '',
    executor_no: '',
    photo_ids: '',
    has_partnership: true,
    partners: ''
  }, { photos: true, partners: true });

  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.blocking.map((issue) => issue.code), [
    'title',
    'event_date',
    'executor_no',
    'photos',
    'partners'
  ]);
});

test('activity readiness accepts existing Drive photos', () => {
  const ctx = loadCodeGs();
  const readiness = ctx.reportReadinessForActivity_({
    type: 'محاضرة',
    title: 'برنامج صحي',
    event_date: '2026-06-01',
    executor_no: '65886',
    photo_ids: 'abc,def',
    has_partnership: false,
    partners: ''
  }, { photos: true, partners: true });

  assert.equal(readiness.ok, true);
  assert.equal(readiness.blocking.length, 0);
});

test('activity readiness warns while photos are still uploading', () => {
  const ctx = loadCodeGs();
  const readiness = ctx.reportReadinessForActivity_({
    type: 'محاضرة',
    title: 'برنامج صحي',
    event_date: '2026-06-01',
    executor_no: '65886',
    photo_ids: 'abc',
    status: 'جارٍ رفع الصور'
  }, { photos: true });

  assert.equal(readiness.ok, true);
  assert.deepEqual(readiness.warnings.map((issue) => issue.code), ['uploading']);
});

test('period readiness summarizes row issues', () => {
  const ctx = loadCodeGs();
  const summary = ctx.reportReadinessForRows_([
    { id: 'A', title: 'جاهز', type: 'محاضرة', event_date: '2026-06-01', executor_no: '1', photo_ids: 'p1' },
    { id: 'B', title: '', type: 'محاضرة', event_date: '2026-06-02', executor_no: '1', photo_ids: '' },
    { id: 'C', title: 'رفع', type: 'محاضرة', event_date: '2026-06-03', executor_no: '1', photo_ids: 'p2', status: 'جارٍ رفع الصور' }
  ], { photos: true });

  assert.equal(summary.total, 3);
  assert.equal(summary.ready, 1);
  assert.equal(summary.blockingCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.issueCounts.title, 1);
  assert.equal(summary.issueCounts.photos, 1);
  assert.equal(summary.issueCounts.uploading, 1);
});
```

- [ ] **Step 3: Run the failing test**

Run:

```powershell
npm run test:readiness
```

Expected: FAIL with an assertion showing `reportReadinessForActivity_` is not a function.

- [ ] **Step 4: Commit the failing tests**

```powershell
git add package.json tests/report-readiness.test.cjs
git commit -m "test: add report readiness coverage"
```

---

### Task 2: Add Server Readiness API

**Files:**
- Modify: `src/Code.gs`
- Test: `tests/report-readiness.test.cjs`

- [ ] **Step 1: Expose readiness API methods**

In `src/Code.gs`, update `API_METHODS` to include:

```js
  getActivityReportReadiness: true,
  getPeriodReportReadiness: true,
```

Place the two lines after `getDashboardItems: true,`.

- [ ] **Step 2: Add pure readiness helpers**

In `src/Code.gs`, insert this block after `missingRequiredFields_(payload)`:

```js
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
```

- [ ] **Step 3: Add public readiness functions**

In `src/Code.gs`, insert this block before `exportActivityPdf(id, actorEmpNo)`:

```js
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
```

- [ ] **Step 4: Run readiness tests**

Run:

```powershell
npm run test:readiness
```

Expected: PASS for all four tests.

- [ ] **Step 5: Commit server readiness API**

```powershell
git add src/Code.gs
git commit -m "feat: add report readiness checks"
```

---

### Task 3: Add Frontend Export Readiness Flow

**Files:**
- Modify: `docs/app.js`
- Modify: `src/JavaScript.html`

- [ ] **Step 1: Route PDF buttons through readiness check**

In both `docs/app.js` and `src/JavaScript.html`, replace:

```js
(isPending?'':'<button class="btn btn-print btn-sm" id="pdfBtn_'+escAttr(o.id)+'" onclick="exportPdf(\''+o.id+'\')"><span class="ico">⤓</span> تحميل PDF</button>')+
```

with:

```js
(isPending?'':'<button class="btn btn-print btn-sm" id="pdfBtn_'+escAttr(o.id)+'" onclick="prepareExportPdf(\''+o.id+'\')"><span class="ico">⤓</span> تحميل PDF</button>')+
```

- [ ] **Step 2: Add readiness modal helpers**

In both `docs/app.js` and `src/JavaScript.html`, insert this block immediately before `function exportPdf(id)`:

```js
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
      return '<div class="readiness-record">'+
        '<b>'+esc(item.title||item.id||'فعالية')+'</b>'+
        '<span>'+esc(item.event_date||'')+'</span>'+
        readinessIssueListHtml((item.blocking||[]).concat(item.warnings||[]), '')+
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
    ? 'توجد نواقص تمنع التقرير من الظهور كمكتمل. راجعها قبل التصدير.'
    : 'توجد ملاحظات غير مانعة. يمكنك المتابعة إذا كانت مقبولة.';
  var body = '<p class="readiness-intro">'+esc(intro)+'</p>'+readinessSummaryHtml(readiness);
  var footer = '<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>';
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
```

- [ ] **Step 3: Split PDF export into precheck and direct export**

In both `docs/app.js` and `src/JavaScript.html`, replace `function exportPdf(id){...}` with:

```js
function prepareExportPdf(id){
  var btn=document.getElementById('pdfBtn_'+id);
  setBusy(btn, 'جارٍ فحص البيانات…');
  run('getActivityReportReadiness', id, USER.no).then(function(r){
    restoreBusy(btn);
    if(!r || !r.ok){ toast((r&&r.msg)||'تعذّر فحص جاهزية التقرير.','err'); return; }
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
```

- [ ] **Step 4: Split Excel export into precheck and direct export**

In both `docs/app.js` and `src/JavaScript.html`, replace `function exportExcel(){...}` with:

```js
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
```

- [ ] **Step 5: Add ZIP precheck without rewriting the ZIP worker**

In both `docs/app.js` and `src/JavaScript.html`, replace the first lines of `function exportZip(){` through `var filter=periodFilter('fl');` with:

```js
function exportZip(){
  var btn=document.getElementById('zipBtn');
  var filter=periodFilter('fl');
  setBusy(btn, 'جارٍ فحص البيانات…');
  run('getPeriodReportReadiness', filter, USER.no).then(function(r){
    restoreBusy(btn);
    if(!r || !r.ok){ toast((r&&r.msg)||'تعذّر فحص جاهزية التصدير.','err'); return; }
    var proceed=function(){ exportZipDirect(filter); };
    if(shouldProceedAfterReadiness(r.readiness, proceed, 'جاهزية تحميل ZIP')) return proceed();
  }).catch(function(e){
    restoreBusy(btn);
    toast((e&&e.message)||'تعذّر فحص جاهزية التصدير.','err');
  });
}

function exportZipDirect(filter){
  var btn=document.getElementById('zipBtn');
  filter=filter || periodFilter('fl');
```

Then keep the existing ZIP body unchanged until its closing brace. The only structural change is that the existing ZIP body now belongs to `exportZipDirect(filter)`.

- [ ] **Step 6: Run syntax checks**

Run:

```powershell
node --check docs/app.js
```

Expected: no syntax errors.

- [ ] **Step 7: Commit frontend readiness flow**

```powershell
git add docs/app.js src/JavaScript.html
git commit -m "feat: gate exports with readiness checks"
```

---

### Task 4: Add Readiness UI Styles

**Files:**
- Modify: `docs/styles.css`
- Modify: `src/Stylesheet.html`

- [ ] **Step 1: Add readiness styles**

Append this CSS to both `docs/styles.css` and `src/Stylesheet.html` before the final media-query section if present, otherwise at the end:

```css
.readiness-intro{margin:0 0 12px;color:var(--ink);line-height:1.8}
.readiness-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.readiness-item{border:1px solid var(--line);border-right-width:4px;border-radius:8px;padding:9px 10px;background:#fff}
.readiness-item b{display:block;font-size:13px;margin-bottom:3px;color:var(--ink)}
.readiness-item span{display:block;font-size:12.5px;color:var(--muted);line-height:1.7}
.readiness-item.blocking{border-right-color:var(--err);background:#fff7f6}
.readiness-item.warning{border-right-color:#b7812c;background:#fffaf0}
.readiness-records{display:flex;flex-direction:column;gap:10px;max-height:58vh;overflow:auto;padding-left:4px}
.readiness-record{border:1px solid var(--line);border-radius:8px;padding:10px;background:#fbfcfd}
.readiness-record>b{display:block;color:var(--brand-deep);font-size:13.5px;margin-bottom:2px}
.readiness-record>span{display:block;color:var(--muted);font-size:12px;margin-bottom:8px}
```

- [ ] **Step 2: Run style smoke check**

Run:

```powershell
Select-String -Path docs/styles.css,src/Stylesheet.html -Pattern "readiness-intro|readiness-records"
```

Expected: both files contain both selectors.

- [ ] **Step 3: Commit readiness styles**

```powershell
git add docs/styles.css src/Stylesheet.html
git commit -m "style: add report readiness UI"
```

---

### Task 5: Verify End-to-End

**Files:**
- Verify: `package.json`
- Verify: `tests/report-readiness.test.cjs`
- Verify: `src/Code.gs`
- Verify: `docs/app.js`
- Verify: `src/JavaScript.html`
- Verify: `docs/styles.css`
- Verify: `src/Stylesheet.html`

- [ ] **Step 1: Run local tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run JavaScript syntax check**

Run:

```powershell
node --check docs/app.js
```

Expected: no syntax errors.

- [ ] **Step 3: Check mirrored frontend source**

Run:

```powershell
Select-String -Path docs/app.js,src/JavaScript.html -Pattern "prepareExportPdf|getPeriodReportReadiness|showReadinessModal"
```

Expected: both files contain all three names.

- [ ] **Step 4: Check working tree**

Run:

```powershell
git status --short
```

Expected: no uncommitted changes except the ignored `.superpowers/` directory.

- [ ] **Step 5: Manual browser verification**

Open the GitHub Pages app locally if a static-server workflow is available, or use the deployed app after publishing. Verify:

1. PDF export first shows a readiness modal for an incomplete record.
2. Excel export shows period-level missing-data summaries.
3. ZIP export shows the same readiness precheck before building the ZIP.
4. A fully complete activity exports without a modal.
5. Existing save, record loading, and dashboard loading still work.

- [ ] **Step 6: Final commit if verification required small fixes**

If Step 5 required fixes, commit them:

```powershell
git add docs/app.js src/JavaScript.html docs/styles.css src/Stylesheet.html src/Code.gs tests/report-readiness.test.cjs package.json
git commit -m "fix: polish report readiness flow"
```
