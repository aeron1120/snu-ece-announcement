import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAutomationConfig } from '../server/config/runtime-config.js';
import { createAutomationStore } from '../server/storage/automation-store.js';

test('automation configuration disables protected jobs when secrets are absent', () => {
    const config = getAutomationConfig({});

    assert.equal(config.crawl.enabled, false);
    assert.equal(config.push.enabled, false);
});

test('automation configuration accepts complete crawl and push settings', () => {
    const config = getAutomationConfig({
        CRAWL_TRIGGER_SECRET: 'a'.repeat(32),
        VAPID_PUBLIC_KEY: 'public',
        VAPID_PRIVATE_KEY: 'private',
        VAPID_SUBJECT: 'mailto:ece@example.com'
    });

    assert.equal(config.crawl.enabled, true);
    assert.equal(config.push.enabled, true);
    assert.equal(config.crawl.pages, 3);
    assert.equal(config.crawl.maxDetails, 20);
    assert.equal(config.categories.windowDays, 60);
    assert.equal(config.categories.minimumNotices, 5);
    assert.equal(config.categories.minimumConfidence, 0.75);
});

test('Supabase schema contains automation tables, constraints, and RLS', async () => {
    const schema = await readFile('server/sql/supabase-schema.sql', 'utf8');
    const requiredTables = [
        'crawl_runs',
        'crawl_items',
        'categories',
        'category_aliases',
        'notice_categories',
        'category_candidates',
        'category_candidate_notices',
        'push_subscriptions',
        'notification_jobs',
        'notification_deliveries'
    ];

    for (const table of requiredTables) {
        assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
        assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    }

    assert.match(schema, /notices_source_external_unique/);
    assert.match(schema, /unique\s*\(job_id,\s*subscription_id\)/);
    assert.match(schema, /pending_review/);
    assert.match(schema, /analysis_status/);
});

test('JSON automation store creates one pending notice per external source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-store-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    const input = {
        sourceType: 'ece_academics',
        sourceExternalId: '57854',
        title: '교과목 중복인정',
        content: '본문',
        status: 'pending_review'
    };

    const created = await store.createPendingNotice(input);

    assert.equal(created.status, 'pending_review');
    assert.equal(created.sourceExternalId, '57854');
    assert.equal(
        (await store.findNoticeBySource('ece_academics', '57854')).id,
        created.id
    );
    await assert.rejects(
        () => store.createPendingNotice(input),
        error => error.code === 'DUPLICATE_SOURCE_NOTICE'
    );
});

test('JSON automation store records crawl completion', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-store-run-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });

    const run = await store.beginCrawlRun('ece_academics');
    const completed = await store.finishCrawlRun(run.id, {
        status: 'partial',
        discoveredCount: 3,
        createdCount: 2,
        failedCount: 1,
        errorMessage: 'one detail failed'
    });

    assert.equal(completed.status, 'partial');
    assert.equal(completed.createdCount, 2);
    assert.ok(completed.finishedAt);
});
