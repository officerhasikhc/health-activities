# Athar Record Readiness PDF Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved record action, missing-data navigation, required-edit validation, period counters, and combined-period PDF export improvements.

**Architecture:** Keep the existing single-file Apps Script and static UI structure. Add small helpers around readiness issues so the same issue data can drive both export blocking and edit navigation. Replace the old period ZIP path with a server-generated combined PDF path while leaving individual PDF and Excel flows intact.

**Tech Stack:** Google Apps Script V8 in `src/Code.gs`, static HTML/JS/CSS in `src/JavaScript.html`, `src/Stylesheet.html`, mirrored GitHub Pages files in `docs/`, and Node `node:test` contract tests.

---

## File Structure

- Modify `tests/actions-notifications-ui.test.cjs`: UI contract tests for icon actions, missing-data wording, period PDF, and period counts.
- Modify `tests/report-readiness.test.cjs`: Apps Script contract tests for combined PDF API and pure combined HTML helper.
- Modify `src/Code.gs`: add `exportActivitiesPdfDownload`, pure combined PDF HTML builder, combined PDF blob builder, API allow-list entry, and period PDF limits.
- Modify `docs/app.js` and `src/JavaScript.html`: add readiness edit navigation, pending missing-field highlight, period PDF export flow, action icon buttons, and period counters.
- Modify `docs/styles.css` and `src/Stylesheet.html`: calm icon button styles, tooltip support through native `title`, and period count chips.

## Task 1: UI Contract Tests

**Files:**
- Modify: `tests/actions-notifications-ui.test.cjs`

- [ ] **Step 1: Add failing tests for approved UI contracts**

Insert these tests after the existing record action test:

```js
test('period export uses combined PDF flow instead of ZIP labels', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.match(js, /id="periodPdfBtn"/, file);
    assert.match(js, /onclick="exportPeriodPdf\(\)"/, file);
    assert.match(js, /تصدير PDF/, file);
    assert.match(js, /function exportPeriodPdf\(\)/, file);
    assert.match(js, /exportActivitiesPdfDownload/, file);
    assert.doesNotMatch(js, /تحميل ZIP/, file);
    assert.doesNotMatch(js, /function exportZip\(\)/, file);
  }
});

test('readiness modal uses concise missing-data wording and edit navigation', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.match(js, /هناك بيانات ناقصة/, file);
    assert.match(js, /function editActivityWithIssues\(id, issueCodes\)/, file);
    assert.match(js, /function applyPendingMissingFields\(\)/, file);
    assert.match(js, /تعديل البيانات/, file);
  }
});

test('record actions use icon buttons with tooltip titles', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.match(js, /btn-icon-command/, file);
    assert.match(js, /title="عرض"/, file);
    assert.match(js, /title="تعديل"/, file);
    assert.match(js, /title="طباعة"/, file);
    assert.match(js, /title="حذف"/, file);
    assert.match(js, /aria-label="طباعة/, file);
  }
});

test('period controls expose count chip refresh helpers', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.match(js, /periodCountChip/, file);
    assert.match(js, /function updatePeriodCountChip\(prefix, list\)/, file);
    assert.match(js, /عدد الفعاليات/, file);
  }
});
```

- [ ] **Step 2: Run the UI tests and verify failure**

Run:

```bash
npm test -- tests/actions-notifications-ui.test.cjs
```

Expected: FAIL because the current UI still contains `تحميل ZIP`, `exportZip`, text buttons, and no missing-data edit navigation helpers.

## Task 2: Apps Script Combined PDF Tests

**Files:**
- Modify: `tests/report-readiness.test.cjs`

- [ ] **Step 1: Add failing tests for combined PDF API and HTML helper**

Add these tests after `period readiness summarizes row issues`:

