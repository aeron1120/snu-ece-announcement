import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, toNoticeSummary } from '../server/server.js';

test('notice summaries expose card metadata without heavy detail fields', () => {
    const summary = toNoticeSummary({
        id: 42,
        title: 'Lean notice',
        content: 'full body',
        rawContent: 'crawler body',
        ocrText: 'search-only private text',
        target: '전체',
        targets: ['전체'],
        host: '전기정보공학부',
        deadline: '2026-08-01',
        deadlineAt: '2026-08-01T14:59:59.000Z',
        expiresAt: '2026-08-04T14:59:59.000Z',
        isAlwaysOpen: false,
        isPinned: false,
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
        deadlineAt: '2026-08-01T14:59:59.000Z',
        expiresAt: '2026-08-04T14:59:59.000Z',
        isAlwaysOpen: false,
        isPinned: false,
        isArchived: false,
        isInGracePeriod: false,
        aiSummary: ['summary'],
        keywords: ['keyword'],
        categoryIds: [3],
        views: 7,
        sourcePublishedAt: '2026-07-27T00:00:00.000Z',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
        hasImages: true,
        thumbnailUrl: '/api/notices/42/thumbnail?v=2026-07-27T00%3A00%3A00.000Z'
    });
    assert.equal(
        toNoticeSummary({ id: 43, images: [], hasImages: false }).thumbnailUrl,
        '/icons/default-notice-thumbnail.png'
    );
    assert.doesNotMatch(JSON.stringify(summary), /data:image/);
    assert.doesNotMatch(JSON.stringify(summary), /search-only private text|ocrText/);
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
        assert.equal(typeof notice.thumbnailUrl, 'string');
        assert.doesNotMatch(notice.thumbnailUrl, /^data:image/);
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

test('summary mismatch reports are anonymous and enter the admin feedback inbox', async t => {
    const feedbackPath = path.join(process.cwd(), 'server', 'data', 'feedback.json');
    const originalFeedback = await readFile(feedbackPath, 'utf8').catch(() => '[]');
    t.after(() => writeFile(feedbackPath, originalFeedback, 'utf8'));

    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => server.close());
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const listResponse = await fetch(`${baseUrl}/api/notices?limit=1`);
    const list = await listResponse.json();
    const notice = list.notices[0];
    assert.ok(notice?.id);

    const report = await fetch(`${baseUrl}/api/notices/${encodeURIComponent(notice.id)}/summary-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    });
    assert.equal(report.status, 201);
    assert.deepEqual(await report.json(), { ok: true });

    const stored = JSON.parse(await readFile(feedbackPath, 'utf8'));
    assert.equal(stored[0].category, 'summary_mismatch');
    assert.equal(String(stored[0].noticeId), String(notice.id));
    assert.equal(Object.hasOwn(stored[0], 'ip'), false);
    assert.equal(Object.hasOwn(stored[0], 'userAgent'), false);
});

test('admin pages require a short-lived HttpOnly server session', async t => {
    const settingsPath = path.join(process.cwd(), 'server', 'data', 'settings.json');
    const originalSettings = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(originalSettings);
    const password = 'test-admin-session-password';
    settings.adminTokenHash = crypto.createHash('sha256').update(password).digest('hex');
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    t.after(() => writeFile(settingsPath, originalSettings, 'utf8'));

    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => server.close());
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const loginPage = await fetch(`${baseUrl}/admin`);
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /id="admin-login-form"/);

    const blockedWorkspace = await fetch(`${baseUrl}/admin.html`, { redirect: 'manual' });
    assert.equal(blockedWorkspace.status, 302);
    assert.equal(blockedWorkspace.headers.get('location'), '/admin');

    const login = await fetch(`${baseUrl}/api/admin/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    assert.equal(login.status, 201);
    const setCookie = login.headers.get('set-cookie') || '';
    assert.match(setCookie, /ece_admin_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];

    const workspace = await fetch(`${baseUrl}/admin/workspace`, {
        headers: { Cookie: cookie },
        redirect: 'manual'
    });
    assert.equal(workspace.status, 200);
    assert.match(await workspace.text(), /data-page="admin"/);

    const session = await fetch(`${baseUrl}/api/admin/session`, {
        headers: { Cookie: cookie }
    });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { authenticated: true });

    const protectedApi = await fetch(`${baseUrl}/api/admin/feedback`, {
        headers: { Cookie: cookie }
    });
    assert.equal(protectedApi.status, 200);

    const backfillSample = [
        '--------------- 2025년 3월 9일 일요일 ---------------',
        '[전기정보 학생회] [오전 9:46] [졸업 학점 안내]\n필수 이수 학점을 확인하세요.'
    ].join('\r\n');
    const blockedBackfill = await fetch(`${baseUrl}/api/admin/backfill/kakao/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: backfillSample
    });
    assert.equal(blockedBackfill.status, 401);
    const preview = await fetch(`${baseUrl}/api/admin/backfill/kakao/preview`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'text/plain' },
        body: backfillSample
    });
    assert.equal(preview.status, 201);
    const previewResult = await preview.json();
    assert.equal(previewResult.stats.draftCount, 1);
    assert.equal(previewResult.drafts[0].categorySlug, 'academics');

    const logout = await fetch(`${baseUrl}/api/admin/session`, {
        method: 'DELETE',
        headers: { Cookie: cookie }
    });
    assert.equal(logout.status, 204);
});
