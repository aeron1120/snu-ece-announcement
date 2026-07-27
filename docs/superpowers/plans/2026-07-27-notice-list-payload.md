# Notice List Payload Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-megabyte eager notice download with a 20-item summary page and fetch full notice bodies only when needed.

**Architecture:** The server exposes separate summary-page and detail-query paths. The browser keeps summary pagination state, appends pages on demand, and upgrades a summary to a full notice through a deduplicated detail request before rendering detail-dependent UI.

**Tech Stack:** Node.js 22, Express 4, Supabase/PostgREST, browser JavaScript, Node test runner

## Global Constraints

- The initial notice request is `GET /api/notices?page=1&limit=20`.
- List objects never contain `content`, `rawContent`, `images`, `attachments`, or crawler payloads.
- Detail objects retain complete public content and images.
- Existing Base64-to-Supabase-Storage migration and WebP/AVIF generation are out of scope.
- Source assets are edited first; `npm.cmd run prepare:public` generates `public/`.

---

### Task 1: Lean server list and direct detail lookup

**Files:**
- Modify: `server/server.js`
- Modify: `server/sql/supabase-schema.sql`
- Modify: `tests/server-public-api.test.js`

**Interfaces:**
- Produces: `toNoticeSummary(notice) -> NoticeSummary`
- Produces: `listNoticeSummaries({ page, limit, categoryIds }) -> { notices, pagination }`
- Produces: `getPublishedNoticeById(id) -> Notice | null`
- API: `GET /api/notices?page=<number>&limit=<number>&category=<ids>`
- API: `GET /api/notices/:id`

- [ ] **Step 1: Write the failing list-contract integration test**

Extend the public API fixture test to require a default limit of 20 and assert
that every returned list item has `hasImages` but none of these keys:

```js
for (const notice of list.notices) {
    assert.equal(typeof notice.hasImages, 'boolean');
    for (const heavyKey of [
        'content', 'rawContent', 'images', 'attachments', 'crawlMetadata'
    ]) {
        assert.equal(Object.hasOwn(notice, heavyKey), false);
    }
}
assert.equal(defaultList.pagination.limit, 20);
assert.ok(Buffer.byteLength(defaultListText) < 100_000);
```

Also fetch the first ID and assert the detail has its `content` key and, for a
notice known to have images, its `images` array.

- [ ] **Step 2: Run the server test and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="public notice API"
```

Expected: FAIL because list objects still expose heavy fields, the default
limit is 50, and the response exceeds 100 KB.

- [ ] **Step 3: Add the summary mapper and file-mode page/detail operations**

Add a mapper that explicitly constructs only:

```js
{
    id, title, target, targets, host, deadline, aiSummary, keywords,
    categoryIds, views, sourcePublishedAt, createdAt, updatedAt,
    hasImages: Array.isArray(notice.images) && notice.images.length > 0
}
```

In file mode, merge and sort manual and automated published notices, slice only
the requested page, then map that slice. Detail lookup reads manual notices
first and falls back to `automationStore.getAutomationNotice(id)`, rejecting
deleted or non-published records.

- [ ] **Step 4: Add bounded Supabase page and detail queries**

Add `has_images` to the schema as a stored boolean maintained by a trigger when
`images` changes. Backfill it from `jsonb_array_length(images)`.

Query only the summary columns plus `notice_categories(category_id)`, use
`select(..., { count: 'exact' })`, apply category filtering, and apply
`.range(offset, offset + limit - 1)`. Detail lookup uses `.eq('id', id)`,
published/deleted filters, and `.maybeSingle()`.

- [ ] **Step 5: Route through the new operations**

Parse `page` with a minimum of 1 and `limit` with a default of 20 and maximum of
50. Return `listNoticeSummaries(...)` directly. Replace the detail route's
`listNotices().find(...)` with `getPublishedNoticeById(id)`.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS and page 1 is below 100 KB.

- [ ] **Step 7: Commit**

```powershell
git add server/server.js server/sql/supabase-schema.sql tests/server-public-api.test.js
git commit -m "fix: return lean paginated notice summaries"
```

### Task 2: Browser paging and lazy detail loading

**Files:**
- Modify: `js/app.js`
- Modify: `tests/public-build.test.js`

**Interfaces:**
- Consumes: Task 1 list and detail API contracts
- Produces: `loadNoticePage(page, { replace }) -> Promise<void>`
- Produces: `loadMoreNotices() -> Promise<void>`
- Produces: `getNoticeDetail(id) -> Promise<Notice>`
- Changes: `openDetail(id)` and `openCompareModal()` return promises

- [ ] **Step 1: Write failing browser behavior tests**

Execute the real paging/detail functions with a controlled `apiRequest` fake
and assert observable state:

```js
await loadNoticePage(1, { replace: true });
assert.deepEqual(requestedPaths, ['/api/notices?page=1&limit=20']);
assert.deepEqual(notices.map(item => item.id), [1, 2]);

