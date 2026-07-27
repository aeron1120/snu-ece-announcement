import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
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

test('right-rail images retain their layout contract with and without a link', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const css = await readFile('css/style.css', 'utf8');
    const source = app.match(/function renderRightRailAd\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(source);

    const render = slide => {
        const container = { innerHTML: '' };
        const renderRightRailAd = new Function(
            'document', 'getBannerSlidesByPlacement', 'escapeHtml', 'renderRightRailInquiryFallback',
            `${source}; return renderRightRailAd;`
        )(
            { getElementById: () => container },
            () => [slide],
            value => String(value),
            () => { container.innerHTML = 'fallback'; }
        );
        renderRightRailAd();
        return container.innerHTML;
    };

    const linked = render({ src: 'https://example.test/linked.png', linkUrl: 'https://example.test', text: 'Linked' });
    const linkless = render({ src: 'https://example.test/linkless.png', linkUrl: '', text: 'Linkless' });

    assert.match(linked, /class="rail-ad-link"/);
    assert.match(linked, /class="rail-ad-image"/);
    assert.doesNotMatch(linkless, /class="rail-ad-link"/);
    assert.match(linkless, /class="rail-ad-image"/);
    assert.match(css, /\.rail-ad-image\s*\{[^}]*width:\s*100%[^}]*aspect-ratio:\s*9\s*\/\s*16[^}]*object-fit:\s*cover/s);
});

test('right rail chooses the smallest numeric order', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const source = app.match(/function getBannerSlidesByPlacement\(placement\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(source);

    const getBannerSlidesByPlacement = new Function(
        'bannerSlides',
        `${source}; return getBannerSlidesByPlacement;`
    )([
        { id: 10, placement: 'right_rail', order: '10' },
        { id: 2, placement: 'right_rail', order: '2' },
        { id: 1, placement: 'header', order: '1' }
    ]);

    assert.equal(getBannerSlidesByPlacement('right_rail')[0].id, 2);
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

test('banner manager omits an untouched expiry so storage preserves it', async () => {
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
        ''
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

    const originalOffsetIso = '2030-04-05T15:07:08.987+09:00';
    assert.equal(
        resolveUpdateExpiresAt({
            value: '2030-04-05T15:07',
            dataset: {
                originalExpiresAt: originalOffsetIso,
                originalLocalValue: '2030-04-05T15:07'
            }
        }),
        ''
    );

    const updateSource = app.slice(
        app.indexOf('async function updateBannerSlide(slideId)'),
        app.indexOf('\nasync function moveBanner(', app.indexOf('async function updateBannerSlide(slideId)'))
    );
    assert.match(updateSource, /expiresAt\s*\n\s*\}\)/);
    assert.doesNotMatch(updateSource, /expiresAt:\s*expiresAt\s*\?\s*new Date\(expiresAt\)\.toISOString\(\)\s*:\s*''/);
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

test('service worker replaces the stale app-shell cache during activation', async () => {
    const worker = await readFile('service-worker.js', 'utf8');
    const handlers = {};
    const openedCaches = [];
    const deletedCaches = [];
    const cache = {
        async addAll() {},
        async put() {}
    };
    const context = {
        URL,
        Promise,
        fetch: async () => ({ ok: true, type: 'basic', clone() { return this; } }),
        caches: {
            async open(name) {
                openedCaches.push(name);
                return cache;
            },
            async keys() {
                return ['ece-notices-v1'];
            },
            async delete(name) {
                deletedCaches.push(name);
                return true;
            },
            async match() {
                return null;
            }
        },
        self: {
            location: { origin: 'http://localhost' },
            addEventListener(name, handler) {
                handlers[name] = handler;
            },
            async skipWaiting() {},
            clients: {
                async claim() {},
                async openWindow() {}
            }
        }
    };
    runInNewContext(worker, context);

    let installWork;
    handlers.install({ waitUntil(promise) { installWork = promise; } });
    await installWork;
    let activateWork;
    handlers.activate({ waitUntil(promise) { activateWork = promise; } });
    await activateWork;

    assert.notEqual(openedCaches[0], 'ece-notices-v1');
    assert.deepEqual(deletedCaches, ['ece-notices-v1']);
});

test('service worker loads app-shell files from the network before cached fallback', async () => {
    const worker = await readFile('service-worker.js', 'utf8');
    const handlers = {};
    const calls = [];
    const pendingWrites = [];
    const state = { networkFails: false };
    const cachedResponse = { source: 'cache' };
    const networkResponse = {
        source: 'network',
        ok: true,
        type: 'basic',
        clone() {
            return this;
        }
    };
    const cache = {
        async addAll() {},
        async put() {}
    };
    const context = {
        URL,
        Promise,
        async fetch() {
            calls.push('network');
            if (state.networkFails) throw new Error('offline');
            return networkResponse;
        },
        caches: {
            async open() {
                return cache;
            },
            async keys() {
                return [];
            },
            async delete() {
                return true;
            },
            async match() {
                calls.push('cache');
                return cachedResponse;
            }
        },
        self: {
            location: { origin: 'http://localhost' },
            addEventListener(name, handler) {
                handlers[name] = handler;
            },
            async skipWaiting() {},
            clients: {
                async claim() {},
                async openWindow() {}
            }
        }
    };
    runInNewContext(worker, context);

    const request = { method: 'GET', url: 'http://localhost/css/style.css' };
    let responseWork;
    handlers.fetch({
        request,
        respondWith(promise) {
            responseWork = promise;
        },
        waitUntil(promise) {
            pendingWrites.push(promise);
        }
    });
    assert.equal((await responseWork).source, 'network');
    assert.deepEqual(calls, ['network']);
    await Promise.all(pendingWrites);

    calls.length = 0;
    state.networkFails = true;
    handlers.fetch({
        request,
        respondWith(promise) {
            responseWork = promise;
        },
        waitUntil(promise) {
            pendingWrites.push(promise);
        }
    });
    assert.equal((await responseWork).source, 'cache');
    assert.deepEqual(calls, ['network', 'cache']);
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

test('notice list uses masonry columns without splitting cards', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const css = await readFile('css/style.css', 'utf8');

    assert.match(css, /\.grid\s*\{[^}]*column-count:\s*4/s);
    assert.match(css, /\.card\s*\{[^}]*break-inside:\s*avoid/s);
    assert.match(css, /\.card\s*\{[^}]*margin-bottom:\s*20px/s);
    assert.match(css, /@media \(max-width:\s*1200px\)[\s\S]*column-count:\s*3/);
    assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*column-count:\s*2/);
    assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*column-count:\s*1/);
    assert.match(app, /class="notice-empty-state"/);
    assert.doesNotMatch(css, /\.grid\s*\{[^}]*display:\s*grid/s);
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
