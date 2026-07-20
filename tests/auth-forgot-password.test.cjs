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
  const context = {
    console,
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
    MailApp: { sendEmail: (opts) => { sentEmails.push(opts); } },
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

function extractCode(body) {
  const m = String(body).match(/\d{6}/);
  assert.ok(m, 'email body contains a 6-digit code');
  return m[0];
}

test('requestPasswordReset returns the identical generic message for unknown, email-less, and valid accounts', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);

  const unknown = ctx.requestPasswordReset('00000');
  const noEmail = ctx.requestPasswordReset('67204');
  const valid = ctx.requestPasswordReset('65886');

  assert.equal(unknown.ok, true);
  assert.equal(noEmail.ok, true);
  assert.equal(valid.ok, true);
  assert.equal(unknown.msg, noEmail.msg);
  assert.equal(unknown.msg, valid.msg);
  assert.equal(ctx._sentEmails.length, 1, 'only the account with a registered email receives mail');
  assert.equal(ctx._sentEmails[0].to, 'first@moh.gov.om');
});

test('requestPasswordReset respects the resend cooldown', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);

  ctx.requestPasswordReset('65886');
  ctx.requestPasswordReset('65886');

  assert.equal(ctx._sentEmails.length, 1, 'second immediate request is throttled, no duplicate email');
});

test('resetPasswordWithCode rejects a code that was never requested', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.setUserPassword_ = () => { throw new Error('must not write a password without a valid code'); };

  const r = ctx.resetPasswordWithCode('65886', '123456', 'abc123');
  assert.equal(r.ok, false);
  assert.match(r.msg, /غير صحيح|منتهي/);
});

test('resetPasswordWithCode locks out after too many wrong attempts, then invalidates the real code too', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.requestPasswordReset('65886');
  const realCode = extractCode(ctx._sentEmails[0].body);
  ctx.setUserPassword_ = () => { throw new Error('must not write a password after lockout'); };

  // أول RESET_CODE_MAX_ATTEMPTS محاولة تُسجَّل كأخطاء عادية؛ المحاولة التالية بعدها
  // هي التي تكتشف تجاوز الحد وتقفل الرمز (الفحص يسبق الزيادة في الخادم).
  let last;
  for (let i = 0; i < ctx.RESET_CODE_MAX_ATTEMPTS + 1; i++) {
    last = ctx.resetPasswordWithCode('65886', '000000', 'abc123');
    assert.equal(last.ok, false);
  }
  assert.match(last.msg, /محاولات كثيرة/);

  const afterLockout = ctx.resetPasswordWithCode('65886', realCode, 'abc123');
  assert.equal(afterLockout.ok, false, 'the real code no longer works once the attempt cache entry is cleared');
});

test('resetPasswordWithCode accepts the correct code and writes the new password', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.requestPasswordReset('65886');
  const realCode = extractCode(ctx._sentEmails[0].body);

  const calls = [];
  ctx.setUserPassword_ = (empNo, newPassword) => { calls.push([empNo, newPassword]); return true; };

  const r = ctx.resetPasswordWithCode('65886', realCode, 'abc123');
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [['65886', 'abc123']]);

  const reuse = ctx.resetPasswordWithCode('65886', realCode, 'xyz999');
  assert.equal(reuse.ok, false, 'a consumed code cannot be reused');
});

test('resetPasswordWithCode still enforces password strength on the new password', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.requestPasswordReset('65886');
  const realCode = extractCode(ctx._sentEmails[0].body);
  ctx.setUserPassword_ = () => { throw new Error('must not write a weak password'); };

  const r = ctx.resetPasswordWithCode('65886', realCode, '123');
  assert.equal(r.ok, false);
  assert.match(r.msg, /6|أحرف/);
});

test('updateMyProfile rejects malformed email and phone before touching the sheet', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.ss_ = () => { throw new Error('must not read the sheet when validation fails'); };

  const badEmail = ctx.updateMyProfile('67204', 'not-an-email', '');
  assert.equal(badEmail.ok, false);
  assert.match(badEmail.msg, /البريد/);

  const badPhone = ctx.updateMyProfile('67204', '', 'abcdefg');
  assert.equal(badPhone.ok, false);
  assert.match(badPhone.msg, /الهاتف/);
});

