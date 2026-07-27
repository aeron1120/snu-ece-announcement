# Notice Thumbnail and Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore equal-size image cards while transferring only viewport thumbnails and loading complete image galleries on detail open.

**Architecture:** A focused thumbnail service converts the first Base64 notice image to a cached 640-pixel WebP and exposes it through a public endpoint. Notice summaries carry only a thumbnail URL, while browser observers load card thumbnails and subsequent summary pages as they approach the viewport; the existing detail API remains the only source of original image arrays.

**Tech Stack:** Node.js 22, Express 4, Sharp, Supabase/PostgreSQL, browser JavaScript, CSS Grid, IntersectionObserver, Node test runner

## Global Constraints

- All cards at the same breakpoint have equal total height.
- Real and default thumbnails use centered `object-fit: cover`.
- The supplied SNU ECE notice artwork is the no-image and error fallback.
- List JSON never contains Base64 image content.
- Card thumbnails are at most 640 pixels wide and encoded as WebP.
- Original image arrays load only through `GET /api/notices/:id`.
- Summary pages contain at most 20 notices.
- Existing unrelated edits in `docs/superpowers/specs/2026-07-27-side-rails-masonry-design.md` must not be staged, reformatted, or reverted.

---

### Task 1: Default thumbnail asset and image dependency

**Files:**
- Create: `icons/default-notice-thumbnail.png`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/public-build.test.js`
- Regenerate: `public/icons/default-notice-thumbnail.png`

**Interfaces:**
- Produces: canonical fallback URL `/icons/default-notice-thumbnail.png`
- Produces: `sharp` runtime dependency for Task 2

- [ ] **Step 1: Install Sharp**

Run:

```powershell
npm.cmd install sharp
```

Expected: `package.json` and `package-lock.json` record a Node 22-compatible
Sharp release.

- [ ] **Step 2: Write the failing canonical asset test**

Add a public build test that reads the canonical and generated files, verifies
the PNG metadata with Sharp, and asserts exact byte preservation:

```js
const canonical = await readFile('icons/default-notice-thumbnail.png');
const generated = await readFile('public/icons/default-notice-thumbnail.png');
const metadata = await sharp(canonical).metadata();
assert.equal(metadata.format, 'png');
assert.equal(metadata.width, 1024);
assert.equal(metadata.height, 1024);
assert.deepEqual(
    generated,
    canonical
);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="default notice thumbnail"
```

Expected: FAIL with `ENOENT` because the canonical asset does not yet exist.

- [ ] **Step 4: Save the supplied image without redesigning it**

Use the image supplied in the conversation as the content of:

`icons/default-notice-thumbnail.png`

Keep its square composition, typography, logo, colors, and whitespace. Do not
generate a different illustration or add overlays.

- [ ] **Step 5: Generate public assets and verify GREEN**

Run:

```powershell
npm.cmd run prepare:public
node --test --test-concurrency=1 --test-name-pattern="default notice thumbnail"
```

Expected: PASS and the public PNG is byte-identical to the canonical PNG.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json icons/default-notice-thumbnail.png public/icons/default-notice-thumbnail.png tests/public-build.test.js
git commit -m "feat: add default notice thumbnail asset"
```

### Task 2: Cached WebP thumbnail service

**Files:**
- Create: `server/services/notice-thumbnail-service.js`
- Create: `tests/notice-thumbnail-service.test.js`

**Interfaces:**
- Produces: `createNoticeThumbnailService({ cacheDir })`
- Produces: `getThumbnail({ id, updatedAt, image }) -> Promise<{ kind, body?, etag? }>`
- `kind` is exactly `'webp'` or `'default'`

- [ ] **Step 1: Write failing conversion, fallback, and cache tests**

Generate a real 1200×800 PNG fixture with Sharp, encode it as a data URL, and
assert real output behavior:

