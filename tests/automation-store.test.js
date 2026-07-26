import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAutomationConfig } from '../server/config/runtime-config.js';

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
