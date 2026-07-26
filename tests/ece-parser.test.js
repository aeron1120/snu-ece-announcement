import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    EceParseError,
    parseAcademicsList,
    parseAcademicsDetail
} from '../server/services/ece-parser.js';

test('list parser keeps undergraduate audiences and extracts bbsidx', async () => {
    const html = await readFile('tests/fixtures/ece-academics-list.html', 'utf8');
    const rows = parseAcademicsList(
        html,
        'https://ece.snu.ac.kr/community/academics'
    );

    assert.deepEqual(rows.map(row => row.audience), ['학부', '학부&대학원']);
    assert.deepEqual(rows.map(row => row.externalId), ['57854', '57796']);
    assert.deepEqual(rows.map(row => row.publishedDate), ['2026-07-01', '2026-06-05']);
    assert.equal(rows[1].title, '등록 및 휴학 안내');
});

test('detail parser preserves source and attachment links', async () => {
    const html = await readFile('tests/fixtures/ece-academics-detail.html', 'utf8');
    const sourceUrl = 'https://ece.snu.ac.kr/community/academics?bbsidx=57854&md=v';
    const detail = parseAcademicsDetail(html, sourceUrl);

    assert.match(detail.title, /교과목 중복인정/);
    assert.match(detail.content, /학사정보시스템/);
    assert.equal(detail.externalId, '57854');
    assert.equal(detail.publishedDate, '2026-07-01');
    assert.equal(detail.attachments[0].name.endsWith('.pdf'), true);
    assert.equal(
        detail.attachments[0].url,
        'https://ece.snu.ac.kr/community/academics?md=down&bbsidx=57854&fileidx=16196'
    );
});

test('parser rejects HTML when board contracts disappear', () => {
    assert.throws(
        () => parseAcademicsList('<html></html>', 'https://ece.snu.ac.kr/community/academics'),
        EceParseError
    );
    assert.throws(
        () => parseAcademicsDetail(
            '<div class="bbs_contents">body only</div>',
            'https://ece.snu.ac.kr/community/academics?bbsidx=1&md=v'
        ),
        EceParseError
    );
});
