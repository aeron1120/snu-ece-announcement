import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createNoticeThumbnailService } from '../server/services/notice-thumbnail-service.js';

async function createSourceDataUrl() {
    const source = await sharp({
        create: {
            width: 1200,
            height: 800,
            channels: 3,
            background: '#3355aa'
        }
    }).png().toBuffer();
    return {
        source,
        dataUrl: `data:image/png;base64,${source.toString('base64')}`
    };
}

test('thumbnail service creates and reuses a bounded WebP cache entry', async t => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'notice-thumbnails-'));
    t.after(() => rm(cacheDir, { recursive: true, force: true }));
    const { source, dataUrl } = await createSourceDataUrl();
    const service = createNoticeThumbnailService({ cacheDir });

    const first = await service.getThumbnail({
        id: 7,
        updatedAt: '2026-07-27T00:00:00.000Z',
        image: dataUrl
    });
    const metadata = await sharp(first.body).metadata();

    assert.equal(first.kind, 'webp');
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 640);
    assert.ok(first.body.length < source.length);
    assert.match(first.etag, /^"[a-f0-9]{64}"$/);

    const cached = await service.getThumbnail({
        id: 7,
        updatedAt: '2026-07-27T00:00:00.000Z',
        image: 'malformed-after-cache-was-created'
    });
    assert.equal(cached.kind, 'webp');
    assert.equal(cached.etag, first.etag);
    assert.deepEqual(cached.body, first.body);
    assert.deepEqual(await readdir(cacheDir), [`${first.etag.slice(1, -1)}.webp`]);
});

test('thumbnail service invalidates cache by update time and falls back safely', async t => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'notice-thumbnails-'));
    t.after(() => rm(cacheDir, { recursive: true, force: true }));
    const { dataUrl } = await createSourceDataUrl();
    const service = createNoticeThumbnailService({ cacheDir });

    const original = await service.getThumbnail({
        id: 9,
        updatedAt: '2026-07-27T00:00:00.000Z',
        image: dataUrl
    });
    const updated = await service.getThumbnail({
        id: 9,
        updatedAt: '2026-07-28T00:00:00.000Z',
        image: dataUrl
    });

    assert.equal(updated.kind, 'webp');
    assert.notEqual(updated.etag, original.etag);
    assert.equal((await readdir(cacheDir)).length, 2);

    assert.deepEqual(
        await service.getThumbnail({ id: 10, updatedAt: '', image: '' }),
        { kind: 'default' }
    );
    assert.deepEqual(
        await service.getThumbnail({
            id: 11,
            updatedAt: '',
            image: 'data:image/png;base64,not-valid-base64'
        }),
        { kind: 'default' }
    );
});

const BUCKET_URL = 'https://project.supabase.co/storage/v1/object/public/notice-images/a.png';
const ownsProjectBucket = url => String(url).startsWith('https://project.supabase.co/');

test('thumbnail service fetches a bucket URL and converts it', async t => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'notice-thumbnails-'));
    t.after(() => rm(cacheDir, { recursive: true, force: true }));
    const { source } = await createSourceDataUrl();
    const requested = [];
    const service = createNoticeThumbnailService({
        cacheDir,
        isOwnedUrl: ownsProjectBucket,
        fetchImage: async url => {
            requested.push(url);
            return source;
        }
    });

    const result = await service.getThumbnail({
        id: 21,
        updatedAt: '2026-07-29T00:00:00.000Z',
        image: BUCKET_URL
    });

    assert.deepEqual(requested, [BUCKET_URL]);
    assert.equal(result.kind, 'webp');
    assert.equal((await sharp(result.body).metadata()).format, 'webp');
});

test('thumbnail service never fetches a URL the bucket does not own', async t => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'notice-thumbnails-'));
    t.after(() => rm(cacheDir, { recursive: true, force: true }));
    let called = false;
    // 남의 주소를 따라가면 이 엔드포인트가 요청 대행 통로가 된다.
    const service = createNoticeThumbnailService({
        cacheDir,
        isOwnedUrl: ownsProjectBucket,
        fetchImage: async () => {
            called = true;
            return Buffer.alloc(0);
        }
    });

    const result = await service.getThumbnail({
        id: 22,
        updatedAt: '2026-07-29T00:00:00.000Z',
        image: 'https://elsewhere.example/a.png'
    });

    assert.equal(called, false);
    assert.deepEqual(result, { kind: 'default' });
});

test('thumbnail service falls back to the default when the fetch fails', async t => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'notice-thumbnails-'));
    t.after(() => rm(cacheDir, { recursive: true, force: true }));
    const service = createNoticeThumbnailService({
        cacheDir,
        isOwnedUrl: ownsProjectBucket,
        fetchImage: async () => {
            throw new Error('network down');
        }
    });

    assert.deepEqual(
        await service.getThumbnail({
            id: 23,
            updatedAt: '2026-07-29T00:00:00.000Z',
            image: BUCKET_URL
        }),
        { kind: 'default' }
    );
});
