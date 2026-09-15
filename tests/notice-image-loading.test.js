import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';

const source = await readFile('js/core.js', 'utf8');
const helpers = source.slice(
    source.indexOf('const noticeImageRequests ='),
    source.indexOf('function updateDetailImage()')
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function setup() {
    const nodes = new Map();
    const candidates = [];
    const timers = new Map();
    let timerId = 0;
    function node(id) {
        if (!nodes.has(id)) {
            nodes.set(id, {
                dataset: {}, style: {}, hidden: false,
                children: new Map(),
                setAttribute(name, value) { this[name] = value; },
                removeAttribute(name) { delete this[name]; },
                querySelector(selector) {
                    if (!this.children.has(selector)) this.children.set(selector, {});
                    return this.children.get(selector);
                }
            });
        }
        return nodes.get(id);
    }
    function image(id) {
        return {
            id, src: 'previous.jpg', naturalWidth: 800,
            removeAttribute(name) { delete this[name]; },
            cloneNode() {
                const clone = image(id);
                candidates.push(clone);
                return clone;
            },
            replaceWith(next) { nodes.set(id, next); },
            decode() { return Promise.resolve(); }
        };
    }
    nodes.set('detail-hero-img', image('detail-hero-img'));
    nodes.set('viewer-img', image('viewer-img'));
    const context = {
        document: { getElementById: node },
        window: {
            setTimeout(callback, delay) {
                const id = ++timerId;
                timers.set(id, { callback, delay });
                return id;
            },
            clearTimeout(id) { timers.delete(id); }
        }
    };
    runInNewContext(`${helpers}
        globalThis.load = loadNoticeImage;
        globalThis.reset = resetNoticeImage;
    `, context);
    return { ...context, node, candidates, timers };
}

for (const scope of ['detail', 'viewer']) {
    const imageId = scope === 'detail' ? 'detail-hero-img' : 'viewer-img';
    const stageId = scope === 'detail' ? 'detail-hero' : 'viewer-image-stage';

    test(`${scope}: clears old image immediately and waits for decoding`, async () => {
        const h = setup();
        h.load(scope, 'next.jpg');
        assert.equal(h.node(imageId).src, undefined);
        assert.equal(h.node(stageId).dataset.imageState, 'loading');
        assert.equal(h.node(stageId)['aria-busy'], 'true');
        assert.equal(h.node(`${scope}-image-status`).hidden, false);
        const candidate = h.candidates.at(-1);
        const decode = deferred();
        candidate.decode = () => decode.promise;
        const loaded = candidate.onload();
        assert.equal(h.node(stageId).dataset.imageState, 'loading');
        decode.resolve();
        await loaded;
        assert.equal(h.node(imageId), candidate);
        assert.equal(h.node(imageId).src, 'next.jpg');
        assert.equal(h.node(stageId).dataset.imageState, 'ready');
        assert.equal(h.node(stageId)['aria-busy'], 'false');
        assert.equal(h.node(`${scope}-image-status`).hidden, true);
        assert.equal(h.timers.size, 0);
    });

    test(`${scope}: stale decode and error cannot overwrite a newer image`, async () => {
        const h = setup();
        h.load(scope, 'slow.jpg');
        const old = h.candidates.at(-1);
        const lateError = old.onerror;
        const decode = deferred();
        old.decode = () => decode.promise;
        const loaded = old.onload();
        h.load(scope, 'latest.jpg');
        await h.candidates.at(-1).onload();
        decode.resolve();
        await loaded;
        lateError();
        assert.equal(h.node(imageId).src, 'latest.jpg');
        assert.equal(h.node(stageId).dataset.imageState, 'ready');
        assert.equal(h.timers.size, 0);
    });

    test(`${scope}: error and timeout expose retry, which can succeed`, async () => {
        const h = setup();
        h.load(scope, 'broken.jpg');
        h.candidates.at(-1).onerror();
        assert.equal(h.node(stageId).dataset.imageState, 'error');
        const status = h.node(`${scope}-image-status`);
        assert.equal(status.querySelector('.notice-image-retry').hidden, false);
        assert.equal(status.querySelector('.notice-loading-spinner').hidden, true);
        h.load(scope, 'broken.jpg');
        const timer = [...h.timers.values()][0];
        assert.equal(timer.delay, 30000);
        timer.callback();
        assert.equal(h.node(stageId).dataset.imageState, 'error');
        h.load(scope, 'broken.jpg');
        await h.candidates.at(-1).onload();
        assert.equal(h.node(stageId).dataset.imageState, 'ready');
    });

    test(`${scope}: closing during decoding cancels callbacks and timers`, async () => {
        const h = setup();
        h.load(scope, 'slow.jpg');
        const candidate = h.candidates.at(-1);
        const decode = deferred();
        candidate.decode = () => decode.promise;
        const loaded = candidate.onload();
        h.reset(scope);
        decode.resolve();
        await loaded;
        assert.equal(h.node(stageId).dataset.imageState, 'idle');
        assert.equal(h.node(imageId).src, undefined);
        assert.equal(h.timers.size, 0);
    });

    test(`${scope}: decode failure offers retry without showing broken image`, async () => {
        const h = setup();
        h.load(scope, 'invalid.jpg');
        h.candidates.at(-1).decode = () => Promise.reject(new Error('decode'));
        await h.candidates.at(-1).onload();
        assert.equal(h.node(stageId).dataset.imageState, 'error');
        assert.equal(h.node(imageId).src, undefined);
    });
}

test('obsolete detail responses do not render or hide the current loading indicator', async () => {
    const pending = new Map();
    let hidden = 0;
    let renders = 0;
    const context = {
        cancelNoticeHoverPreview() {},
        closeModal() {},
        showNoticeLoading() {},
        hideNoticeLoading() { hidden += 1; },
        getNoticeDetail(id) {
            const result = deferred();
            pending.set(id, result);
            return result.promise;
        },
        getNoticeDatePresentation() { return {}; },
        renderNoticeCards() { renders += 1; },
        // A current request can fail without any DOM rendering.
        console: { error() {} },
        alert() {}
    };
    const detail = source.slice(source.indexOf('async function openDetail('),
        source.indexOf('function runNoticeSurfaceTransition('));
    runInNewContext(`let currentViewId = null;
        let noticeDetailRequestVersion = 0;
        ${detail}
        globalThis.open = openDetail;
    `, context);
    const old = context.open('old');
    const latest = context.open('latest');
    pending.get('old').resolve({ id: 'old' });
    await old;
    assert.equal(renders, 0);
    assert.equal(hidden, 0);
    pending.get('latest').reject(new Error('network'));
    await latest;
    assert.equal(hidden, 1);
});

test('image status markup and cleanup hooks are wired into the public page', async () => {
    const html = await readFile('index.html', 'utf8');
    for (const scope of ['detail', 'viewer']) {
        assert.match(html, new RegExp(`id="${scope}-image-status" hidden`));
        assert.match(html, new RegExp(`id="${scope}-image-message" role="status"`));
    }
    assert.match(source, /function closeModal\(id\) \{\s*if \(id === 'image-viewer-modal'\) resetNoticeImage\('viewer'\)/);
    assert.match(source, /function showBoardView\(\) \{\s*noticeDetailRequestVersion \+= 1;\s*hideNoticeLoading\(\);\s*resetNoticeImage\('detail'\)/);
});

// ========================================
// 상세 썸네일 줄
// ========================================

const gallerySource = source.slice(
    source.indexOf('function renderDetailGallery('),
    source.indexOf('// 상세 화면의 "크게 보기" 버튼 전용 진입점')
);

function fakeElement(tag) {
    const listeners = {};
    return {
        tagName: tag.toUpperCase(),
        className: '',
        dataset: {},
        attributes: {},
        children: [],
        innerHTML: '',
        setAttribute(name, value) { this.attributes[name] = String(value); },
        addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
        dispatch(type) { (listeners[type] || []).forEach(handler => handler()); },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; }
    };
}

function galleryHarness() {
    const timers = new Map();
    let timerId = 0;
    const context = {
        updates: [],
        document: { createElement: fakeElement },
        window: {
            setTimeout(callback, delay) {
                const id = ++timerId;
                timers.set(id, { callback, delay });
                return id;
            },
            clearTimeout(id) { timers.delete(id); }
        }
    };
    runInNewContext(`let detailImageIndex = 0;
        function updateDetailImage() { updates.push(detailImageIndex); }
        ${gallerySource}
        globalThis.render = renderDetailGallery;
        globalThis.create = createGalleryThumb;
    `, context);
    return { ...context, timers };
}

test('a gallery thumb holds its loading slot until the photo arrives', () => {
    const h = galleryHarness();
    const thumb = h.create('poster-1.jpg', 0);
    const [slot, image] = thumb.children;

    assert.equal(thumb.dataset.state, 'loading');
    assert.equal(thumb.attributes['aria-busy'], 'true');
    assert.equal(slot.className, 'gallery-thumb-slot');
    assert.match(slot.innerHTML, /notice-loading-spinner/);
    assert.equal(image.className, 'gallery-img');
    assert.equal(image.src, 'poster-1.jpg');

    image.naturalWidth = 1080;
    image.dispatch('load');
    assert.equal(thumb.dataset.state, 'ready');
    assert.equal(thumb.attributes['aria-busy'], 'false');
    assert.equal(h.timers.size, 0);
});

// 한 장이 느리다고 나머지 사진까지 가려지면 안 된다.
test('each thumb settles on its own, so a slow photo does not hold back the rest', () => {
    const h = galleryHarness();
    const gallery = fakeElement('div');
    h.render(gallery, ['1.jpg', '2.jpg', '3.jpg']);
    const images = gallery.children.map(thumb => thumb.children[1]);

    images[2].naturalWidth = 1080;
    images[2].dispatch('load');
    images[0].dispatch('error');

    assert.deepEqual(gallery.children.map(thumb => thumb.dataset.state), ['error', 'loading', 'ready']);
});

test('a stalled photo stops spinning after 30 seconds but still shows if it arrives late', () => {
    const h = galleryHarness();
    const thumb = h.create('slow.jpg', 0);
    const image = thumb.children[1];
    const [timer] = [...h.timers.values()];

    assert.equal(timer.delay, 30000);
    timer.callback();
    assert.equal(thumb.dataset.state, 'error');

    image.naturalWidth = 1080;
    image.dispatch('load');
    assert.equal(thumb.dataset.state, 'ready');
});

test('a photo that loads without any pixels counts as broken', () => {
    const h = galleryHarness();
    const thumb = h.create('empty.jpg', 0);
    thumb.children[1].naturalWidth = 0;
    thumb.children[1].dispatch('load');
    assert.equal(thumb.dataset.state, 'error');
});

test('tapping a thumb moves the large photo to it, even before the thumb loads', () => {
    const h = galleryHarness();
    const thumb = h.create('3.jpg', 2);
    thumb.dispatch('click');
    assert.deepEqual(h.updates, [2]);
});

// innerHTML +=는 붙일 때마다 줄 전체를 다시 만들어 받던 사진을 버리고 새로 요청한다.
test('the gallery is built from nodes once, not re-parsed per photo', () => {
    assert.doesNotMatch(source, /gallery\.innerHTML \+=/);
    assert.match(source, /renderDetailGallery\(gallery, notice\.images\)/);
});

test('the loading slot matches the 4:5 posters it stands in for', async () => {
    const css = await readFile('css/core.css', 'utf8');
    const rule = css.slice(css.indexOf('.gallery-thumb-slot {'), css.indexOf('}', css.indexOf('.gallery-thumb-slot {')));
    assert.match(rule, /width: 96px;/);
    assert.match(rule, /height: 120px;/);
    assert.match(rule, /url\('\.\.\/icons\/gallery-thumb-loading\.jpg'\)/);

    // 칸의 두 배 크기로 만들어야 고해상도 화면에서 흐리지 않다.
    const asset = await sharp('icons/gallery-thumb-loading.jpg').metadata();
    assert.equal(asset.width, 192);
    assert.equal(asset.height, 240);
});
