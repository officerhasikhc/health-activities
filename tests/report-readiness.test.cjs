const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCodeGs() {
  const codePath = path.join(__dirname, '..', 'src', 'Code.gs');
  const authPath = path.join(__dirname, '..', 'src', 'athar-auth.gs');
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
  for (const file of [codePath, authPath]) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
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

test('password auth rejects wrong default password and requires reset on first login', () => {
  const ctx = loadCodeGs();
  ctx.getUsers_ = () => [{
    emp_no: '65886',
    name: 'عبدالباقي عبدالهادي مرزوق بيت مرواس',
    role: 'admin',
    title: 'المشرف الإداري / مسؤول النظام',
    active: true,
    password_hash: '',
    salt: '',
    must_reset: true
  }];
  ctx.getConfig = () => ({ activity_type: [], target_group: [], mechanism: [] });
  ctx.getActiveUsersForAdmin_ = () => [];
  ctx.logAudit_ = () => {};

  const rejected = ctx.login('65886', 'not-the-employee-number');
  assert.equal(rejected.ok, false);
  assert.match(rejected.msg, /كلمة المرور/);

  const accepted = ctx.login('65886', '65886');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.mustReset, true);

  const init = ctx.init('65886', '65886');
  assert.equal(init.ok, true);
  assert.equal(init.mustReset, true);
  assert.equal(init.config, undefined);
});

test('password strength accepts six characters with letters and numbers', () => {
  const ctx = loadCodeGs();
  assert.equal(ctx.passwordStrengthError_('abc123', '65886'), '');
  assert.equal(ctx.passwordStrengthError_('ab#123', '65886'), '');
  assert.match(ctx.passwordStrengthError_('abc12', '65886'), /6/);
  assert.match(ctx.passwordStrengthError_('abcdef', '65886'), /رقم/);
  assert.match(ctx.passwordStrengthError_('123456', '65886'), /حرف/);
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
