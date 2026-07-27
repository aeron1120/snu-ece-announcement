import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preparePublic } from '../scripts/prepare-public.mjs';

test('preparePublic copies canonical frontend files', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'ece-public-'));
    await mkdir(path.join(rootDir, 'css'));
    await mkdir(path.join(rootDir, 'js'));
    await writeFile(path.join(rootDir, 'index.html'), '<main>ok</main>');
    await writeFile(path.join(rootDir, 'css/style.css'), 'body{}');
    await writeFile(path.join(rootDir, 'js/app.js'), 'window.ok=true');
    await writeFile(path.join(rootDir, 'js/config.js'), 'window.API_BASE_URL=""');

    await preparePublic({ rootDir });

    assert.equal(
        await readFile(path.join(rootDir, 'public/index.html'), 'utf8'),
        '<main>ok</main>'
    );
    assert.equal(
        await readFile(path.join(rootDir, 'public/js/app.js'), 'utf8'),
        'window.ok=true'
    );
});

test('canonical HTML includes the administrator review manager contract', async () => {
    const html = await readFile('index.html', 'utf8');

    for (const id of [
        'review-manager-modal',
        'review-notice-list',
        'review-editor',
        'review-pending-count'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-live="polite"/);
});

test('PWA manifest and service worker include install and push contracts', async () => {
    const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
    const worker = await readFile('service-worker.js', 'utf8');

    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.icons[0].src, /app-icon\.svg$/);
    assert.match(worker, /addEventListener\('push'/);
    assert.match(worker, /showNotification/);
    assert.match(worker, /notificationclick/);
    assert.match(worker, /!APP_SHELL\.includes\(url\.pathname\)/);
});

test('expired notices use a neutral card and badge state in list and detail views', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const css = await readFile('css/style.css', 'utf8');
    const detailStart = app.indexOf('function openDetail');
    const expiredTagBinding = /dDay\.isExpired\s*\?\s*'expired'/;

    assert.match(app, /isExpired:\s*true/);
    assert.match(app, /card-expired/);
    assert.ok(detailStart > 0);
    assert.match(app.slice(0, detailStart), expiredTagBinding);
    assert.match(app.slice(detailStart), expiredTagBinding);
    assert.equal((app.match(/dDay\.isExpired\s*\?\s*'expired'/g) || []).length, 2);
    assert.match(app, /dDay\.isUrgent\s*\?\s*'d-day'/);
    assert.match(css, /\.card\.card-expired\s*\{/);
    assert.match(css, /\.tags \.tag\.expired\s*\{/);
    assert.doesNotMatch(css, /\.card\.card-expired[^{]*\{[^}]*opacity\s*:/s);
    assert.doesNotMatch(css, /\.card\.card-expired[^{]*\{[^}]*text-decoration\s*:/s);
});

test('calcDDay uses calendar-day states for permanent, urgent, and expired notices', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const calendarDayDifferenceSource = app.match(/function getCalendarDayDifference\([^)]*\) \{[\s\S]*?\r?\n\}/)?.[0];
    const calcDDaySource = app.match(/function calcDDay\(deadlineStr\) \{[\s\S]*?\r?\n\}/)?.[0];
    assert.ok(calendarDayDifferenceSource);
    assert.ok(calcDDaySource);

    const onDeadlineDate = new Function(
        'getCurrentDate',
        `${calendarDayDifferenceSource}\n${calcDDaySource}; return calcDDay;`
    )(() => new Date('2026-07-27T00:00:00'));
    const followingDate = new Function(
        'getCurrentDate',
        `${calendarDayDifferenceSource}\n${calcDDaySource}; return calcDDay;`
    )(() => new Date('2026-07-28T00:00:00'));

    assert.deepEqual(onDeadlineDate(null), {
        text: '상시', isUrgent: false, isD1: false, isExpired: false
    });
    assert.equal(onDeadlineDate('2026-07-27').isUrgent, true);
    assert.equal(onDeadlineDate('2026-07-27').isExpired, false);
    assert.equal(followingDate('2026-07-27').isExpired, true);
    assert.equal(followingDate('2026-07-27').isUrgent, false);
    assert.equal(onDeadlineDate('2026-07-30').isUrgent, true);
    assert.equal(onDeadlineDate('2026-07-31').isUrgent, false);
    assert.match(calendarDayDifferenceSource, /Date\.UTC/);
});

test('deadline-status filtering excludes expired notices from urgent results', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const deadlineStatusSource = app.match(/function matchesDeadlineStatus\([^)]*\) \{[\s\S]*?\r?\n\}/)?.[0];
    assert.ok(deadlineStatusSource);
    const matchesDeadlineStatus = new Function(
        `${deadlineStatusSource}; return matchesDeadlineStatus;`
    )();

    const expired = { isUrgent: false, isExpired: true };
    assert.equal(matchesDeadlineStatus('마감임박', expired, true), false);
    assert.equal(matchesDeadlineStatus('마감됨', expired, true), true);
});

test('Cloudflare scheduled worker triggers the protected crawl endpoint', async () => {
    const worker = (await import('../cloudflare/crawl-worker.js')).default;
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
    };
    try {
        const pending = [];
        worker.scheduled({}, {
            API_BASE_URL: 'https://api.example.test/',
            CRAWL_TRIGGER_SECRET: 'secret'
        }, {
            waitUntil(promise) {
                pending.push(promise);
            }
        });
        await Promise.all(pending);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'https://api.example.test/api/internal/crawl/ece-academics'
    );
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['x-crawl-secret'], 'secret');
});