test('updateMyProfile rejects an email already registered to another active employee', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  ctx.ss_ = () => { throw new Error('must not read the sheet when the email is already taken'); };

  const r = ctx.updateMyProfile('67204', 'FIRST@moh.gov.om', '');
  assert.equal(r.ok, false);
  assert.match(r.msg, /موظف آخر/);
});

test('updateMyProfile allows an inactive account\'s old email to be reclaimed, and does not block saving your own unchanged email', () => {
  const ctx = loadAuth();
  withRoster(ctx, ROSTER);
  const headers = ['emp_no', 'name', 'role', 'title', 'active', 'password_hash', 'salt', 'must_reset', 'pwd_updated_at', 'email', 'phone'];
  const sheet = makeFakeUsersSheet(headers, [
    ['65886', 'موظف أول', 'admin', 'مسؤول', true, '', '', true, '', 'first@moh.gov.om', ''],
    ['67204', 'موظف بلا بريد', 'staff', '', true, '', '', true, '', '', '']
  ]);
  ctx.ss_ = () => ({ getSheetByName: (name) => (name === ctx.SHEETS.USERS ? sheet : null) });

  const reclaim = ctx.updateMyProfile('67204', 'inactive@moh.gov.om', '');
  assert.equal(reclaim.ok, true, 'email that only belongs to a disabled account is free to claim');

  const keepOwn = ctx.updateMyProfile('65886', 'first@moh.gov.om', '9123456');
  assert.equal(keepOwn.ok, true, 'saving your own current email must not be rejected as a duplicate');
});

test('forgot-password screen exists with matching markup in both entrypoints', () => {
  for (const file of ['docs/index.html', 'src/Index.html']) {
    const html = read(file);
    assert.match(html, /onclick="showForgotScreen\(\)"/, file);
    assert.match(html, /id="forgotScreen"/, file);
    assert.match(html, /id="forgotEmpNo"/, file);
    assert.match(html, /onclick="doRequestReset\(\)"/, file);
    assert.match(html, /id="resetCode"/, file);
    assert.match(html, /onclick="doResetWithCode\(\)"/, file);
  }
});

test('profile page is reachable only via the header name button, not the main tabs row', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.doesNotMatch(js, /tabs\.push\(\{id:'profile'/, file + ': profile must not appear in the main tabs row');
    assert.match(js, /else if\(tab==='profile'\) renderProfile\(\);/, file);
    assert.match(js, /function renderProfile\(\)/, file);
    assert.match(js, /function saveProfile\(\)/, file);
    assert.match(js, /run\('getMyProfile', USER\.no\)/, file);
    assert.match(js, /run\('updateMyProfile', USER\.no, email, phone\)/, file);
  }
  for (const file of ['docs/index.html', 'src/Index.html']) {
    const html = read(file);
    assert.match(html, /class="who-btn" onclick="onTabClick\('profile'\)"/, file);
  }
});

test('contact info is read-only text edited through a dialog, with a way back to the home tab', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    const renderProfileBody = js.slice(js.indexOf('function renderProfile('), js.indexOf('function openEditContactModal('));
    assert.doesNotMatch(renderProfileBody, /<input/, file + ': the profile card itself must show read-only text, not inputs');
    assert.match(renderProfileBody, /readonly-box.*p\.email/, file);
    assert.match(renderProfileBody, /readonly-box.*p\.phone/, file);
    assert.match(js, /function openEditContactModal\(\)/, file);
    assert.match(js, /openModal\('تعديل بيانات التواصل'/, file);
    assert.match(js, /<input id="profEmail" type="email"/, file + ': the edit dialog still needs the input');
    assert.match(js, /<input id="profPhone" type="tel"/, file);
    assert.match(js, /onclick="closeModal\(\)">إلغاء</, file);
    assert.match(js, /onTabClick\([^)]*register[^)]*\)[^<]*>العودة للصفحة الرئيسية/, file);
  }
});

test('forgot-password server API is exposed to both direct and bridge callers', () => {
  const code = read('src/Code.gs');
  const bridge = read('src/Bridge.html');
  for (const fn of ['requestPasswordReset', 'resetPasswordWithCode', 'getMyProfile', 'updateMyProfile']) {
    assert.match(code, new RegExp(fn + ':\\s*true'), 'src/Code.gs: ' + fn);
    assert.match(bridge, new RegExp(fn + ':\\s*true'), 'src/Bridge.html: ' + fn);
  }
});
