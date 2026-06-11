# Athar Actions Notifications UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved option C design for calmer record actions and clearer save/upload/delete notifications.

**Architecture:** Keep behavior in the existing vanilla JavaScript files and mirror every `docs/` change to the Apps Script `src/` files. Add a lightweight source-contract test so button classes, live-region markup, and toast states stay present across both copies.

**Tech Stack:** Vanilla JavaScript, CSS, Google Apps Script HTML mirrors, Node `node:test` for local verification.

---

## File Structure

- Modify: `docs/index.html` and `src/Index.html`  
  Add live-region attributes to the toast container.
- Modify: `docs/app.js` and `src/JavaScript.html`  
  Add richer `toast(msg, type, detail)` behavior, calmer record action markup, sync status note, and clearer save/upload/delete messages.
- Modify: `docs/styles.css` and `src/Stylesheet.html`  
  Add command-button, focus-visible, sync-note, and enhanced toast styling.
- Create: `tests/actions-notifications-ui.test.cjs`  
  Verifies both docs/src copies contain the approved UI contracts.

---

### Task 1: Add UI Contract Test

**Files:**
- Create: `tests/actions-notifications-ui.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `tests/actions-notifications-ui.test.cjs`:

```js
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
    assert.match(js, /toast\('تم الرفع'/, file);
    assert.match(js, /toast\('لم يكتمل الحذف'/, file);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test
```

Expected: FAIL because the new live-region attributes and approved command classes are not implemented yet.

- [ ] **Step 3: Commit the failing test**

```powershell
git add tests/actions-notifications-ui.test.cjs
git commit -m "test: add actions notifications UI contract"
```

---

### Task 2: Implement Markup and Toast Behavior

**Files:**
- Modify: `docs/index.html`
- Modify: `src/Index.html`
- Modify: `docs/app.js`
- Modify: `src/JavaScript.html`

- [ ] **Step 1: Add toast live-region attributes**

Change the toast container in both `docs/index.html` and `src/Index.html` to:

```html
<div id="toast" role="status" aria-live="polite" aria-atomic="true"><span class="toast-bar"></span><span class="toast-icon"></span><span class="toast-msg"></span></div>
```

- [ ] **Step 2: Update the toast helper**

In both `docs/app.js` and `src/JavaScript.html`, replace the existing `toast` function with:

```js
function toast(msg, type, detail){
  var t=document.getElementById('toast');
  var icons={ok:'✓', err:'✕', warn:'!'};
  var icon=icons[type]||'ℹ';
  var ic=t.querySelector('.toast-icon');
  var m=t.querySelector('.toast-msg');
  t.setAttribute('role', type==='err'?'alert':'status');
  t.setAttribute('aria-live', type==='err'?'assertive':'polite');
  if(ic) ic.textContent=icon;
  if(m){
    m.innerHTML='<span class="toast-title">'+esc(msg||'')+'</span>'+
      (detail?'<span class="toast-detail">'+esc(detail)+'</span>':'');
  }
  t.className='show '+(type||'');
  clearTimeout(toastT);
  toastT=setTimeout(function(){ t.className=''; }, detail?4200:3200);
}
```

- [ ] **Step 3: Update record action markup**

In both UI scripts, update the pending note and action buttons inside `paintRecords` to use:

```js
(isPending&&photoCount?'<div class="sync-note"><span class="sync-dot"></span><span>جارٍ رفع '+photoCount+' صورة</span></div>':'')+
```

and:

```js
'<div class="ops record-actions" aria-label="إجراءات الفعالية">'+
  '<button class="btn btn-view btn-sm btn-command btn-command-primary" onclick="viewActivity(\''+o.id+'\')"><span class="ico" aria-hidden="true">◉</span><span>عرض</span></button>'+
  (isPending?'':'<button class="btn btn-edit btn-sm btn-command" onclick="editActivity(\''+o.id+'\')"><span class="ico" aria-hidden="true">✎</span><span>تعديل</span></button>')+
  (isPending?'':'<button class="btn btn-print btn-sm btn-command" id="pdfBtn_'+escAttr(o.id)+'" onclick="prepareExportPdf(\''+o.id+'\')"><span class="ico" aria-hidden="true">⇩</span><span>PDF</span></button>')+
  (isPending?'':'<button class="btn btn-danger-text btn-sm btn-command" id="delBtn_'+escAttr(o.id)+'" aria-label="حذف '+escAttr(o.title)+'" onclick="askDelete(\''+o.id+'\')"><span>حذف</span></button>')+
'</div></div>';
```

- [ ] **Step 4: Update save/upload/delete messages**

In both UI scripts:

Change local save toast in `onSavedLocal` to:

```js
toast('تم الحفظ محليًا','warn','جارٍ رفع الصور والبيانات عند توفر الاتصال.');
```

In `syncOutbox`, after a successful flush with `r.sent > 0`, add:

```js
toast('تم الرفع','ok','أصبحت الفعالية متاحة في السجل والتقارير.');
```

Change delete success to:

```js
toast('تم الحذف','ok','أزيلت الفعالية من السجل.');
```

Change delete failure to:

```js
toast('لم يكتمل الحذف','err','لم تتغير البيانات. أعد المحاولة.');
```

- [ ] **Step 5: Run tests and syntax check**

Run:

```powershell
npm test
node --check docs/app.js
node -e "const fs=require('fs'); let s=fs.readFileSync('src/JavaScript.html','utf8').trim(); if(s.startsWith('<script>')) s=s.slice(8); if(s.endsWith('</script>')) s=s.slice(0,-9); new Function(s); console.log('src JavaScript syntax ok')"
```

Expected: tests pass and both syntax checks pass.

- [ ] **Step 6: Commit markup and behavior**

```powershell
git add docs/index.html src/Index.html docs/app.js src/JavaScript.html
git commit -m "feat: improve action and notification behavior"
```

---

### Task 3: Implement Calm Styling

**Files:**
- Modify: `docs/styles.css`
- Modify: `src/Stylesheet.html`

- [ ] **Step 1: Add approved action/toast styles**

In both stylesheets, update or add CSS for:

```css
.btn:focus-visible{outline:3px solid rgba(154,123,63,.35);outline-offset:2px}
.btn-command{min-width:78px;height:34px;padding:7px 12px;border-radius:7px}
.btn-command-primary{background:var(--brand);border-color:var(--brand);color:#fff}
.btn-command-primary:hover{background:var(--brand-deep)}
.btn-danger-text{background:transparent;color:var(--err);border-color:transparent}
.btn-danger-text:hover{background:#fff4f4;border-color:rgba(178,59,59,.25);box-shadow:none}
.record-actions{align-items:stretch}
.sync-note{display:inline-flex;align-items:center;gap:7px;margin:-2px 0 6px;padding:4px 9px;border:1px solid #e7d0a4;border-radius:999px;background:#fff8eb;color:#7a5a15;font-size:11.5px;font-weight:700}
.sync-dot{width:6px;height:6px;border-radius:50%;background:#b7812c;box-shadow:0 0 0 3px rgba(183,129,44,.14)}
#toast.warn .toast-bar{background:#b7812c}
#toast.warn .toast-icon{color:#b7812c}
.toast-title{display:block}
.toast-detail{display:block;color:var(--muted);font-size:12px;font-weight:500;margin-top:2px}
```

- [ ] **Step 2: Run verification**

Run:

```powershell
npm test
node --check docs/app.js
```

Expected: PASS.

- [ ] **Step 3: Commit styling**

```powershell
git add docs/styles.css src/Stylesheet.html
git commit -m "style: refine action buttons and notifications"
```

---

### Task 4: Browser Verification

**Files:**
- Verify: all changed UI files.

- [ ] **Step 1: Start local server**

Run:

```powershell
python -m http.server 4174 --directory docs
```

- [ ] **Step 2: Open `http://localhost:4174/` and verify**

Check:

1. Buttons use the approved visual hierarchy.
2. Toast has a title/detail layout.
3. Toast is not visually overlapping critical controls on mobile width.
4. Keyboard focus is visible on buttons.

- [ ] **Step 3: Final verification**

Run:

```powershell
npm test
git status --short
```

Expected: tests pass and working tree is clean after commits.
