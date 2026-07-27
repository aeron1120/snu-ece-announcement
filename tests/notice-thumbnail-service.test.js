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
