# Notice Thumbnail and Lazy Loading Design

## Problem

The optimized notice list no longer transfers Base64 images, which reduced the
initial list response from megabytes to a few kilobytes. However, removing card
images entirely is not the desired experience.

The notice grid must retain a consistent visual block for every notice, use a
provided SNU ECE default image when a notice has no photo, and transfer only the
small thumbnails needed for cards currently entering the viewport. Full notice
images must remain deferred until the detail view opens.

## Goals

- Render every notice in an equal-height card.
- Let the natural, line-clamped text area determine how much of the fixed card
  remains available for the thumbnail.
- Fill the remaining thumbnail area with `object-fit: cover` and centered
  cropping.
- Use the user-provided SNU ECE notice image as the default thumbnail.
- Transfer only resized thumbnails for cards near the viewport.
- Load additional summary pages as the user scrolls.
- Load the selected notice's full content and original image array only when its
  detail view opens.
- Keep the lean summary API free of Base64 image data.

## Non-goals

- Migrating every existing original image to Supabase Storage in this change.
- Changing notice authoring, AI summaries, categories, or notification logic.
- Preloading original gallery images from the list screen.

## Card Layout

The masonry column layout is replaced by a responsive CSS Grid. Every card has
the same fixed height at a given breakpoint.

Each card is a vertical flex container:

1. The thumbnail region grows to consume the space left by the text region.
2. The text region keeps its natural height within explicit line clamps.
3. Titles are clamped to two lines and summaries to three lines.
4. A minimum thumbnail height prevents text-heavy cards from eliminating the
   image.

Both real thumbnails and the default image use:

```css
object-fit: cover;
object-position: center;
```

The user accepts that the default image's top or bottom may be cropped to fill
the thumbnail region.

## Thumbnail Asset

The supplied SNU ECE notice artwork is stored as:

`icons/default-notice-thumbnail.png`

The public build copies it to:

`public/icons/default-notice-thumbnail.png`

Notices without images use this asset directly. Thumbnail errors also fall back
to it.

## Server Thumbnail Flow

The list summary exposes:

- `hasImages`
- `thumbnailUrl`

For a notice with images, `thumbnailUrl` points to:

`GET /api/notices/:id/thumbnail?v=:updatedAt`

For a notice without images, it points directly to the static default asset.

The thumbnail endpoint:

1. Validates that the notice is published and active.
2. Reads only the first original image through a dedicated storage query.
3. Decodes the existing Base64 data.
4. Resizes it to a maximum width of 640 pixels.
5. Converts it to WebP with `sharp` and a balanced quality setting.
6. Stores the result in a local ignored cache keyed by notice ID and
   `updatedAt`.
7. Returns cache headers and an ETag.

The first request performs the conversion; later requests reuse the cached
thumbnail. An update to the notice changes both the cache key and the versioned
URL, so browser and server caches do not reuse stale thumbnails.

File mode stores generated thumbnails under
`server/data/thumbnail-cache/`. The directory remains ignored by Git. A later
Supabase Storage migration may replace this cache without changing the browser
contract.

Supabase mode uses a small SQL function to return the first JSON image value
without transferring the rest of the image array to the Node server.

If the original image is missing, malformed, unsupported, or conversion fails,
the endpoint redirects to the default thumbnail instead of returning a broken
image.

## Browser Loading Flow

### Summary pages

Startup requests only:

`GET /api/notices?page=1&limit=20`

Cards render immediately with an empty thumbnail element whose URL is stored in
`data-thumbnail-src`.

### Viewport thumbnail loading

One `IntersectionObserver` watches card thumbnails. When a thumbnail enters the
viewport or a small preload margin, the browser:

1. copies `data-thumbnail-src` to `src`;
2. removes the data attribute;
3. unobserves the image.

An image error replaces `src` with the default asset exactly once.

### Infinite summary loading

A second `IntersectionObserver` watches the pagination sentinel below the grid.
When it approaches the viewport and another page exists, it requests the next
20 summaries, appends unique cards, and registers their thumbnail elements.

The existing load-more button remains visible as a keyboard-accessible and
failure-recovery fallback. Concurrent next-page requests are prevented.

### Detail loading

Opening a card continues to request:

`GET /api/notices/:id`

Only this response contains the full body, attachments, and complete original
image array. The gallery renders after that request succeeds.

## Error Handling

- Thumbnail conversion failure: serve the default thumbnail.
- Browser image failure: swap to the default thumbnail once.
- Next-page failure: retain current cards, restore the load-more control, and
  show the existing retry message.
- Detail failure: leave the list intact and show the existing detail-load error.
- Browsers without `IntersectionObserver`: load the current page's thumbnails
  immediately and keep the load-more button as the pagination mechanism.

## Testing

Tests must be written before production changes and prove:

- Summary objects expose a URL but never Base64 image content.
- No-image summaries use the default asset URL.
- The thumbnail endpoint returns a small WebP for a Base64 source image.
- Malformed or missing source images fall back to the default.
- Cached thumbnails are reused and invalidated by `updatedAt`.
- Cards have equal fixed heights, clamped text, and a flexible cover-cropped
  thumbnail region.
- Offscreen cards retain `data-thumbnail-src` until observed.
- Newly appended pages register their thumbnails with the observer.
- The pagination sentinel loads one page at a time.
- Opening detail still returns and renders all original images.
- The public build contains the supplied default image.

## Success Criteria

- All cards at the same breakpoint have equal total height.
- Cards without photos display the supplied default image.
- The initial list JSON contains no Base64 data.
- Only near-viewport card thumbnails generate image requests.
- Card thumbnail responses are resized WebP files, not full originals.
- Scrolling appends the next summary page automatically.
- Opening a detail displays every original image for that notice.
- The complete automated test suite passes.
