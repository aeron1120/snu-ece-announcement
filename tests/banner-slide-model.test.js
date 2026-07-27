import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeBannerPayload,
    toClientBannerSlide
} from '../server/server.js';

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
            alt_text: '학생 할인 광고',
            description: '이번 달 혜택'
        }),
        {
            id: 7,
            name: '협찬',
            text: '학생 할인',
            bgStyle: 'background:#fff;',
            textColor: '#111',
            src: null,
            order: 2,
            expiresAt: null,
            placement: 'header',
            linkUrl: 'https://example.com/ad',
            altText: '학생 할인 광고',
            description: '이번 달 혜택'
        }
    );
});

test('banner payload accepts only known placements and web links', () => {
    const payload = normalizeBannerPayload({
        name: '세로 광고',
        text: '가입 안내',
        placement: 'right_rail',
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
        () => normalizeBannerPayload({ text: '광고', placement: 'footer' }),
        /표시 위치/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '광고', linkUrl: 'javascript:alert(1)' }),
        /http 또는 https/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '광고', expiresAt: 'not-a-date' }),
        /만료일/
    );
});

test('banner payload enforces text limits and requires text or image', () => {
    assert.throws(
        () => normalizeBannerPayload({ text: 'x'.repeat(101) }),
        /100자/
    );
    assert.throws(
        () => normalizeBannerPayload({ placement: 'right_rail' }),
        /텍스트 또는 이미지/
    );
});