```js
const source = await sharp({
    create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: '#3355aa'
    }
}).png().toBuffer();
const image = `data:image/png;base64,${source.toString('base64')}`;
const service = createNoticeThumbnailService({ cacheDir });
const result = await service.getThumbnail({
    id: 7,
    updatedAt: '2026-07-27T00:00:00.000Z',
    image
});
const metadata = await sharp(result.body).metadata();
assert.equal(result.kind, 'webp');
assert.equal(metadata.format, 'webp');
assert.equal(metadata.width, 640);
assert.ok(result.body.length < source.length);
```

Call the same request twice and assert the second result has the same ETag and
cache file. Change `updatedAt` and assert a different ETag/cache file. Pass an
empty or malformed data URL and assert `{ kind: 'default' }`.

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```powershell
node --test tests/notice-thumbnail-service.test.js
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the minimal service**

Implement:

```js
export function createNoticeThumbnailService({ cacheDir }) {
    return {
        async getThumbnail({ id, updatedAt, image }) {
            // validate a data:image/*;base64 URL
            // hash `${id}:${updatedAt}` for a safe cache filename and ETag
            // return cached bytes when present
            // resize with sharp(...).resize({ width: 640, withoutEnlargement: true })
            // encode with .webp({ quality: 76 })
            // atomically write the cache file
            // return { kind: 'default' } for invalid or failed conversions
        }
    };
}
```

Cache failures must not fail the notice list or detail API.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run the command from Step 2.

Expected: all conversion, fallback, reuse, and invalidation tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/services/notice-thumbnail-service.js tests/notice-thumbnail-service.test.js
git commit -m "feat: generate cached WebP notice thumbnails"
```

### Task 3: Thumbnail data lookup and public endpoint

**Files:**
- Create: `server/routes/notice-thumbnail-route.js`
- Create: `tests/notice-thumbnail-route.test.js`
- Modify: `server/server.js`
- Modify: `server/sql/supabase-schema.sql`
- Modify: `tests/server-public-api.test.js`

**Interfaces:**
- Consumes: Task 2 `getThumbnail`
- Produces: `createNoticeThumbnailRouter({ loadSource, thumbnailService, defaultUrl })`
- Produces: `loadPublishedNoticeThumbnailSource(id) -> { id, updatedAt, image } | null`
- API: `GET /api/notices/:id/thumbnail`
- Summary: `thumbnailUrl`

- [ ] **Step 1: Write the failing summary contract test**

Extend the summary mapper test with literal expectations:

```js
assert.equal(
    toNoticeSummary({ id: 42, images: [], hasImages: false }).thumbnailUrl,
    '/icons/default-notice-thumbnail.png'
);
assert.equal(
    toNoticeSummary({ id: 43, images: ['data:image/png;base64,AA=='] }).thumbnailUrl,
    '/api/notices/43/thumbnail?v=0'
);
assert.doesNotMatch(JSON.stringify(summary), /data:image/);
```

- [ ] **Step 2: Write failing route behavior tests**

Mount the real router on a temporary Express app. Use a real Task 2 service with
a temporary cache and a controlled `loadSource` function.

Assert:

- a published image source returns `200`, `image/webp`, ETag, and immutable
  cache headers;
- `If-None-Match` returns `304`;
- missing, empty, and malformed sources redirect to
  `/icons/default-notice-thumbnail.png`;
- invalid IDs return `400`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="thumbnail URL|notice thumbnail route"
```

Expected: FAIL because summaries have no URL and the route does not exist.

- [ ] **Step 4: Add dedicated first-image storage lookup**

File mode finds the published notice using existing file/store operations and
returns only:

```js
{
    id: Number(notice.id),
    updatedAt: notice.updatedAt || notice.createdAt || '',
    image: Array.isArray(notice.images) ? notice.images[0] || '' : ''
}
```

Supabase schema adds a service-role-only function:

```sql
create or replace function public.get_notice_thumbnail_source(target_notice_id bigint)
returns table(id bigint, updated_at timestamptz, image text)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.updated_at, n.images->>0
  from public.notices n
  where n.id = target_notice_id
    and n.status = 'published'
    and n.is_deleted = false;
