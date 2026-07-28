import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateNoticeLifecycle,
    getNoticeLifecycleState,
    normalizeDeadlineAt
} from '../server/services/notice-expiry.js';

test('deadline dates are stored as explicit Seoul end-of-day instants', () => {
    assert.equal(normalizeDeadlineAt('2026-08-01'), '2026-08-01T14:59:59.000Z');
});

test('notice expiry follows category priority and grace periods', () => {
    const application = calculateNoticeLifecycle({
        deadlineAt: '2026-08-01',
        categorySlugs: ['application'],
        createdAt: '2026-07-01T00:00:00.000Z'
    });
    assert.equal(application.expiresAt, '2026-08-04T14:59:59.000Z');

    const academicsWins = calculateNoticeLifecycle({
        deadlineAt: '2026-08-01',
        categorySlugs: ['application', 'academics'],
        createdAt: '2026-07-01T00:00:00.000Z'
    });
    assert.equal(academicsWins.expiresAt, '2026-08-08T14:59:59.000Z');

    const benefitFallback = calculateNoticeLifecycle({
        categorySlugs: ['benefits-partnerships'],
        createdAt: '2026-07-01T00:00:00.000Z'
    });
    assert.equal(benefitFallback.expiresAt, '2026-08-30T00:00:00.000Z');
});

test('always-open and governance notices never expire', () => {
    assert.equal(calculateNoticeLifecycle({
        deadlineAt: '2026-08-01',
        isAlwaysOpen: true,
        categorySlugs: ['application']
    }).expiresAt, null);
    assert.equal(calculateNoticeLifecycle({
        categorySlugs: ['governance']
    }).expiresAt, null);
});

test('application notices require a human-confirmed deadline', () => {
    assert.throws(
        () => calculateNoticeLifecycle({ categorySlugs: ['application'] }),
        /관리자가 확인한 마감일/
    );
});

test('lifecycle state distinguishes grace-period and archived notices', () => {
    const lifecycle = {
        deadlineAt: '2026-08-01T14:59:59.000Z',
        expiresAt: '2026-08-04T14:59:59.000Z',
        isAlwaysOpen: false
    };
    assert.deepEqual(
        getNoticeLifecycleState(lifecycle, new Date('2026-08-03T00:00:00.000Z')),
        { deadlinePassed: true, isExpired: false, isInGracePeriod: true }
    );
    assert.equal(
        getNoticeLifecycleState(lifecycle, new Date('2026-08-05T00:00:00.000Z')).isExpired,
        true
    );
});