```js
test('combined period PDF API is exposed to bridge callers', () => {
  const ctx = loadCodeGs();
  assert.equal(ctx.API_METHODS.exportActivitiesPdfDownload, true);
  assert.equal(typeof ctx.exportActivitiesPdfDownload, 'function');
});

test('combined period PDF HTML includes each activity as an independent report section', () => {
  const ctx = loadCodeGs();
  assert.equal(typeof ctx.buildActivitiesPeriodPdfHtml_, 'function');

  const html = ctx.buildActivitiesPeriodPdfHtml_([
    {
      type: 'محاضرة',
      title: 'النشاط الأول',
      event_date: '2026-06-01',
      month_name: 'يونيو',
      quarter: 'الربع الثاني',
      executor_name: 'آمنة',
      objective: 'رفع الوعي',
      photo_ids: ''
    },
    {
      type: 'يوم عالمي',
      world_day: 'اليوم العالمي للصحة',
      title: 'اليوم العالمي للصحة',
      event_date: '2026-06-02',
      month_name: 'يونيو',
      quarter: 'الربع الثاني',
      executor_name: 'عائشة',
      objective: 'تفعيل المناسبة',
      photo_ids: ''
    }
  ], '', {});

  assert.match(html, /تقرير توثيق فعالية/);
  assert.match(html, /النشاط الأول/);
  assert.match(html, /اليوم العالمي للصحة/);
  assert.match(html, /period-break/);
});
```

- [ ] **Step 2: Run the readiness tests and verify failure**

Run:

```bash
npm test -- tests/report-readiness.test.cjs
```

Expected: FAIL because `API_METHODS.exportActivitiesPdfDownload` and `buildActivitiesPeriodPdfHtml_` do not exist yet.

## Task 3: Implement Combined Period PDF on the Server

**Files:**
- Modify: `src/Code.gs`

- [ ] **Step 1: Add API method and PDF count limit**

Near the existing export constants, add:

```js
var PERIOD_PDF_MAX_COUNT = 35;
```

Inside `API_METHODS`, add:

```js
  exportActivitiesPdfDownload: true,
```

- [ ] **Step 2: Add combined period PDF export functions**

Add these functions near the existing PDF/Excel export section, before `exportActivitiesExcel`:

```js
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

function buildActivitiesPeriodPdfBlob_(rows, periodLabel, user) {
  var letter = getOfficialLetterBlob_();
  var letterDataUri = letter ? blobDataUri_(letter) : '';
  var photosById = {};
  rows.forEach(function(activity){
    String(activity.photo_ids || '').split(',').filter(Boolean).forEach(function(pid){
      if (photosById[pid]) return;
      try { photosById[pid] = blobDataUri_(DriveApp.getFileById(pid).getBlob()); }
      catch (e) { photosById[pid] = ''; }
    });
  });
  var html = buildActivitiesPeriodPdfHtml_(rows, letterDataUri, photosById);
  var fileName = safeFileName_('تقرير أثر PDF - ' + (user.name || user.emp_no) + ' - ' + periodLabel) + '.pdf';
  return Utilities.newBlob(html, 'text/html', fileName.replace(/\.pdf$/,'') + '.html')
    .getAs(MimeType.PDF)
    .setName(fileName);
}
```

- [ ] **Step 3: Add pure combined HTML builder**

Add this helper after `buildActivityPdfHtml_`:

```js
function buildActivitiesPeriodPdfHtml_(activities, letterDataUri, photosById) {
  activities = activities || [];
  photosById = photosById || {};
  var sections = activities.map(function(activity, index){
    activity.display_type = activity.display_type || activityDisplayType_(activity);
    var ids = String(activity.photo_ids || '').split(',').filter(Boolean);
    var photoDataUris = ids.map(function(pid){ return photosById[pid] || ''; }).filter(Boolean);
    return activityPdfSectionsHtml_(activity, letterDataUri || '', photoDataUris, index > 0);
  }).join('');
  var pageBgCss = letterDataUri ? '' : 'background:#fff;border:1px solid #dfe4ea;';
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;font-family:Arial,Tahoma,sans-serif;color:#1d2733}.page{width:210mm;height:297mm;position:relative;box-sizing:border-box;page-break-after:always;' + pageBgCss + 'overflow:hidden}.page:last-child{page-break-after:auto}.period-break{page-break-before:always}.page-bg{position:absolute;top:0;left:0;width:210mm;height:297mm;z-index:-1;object-fit:cover;display:block}.pdf-header{position:absolute;top:45mm;right:13mm;font-size:13pt;font-weight:bold;color:#123a46;text-align:right;line-height:1.4;z-index:2}.pdf-footer{position:absolute;bottom:30mm;left:30mm;right:15mm;font-size:12.5pt;color:#123a46;z-index:2}.pdf-footer .prep{position:absolute;right:0;bottom:0;font-weight:bold}.pdf-footer .appr{position:absolute;left:0;bottom:0;font-weight:bold}.content{position:absolute;inset:55mm 15mm 30mm 15mm;z-index:1}.first h1{position:relative;top:10mm;right:7mm;font-size:19pt;margin:0 0 8mm;text-align:center;color:#123a46}.row{display:grid;grid-template-columns:38mm 1fr;gap:5mm;border-bottom:1px solid #dfe4ea;padding:3.8mm 0;font-size:11.5pt;line-height:1.6}.row span{color:#5b6b7b;font-weight:bold}.row b{font-weight:500;white-space:pre-wrap}.photos h2{font-size:15pt;margin:0 0 6mm;text-align:center;color:#123a46}.photo-list{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:minmax(100px, 1fr);gap:10mm;height:190mm}figure{margin:0;border:1px solid #dfe4ea;padding:2.5mm;background:rgba(255,255,255,.92);display:flex;flex-direction:column;gap:1.5mm;box-shadow:0 2px 6px rgba(0,0,0,.05)}figure img{width:100%;height:80mm;object-fit:contain}figcaption{text-align:center;color:#5b6b7b;font-size:11pt;font-weight:bold}</style>' +
    '</head><body>' + sections + '</body></html>';
}
```

