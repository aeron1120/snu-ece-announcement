import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    buildBannerSlideUpdate,
    normalizeBannerPayload,
    toClientBannerSlide
} from '../server/server.js';
import * as server from '../server/server.js';

const bannerFilePath = path.join(process.cwd(), 'server', 'data', 'banner-slides.json');

async function replaceBannerRows(t, rows) {
    const original = await readFile(bannerFilePath, 'utf8');
    t.after(() => writeFile(bannerFilePath, original, 'utf8'));
    await writeFile(bannerFilePath, JSON.stringify(rows, null, 2), 'utf8');
}

test('legacy banner rows default to header and preserve new metadata', () => {
    assert.deepEqual(
        toClientBannerSlide({
            id: 7,
            name: '협찬',
            text: '학생 할인',
            bg_style: 'background:#fff;',
            text_color: '#111',
            src: null,
            order: 2,
            link_url: 'https://example.com/ad',
            alt_text: '학생 할인 학내 홍보',
            description: '이번 달 혜택'
        }),
        {
            id: 7,
            name: '협찬',
            text: '학생 할인',
            bgStyle: 'background:#fff;',
            textColor: '#111',
            src: null,
            mobileSrc: null,
            order: 2,
            expiresAt: null,
            placement: 'header',
            linkUrl: 'https://example.com/ad',
            altText: '학생 할인 학내 홍보',
            description: '이번 달 혜택',
            type: 'council',
            owner: 'SNU ECE 학생회',
            status: 'approved',
            startsAt: null
        }
    );
});

test('banner updates omit an empty expiry so the stored value is preserved', () => {
    const update = buildBannerSlideUpdate({
        name: 'updated',
        text: 'updated',
        bgStyle: 'background:#fff;',
        textColor: '#111',
        src: null,
        order: 1,
        placement: 'header',
        linkUrl: '',
        altText: '',
        description: '',
        expiresAt: ''
    }, 'expiresAt');

    assert.equal(Object.hasOwn(update, 'expiresAt'), false);
    assert.equal({ expiresAt: null, ...update }.expiresAt, null);

    const exactExpiry = '2030-04-05T06:07:08.987Z';
    const supabaseUpdate = buildBannerSlideUpdate({ ...update, expiresAt: exactExpiry }, 'expires_at');
    assert.equal(supabaseUpdate.expires_at, exactExpiry);
});

test('banner payload accepts only known placements and web links', () => {
    const payload = normalizeBannerPayload({
        name: '세로 학내 홍보',
        text: '가입 안내',
        type: 'club',
        owner: '학생 동아리',
        status: 'approved',
        placement: 'right_rail',
        src: 'data:image/png;base64,desktop',
        mobileSrc: 'data:image/png;base64,mobile',
        linkUrl: 'https://example.com/join',
        altText: '가입 안내 포스터',
        description: '학생 대상 서비스',
        expiresAt: '2999-08-31T23:59:59+09:00',
        order: 1
    });
    assert.equal(payload.placement, 'right_rail');
    assert.equal(payload.linkUrl, 'https://example.com/join');
    assert.equal(payload.expiresAt, '2999-08-31T14:59:59.000Z');

    assert.throws(
        () => normalizeBannerPayload({ text: '홍보', owner: '학생회', placement: 'footer' }),
        /표시 위치/
    );
    assert.equal(
        normalizeBannerPayload({ text: '홍보', owner: '학생회' }).placement,
        'header'
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '홍보', owner: '학생회', placement: false }),
        /표시 위치/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '홍보', owner: '학생회', placement: 0 }),
        /표시 위치/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '홍보', owner: '학생회', linkUrl: 'javascript:alert(1)' }),
        /http 또는 https/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '홍보', owner: '학생회', expiresAt: 'not-a-date' }),
        /만료일/
    );
});

test('banner payload enforces text limits and requires text or image', () => {
    assert.throws(
        () => normalizeBannerPayload({ text: 'x'.repeat(101), owner: '학생회' }),
        /100자/
    );
    assert.throws(
        () => normalizeBannerPayload({ placement: 'right_rail', owner: '학생회' }),
        /텍스트 또는 이미지/
    );
    assert.throws(
        () => normalizeBannerPayload({
            placement: 'right_rail',
            owner: '학생회',
            text: '홍보',
            src: 'data:image/png;base64,desktop'
        }),
        /데스크탑과 모바일 이미지/
    );
});

