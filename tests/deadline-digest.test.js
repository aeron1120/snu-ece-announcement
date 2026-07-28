import test from 'node:test';
import assert from 'node:assert/strict';
import { listImminentDeadlineNotices } from '../server/server.js';

test('deadline digest returns today and upcoming counts with permalinks', () => {
    const result = listImminentDeadlineNotices([
        { id: 1, title: '오늘', deadlineAt: '2026-07-28T14:59:59.000Z', categoryIds: [] },
        { id: 2, title: '이번 주', deadline: '2026-08-02', categoryIds: [] },
        { id: 3, title: '기간 밖', deadline: '2026-09-01', categoryIds: [] },
        { id: 4, title: '상시', deadline: '', isAlwaysOpen: true, categoryIds: [] }
    ], {
        now: new Date('2026-07-28T09:00:00+09:00'),
        days: 7,
        publicBaseUrl: 'https://notice.example.test'
    });

    assert.equal(result.counts.today, 1);
    assert.equal(result.counts.upcoming, 2);
    assert.deepEqual(result.notices.map(notice => notice.id), [1, 2]);
    assert.equal(result.notices[0].permalink, 'https://notice.example.test/?id=1');
});
