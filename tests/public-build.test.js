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

test('desktop shell exposes brand and managed advertising rails', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/app.js', 'utf8');

    for (const id of [
        'left-brand-rail',
        'right-ad-rail',
        'right-rail-ad-content',
        'page-main'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /class="brand-mark"[^>]*>SNU</);
    assert.match(html, />서울대학교 홈페이지</);
    assert.match(html, />전기정보공학부</);
    assert.match(html, />mySNU</);
    assert.match(app, /function getBannerSlidesByPlacement/);
    assert.match(app, /function renderRightRailAd/);
    assert.match(app, /getBannerSlidesByPlacement\('header'\)/);
    assert.match(app, /getBannerSlidesByPlacement\('right_rail'\)/);
});

test('right-rail image errors restore the inquiry fallback', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const fallbackSource = app.match(/function renderRightRailInquiryFallback\(\) \{[\s\S]*?\n\}/)?.[0];

    assert.ok(fallbackSource);
    assert.match(fallbackSource, /openModal\('contact-modal'\)/);
    assert.match(app, /onerror="renderRightRailInquiryFallback\(\)"/);
});

test('banner manager separates header slides from right rail ads', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/app.js', 'utf8');

    assert.match(html, /id="header-banner-slides-list"/);
    assert.match(html, /id="right-rail-slides-list"/);
    assert.match(app, /function renderBannerSection/);
    assert.match(app, /new-right_rail-description/);
    assert.match(app, /new-right_rail-link-url/);
    assert.match(app, /new-right_rail-alt-text/);
    assert.match(app, /new-right_rail-expires-at/);
    assert.match(app, /new-right_rail-name/);
    assert.match(app, /async function addNewBannerSlide\(placement\)/);
    assert.match(app, /async function moveBanner\(placement, idx, dir\)/);
});

test('banner manager preserves an untouched expiry ISO value', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const source = app.match(/function resolveUpdateExpiresAt\(input\) \{[\s\S]*?\n\}/)?.[0];

    assert.ok(source);
    const resolveUpdateExpiresAt = new Function(`${source}; return resolveUpdateExpiresAt;`)();
    const originalIso = '2030-04-05T06:07:08.987Z';

    assert.equal(
        resolveUpdateExpiresAt({
            value: '2030-04-05T06:07',
            dataset: {
                originalExpiresAt: originalIso,
                originalLocalValue: '2030-04-05T06:07'
            }
        }),
        originalIso
    );
    assert.equal(
        resolveUpdateExpiresAt({
            value: '2030-04-05T06:08',
            dataset: {
                originalExpiresAt: originalIso,
                originalLocalValue: '2030-04-05T06:07'
            }
        }),
        new Date('2030-04-05T06:08').toISOString()
    );
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

test('deadline-soon sorting renders dated notices without an undefined current-date variable', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const start = app.indexOf('function filterCards()');
    const end = app.indexOf('\nfunction toggleViewMode()', start);
    const filterCardsSource = app.slice(start, end);
    const cards = [];
    const elements = {
        searchInput: { value: '' },
        targetFilter: { value: '전체' },
        'notice-grid': {
            innerHTML: '',
            appendChild(card) {
                cards.push(card);
            }
        },
        'filter-result-count': { innerHTML: '' }
    };
    const document = {
        getElementById(id) {
            return elements[id] || null;
        },
        createElement() {
            return {};
        }
    };
    const filterCards = new Function(
        'document', 'notices', 'savedPosts', 'viewMode', 'filterState',
        'selectedCategoryFilters', 'calcDDay', 'matchesDeadlineStatus',
        'escapeHtml', 'toggleSave', 'openDetail',
        `${filterCardsSource}; return filterCards;`
    )(
        document,
        [
            { id: 'later', title: 'Later deadline', deadline: '2026-07-30' },
            { id: 'sooner', title: 'Sooner deadline', deadline: '2026-07-29' }
        ],
        [],
        'all',
        {
            'deadline-status': '전체', host: '전체', 'has-image': '전체',
            saved: '전체', views: '전체', sort: '마감임박순'
        },
        new Set(),
        () => ({ text: 'D-2', isUrgent: true, isExpired: false }),
        () => true,
        value => String(value),
        () => {},
        () => {}
    );

    assert.doesNotThrow(() => filterCards());
    assert.match(cards[0].innerHTML, /Sooner deadline/);
    assert.match(cards[1].innerHTML, /Later deadline/);
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
