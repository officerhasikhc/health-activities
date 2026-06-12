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
  assert.deepEqual(Array.from(readiness.blocking.map((issue) => issue.code)), [
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
  assert.deepEqual(Array.from(readiness.warnings.map((issue) => issue.code)), ['uploading']);
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
