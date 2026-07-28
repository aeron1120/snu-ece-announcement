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

test('notice expiry is derived directly from the deadline without category grace periods', () => {
    const opportunity = calculateNoticeLifecycle({
        deadlineAt: '2026-08-01',
        categorySlugs: ['opportunity'],
        createdAt: '2026-07-01T00:00:00.000Z'
    });
    assert.equal(opportunity.expiresAt, '2026-08-01T14:59:59.000Z');

    const academic = calculateNoticeLifecycle({
        deadlineAt: '2026-08-01',
        categorySlugs: ['academic'],
        createdAt: '2026-07-01T00:00:00.000Z'
    });
    assert.equal(academic.expiresAt, '2026-08-01T14:59:59.000Z');

    const noDeadline = calculateNoticeLifecycle({
        categorySlugs: ['benefit'],
        createdAt: '2026-07-01T00:00:00.000Z'
    });
    assert.equal(noDeadline.expiresAt, null);
});

test('always-open and deadline-free community notices never expire', () => {
    assert.equal(calculateNoticeLifecycle({
        deadlineAt: '2026-08-01',
        isAlwaysOpen: true,
        categorySlugs: ['opportunity']
    }).expiresAt, null);
    assert.equal(calculateNoticeLifecycle({
        categorySlugs: ['community']
    }).expiresAt, null);
});

test('opportunity notices without a deadline remain always-current information', () => {
    assert.equal(
        calculateNoticeLifecycle({ categorySlugs: ['opportunity'] }).expiresAt,
        null
    );
});

test('lifecycle state marks a notice expired as soon as its deadline passes', () => {
    const lifecycle = {
        deadlineAt: '2026-08-01T14:59:59.000Z',
        expiresAt: '2026-08-01T14:59:59.000Z',
        isAlwaysOpen: false
    };
    assert.deepEqual(
        getNoticeLifecycleState(lifecycle, new Date('2026-08-03T00:00:00.000Z')),
        { deadlinePassed: true, isExpired: true, isInGracePeriod: false }
    );
    assert.equal(
        getNoticeLifecycleState(lifecycle, new Date('2026-08-05T00:00:00.000Z')).isExpired,
        true
    );
});
