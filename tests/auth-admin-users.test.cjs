const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

// نطاق قراءة/كتابة بسيط يحاكي Range الخاص بـ Google Sheets فوق مصفوفة في الذاكرة.
function makeRange(data, r, c, numRows, numCols) {
  numRows = numRows || 1; numCols = numCols || 1;
  return {
    getValues: () => {
      const out = [];
      for (let i = 0; i < numRows; i++) {
        const row = [];
        for (let j = 0; j < numCols; j++) row.push(data[r - 1 + i][c - 1 + j]);
        out.push(row);
      }
      return out;
    },
    setValues: (vals) => {
      for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) data[r - 1 + i][c - 1 + j] = vals[i][j];
    },
    setValue: (v) => { data[r - 1][c - 1] = v; },
    setFontWeight: () => makeRange(data, r, c, numRows, numCols)
  };
}
function makeFakeUsersSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map((r) => r.slice())];
  return {
    getDataRange: () => makeRange(data, 1, 1, data.length, headers.length),
    getLastRow: () => data.length,
    getLastColumn: () => headers.length,
    getRange: (r, c, nr, nc) => makeRange(data, r, c, nr, nc),
    setFrozenRows: () => {}
  };
}

function loadAuth() {
  const codePath = path.join(__dirname, '..', 'src', 'Code.gs');
  const authPath = path.join(__dirname, '..', 'src', 'athar-auth.gs');
  const cacheStore = new Map();
  const sentEmails = [];
  const loggedErrors = [];
  const context = {
    console: { ...console, error: (...args) => { loggedErrors.push(args.map(String).join(' ')); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
        put: (k, v) => { cacheStore.set(k, String(v)); },
        remove: (k) => { cacheStore.delete(k); }
      })
    },
    HtmlService: { XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
    ContentService: { MimeType: { JSON: 'application/json' } },
    Utilities: {
      base64EncodeWebSafe: (value) => Buffer.from(String(value)).toString('base64url'),
      base64Encode: (value) => Buffer.from(String(value)).toString('base64'),
      computeDigest: () => [],
      getUuid: () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      Charset: { UTF_8: 'UTF_8' },
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' }
    },
    Session: { getScriptTimeZone: () => 'Asia/Muscat', getEffectiveUser: () => ({ getEmail: () => '' }) },
    MailApp: {
      getRemainingDailyQuota: () => 99,
      sendEmail: (opts) => { sentEmails.push(opts); }
    },
    ScriptApp: {
      AuthMode: { FULL: 'FULL' },
      AuthorizationStatus: { REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' },
      getAuthorizationInfo: () => ({
        getAuthorizationStatus: () => 'NOT_REQUIRED',
        getAuthorizedScopes: () => ['https://www.googleapis.com/auth/script.send_mail'],
        getAuthorizationUrl: () => ''
      })
    },
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
  context._sentEmails = sentEmails;
  context._cacheStore = cacheStore;
  context._loggedErrors = loggedErrors;
  context.logAudit_ = () => {};
  return context;
}

function withRoster(ctx, users) {
  ctx.getUsers_ = () => users;
}

const ROSTER = [
  { emp_no: '65886', name: 'موظف أول', role: 'admin', title: 'مسؤول', active: true, email: 'first@moh.gov.om', phone: '' },
  { emp_no: '67204', name: 'موظف بلا بريد', role: 'staff', title: '', active: true, email: '', phone: '' },
  { emp_no: '11111', name: 'موظف موقوف', role: 'staff', title: '', active: false, email: 'inactive@moh.gov.om', phone: '' }
];

const USER_HEADERS = ['emp_no', 'name', 'role', 'title', 'active', 'password_hash', 'salt', 'must_reset', 'pwd_updated_at', 'email', 'phone'];

function withUsersSheet(ctx, rows) {
  const sheet = makeFakeUsersSheet(USER_HEADERS, rows);
  ctx.ss_ = () => ({ getSheetByName: (name) => (name === ctx.SHEETS.USERS ? sheet : null) });
  return sheet;
}

function rowFor(sheet, empNo) {
  return sheet.getDataRange().getValues().find((r) => String(r[0]) === empNo);
}

test('adminResetPassword, adminUpdateUser and getUsersForAdmin all reject a non-admin actor', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.ss_ = () => { throw new Error('must not touch the sheet before the admin check'); };

  assert.throws(() => ctx.adminResetPassword('67204', '11111'), /للمسؤول فقط/);
  assert.throws(() => ctx.adminUpdateUser('67204', '11111', 'اسم', '', '', ''), /للمسؤول فقط/);
  assert.throws(() => ctx.getUsersForAdmin('67204'), /للمسؤول فقط/);
});

test('adminResetPassword blanks the hash/salt and forces must_reset for the target employee', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  const sheet = withUsersSheet(ctx, [
    ['65886', 'موظف أول', 'admin', 'مسؤول', true, '', '', true, '', 'first@moh.gov.om', ''],
    ['67204', 'موظف بلا بريد', 'staff', '', true, 'somehash', 'somesalt', false, '2024-01-01', '', '']
  ]);

  const r = ctx.adminResetPassword('65886', '67204');
  assert.equal(r.ok, true);
  assert.match(r.msg, /الرقم الوظيفي/);

  const row = rowFor(sheet, '67204');
  assert.equal(row[5], '', 'password_hash must be cleared');
  assert.equal(row[6], '', 'salt must be cleared');
  assert.equal(row[7], true, 'must_reset must be set');
});

