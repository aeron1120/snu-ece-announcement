# Notice Images to Supabase Storage Design

## Problem

Notice photographs are stored as Base64 data URLs inside the `images` jsonb
column. A single row therefore carries the whole picture, and every reader pays
for it twice over.

Writing is slow enough to fail. Three phone photos became tens of megabytes in
one insert and Postgres cut the save off with `canceling statement due to
statement timeout`. Client-side compression, shipped separately, brought a
typical attachment down to about a megabyte and stopped the timeouts, but the
bytes still travel through the database.

Reading is worse. `GET /api/notices/:id` returns the complete `images` array
inline, with no `Cache-Control` header, and the service worker does not
intercept `/api/` paths. A student who opens the same notice twice downloads
every photograph twice, because a Base64 string inside a JSON body is not an
image as far as the browser cache is concerned.

## Goals

- Store new notice photographs as files in Supabase Storage and keep only their
  URLs in the database.
- Let the browser and the CDN cache those photographs like any other image.
- Leave notices that already hold Base64 images working exactly as they are.
- Remove a notice's stored files when the notice is deleted.
- Keep the site working when Supabase is not configured at all.

## Non-goals

- Migrating existing Base64 notices. They keep working untouched; a migration
  can be its own change later.
- Touching banner or inquiry images. They use a separate local-disk path.
- Changing the `images` column type or any other part of the schema. The column
  stays `jsonb` holding an array of strings.
- Re-doing client-side compression. That already ships and applies to Storage
  uploads too.

## Bucket

A public bucket named `notice-images` already exists in the project.

Public is deliberate. Notice photographs are posters already displayed around
campus, and a stable URL is what lets the CDN and the browser cache them. The
cost is that a URL keeps working after its notice is hidden, which is why
deletion has to remove the file.

The bucket needs no access policies. The server authenticates with the service
role key, which bypasses row level security, and public reads need no policy.

## Upload Path

The browser continues to send data URLs to the API exactly as it does today. No
Supabase credentials reach the admin page, and no new browser-side permissions
are involved.

`POST /api/notices` and `PUT /api/notices/:id` gain one step between
`normalizeNoticeInput` and the store call:

```
payload.images = await persistNoticeImages(payload.images)
```

`persistNoticeImages` walks the array and, for each entry:

- a `data:` URL is decoded, uploaded to `notice-images` under a random UUID key,
  and replaced by its public URL;
- anything else — an `https:` URL from an earlier save — is passed through
  untouched, so re-saving an edited notice does not re-upload its photographs;
- every entry is passed through untouched when Supabase is not configured.

The picture crosses the Render server once, at upload. Readers never touch
Render for image bytes again.

The object key is a bare UUID rather than anything derived from the notice id,
because the id does not exist until the row is inserted. Deletion recovers the
key from the stored URL instead.

## Deletion

`DELETE /api/notices/:id` is a soft delete: `softDeleteNotice` sets `is_deleted`
and leaves the row in place. The route reads the notice's `images` first and
deletes any entry that points into the bucket. Entries that are data URLs or
belong to another host are ignored.

Removing the files makes that soft delete irreversible for photographs, where
today a row could in principle be revived with SQL. That is an accepted trade:
there is no restore anywhere in the product — the administrator console never
reads `is_deleted` and offers no way back — so a deleted notice is already gone
as far as anyone using the site is concerned. Keeping the files instead would
leave objects nobody can reach through the UI and nobody will ever clean up,
still served to anyone holding the URL, which is precisely the exposure a public
bucket obliges us to close.

A failed file deletion is logged and does not abort the request. An orphaned
object wastes storage; a notice that refuses to delete blocks the
administrator.

## Thumbnails

`notice-thumbnail-service.js` currently recognises an image only by matching a
`data:image/...;base64,` prefix and decoding it. It gains a second source: an
`https:` URL belonging to the configured Supabase host is fetched and its bytes
used in place of the decoded ones.

Everything downstream — the resize, the WebP conversion, the on-disk cache keyed
by notice id and `updatedAt` — is unchanged, so old and new notices share one
path. A URL that cannot be fetched falls back to the default thumbnail, exactly
as a malformed data URL does today.

Only the configured Supabase host is fetched. Following an arbitrary URL out of
the database would turn the thumbnail endpoint into a request proxy.

## Fallback Without Supabase

The server already runs in a file-backed mode when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are absent, which is how it runs locally. There is
no Storage in that mode, so `persistNoticeImages` returns its input unchanged
and notices keep their Base64 images. Nothing else branches.

## Error Handling

- Upload failure: the save fails with a clear message. A notice whose pictures
  did not survive is worse than one that was not saved.
- Deletion failure: logged, request proceeds.
- Thumbnail fetch failure: default thumbnail, as today.
- Supabase absent: Base64 passthrough, as today.

## Testing

- A data URL becomes a Storage URL in the saved payload.
- An existing Storage URL passes through without a second upload.
- Every entry passes through unchanged when Supabase is not configured.
- Soft-deleting a notice removes its bucket objects and ignores data URLs.
- A failed object deletion still soft-deletes the notice.
- The thumbnail service accepts both a data URL and a Supabase URL.
- The thumbnail service refuses a URL on any other host.
- The existing suite continues to pass.

## Success Criteria

- A newly saved notice stores `https://` URLs and its row is a few hundred bytes.
- Its photographs display unchanged on cards, the detail view, and comparison
  blocks.
- Re-opening the notice serves the photographs from cache rather than the API.
- A notice saved before this change still displays.
- Deleting a notice leaves no objects behind in the bucket.
- The complete automated test suite passes.
