import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeImageStore } from '../server/services/notice-image-store.js';

const SUPABASE_URL = 'https://project.supabase.co';
const PNG_DATA_URL = 'data:image/png;base64,aGVsbG8=';

// 업로드·삭제 호출을 기록하는 가짜 Supabase 클라이언트.
function fakeSupabase({ uploadError = null, removeError = null } = {}) {
    const calls = { uploads: [], removals: [] };
    return {
        calls,
        client: {
            storage: {
                from(bucket) {
                    return {
                        async upload(key, body, options) {
                            calls.uploads.push({ bucket, key, body, options });
                            return { error: uploadError };
                        },
                        async remove(keys) {
                            calls.removals.push({ bucket, keys });
                            return { error: removeError };
                        },
                        getPublicUrl(key) {
                            return {
                                data: {
                                    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${key}`
                                }
                            };
                        }
                    };
                }
            }
        }
    };
}

test('a data URL is uploaded and replaced by its public URL', async () => {
    const { client, calls } = fakeSupabase();
    const store = createNoticeImageStore({ supabase: client, supabaseUrl: SUPABASE_URL });

    const result = await store.persistImages([PNG_DATA_URL]);

    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.uploads[0].bucket, 'notice-images');
    assert.match(calls.uploads[0].key, /^[0-9a-f-]{36}\.png$/);
    assert.equal(calls.uploads[0].options.contentType, 'image/png');
    // 업로드된 것은 base64 문자열이 아니라 실제 바이트여야 한다.
    assert.ok(Buffer.isBuffer(calls.uploads[0].body));
    assert.equal(calls.uploads[0].body.toString('utf8'), 'hello');

    assert.equal(result.length, 1);
    assert.equal(
        result[0],
        `${SUPABASE_URL}/storage/v1/object/public/notice-images/${calls.uploads[0].key}`
    );
});

test('an already stored URL is left alone instead of uploaded again', async () => {
    const { client, calls } = fakeSupabase();
    const store = createNoticeImageStore({ supabase: client, supabaseUrl: SUPABASE_URL });
    const existing = `${SUPABASE_URL}/storage/v1/object/public/notice-images/abc.webp`;

    assert.deepEqual(await store.persistImages([existing]), [existing]);
    assert.equal(calls.uploads.length, 0);
});

test('without Supabase every entry passes through untouched', async () => {
    const store = createNoticeImageStore({ supabase: null, supabaseUrl: '' });
    assert.deepEqual(await store.persistImages([PNG_DATA_URL]), [PNG_DATA_URL]);
});

test('a failed upload rejects so the notice is not saved without its picture', async () => {
    const { client } = fakeSupabase({ uploadError: new Error('bucket unreachable') });
    const store = createNoticeImageStore({ supabase: client, supabaseUrl: SUPABASE_URL });

    await assert.rejects(() => store.persistImages([PNG_DATA_URL]), /bucket unreachable/);
});

test('only bucket URLs are removed, and data URLs are ignored', async () => {
    const { client, calls } = fakeSupabase();
    const store = createNoticeImageStore({ supabase: client, supabaseUrl: SUPABASE_URL });

    await store.removeImages([
        `${SUPABASE_URL}/storage/v1/object/public/notice-images/one.webp`,
        PNG_DATA_URL,
        'https://elsewhere.example/two.webp'
    ]);

    assert.equal(calls.removals.length, 1);
    assert.deepEqual(calls.removals[0].keys, ['one.webp']);
});

test('a failed removal is swallowed so deleting the notice still succeeds', async () => {
    const { client } = fakeSupabase({ removeError: new Error('gone') });
    const store = createNoticeImageStore({ supabase: client, supabaseUrl: SUPABASE_URL });

    await store.removeImages([
        `${SUPABASE_URL}/storage/v1/object/public/notice-images/one.webp`
    ]);
});

test('an image the bucket does not own is never fetched as a thumbnail source', async () => {
    const store = createNoticeImageStore({ supabase: {}, supabaseUrl: SUPABASE_URL });

    assert.equal(store.isOwnedUrl(`${SUPABASE_URL}/storage/v1/object/public/notice-images/a.webp`), true);
    assert.equal(store.isOwnedUrl('https://elsewhere.example/a.webp'), false);
    assert.equal(store.isOwnedUrl(PNG_DATA_URL), false);
});
