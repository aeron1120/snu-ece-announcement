import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildKakaoNoticeEvent,
    buildNoticePermalink,
    createKakaoBotWebhookService
} from '../server/services/kakao-bot-webhook.js';

test('Kakao notice event includes category, title, absolute deadline, D-day, and permalink', () => {
    const payload = buildKakaoNoticeEvent({
        notice: {
            id: 42,
            title: '장학금 신청 안내',
            deadlineAt: '2026-08-04T14:59:59.000Z'
        },
        categorySlugs: ['academics', 'application'],
        publicBaseUrl: 'https://notice.example.edu/',
        now: new Date('2026-07-28T12:00:00+09:00')
    });

    assert.equal(payload.notice.category, 'application');
    assert.equal(payload.notice.deadline, '2026-08-04');
    assert.equal(payload.notice.dDay, 7);
    assert.equal(payload.notice.permalink, 'https://notice.example.edu/?id=42');
    assert.match(payload.message, /^\[신청\] 장학금 신청 안내/);
    assert.match(payload.message, /마감 2026\.08\.04 \(D-7\)/);
    assert.match(payload.message, /https:\/\/notice\.example\.edu\/\?id=42$/);
});

test('Kakao webhook only sends application and academics notices', async () => {
    const calls = [];
    const service = createKakaoBotWebhookService({
        webhookUrl: 'https://bot.example.test/webhook',
        publicBaseUrl: 'https://notice.example.test',
        categoryProvider: async () => [
            { id: 1, slug: 'application' },
            { id: 2, slug: 'campus' }
        ],
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, status: 204 };
        }
    });

    const skipped = await service.notifyPublishedNotice({
        id: 1,
        title: '캠퍼스 안내',
        deadline: '2026-08-01',
        categoryIds: [2]
    });
    assert.deepEqual(skipped, { sent: false, reason: 'category_not_eligible' });

    const sent = await service.notifyPublishedNotice({
        id: 2,
        title: '신청 안내',
        deadline: '2026-08-01',
        categoryIds: [1]
    });
    assert.equal(sent.sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://bot.example.test/webhook');
    assert.equal(JSON.parse(calls[0].options.body).notice.id, 2);
});

test('permalink keeps an existing public-site path and query', () => {
    assert.equal(
        buildNoticePermalink('https://example.test/board?source=bot', 7),
        'https://example.test/board?source=bot&id=7'
    );
});

test('D-day is based on Korea time even when the runtime clock is UTC', () => {
    const payload = buildKakaoNoticeEvent({
        notice: { id: 8, title: '자정 기준 테스트', deadline: '2026-07-29' },
        categorySlugs: ['academics'],
        publicBaseUrl: 'https://notice.example.test',
        now: new Date('2026-07-28T16:00:00Z')
    });
    assert.equal(payload.notice.dDay, 0);
    assert.match(payload.message, /\(D-Day\)/);
});
