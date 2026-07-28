import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyNoticeListFilters,
    normalizeNoticeListFilters
} from '../server/server.js';

const rows = [
    {
        id: 1,
        title: '수강 신청 안내',
        content: '학사 신청 링크를 확인하세요.',
        target: '전체',
        host: '전기정보공학부',
        deadline: '2026-08-02',
        categoryIds: [1, 2],
        views: 30,
        images: [],
        createdAt: '2026-07-28T01:00:00.000Z'
    },
    {
        id: 2,
        title: '학생회 행사',
        content: '캠퍼스 행사 안내',
        target: '26학번',
        host: '학생회',
        deadline: '2026-07-20',
        categoryIds: [4],
        views: 120,
        images: ['poster'],
        createdAt: '2026-07-27T01:00:00.000Z'
    },
    {
        id: 3,
        title: '상시 제휴 혜택',
        content: '학생 할인',
        target: '전체',
        host: '외부·기업',
        deadline: '',
        categoryIds: [3],
        views: 5,
        images: [],
        createdAt: '2026-07-26T01:00:00.000Z'
    }
];

test('notice list filters derive the page rows and count from one matching collection', () => {
    const filters = normalizeNoticeListFilters({
        category: '2',
        search: '수강 신청',
        target: '26학번',
        deadlineStatus: '진행중',
        hasImage: '없음'
    });
    const matching = applyNoticeListFilters(rows, filters, {
        now: new Date('2026-07-28T12:00:00+09:00')
    });

    assert.deepEqual(matching.map(notice => notice.id), [1]);
});

test('notice list filters support contextual empty results and server-side sorting inputs', () => {
    const empty = applyNoticeListFilters(
        rows,
        normalizeNoticeListFilters({ search: '존재하지 않는 검색어' }),
        { now: new Date('2026-07-28T12:00:00+09:00') }
    );
    assert.equal(empty.length, 0);

    const byViews = applyNoticeListFilters(
        rows,
        normalizeNoticeListFilters({ sort: '조회순' }),
        { now: new Date('2026-07-28T12:00:00+09:00') }
    );
    assert.deepEqual(byViews.map(notice => notice.id), [2, 1, 3]);
});

test('pinned notices stay above the selected sort order', () => {
    const result = applyNoticeListFilters([
        { ...rows[0], id: 30, views: 10, isPinned: true },
        { ...rows[1], id: 31, views: 999, isPinned: false }
    ], normalizeNoticeListFilters({ sort: '조회순' }), {
        now: new Date('2026-07-01T00:00:00.000Z')
    });
    assert.deepEqual(result.map(notice => notice.id), [30, 31]);
});

test('notice list filter normalization rejects unknown states instead of widening queries unpredictably', () => {
    assert.deepEqual(
        normalizeNoticeListFilters({
            category: '1,not-a-number,2,1',
            deadlineStatus: 'unknown',
            hasImage: 'unknown',
            views: 'unknown',
            sort: 'unknown'
        }),
        {
            categoryIds: [1, 2],
            search: '',
            target: '전체',
            deadlineStatus: '전체',
            host: '전체',
            hasImage: '전체',
            views: '전체',
            sort: '최신순',
            dateFrom: '',
            dateTo: '',
            includeExpired: false
        }
    );
});

test('default lists hide archived notices while search keeps them after active results', () => {
    const lifecycleRows = [
        {
            ...rows[0],
            id: 10,
            title: '같은 검색 활성',
            deadlineAt: '2026-08-01T14:59:59.000Z',
            expiresAt: '2026-08-04T14:59:59.000Z'
        },
        {
            ...rows[1],
            id: 11,
            title: '같은 검색 만료',
            deadlineAt: '2026-07-01T14:59:59.000Z',
            expiresAt: '2026-07-04T14:59:59.000Z'
        }
    ];
    const now = new Date('2026-07-28T12:00:00+09:00');
    const defaultResult = applyNoticeListFilters(
        lifecycleRows,
        normalizeNoticeListFilters({}),
        { now }
    );
    assert.deepEqual(defaultResult.map(notice => notice.id), [10]);

    const searchResult = applyNoticeListFilters(
        lifecycleRows,
        normalizeNoticeListFilters({ search: '같은 검색' }),
        { now }
    );
    assert.deepEqual(searchResult.map(notice => notice.id), [10, 11]);
});

test('deadline grace-period notices stay visible after active notices', () => {
    const now = new Date('2026-07-28T12:00:00+09:00');
    const result = applyNoticeListFilters([
        {
            ...rows[0],
            id: 20,
            createdAt: '2026-07-27T00:00:00.000Z',
            deadlineAt: '2026-08-01T14:59:59.000Z',
            expiresAt: '2026-08-04T14:59:59.000Z'
        },
        {
            ...rows[0],
            id: 21,
            createdAt: '2026-07-28T00:00:00.000Z',
            deadlineAt: '2026-07-25T14:59:59.000Z',
            expiresAt: '2026-07-29T14:59:59.000Z'
        }
    ], normalizeNoticeListFilters({ sort: '최신순' }), { now });
    assert.deepEqual(result.map(notice => notice.id), [20, 21]);
});