test('right rail accepts at most five active banners', async t => {
    await replaceBannerRows(t, Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        name: `banner-${index + 1}`,
        text: `banner-${index + 1}`,
        placement: 'right_rail',
        order: index,
        expiresAt: '2999-12-31T23:59:59.000Z',
        isDeleted: false
    })));

    await assert.rejects(
        () => server.createBannerSlide(normalizeBannerPayload({
            text: 'sixth banner',
            owner: '학생회',
            status: 'approved',
            placement: 'right_rail',
            src: 'data:image/png;base64,desktop',
            mobileSrc: 'data:image/png;base64,mobile'
        })),
        /최대 5개/
    );
});

test('file banner storage evaluates expiration chronologically and preserves numeric order', async t => {
    await replaceBannerRows(t, [
        {
            id: 1,
            order: 5,
            createdAt: '2030-04-01T00:00:00.000Z',
            expiresAt: '2030-04-05T15:07:08.987+09:00',
            isDeleted: false
        },
        {
            id: 2,
            order: 10,
            createdAt: '2030-04-01T00:00:00.000Z',
            expiresAt: '2030-04-06T00:00:00.000Z',
            isDeleted: false
        },
        {
            id: 3,
            order: 1,
            createdAt: '2030-04-01T00:00:00.000Z',
            expiresAt: 'not-a-date',
            isDeleted: false
        },
        {
            id: 4,
            order: 3,
            createdAt: '2030-04-01T00:00:00.000Z',
            expiresAt: '',
            isDeleted: false
        }
    ]);

    const slides = await server.listBannerSlides?.(Date.parse('2030-04-05T06:07:08.988Z'));
    assert.deepEqual(slides?.map(slide => slide.id), [4, 2]);
});

test('public campus promotion excludes pending, rejected, and out-of-period slots', async t => {
    await replaceBannerRows(t, [
        {
            id: 1, order: 1, status: 'approved',
            startsAt: '2029-12-01T00:00:00.000Z',
            expiresAt: '2030-02-01T00:00:00.000Z',
            isDeleted: false
        },
        {
            id: 2, order: 2, status: 'pending',
            startsAt: '2029-12-01T00:00:00.000Z',
            expiresAt: '2030-02-01T00:00:00.000Z',
            isDeleted: false
        },
        {
            id: 3, order: 3, status: 'rejected',
            startsAt: '2029-12-01T00:00:00.000Z',
            expiresAt: '2030-02-01T00:00:00.000Z',
            isDeleted: false
        },
        {
            id: 4, order: 4, status: 'approved',
            startsAt: '2030-02-02T00:00:00.000Z',
            expiresAt: '2030-03-01T00:00:00.000Z',
            isDeleted: false
        },
        {
            id: 5, order: 5, status: 'approved',
            startsAt: '2029-10-01T00:00:00.000Z',
            expiresAt: '2029-12-01T00:00:00.000Z',
            isDeleted: false
        }
    ]);

    const now = Date.parse('2030-01-01T00:00:00.000Z');
    const publicSlides = await server.listBannerSlides(now);
    const managedSlides = await server.listBannerSlides(now, { includeUnpublished: true });

    assert.deepEqual(publicSlides.map(slide => slide.id), [1]);
    assert.deepEqual(managedSlides.map(slide => slide.id), [1, 2, 3, 4, 5]);
});

test('file banner cleanup soft-deletes expired and invalid expiration values only', async t => {
    await replaceBannerRows(t, [
        { id: 1, expiresAt: '2030-04-05T15:07:08.987+09:00', isDeleted: false },
        { id: 2, expiresAt: 'not-a-date', isDeleted: false },
        { id: 3, expiresAt: '', isDeleted: false },
        { id: 4, isDeleted: false },
        { id: 5, expiresAt: '2030-04-06T00:00:00.000Z', isDeleted: false }
    ]);

    await server.cleanupExpiredBanners?.(Date.parse('2030-04-05T06:07:08.988Z'));
    const rows = JSON.parse(await readFile(bannerFilePath, 'utf8'));

    assert.deepEqual(rows.map(row => row.isDeleted), [true, true, false, false, false]);
});