await loadMoreNotices();
assert.deepEqual(requestedPaths, [
    '/api/notices?page=1&limit=20',
    '/api/notices?page=2&limit=20'
]);
assert.deepEqual(notices.map(item => item.id), [1, 2, 3]);
```

For detail loading, call `getNoticeDetail(1)` twice concurrently and assert one
detail request is made, the complete object replaces the summary fields, and
the resolved object contains `content`.

- [ ] **Step 2: Run the focused browser tests and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="notice paging|lazy notice detail"
```

Expected: FAIL because the current browser downloads every page at startup and
does not expose the new operations.

- [ ] **Step 3: Replace eager collection with page state**

Introduce:

```js
const NOTICE_PAGE_SIZE = 20;
let noticePagination = { page: 0, limit: 20, total: 0, totalPages: 0 };
const noticeDetailRequests = new Map();
```

`loadNoticePage` requests one page, replaces or appends by unique string ID,
updates pagination, and re-renders cards and the load-more control.
`loadData` calls only page 1 with `{ replace: true }`.
`refreshPublishedNotices` also reloads page 1 with `{ replace: true }`, so
create/update/publish operations do not restore the eager all-page download.

- [ ] **Step 4: Add deduplicated detail loading**

`getNoticeDetail(id)` returns an already complete object when it has an own
`content` property. Otherwise it shares one promise per ID, requests the detail
endpoint, merges the result into the matching summary, and always removes the
settled promise from `noticeDetailRequests`.

- [ ] **Step 5: Make detail and comparison paths await full objects**

Make `openDetail` await `getNoticeDetail` before incrementing views or rendering
the modal. Make `openCompareModal` load every selected detail with
`Promise.all(compareList.map(getNoticeDetail))` before building columns.
Deep-link loading continues to use the detail endpoint.

Use:

```js
const hasImg = Object.hasOwn(notice, 'hasImages')
    ? notice.hasImages
    : Array.isArray(notice.images) && notice.images.length > 0;
```

Cards do not render Base64 image previews from summary records.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS with exactly one startup list request and one shared detail
request per notice.

- [ ] **Step 7: Commit**

```powershell
git add js/app.js tests/public-build.test.js
git commit -m "fix: load notice pages and details on demand"
```

### Task 3: Load-more UI and generated public assets

**Files:**
- Modify: `index.html`
- Modify: `css/style.css`
- Regenerate: `public/index.html`
- Regenerate: `public/css/style.css`
- Regenerate: `public/js/app.js`
- Modify: `tests/public-build.test.js`

**Interfaces:**
- Consumes: `loadMoreNotices()` and `noticePagination` from Task 2
- Produces: `#notice-load-more`, `#notice-load-more-status`

- [ ] **Step 1: Write the failing UI behavior test**

Build the public directory in a temporary root and assert that the page contains
a load-more button wired to `loadMoreNotices()`. Execute
`updateNoticePaginationUI()` against stub elements and assert the button is
hidden on the last page, visible before the last page, and disabled while a
request is running.

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="notice load-more"
```

Expected: FAIL because the controls and updater do not exist.

- [ ] **Step 3: Add accessible controls and styling**

Place the controls immediately after `#notice-grid`:

```html
<div class="notice-pagination" id="notice-pagination">
  <button class="btn btn-outline" id="notice-load-more"
          type="button" onclick="loadMoreNotices()">더 보기</button>
  <p id="notice-load-more-status" aria-live="polite"></p>
</div>
```

Style the container as a centered vertical group. The updater reports
`loaded / total`, hides the button when `page >= totalPages`, and restores the
button after request failures.

- [ ] **Step 4: Generate deployable assets**

Run:

```powershell
npm.cmd run prepare:public
```

- [ ] **Step 5: Run the focused UI test and verify GREEN**

Run the command from Step 2.

Expected: PASS for source and generated files.

- [ ] **Step 6: Commit**

```powershell
git add index.html css/style.css js/app.js public tests/public-build.test.js
git commit -m "feat: add notice load-more control"
```

### Task 4: Regression and payload verification

**Files:**
- Modify only if a regression directly caused by Tasks 1-3 is found

**Interfaces:**
- Verifies all earlier task contracts

- [ ] **Step 1: Run the complete test suite**

```powershell
npm.cmd test
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Measure the live local API**

Start `app` on an ephemeral loopback port, fetch
`/api/notices?page=1&limit=20`, and print byte length, notice count, and keys.

Expected:

- response below 100,000 bytes;
- no heavy list keys;
- at most 20 notices.

- [ ] **Step 3: Verify generated assets and diff hygiene**

```powershell
npm.cmd run prepare:public
git diff --check
git status --short
```

Expected: generated files match sources, no whitespace errors, and only intended
changes remain.

- [ ] **Step 4: Commit any direct regression fix**

If Step 1-3 required a code correction, commit only those files:

```powershell
git add <corrected-files>
git commit -m "fix: preserve notice list regressions"
```
