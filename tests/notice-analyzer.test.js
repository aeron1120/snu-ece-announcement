import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NoticeAnalysisError,
    createNoticeAnalyzer,
    validateNoticeAnalysis
} from '../server/services/notice-analyzer.js';

test('validateNoticeAnalysis normalizes and constrains model output', () => {
    const analysis = validateNoticeAnalysis({
        summary: [' a ', 'b', 'c', 'd'],
        deadline: '2026-08-10',
        targets: ['25학번', '임의대상', '25학번'],
        keywords: [' 복수전공 ', '복수전공', ...Array.from({ length: 12 }, (_, i) => `키워드${i}`)],
        existingCategoryIds: [1, 999, 1],
        confidence: 1.3
    }, new Set([1, 2]));

    assert.deepEqual(analysis.summary, ['a', 'b', 'c']);
    assert.deepEqual(analysis.targets, ['25학번']);
    assert.equal(analysis.keywords.length, 10);
    assert.equal(analysis.keywords[0], '복수전공');
    assert.deepEqual(analysis.existingCategoryIds, [1]);
    assert.equal(analysis.confidence, 1);
    assert.equal(analysis.analysisStatus, 'succeeded');
});

test('validateNoticeAnalysis rejects missing summaries and invalid deadlines', () => {
    assert.throws(
        () => validateNoticeAnalysis({
            summary: [],
            deadline: 'next week',
            targets: ['전체'],
            keywords: [],
            existingCategoryIds: [],
            confidence: 0.5
        }, new Set()),
        NoticeAnalysisError
    );
});

test('analyzer retries one schema-invalid response and returns corrected JSON', async () => {
    let calls = 0;
    const requests = [];
    const fetchImpl = async (url, options) => {
        calls += 1;
        requests.push({ url: String(url), body: JSON.parse(options.body) });
        const text = calls === 1
            ? '{"summary":[]}'
            : '```json\n{"summary":["핵심"],"deadline":null,"targets":["전체"],"keywords":["수강신청"],"existingCategoryIds":[2],"confidence":0.8}\n```';
        return {
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text }] } }]
            })
        };
    };
    const analyzer = createNoticeAnalyzer({
        apiKey: 'test-key',
        model: 'gemini-test-model',
        fetchImpl,
        categoryProvider: async () => [{ id: 2, name: '수강신청' }]
    });

    const result = await analyzer.analyzeNotice({
        title: '수강신청 안내',
        content: '본문'
    });

    assert.equal(calls, 2);
    assert.deepEqual(result.summary, ['핵심']);
    assert.deepEqual(result.existingCategoryIds, [2]);
    assert.match(requests[0].url, /gemini-test-model:generateContent/);
    assert.match(requests[0].body.contents[0].parts[0].text, /신청: 사용자가 링크·폼·메일/);
    assert.match(requests[0].body.contents[0].parts[0].text, /가능한 한 가장 핵심적인 한 범주만 선택/);
    assert.match(
        requests[1].body.contents[0].parts[0].text,
        /이전 응답이 스키마를 만족하지 못했습니다/
    );
});

test('analyzer fails after two invalid model responses', async () => {
    const analyzer = createNoticeAnalyzer({
        apiKey: 'test-key',
        model: 'gemini-test-model',
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: 'not json' }] } }]
            })
        }),
        categoryProvider: async () => []
    });

    await assert.rejects(
        () => analyzer.analyzeNotice({ title: '제목', content: '본문' }),
        NoticeAnalysisError
    );
});
