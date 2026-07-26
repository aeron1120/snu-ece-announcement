import express from 'express';
import crypto from 'node:crypto';

function secretsMatch(actual, expected) {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(String(actual));
    const expectedBuffer = Buffer.from(String(expected));
    return actualBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function errorResponse(res, error) {
    if (error?.code === 'NOTICE_NOT_PENDING') {
        return res.status(409).json({ error: '이미 처리되었거나 존재하지 않는 검수 공지입니다.' });
    }
    console.error('[automation-api]', error);
    return res.status(500).json({ error: error?.message || '자동화 요청 처리에 실패했습니다.' });
}

export function createAutomationRouter({
    store,
    crawler,
    analyzer = null,
    requireAdmin,
    config
}) {
    if (!store || !crawler || !requireAdmin || !config) {
        throw new Error('Automation router dependencies are required');
    }

    const router = express.Router();

    async function runCrawl(req, res) {
        try {
            const result = crawler.crawl
                ? await crawler.crawl()
                : await crawler.run();
            res.json(result);
        } catch (error) {
            errorResponse(res, error);
        }
    }

    router.post('/api/internal/crawl/ece-academics', async (req, res) => {
        if (!config.crawl.enabled) {
            return res.status(503).json({ error: '크롤링 자동화가 설정되지 않았습니다.' });
        }
        if (!secretsMatch(
            req.get('x-crawl-secret'),
            config.crawl.triggerSecret || config.crawl.secret
        )) {
            return res.status(401).json({ error: '유효하지 않은 크롤링 인증 정보입니다.' });
        }
        return runCrawl(req, res);
    });

    router.post('/api/admin/crawl/ece-academics', requireAdmin, runCrawl);

    router.get('/api/admin/crawl-runs', requireAdmin, async (req, res) => {
        try {
            res.json({ runs: await store.listCrawlRuns() });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.get('/api/admin/review-notices', requireAdmin, async (req, res) => {
        try {
            res.json({ notices: await store.listReviewNotices() });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.get('/api/admin/review-notices/:id', requireAdmin, async (req, res) => {
        try {
            const notice = await store.getReviewNotice(req.params.id);
            if (!notice) return res.status(404).json({ error: '검수 공지를 찾을 수 없습니다.' });
            res.json({ notice });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/review-notices/:id/reanalyze', requireAdmin, async (req, res) => {
        if (!analyzer) {
            return res.status(503).json({ error: 'LLM 분석 설정이 없습니다.' });
        }
        try {
            const notice = await store.getReviewNotice(req.params.id);
            if (!notice) return res.status(404).json({ error: '검수 공지를 찾을 수 없습니다.' });
            const analysis = analyzer.analyze
                ? await analyzer.analyze({
                    title: notice.rawTitle || notice.title,
                    content: notice.rawContent || notice.content
                })
                : await analyzer.analyzeNotice({
                title: notice.rawTitle || notice.title,
                content: notice.rawContent || notice.content
            });
            const updated = await store.updateReviewAnalysis(notice.id, {
                aiSummary: analysis.summary,
                deadline: analysis.deadline,
                targets: analysis.targets,
                keywords: analysis.keywords,
                analysisStatus: 'completed',
                analysisConfidence: analysis.confidence
            });
            res.json({ notice: updated });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/review-notices/:id/publish', requireAdmin, async (req, res) => {
        try {
            const notice = await store.publishReviewNotice(
                req.params.id,
                req.body?.edits || {},
                { notify: req.body?.notify !== false }
            );
            res.json({ notice });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/review-notices/:id/reject', requireAdmin, async (req, res) => {
        try {
            const notice = await store.rejectReviewNotice(req.params.id, req.body?.reason);
            res.json({ notice });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    return router;
}
