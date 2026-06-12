const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('toast containers are accessible live regions in both entrypoints', () => {
  for (const file of ['docs/index.html', 'src/Index.html']) {
    const html = read(file);
    assert.match(html, /id="toast"[^>]*role="status"/, file);
    assert.match(html, /id="toast"[^>]*aria-live="polite"/, file);
    assert.match(html, /id="toast"[^>]*aria-atomic="true"/, file);
  }
});

test('record actions use approved calm command classes in both UI scripts', () => {
  for (const file of ['docs/app.js', 'src/JavaScript.html']) {
    const js = read(file);
    assert.match(js, /record-actions/, file);
    assert.match(js, /btn-icon-command/, file);
    assert.match(js, /btn-danger-text/, file);
    assert.match(js, /sync-note/, file);
    assert.match(js, /function toast\(msg, type, detail\)/, file);
    assert.match(js, /toast\('لم يكتمل الحذف'/, file);
  }
});

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
    assert.match(js, /period-count-chip/, file);
    assert.match(js, /function updatePeriodCountChip\(prefix, list\)/, file);
    assert.match(js, /عدد الفعاليات/, file);
  }
});

test('offline sync announces successful upload in both offline scripts', () => {
  for (const file of ['docs/offline.js', 'src/Offline.html']) {
    const js = read(file);
    assert.match(js, /toast\('تم الرفع'/, file);
  }
});

test('styles define calm action buttons, focus state, sync note, and toast detail', () => {
  for (const file of ['docs/styles.css', 'src/Stylesheet.html']) {
    const css = read(file);
    assert.match(css, /\.btn-command/, file);
    assert.match(css, /\.btn-command-primary/, file);
    assert.match(css, /\.btn-danger-text/, file);
    assert.match(css, /:focus-visible/, file);
    assert.match(css, /\.sync-note/, file);
    assert.match(css, /\.toast-detail/, file);
    assert.match(css, /#toast\.warn/, file);
  }
});
