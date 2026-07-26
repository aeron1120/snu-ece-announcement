import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAutomationRouter } from '../server/routes/automation-routes.js';
import { createAutomationStore } from '../server/storage/automation-store.js';

async function createTestServer({ crawlEnabled = true } = {}) {
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
        requireAdmin,
        config: {
            crawl: { enabled: crawlEnabled, triggerSecret: 's'.repeat(32) }
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
