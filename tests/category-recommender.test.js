import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateCategoryCandidates,
    normalizeKeyword
} from '../server/services/category-recommender.js';

const now = new Date('2026-07-27T12:00:00.000Z');
const config = {
    windowDays: 60,
    minimumNotices: 5,
    minimumConfidence: 0.75
};

function notice(id, {
    daysAgo = id,
    confidence = 0.8,
    keyword = '수강 신청'
} = {}) {
    return {
        id,
        status: 'published',
        publishedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
        keywords: [keyword],
        analysisConfidence: confidence
    };
}

test('normalizeKeyword trims and folds Korean keyword spacing and case', () => {
    assert.equal(normalizeKeyword('  AI   세미나 '), 'ai 세미나');
});

test('category recommendation requires five recent distinct notices at confidence threshold', () => {
    const four = evaluateCategoryCandidates({
        notices: [1, 2, 3, 4].map(id => notice(id)),
        categories: [],
        candidates: [],
        now,
        config
    });
    assert.equal(four.length, 0);

    const five = evaluateCategoryCandidates({
        notices: [1, 2, 3, 4, 5].map(id => notice(id, { confidence: 0.75 })),
        categories: [],
        candidates: [],
        now,
        config
    });
    assert.equal(five.length, 1);
    assert.equal(five[0].normalizedKeyword, '수강 신청');
    assert.equal(five[0].occurrenceCount, 5);
    assert.deepEqual(five[0].supportingNoticeIds, [1, 2, 3, 4, 5]);
});

test('old notices and low average confidence do not cross the threshold', () => {
    const withOld = [1, 2, 3, 4].map(id => notice(id));
    withOld.push(notice(5, { daysAgo: 61 }));
    assert.equal(evaluateCategoryCandidates({
        notices: withOld,
        categories: [],
        candidates: [],
        now,
        config
    }).length, 0);

    assert.equal(evaluateCategoryCandidates({
        notices: [1, 2, 3, 4, 5].map(id =>
            notice(id, { confidence: id === 5 ? 0.4 : 0.8 })
        ),
        categories: [],
        candidates: [],
        now,
        config
    }).length, 0);
});

test('aliases, stopwords, rejected, and currently deferred candidates stay hidden', () => {
    const notices = [1, 2, 3, 4, 5].map(id => notice(id));
    assert.equal(evaluateCategoryCandidates({
        notices,
        categories: [{ id: 1, name: '교과목', aliases: ['수강 신청'] }],
        candidates: [],
        now,
        config
    }).length, 0);
    assert.equal(evaluateCategoryCandidates({
        notices: [1, 2, 3, 4, 5].map(id => notice(id, { keyword: '공지' })),
        categories: [],
        candidates: [],
        now,
        config
    }).length, 0);
    assert.equal(evaluateCategoryCandidates({
        notices,
        categories: [],
        candidates: [{ normalizedKeyword: '수강 신청', status: 'rejected' }],
        now,
        config
    }).length, 0);
    assert.equal(evaluateCategoryCandidates({
        notices,
        categories: [],
        candidates: [{
            normalizedKeyword: '수강 신청',
            status: 'deferred',
            deferredUntil: '2026-08-26T12:00:00.000Z'
        }],
        now,
        config
    }).length, 0);
});