- [ ] **Step 4: Extract activity section HTML from existing PDF builder**

Add this helper before `buildActivityPdfHtml_` and change `buildActivityPdfHtml_` to call it:

```js
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
```

`buildActivityPdfHtml_` should become a wrapper that returns the same HTML shell with `activityPdfSectionsHtml_(activity, letterDataUri, photos, false)`.

- [ ] **Step 5: Run server tests**

Run:

```bash
npm test -- tests/report-readiness.test.cjs
```

Expected: PASS.

## Task 4: Readiness Navigation and Edit Validation Feedback

**Files:**
- Modify: `docs/app.js`
- Modify: `src/JavaScript.html`

- [ ] **Step 1: Add pending missing-field state**

Near the global state declarations, add:

```js
var PENDING_FORM_MISSING = null;
```

- [ ] **Step 2: Add issue-to-field helpers and edit navigation**

Add these helpers near the validation/readiness functions:

```js
function issueFieldId(code){
  var map={
    type:'f_type', type_custom:'f_type_custom', title:'f_title',
    world_day:'f_world', event_date:'f_date', executor_no:USER&&USER.role==='admin'?'f_exec':'whoName',
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
```

Call `applyPendingMissingFields();` at the end of `renderForm(editing)` after `attachAutosave();`.

- [ ] **Step 3: Change readiness record rendering to include edit buttons**

Update `readinessSummaryHtml(readiness)` so each item computes issue codes:

```js
var issues=(item.blocking||[]).concat(item.warnings||[]);
var codes=issues.map(function(issue){ return issue.code; }).filter(Boolean);
var canEdit=item.id && codes.length;
```

Inside each `.readiness-record`, append:

```js
(canEdit?'<button class="btn btn-ghost btn-sm" onclick="editActivityWithIssues(\''+escAttr(item.id)+'\', '+escAttr(JSON.stringify(codes))+')">تعديل البيانات</button>':'')
```

For single-record readiness, `showReadinessModal` should accept an optional `recordId` and render a footer button:

```js
if(hasBlocking && readiness.recordId){
  var codes=(readiness.blocking||[]).map(function(issue){ return issue.code; }).filter(Boolean);
  footer += '<button class="btn btn-primary" onclick="editActivityWithIssues(\''+escAttr(readiness.recordId)+'\', '+escAttr(JSON.stringify(codes))+')">تعديل البيانات</button>';
}
```

- [ ] **Step 4: Use concise missing-data wording**

In `showReadinessModal`, replace the blocking intro with:

```js
var intro = hasBlocking
  ? 'هناك بيانات ناقصة'
  : 'توجد ملاحظات غير مانعة. يمكنك المتابعة إذا كانت مقبولة.';
```

When calling `showReadinessModal` from `prepareExportPdf`, attach the record id:

```js
r.readiness.recordId = id;
```

- [ ] **Step 5: Run UI tests and verify relevant failures remain for later tasks**

Run:

```bash
npm test -- tests/actions-notifications-ui.test.cjs
```

Expected: readiness wording/navigation tests PASS, period PDF/icon/count tests may still FAIL until later tasks.

## Task 5: Replace Period ZIP with Combined PDF Flow

**Files:**
- Modify: `docs/app.js`
- Modify: `src/JavaScript.html`

- [ ] **Step 1: Replace action button markup**

In `renderRecords()`, replace the ZIP button with:

