# Notice List Payload Optimization Design

## Problem

`GET /api/notices` is paginated in its response shape, but it still loads every
published notice on the server and returns complete notice objects. The browser
then requests every page during initial startup.

On the current local dataset, a list of only 10 notices is 6,948,477 bytes.
Almost all of that size comes from Base64 `images`; the response also duplicates
large `content` and `rawContent` fields that cards do not need.

## Goals

- Keep the initial notice request bounded to 20 records.
- Exclude full body, raw crawler data, attachments, and Base64 images from list
  responses.
- Load the complete notice only when a user opens its detail view.
- Preserve the existing card filters, sorting, saved notices, comparison,
  deep-linking, admin mutations, and view count behavior for the records that
  have been loaded.
- Make file-backed development and Supabase production follow the same public
  API contract.

## Non-goals

- Migrating existing Base64 images to Supabase Storage.
- Generating WebP or AVIF thumbnails.
- Moving every search and filter to the server.

Those storage changes need a separate data migration and deployment plan.
This change removes the large images from startup immediately and leaves a
`hasImages` summary flag so a later thumbnail URL can be added without changing
the detail-loading boundary.

## API Contract

### List

`GET /api/notices?page=1&limit=20`

Returns:

- `notices`: summary objects containing only card/filter metadata:
  `id`, `title`, `target`, `targets`, `host`, `deadline`, `aiSummary`,
  `keywords`, `categoryIds`, `views`, `sourcePublishedAt`, `createdAt`,
  `updatedAt`, and `hasImages`.
- `pagination`: `page`, `limit`, `total`, and `totalPages`.

The list response must not contain `content`, `rawContent`, `images`,
`attachments`, or crawler/analysis payloads.

For Supabase, pagination and category filtering happen in the query, with an
exact count. File mode may merge its two local stores before slicing because it
is only a development fallback, but it must map only the selected page to
summary objects.

### Detail

`GET /api/notices/:id`

Returns the complete public notice. Supabase queries the requested row directly;
file mode searches local manual and automated records. It must not call the
full-list operation.

Invalid IDs return `400`; missing or unpublished notices return `404`.

## Frontend Data Flow

1. Startup requests page 1 with a limit of 20.
2. The browser stores returned summaries and pagination state.
3. A `더 보기` control requests the next page and appends unique summaries.
4. Cards render without embedded Base64 previews. `hasImages` remains available
   for filtering.
5. Opening a card requests `/api/notices/:id`, merges the full result into the
   matching summary, and renders the modal only after the detail arrives.
6. A deep link uses the same detail request and adds the returned notice if it
   is not already in the loaded summaries.
7. Admin create/update/publish refreshes the first page rather than downloading
   every page.

While a detail is loading, repeated opens for that notice share the same
in-flight request. A failed detail request reports the existing user-facing
load error and does not increment the view count.

## Compatibility

- Image filtering uses `hasImages`, falling back to `images.length` for a
  detail object.
- Comparison continues to work for loaded notices. When comparison needs body
  fields, it obtains missing details before rendering.
- Saved notice IDs remain in local storage. Saved notices outside the loaded
  pages appear after their page is loaded; server-side saved-ID lookup is not
  part of this change.
- The source `js/app.js` and generated `public/js/app.js` remain synchronized
  through the existing public build command.

## Testing

Tests are written before production changes and must prove:

- A list item omits all heavy fields and exposes `hasImages`.
- `limit` defaults to 20, is capped, and pagination metadata is correct.
- Detail lookup returns full content and images.
- The frontend requests only the first page at startup and requests detail on
  card open.
- The load-more flow appends the next page without duplicates.
- Existing test suites still pass.
- A live local response check confirms that the first list response is no
  longer measured in megabytes.

## Success Criteria

- Initial startup issues exactly one notice-list request.
- No list response contains Base64 image data or notice body text.
- Detail content and images remain available after a card is opened.
- The measured local page-1 response is below 100 KB for the current dataset.
- All automated tests pass without warnings or failures.
