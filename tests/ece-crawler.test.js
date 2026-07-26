import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAutomationStore } from '../server/storage/automation-store.js';
import { createEceCrawler } from '../server/services/ece-crawler.js';

function response(body, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        text: async () => body
    };
}

test('crawler checks configured pages and creates only unknown notices', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-crawler-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    await store.createPendingNotice({
        sourceType: 'ece_academics',
        sourceExternalId: 'known',
        title: 'known',
        content: 'known',
        status: 'pending_review'
    });

    const requestedUrls = [];
    const waits = [];
    const fetchImpl = async url => {
        requestedUrls.push(String(url));
        return response(String(url).includes('md=v') ? 'detail' : 'list');
    };
    const parser = {
        parseAcademicsList: (_html, url) => {
            const page = new URL(url).searchParams.get('page') || '1';
            return [
                {
                    externalId: page === '1' ? 'known' : `new-${page}`,
                    audience: '학부',
                    title: `title-${page}`,
                    sourceUrl: `https://ece.snu.ac.kr/community/academics?md=v&bbsidx=${page}`,
                    publishedDate: '2026-07-01'
                }
            ];
        },
        parseAcademicsDetail: (_html, sourceUrl) => ({
            externalId: new URL(sourceUrl).searchParams.get('bbsidx'),
            title: 'detail title',
            content: 'detail content',
            publishedDate: '2026-07-01',
            attachments: [],
            sourceUrl
        })
    };
    const analyzer = {
        analyzeNotice: async () => ({
            summary: ['요약'],
            deadline: null,
            targets: ['전체'],
            keywords: ['수강신청'],
            existingCategoryIds: [],
            confidence: 0.9,
            analysisStatus: 'succeeded'
        })
    };
    const crawler = createEceCrawler({
        store,
        fetchImpl,
        parser,
        analyzer,
        config: {
            baseUrl: 'https://ece.snu.ac.kr/community/academics',
            pages: 3,
            maxDetails: 20,
            requestDelayMs: 1000,
            timeoutMs: 10000
        },
        wait: async milliseconds => waits.push(milliseconds)
    });

    const result = await crawler.run();

    assert.equal(result.discoveredCount, 3);
    assert.equal(result.createdCount, 2);
    assert.equal(result.failedCount, 0);
    assert.equal(requestedUrls.filter(url => !url.includes('md=v')).length, 3);
    assert.equal(requestedUrls.filter(url => url.includes('md=v')).length, 2);
    assert.deepEqual(waits, [1000, 1000, 1000, 1000]);

    const rerun = await crawler.run();
    assert.equal(rerun.createdCount, 0);
});

test('crawler caps detail requests and records partial failures', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-crawler-cap-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    let detailRequests = 0;
    const fetchImpl = async url => {
        if (String(url).includes('md=v')) {
            detailRequests += 1;
            return response('detail', detailRequests !== 2);
        }
        return response('list');
    };
    const summaries = Array.from({ length: 25 }, (_value, index) => ({
        externalId: String(index + 1),
        audience: '학부',
        title: `title-${index + 1}`,
        sourceUrl: `https://ece.snu.ac.kr/community/academics?md=v&bbsidx=${index + 1}`,
        publishedDate: '2026-07-01'
    }));
    const crawler = createEceCrawler({
        store,
        fetchImpl,
        parser: {
            parseAcademicsList: () => summaries,
            parseAcademicsDetail: (_html, sourceUrl) => ({
                externalId: new URL(sourceUrl).searchParams.get('bbsidx'),
                title: 'title',
                content: 'content',
                publishedDate: '2026-07-01',
                attachments: [],
                sourceUrl
            })
        },
        analyzer: null,
        config: {
            baseUrl: 'https://ece.snu.ac.kr/community/academics',
            pages: 1,
            maxDetails: 20,
            requestDelayMs: 0,
            timeoutMs: 10000
        },
        wait: async () => {}
    });

    const result = await crawler.run();

    assert.equal(detailRequests, 20);
    assert.equal(result.status, 'partial');
    assert.equal(result.createdCount, 19);
    assert.equal(result.failedCount, 1);
});