```js
'<div class="field" style="justify-content:flex-end"><button class="btn btn-pdf btn-sm" id="periodPdfBtn" onclick="exportPeriodPdf()" onpointerenter="Warmup.intent(\'export\')" ontouchstart="Warmup.intent(\'export\')">تصدير PDF</button></div>'+
```

- [ ] **Step 2: Replace exportZip functions with period PDF functions**

Remove `exportZip` and `exportZipDirect`. Add:

```js
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
```

- [ ] **Step 3: Run UI tests**

Run:

```bash
npm test -- tests/actions-notifications-ui.test.cjs
```

Expected: period PDF tests PASS; icon/count tests may still FAIL.

## Task 6: Calm Icon Actions and Period Counts

**Files:**
- Modify: `docs/app.js`
- Modify: `src/JavaScript.html`
- Modify: `docs/styles.css`
- Modify: `src/Stylesheet.html`

- [ ] **Step 1: Add count chip to period controls**

In `periodControlsHtml(prefix)`, add after the period select field:

```js
'<div class="period-count-chip hidden" id="'+prefix+'_periodCount" aria-live="polite"></div>'+
```

Add helper:

```js
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
  chip.textContent=periodCountLabel(filter)+': '+count+' '+(count===1?'فعالية':'فعاليات');
  chip.classList.remove('hidden');
}
```

Call `updatePeriodCountChip('fl', merged);` after `paintRecords(merged);` in `loadRecords()`.

- [ ] **Step 2: Replace record action buttons with icon buttons**

In `paintRecords`, replace the action markup with:

```js
'<button class="btn btn-icon-command btn-view" title="عرض" aria-label="عرض '+escAttr(o.title)+'" onclick="viewActivity(\''+o.id+'\')"><span class="ico" aria-hidden="true">👁</span></button>'+
(isPending?'':'<button class="btn btn-icon-command btn-edit" title="تعديل" aria-label="تعديل '+escAttr(o.title)+'" onclick="editActivity(\''+o.id+'\')"><span class="ico" aria-hidden="true">✎</span></button>')+
(isPending?'':'<button class="btn btn-icon-command btn-print" title="طباعة" aria-label="طباعة '+escAttr(o.title)+'" id="pdfBtn_'+escAttr(o.id)+'" onclick="prepareExportPdf(\''+o.id+'\')"><span class="ico" aria-hidden="true">⎙</span></button>')+
(isPending?'':'<button class="btn btn-icon-command btn-danger-text" title="حذف" id="delBtn_'+escAttr(o.id)+'" aria-label="حذف '+escAttr(o.title)+'" onclick="askDelete(\''+o.id+'\')"><span class="ico" aria-hidden="true">⌫</span></button>')
```

- [ ] **Step 3: Add styles**

Add to both CSS files near button styles:

```css
.btn-pdf{background:#fff;color:var(--brand-deep);border:1px solid var(--line-strong)}
.btn-pdf:hover{background:#f4f6f7;border-color:#b4c2ce}
.btn-icon-command{width:34px;height:34px;min-width:34px;padding:0;border-radius:6px;background:#fff;color:var(--brand-deep);border:1px solid var(--line-strong)}
.btn-icon-command:hover{background:#f4f6f7;border-color:#b4c2ce;box-shadow:none}
.btn-icon-command.btn-danger-text{color:var(--err);border-color:rgba(178,59,59,.22)}
.btn-icon-command.btn-danger-text:hover{background:#fff6f6;border-color:rgba(178,59,59,.38)}
.period-count-chip{align-self:flex-end;min-height:34px;display:inline-flex;align-items:center;border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;color:var(--brand-deep);font-size:12.5px;font-weight:700}
.period-count-chip.hidden{display:none}
```

- [ ] **Step 4: Run UI tests**

Run:

```bash
npm test -- tests/actions-notifications-ui.test.cjs
```

Expected: PASS.

## Task 7: Full Verification and Browser Check

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Check source/docs parity**

Run:

```bash
fc docs\app.js src\JavaScript.html
fc docs\styles.css src\Stylesheet.html
```

Expected: files may differ only by wrapper requirements already present in the project. New functions/classes must appear in both pairs.

- [ ] **Step 3: Open the static app in the browser**

Open:

```text
file:///C:/Users/super/athar/docs/index.html
```

Expected: page loads without syntax errors. The full data flows require Apps Script bridge, so this check is for render-level breakage only.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended files changed.
