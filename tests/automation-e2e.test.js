import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAutomationStore } from '../server/storage/automation-store.js';
import { createEceCrawler } from '../server/services/ece-crawler.js';
import * as parser from '../server/services/ece-parser.js';
import { createNoticeAnalyzer } from '../server/services/notice-analyzer.js';
import { createPushService } from '../server/services/push-service.js';
import { evaluateCategoryCandidates } from '../server/services/category-recommender.js';

function htmlResponse(body) {
    return {
        ok: true,
        status: 200,
        async text() {
            return body;
        }
    };
}

test('crawl, review, publish, notify, deduplicate, and recommend category end to end', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-e2e-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    const [listHtml, detailHtml] = await Promise.all([
        readFile('tests/fixtures/ece-academics-list.html', 'utf8'),
        readFile('tests/fixtures/ece-academics-detail.html', 'utf8')
    ]);
    const analyzer = createNoticeAnalyzer({
        apiKey: 'test-key',
        fetchImpl: async () => ({
            ok: true,
            async json() {
                return {
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    summary: ['교과목 중복인정 신청 절차가 변경되었습니다.'],
                                    deadline: null,
                                    targets: ['25학번'],
                                    keywords: ['교과목 중복인정'],
                                    existingCategoryIds: [],
                                    confidence: 0.9
                                })
                            }]
                        }
                    }]
                };
            }
        })
    });
    const crawler = createEceCrawler({
        store,
        parser: {
            ...parser,
            parseAcademicsList(...args) {
                return parser.parseAcademicsList(...args).slice(0, 1);
            }
        },
        analyzer,
        fetchImpl: async url => htmlResponse(
            String(url).includes('md=v') ? detailHtml : listHtml
        ),
        config: {
            baseUrl: 'https://ece.snu.ac.kr/community/academics',
            pages: 1,
            maxDetails: 1,
            requestDelayMs: 0,
            timeoutMs: 1000
        },
        wait: async () => {}
    });

    const crawl = await crawler.run();
    assert.equal(crawl.createdCount, 1);
    const [pending] = await store.listReviewNotices();
    assert.equal(pending.status, 'pending_review');
    assert.equal((await store.listPublishedNotices()).length, 0);

    const sent = [];
    const pushService = createPushService({
        store,
        webPushClient: {
            setVapidDetails() {},
            async sendNotification(subscription, payload) {
                sent.push({ subscription, payload });
            }
        },
        config: {
            enabled: true,
            subject: 'mailto:ece@example.com',
            publicKey: 'public',
            privateKey: 'private'
        }
    });
    await pushService.createSubscription({
        endpoint: 'https://push.example.test/e2e',
        keys: { p256dh: 'public-key', auth: 'auth-key' }
    }, {
        admissionYear: '25학번',
        allNotices: true
    });

    const published = await store.publishReviewNotice(
        pending.id,
        { targets: ['25학번'] },
        { notify: true }
    );
    assert.equal(published.status, 'published');
    assert.equal((await store.listPublishedNotices()).length, 1);

    const delivery = await pushService.processPendingJobs();
    assert.equal(delivery.sent, 1);
    await pushService.processPendingJobs();
    assert.equal(sent.length, 1);

    const rerun = await crawler.run();
    assert.equal(rerun.createdCount, 0);
    assert.equal((await store.listReviewNotices()).length, 0);

    for (let index = 0; index < 4; index += 1) {
        const supporting = await store.createPendingNotice({
            sourceType: 'test_seed',
            sourceExternalId: `support-${index}`,
            title: `교과목 중복인정 근거 ${index + 1}`,
            content: '근거 본문',
            targets: ['25학번'],
            keywords: ['교과목 중복인정'],
            analysisConfidence: 0.9
        });
        await store.publishReviewNotice(supporting.id, {}, { notify: false });
    }
    const evaluationData = await store.getCategoryEvaluationData();
    const candidates = evaluateCategoryCandidates({
        ...evaluationData,
        now: new Date(),
        config: {
            windowDays: 60,
            minimumNotices: 5,
            minimumConfidence: 0.75
        }
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].normalizedKeyword, '교과목 중복인정');
    assert.equal(candidates[0].occurrenceCount, 5);
});