$$;
```

The Node Supabase path calls this function so the full image array is not
transferred to the server.

- [ ] **Step 5: Add summary URLs and mount the route**

`toNoticeSummary` uses `updatedAt`, then `createdAt`, then `'0'` as a version
token and sets:

```js
thumbnailUrl: hasImages
    ? `/api/notices/${notice.id}/thumbnail?v=${encodeURIComponent(
        notice.updatedAt || notice.createdAt || '0'
      )}`
    : '/icons/default-notice-thumbnail.png'
```

Create the service with cache directory
`server/data/thumbnail-cache`, then mount the router before the generic
`/api/notices/:id` route.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 3.

Expected: summary and route tests pass.

- [ ] **Step 7: Commit**

```powershell
git add server/server.js server/routes/notice-thumbnail-route.js server/sql/supabase-schema.sql tests/server-public-api.test.js tests/notice-thumbnail-route.test.js
git commit -m "feat: expose lazy notice thumbnail URLs"
```

### Task 4: Viewport image loader and infinite pagination observer

**Files:**
- Modify: `js/app.js`
- Modify: `index.html`
- Modify: `tests/public-build.test.js`

**Interfaces:**
- Consumes: summary `thumbnailUrl`
- Produces: `createNoticeViewportLoader({ IntersectionObserverCtor, resolveUrl, defaultUrl })`
- Produces: `observeThumbnail(img)`
- Produces: `observePaginationSentinel(element, loadNextPage)`

- [ ] **Step 1: Write failing viewport behavior tests**

Execute the real loader factory with a controlled observer class. Assert:

```js
loader.observeThumbnail(image);
assert.equal(image.src, '');
thumbnailObserver.emit({ target: image, isIntersecting: true });
assert.equal(image.src, 'https://api.test/api/notices/7/thumbnail');
assert.equal(image.dataset.thumbnailSrc, undefined);
```

Verify an offscreen entry keeps `src` empty. Dispatch an `error` event and
assert the image changes once to `/icons/default-notice-thumbnail.png`.

For the pagination sentinel, emit intersecting entries twice while the first
`loadNextPage` promise is pending and assert only one call. Resolve it, emit
again, and assert a second call.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="viewport thumbnails|pagination sentinel"
```

Expected: FAIL because the loader factory does not exist.

- [ ] **Step 3: Implement thumbnail observation**

The thumbnail observer uses `rootMargin: '160px 0px'`. API-relative thumbnail
paths pass through `buildApiUrl`; static icon paths stay on the frontend origin.
After setting `src`, remove `data-thumbnail-src` and unobserve the image.

When `IntersectionObserver` is unavailable, immediately assign `src` for the
current page only.

- [ ] **Step 4: Implement automatic next-page observation**

Add a sentinel:

```html
<div id="notice-scroll-sentinel" aria-hidden="true"></div>
```

The pagination observer calls the existing guarded `loadMoreNotices()`. After
`filterCards` appends/rebuilds cards, register all still-unloaded thumbnails.
Keep the load-more button as a visible keyboard fallback.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: offscreen, intersecting, fallback, error, and concurrency behaviors
all pass.

- [ ] **Step 6: Commit**

```powershell
git add js/app.js index.html tests/public-build.test.js
git commit -m "feat: lazy-load visible notice thumbnails"
```

### Task 5: Equal-height cover-cropped card grid

**Files:**
- Modify: `css/style.css`
- Modify: `js/app.js`
- Modify: `tests/public-build.test.js`
- Regenerate: `public/css/style.css`
- Regenerate: `public/js/app.js`
- Regenerate: `public/index.html`
- Regenerate: `public/icons/default-notice-thumbnail.png`

**Interfaces:**
- Consumes: Task 3 `thumbnailUrl`, Task 4 `observeThumbnail`
- Produces: fixed-height `.card`, flexible `.card-thumbnail`, clamped `.card h3`

- [ ] **Step 1: Write the failing rendered-card contract test**

Run `filterCards` with a summary fixture and a real document stub. Assert the
created card contains:

```html
<div class="card-thumbnail">
  <img class="card-img-preview"
       data-thumbnail-src="/icons/default-notice-thumbnail.png">
</div>
```

Assert every card has this wrapper even when `hasImages` is false.

- [ ] **Step 2: Write the failing layout contract test**

