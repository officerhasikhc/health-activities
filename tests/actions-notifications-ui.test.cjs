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
    assert.match(js, /btn-command-primary/, file);
    assert.match(js, /btn-danger-text/, file);
    assert.match(js, /sync-note/, file);
    assert.match(js, /function toast\(msg, type, detail\)/, file);
    assert.match(js, /toast\('لم يكتمل الحذف'/, file);
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
