# Athar Export Fallback And Excel Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "العملية غير مسموحة" export fallback path and move Excel report summary rows above the table while keeping preparer metadata below it.

**Architecture:** Keep Apps Script as the source of truth. Add regression tests that parse server and bridge allow-lists, add a small pure layout helper for Excel row positions, then update the existing spreadsheet builder to use those row positions. Add an inline-download fallback modal so browser download blocking has a visible manual path.

**Tech Stack:** Google Apps Script V8, static GitHub Pages JavaScript, Node `node:test`.

---

### Task 1: Bridge Allow-List Parity

**Files:**
- Modify: `tests/actions-notifications-ui.test.cjs`
- Modify: `src/Bridge.html`

- [ ] **Step 1: Write failing test**

Add a test that extracts every `API_METHODS` key from `src/Code.gs` and asserts `src/Bridge.html` allows the same method names. The test must fail while `getPeriodReportReadiness`, `getActivityReportReadiness`, and `exportActivitiesPdfDownload` are missing from the bridge.

- [ ] **Step 2: Run failing test**

Run: `node --test tests/actions-notifications-ui.test.cjs`
Expected: FAIL with missing bridge method assertions.

- [ ] **Step 3: Implement bridge parity**

Add the missing method names to `ALLOWED_METHODS` in `src/Bridge.html`.

- [ ] **Step 4: Run passing test**

Run: `node --test tests/actions-notifications-ui.test.cjs`
Expected: PASS.

### Task 2: Excel Row Layout

**Files:**
- Modify: `tests/report-readiness.test.cjs`
- Modify: `src/Code.gs`

- [ ] **Step 1: Write failing layout test**

Add a test for `activitiesExcelLayout_(6)` expecting `summaryStart: 1`, `headerRow: 7`, `dataStart: 8`, `preparedStart: 15`, and `tableRows: 7`.

- [ ] **Step 2: Run failing test**

Run: `node --test tests/report-readiness.test.cjs`
Expected: FAIL because `activitiesExcelLayout_` is not defined.

- [ ] **Step 3: Implement helper and apply layout**

Add `activitiesExcelLayout_` near the Excel builder. Update `buildActivitiesExcelBlob_` so summary rows start at row 1, headers start at `layout.headerRow`, data at `layout.dataStart`, borders use `layout.headerRow`, frozen rows use `layout.headerRow`, and preparer rows use `layout.preparedStart`.

- [ ] **Step 4: Run passing test**

Run: `node --test tests/report-readiness.test.cjs`
Expected: PASS.

### Task 3: Inline Download Fallback

**Files:**
- Modify: `tests/actions-notifications-ui.test.cjs`
- Modify: `docs/app.js`
- Modify: `src/JavaScript.html`

- [ ] **Step 1: Write failing UI test**

Add a test that both UI scripts call `showInlineDownloadFallback` from `handleDownloadResponse` when an inline base64 file is returned.

- [ ] **Step 2: Run failing test**

Run: `node --test tests/actions-notifications-ui.test.cjs`
Expected: FAIL because no inline fallback helper exists.

- [ ] **Step 3: Implement UI fallback**

For inline responses, convert base64 to a Blob, generate an object URL, trigger the automatic download, then open a modal with a "تحميل الملف" link using the same object URL. Revoke the URL when the modal closes or after a long timeout.

- [ ] **Step 4: Run passing test**

Run: `node --test tests/actions-notifications-ui.test.cjs`
Expected: PASS.

### Task 4: Full Verification

**Files:**
- No production changes.

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: PASS.

