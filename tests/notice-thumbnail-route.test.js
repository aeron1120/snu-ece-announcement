import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createNoticeThumbnailRouter } from '../server/routes/notice-thumbnail-route.js';
import { createNoticeThumbnailService } from '../server/services/notice-thumbnail-service.js';

async function createImageDataUrl() {
    const source = await sharp({
        create: {
            width: 900,
            height: 600,
            channels: 3,
            background: '#112244'
        }
    }).png().toBuffer();
    return `data:image/png;base64,${source.toString('base64')}`;
}

async function startThumbnailServer(t, loadSource) {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'notice-thumbnail-route-'));
    t.after(() => rm(cacheDir, { recursive: true, force: true }));
    const app = express();
    app.use(createNoticeThumbnailRouter({
        loadSource,
        thumbnailService: createNoticeThumbnailService({ cacheDir }),
        defaultUrl: '/icons/default-notice-thumbnail.png'
    }));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
}

test('notice thumbnail route serves WebP with cache validation', async t => {
    const image = await createImageDataUrl();
    const baseUrl = await startThumbnailServer(t, async id => ({
        id,
        updatedAt: '2026-07-27T00:00:00.000Z',
        image
    }));

    const response = await fetch(`${baseUrl}/api/notices/7/thumbnail?v=one`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(
        response.headers.get('cache-control'),
        'public, max-age=31536000, immutable'
    );
    const etag = response.headers.get('etag');
    assert.match(etag, /^"[a-f0-9]{64}"$/);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 640);

    const cached = await fetch(`${baseUrl}/api/notices/7/thumbnail?v=one`, {
        headers: { 'If-None-Match': etag }
    });
    assert.equal(cached.status, 304);
});

test('notice thumbnail route redirects missing or invalid images to default', async t => {
    const baseUrl = await startThumbnailServer(t, async id => {
        if (id === 8) return null;
        return { id, updatedAt: '', image: 'not-an-image' };
    });

    const invalidId = await fetch(`${baseUrl}/api/notices/not-a-number/thumbnail`, {
        redirect: 'manual'
    });
    assert.equal(invalidId.status, 400);

    for (const id of [8, 9]) {
        const response = await fetch(`${baseUrl}/api/notices/${id}/thumbnail`, {
            redirect: 'manual'
        });
        assert.equal(response.status, 302);
        assert.equal(
            response.headers.get('location'),
            '/icons/default-notice-thumbnail.png'
        );
    }
});