Read the generated CSS and assert the effective layout contract:

- `.grid` uses `display: grid` with responsive `grid-template-columns`;
- `.card` has a fixed height;
- `.card-thumbnail` has `flex: 1` and a minimum height;
- `.card-img-preview` fills width and height with `object-fit: cover`;
- `.card h3` uses a two-line clamp;
- old `column-count` and `break-inside` masonry declarations are absent.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test --test-concurrency=1 --test-name-pattern="equal-height notice cards|rendered notice thumbnail"
```

Expected: FAIL because cards are masonry blocks and no-image notices omit the
image element.

- [ ] **Step 4: Render every card with a deferred thumbnail**

Replace conditional Base64 markup with:

```js
const thumbnailUrl = notice.thumbnailUrl
    || '/icons/default-notice-thumbnail.png';
const imgHtml = `
  <div class="card-thumbnail">
    <img class="card-img-preview"
         alt=""
         data-thumbnail-src="${escapeHtml(thumbnailUrl)}">
  </div>`;
```

Do not assign `src` during card construction.

- [ ] **Step 5: Replace masonry with equal-height grid CSS**

Use:

```css
.grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 20px;
}
.card {
    height: 420px;
}
.card-thumbnail {
    flex: 1 1 auto;
    min-height: 180px;
    overflow: hidden;
}
.card-img-preview {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    object-position: center;
}
.card h3 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
```

Use three, two, and one grid columns at the existing breakpoints. On narrow
mobile screens use a 390-pixel card height while preserving the same cover
behavior.

- [ ] **Step 6: Generate deployable assets and verify GREEN**

Run:

```powershell
npm.cmd run prepare:public
node --test --test-concurrency=1 --test-name-pattern="equal-height notice cards|rendered notice thumbnail"
```

Expected: source and public tests pass.

- [ ] **Step 7: Commit**

```powershell
git add css/style.css js/app.js public index.html tests/public-build.test.js
git commit -m "feat: render equal-height thumbnail cards"
```

### Task 6: Regression, payload, and runtime verification

**Files:**
- Modify only files directly responsible for a discovered regression

**Interfaces:**
- Verifies all earlier contracts

- [ ] **Step 1: Run the complete suite**

```powershell
npm.cmd test
```

Expected: zero failures.

- [ ] **Step 2: Rebuild and verify source/public parity**

```powershell
npm.cmd run prepare:public
git diff --exit-code -- public
```

Expected: generated public files match canonical sources.

- [ ] **Step 3: Verify live list and thumbnail responses**

Run the server on a loopback port and fetch one list page.

Expected:

- list JSON is below 100 KB;
- list JSON contains `thumbnailUrl` and no `data:image`;
- a real thumbnail response is `image/webp`, at most 640 pixels wide, and
  smaller than its original image;
- a no-image thumbnail path is the supplied default asset;
- detail JSON still contains the complete original image array.

- [ ] **Step 4: Verify scroll/loading behavior in a browser**

Open the local site and confirm:

- initial visible cards request thumbnails;
- offscreen cards have not assigned `src`;
- scrolling assigns their thumbnail URLs;
- reaching the sentinel appends the next summary page once;
- all cards keep equal height;
- the supplied default artwork fills no-image cards with centered cropping;
- opening an image notice renders its complete gallery.

- [ ] **Step 5: Check diff hygiene**

Run:

```powershell
git diff --check -- . ':(exclude)docs/superpowers/specs/2026-07-27-side-rails-masonry-design.md'
git status --short
```

Expected: no whitespace errors from this feature and the pre-existing unrelated
document edit remains unstaged.

- [ ] **Step 6: Commit direct regression fixes only if needed**

```powershell
git add package.json package-lock.json icons/default-notice-thumbnail.png server/services/notice-thumbnail-service.js server/routes/notice-thumbnail-route.js server/server.js server/sql/supabase-schema.sql js/app.js css/style.css index.html public tests/notice-thumbnail-service.test.js tests/notice-thumbnail-route.test.js tests/server-public-api.test.js tests/public-build.test.js
git commit -m "fix: preserve lazy thumbnail behavior"
```
