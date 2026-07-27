import test from 'node:test';
import assert from 'node:assert/strict';
import { app, toNoticeSummary } from '../server/server.js';

test('notice summaries expose card metadata without heavy detail fields', () => {
    const summary = toNoticeSummary({
        id: 42,
        title: 'Lean notice',
        content: 'full body',
        rawContent: 'crawler body',
        target: '전체',
        targets: ['전체'],
        host: '전기정보공학부',
        deadline: '2026-08-01',
        aiSummary: ['summary'],
        keywords: ['keyword'],
        attachments: [{ name: 'file', url: 'https://example.test/file' }],
        images: ['data:image/png;base64,large'],
        crawlMetadata: { html: 'large' },
        categoryIds: [3],
        views: 7,
        sourcePublishedAt: '2026-07-27T00:00:00.000Z',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z'
    });

    assert.deepEqual(summary, {
        id: 42,
        title: 'Lean notice',
        target: '전체',
        targets: ['전체'],
        host: '전기정보공학부',
        deadline: '2026-08-01',
        aiSummary: ['summary'],
        keywords: ['keyword'],
        categoryIds: [3],
        views: 7,
        sourcePublishedAt: '2026-07-27T00:00:00.000Z',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
        hasImages: true
    });
});

test('public notice API is paginated, has detail lookup, and hides Express signature', async t => {
    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => server.close());
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const defaultListResponse = await fetch(`${baseUrl}/api/notices`);
    assert.equal(defaultListResponse.status, 200);
    const defaultListText = await defaultListResponse.text();
    assert.ok(Buffer.byteLength(defaultListText) < 100_000);
    const defaultList = JSON.parse(defaultListText);
    assert.equal(defaultList.pagination.limit, 20);
    for (const notice of defaultList.notices) {
        assert.equal(typeof notice.hasImages, 'boolean');
        for (const heavyKey of [
            'content', 'rawContent', 'images', 'attachments', 'crawlMetadata'
        ]) {
            assert.equal(Object.hasOwn(notice, heavyKey), false);
        }
    }

    const listResponse = await fetch(`${baseUrl}/api/notices?page=1&limit=1`);
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get('x-powered-by'), null);
    const list = await listResponse.json();
    assert.ok(Array.isArray(list.notices));
    assert.deepEqual(
        Object.keys(list.pagination).sort(),
        ['limit', 'page', 'total', 'totalPages'].sort()
    );
    assert.equal(list.pagination.limit, 1);

    const missing = await fetch(`${baseUrl}/api/notices/9007199254740991`);
    assert.equal(missing.status, 404);
});
