import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAutomationRouter } from '../server/routes/automation-routes.js';
import { createAutomationStore } from '../server/storage/automation-store.js';

async function createTestServer({ crawlEnabled = true, pushService = null } = {}) {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-api-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    const crawler = {
        async crawl() {
            return { status: 'completed', discoveredCount: 3, createdCount: 1, failedCount: 0 };
        }
    };
    const requireAdmin = (req, res, next) => {
        if (req.get('x-admin-token') !== 'test-admin') {
            return res.status(401).json({ error: 'unauthorized' });
        }
        next();
    };
    const app = express();
    app.use(express.json());
    app.use(createAutomationRouter({
        store,
        crawler,
        analyzer: null,
        pushService,
        requireAdmin,
        config: {
            crawl: { enabled: crawlEnabled, triggerSecret: 's'.repeat(32) },
            categories: {
                windowDays: 60,
                minimumNotices: 5,
                minimumConfidence: 0.75
            }
        }
    }));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    const address = server.address();
    return {
        store,
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
    };
}

test('crawl endpoint requires its dedicated secret and respects disabled configuration', async t => {
    const enabled = await createTestServer();
    t.after(() => enabled.server.close());

    const denied = await fetch(`${enabled.baseUrl}/api/internal/crawl/ece-academics`, {
        method: 'POST'
    });
    assert.equal(denied.status, 401);

    const accepted = await fetch(`${enabled.baseUrl}/api/internal/crawl/ece-academics`, {
        method: 'POST',
        headers: { 'x-crawl-secret': 's'.repeat(32) }
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).createdCount, 1);

    const disabled = await createTestServer({ crawlEnabled: false });
    t.after(() => disabled.server.close());
    const unavailable = await fetch(`${disabled.baseUrl}/api/internal/crawl/ece-academics`, {
        method: 'POST',
        headers: { 'x-crawl-secret': 's'.repeat(32) }
    });
    assert.equal(unavailable.status, 503);
});

test('admin can trigger pending notification job processing', async t => {
    let calls = 0;
    const fixture = await createTestServer({
        pushService: {
            publicKey: 'public',
            async processPendingJobs() {
                calls += 1;
                return { jobs: 1, sent: 2, failed: 0 };
            }
        }
    });
    t.after(() => fixture.server.close());

    const response = await fetch(
        `${fixture.baseUrl}/api/admin/notification-jobs/process`,
        {
            method: 'POST',
            headers: { 'x-admin-token': 'test-admin' }
        }
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).sent, 2);
    assert.equal(calls, 1);
});

test('admin review routes require auth and publish or reject pending notices', async t => {
    const fixture = await createTestServer();
    t.after(() => fixture.server.close());
    const publishTarget = await fixture.store.createPendingNotice({
        sourceType: 'ece_academics',
        sourceExternalId: '70001',
        title: '검수 전',
        content: '본문'
    });
    const rejectTarget = await fixture.store.createPendingNotice({
        sourceType: 'ece_academics',
        sourceExternalId: '70002',
        title: '반려 전',
        content: '본문'
    });

    const denied = await fetch(`${fixture.baseUrl}/api/admin/review-notices`);
    assert.equal(denied.status, 401);

    const listed = await fetch(`${fixture.baseUrl}/api/admin/review-notices`, {
        headers: { 'x-admin-token': 'test-admin' }
    });
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).notices.length, 2);

    const published = await fetch(
        `${fixture.baseUrl}/api/admin/review-notices/${publishTarget.id}/publish`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-admin-token': 'test-admin'
            },
            body: JSON.stringify({ edits: { title: '검수 완료' }, notify: true })
        }
    );
    assert.equal(published.status, 200);
    assert.equal((await published.json()).notice.status, 'published');

    const rejected = await fetch(
        `${fixture.baseUrl}/api/admin/review-notices/${rejectTarget.id}/reject`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-admin-token': 'test-admin'
            },
            body: JSON.stringify({ reason: '학부 공지가 아님' })
        }
    );
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json()).notice.status, 'rejected');
    assert.equal((await fixture.store.listNotificationJobs()).length, 1);
});

test('admin can approve a threshold category candidate and expose it publicly', async t => {
    const fixture = await createTestServer();
    t.after(() => fixture.server.close());
    for (let index = 1; index <= 5; index += 1) {
        const pending = await fixture.store.createPendingNotice({
            sourceType: 'ece_academics',
            sourceExternalId: `category-${index}`,
            title: `장학금 공지 ${index}`,
            content: '본문',
            keywords: ['장학 제도'],
            analysisConfidence: 0.8,
            publishedAt: new Date(Date.now() - index * 86_400_000).toISOString()
        });
        await fixture.store.publishReviewNotice(pending.id, {}, { notify: false });
    }

    const candidateResponse = await fetch(
        `${fixture.baseUrl}/api/admin/category-candidates`,
        { headers: { 'x-admin-token': 'test-admin' } }
    );
    assert.equal(candidateResponse.status, 200);
    const candidates = (await candidateResponse.json()).candidates;
    assert.equal(candidates.length, 1);

    const approveResponse = await fetch(
        `${fixture.baseUrl}/api/admin/category-candidates/${candidates[0].id}/approve`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-admin-token': 'test-admin'
            },
            body: JSON.stringify({ name: '장학 제도', slug: 'scholarships' })
        }
    );
    assert.equal(approveResponse.status, 200);

    const categoriesResponse = await fetch(`${fixture.baseUrl}/api/categories`);
    assert.equal(categoriesResponse.status, 200);
    assert.equal((await categoriesResponse.json()).categories[0].slug, 'scholarships');
});