test('adminResetPassword reports a clear error for an unknown employee number', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  withUsersSheet(ctx, [
    ['65886', 'موظف أول', 'admin', 'مسؤول', true, '', '', true, '', 'first@moh.gov.om', '']
  ]);

  const r = ctx.adminResetPassword('65886', '99999');
  assert.equal(r.ok, false);
  assert.match(r.msg, /غير موجود/);
});

test('getUsersForAdmin returns the active roster without password_hash/salt', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);

  const list = ctx.getUsersForAdmin('65886');
  assert.equal(list.length, 2, 'inactive employees are excluded');
  for (const u of list) {
    assert.ok(!('password_hash' in u), 'password_hash must never be exposed');
    assert.ok(!('salt' in u), 'salt must never be exposed');
  }
  const staff = list.find((u) => u.no === '67204');
  assert.ok(staff);
  assert.equal(staff.email, '');
  assert.equal(staff.phone, '');
});

test('adminUpdateUser rejects an empty name, and malformed email/phone, before touching the sheet', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.ss_ = () => { throw new Error('must not read the sheet when validation fails'); };

  assert.equal(ctx.adminUpdateUser('65886', '67204', '', '', '', '').ok, false);
  assert.match(ctx.adminUpdateUser('65886', '67204', 'اسم', '', 'not-an-email', '').msg, /البريد/);
  assert.match(ctx.adminUpdateUser('65886', '67204', 'اسم', '', '', 'abc').msg, /الهاتف/);
});

test('adminUpdateUser rejects an email already used by another active employee', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.ss_ = () => { throw new Error('must not read the sheet when the email is already taken'); };

  const r = ctx.adminUpdateUser('65886', '67204', 'اسم', '', 'FIRST@moh.gov.om', '');
  assert.equal(r.ok, false);
  assert.match(r.msg, /مسجَّل لموظف آخر/);
});

test('adminUpdateUser writes name/title/email/phone for the target employee', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  const sheet = withUsersSheet(ctx, [
    ['65886', 'موظف أول', 'admin', 'مسؤول', true, '', '', true, '', 'first@moh.gov.om', ''],
    ['67204', 'موظف بلا بريد', 'staff', '', true, '', '', true, '', '', '']
  ]);

  const r = ctx.adminUpdateUser('65886', '67204', 'اسم جديد', 'ممرضة', 'new@moh.gov.om', '99887766');
  assert.equal(r.ok, true);

  const row = rowFor(sheet, '67204');
  assert.equal(row[1], 'اسم جديد');
  assert.equal(row[3], 'ممرضة');
  assert.equal(row[9], 'new@moh.gov.om');
  assert.equal(row[10], '99887766');
  // role/password fields must be untouched by a profile edit
  assert.equal(row[2], 'staff');
  assert.equal(row[5], '');
});

test('adminUpdateUser reports a clear error for an unknown/inactive employee', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.ss_ = () => { throw new Error('must not read the sheet before the target lookup fails'); };

  assert.throws(() => ctx.adminUpdateUser('65886', '11111', 'اسم', '', '', ''), /غير مخوّل|غير نشط/);
  assert.throws(() => ctx.adminUpdateUser('65886', '00000', 'اسم', '', '', ''), /غير مخوّل|غير نشط/);
});

test('admin employee-management server API is exposed to both direct and bridge callers', () => {
  const code = read('src/Code.gs');
  const bridge = read('src/Bridge.html');
  for (const fn of ['adminResetPassword', 'getUsersForAdmin', 'adminUpdateUser']) {
    assert.match(code, new RegExp(fn + ':\\s*true'), 'src/Code.gs: ' + fn);
    assert.match(bridge, new RegExp(fn + ':\\s*true'), 'src/Bridge.html: ' + fn);
  }
});

test('the Employees admin panel exists with matching wiring in both entrypoints', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.match(js, /run\('getUsersForAdmin', USER\.no\)/, file);
    assert.match(js, /run\('adminResetPassword', USER\.no, empNo\)/, file);
    assert.match(js, /run\('adminUpdateUser', USER\.no, empNo, name, title, email, phone\)/, file);
    assert.match(js, /function openEditEmployeeModal\(empNo\)/, file);
    assert.match(js, /function confirmResetEmployeePassword\(empNo\)/, file);
  }
});
