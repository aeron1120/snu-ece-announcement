import express from 'express';
import crypto from 'node:crypto';
import { evaluateCategoryCandidates } from '../services/category-recommender.js';

function secretsMatch(actual, expected) {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(String(actual));
    const expectedBuffer = Buffer.from(String(expected));
    return actualBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function errorResponse(res, error) {
    if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
    }
    if (error?.code === 'NOTICE_NOT_PENDING') {
        return res.status(409).json({ error: '이미 처리되었거나 존재하지 않는 검수 공지입니다.' });
    }
    if (error?.code === 'INVALID_PUSH_SUBSCRIPTION') {
        return res.status(400).json({ error: error.message });
    }
    if (error?.code === 'INVALID_SUBSCRIPTION_TOKEN') {
        return res.status(401).json({ error: error.message });
    }
    if (error?.code === 'PUSH_DISABLED') {
        return res.status(503).json({ error: error.message });
    }
    if (error?.code === 'CATEGORY_CANDIDATE_NOT_PENDING') {
        return res.status(409).json({ error: '이미 처리되었거나 존재하지 않는 카테고리 후보입니다.' });
    }
    if (error?.code === 'CRAWL_ALREADY_RUNNING') {
        return res.status(409).json({ error: '같은 공지 수집 작업이 이미 실행 중입니다.' });
    }
    console.error('[automation-api]', error);
    return res.status(500).json({ error: error?.message || '자동화 요청 처리에 실패했습니다.' });
}

export function createAutomationRouter({
    store,
    crawler,
    analyzer = null,
    pushService = null,
    prepareNoticePublication = null,
    onNoticePublished = null,
    requireAdmin,
    config,
    frontendOrigin = ''
}) {
    if (!store || !crawler || !requireAdmin || !config) {
        throw new Error('Automation router dependencies are required');
    }

    const router = express.Router();
    const subscriptionRateLimits = new Map();

    function validateSubscriptionMutation(req, res, { rateLimit = false } = {}) {
        if (!req.is('application/json')) {
            res.status(415).json({ error: 'Content-Type은 application/json이어야 합니다.' });
            return false;
        }
        const origin = req.get('origin');
        if (frontendOrigin && origin && origin !== frontendOrigin) {
            res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
            return false;
        }
        if (rateLimit) {
            const now = Date.now();
            const key = req.ip || 'unknown';
            const recent = (subscriptionRateLimits.get(key) || [])
                .filter(timestamp => now - timestamp < 10 * 60 * 1000);
            if (recent.length >= 5) {
                res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });
                return false;
            }
            recent.push(now);
            subscriptionRateLimits.set(key, recent);
        }
        return true;
    }

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

    async function refreshCategoryCandidates() {
        const data = await store.getCategoryEvaluationData();
        const recommendations = evaluateCategoryCandidates({
            ...data,
            now: new Date(),
            config: config.categories
        });
        await store.upsertCategoryCandidates(recommendations);
        return store.listCategoryCandidates();
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

    router.post('/api/admin/notification-jobs/process', requireAdmin, async (req, res) => {
        if (!pushService) {
            return res.status(503).json({ error: '웹 푸시가 설정되지 않았습니다.' });
        }
        try {
            res.json(await pushService.processPendingJobs());
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.get('/api/push/public-key', (req, res) => {
        if (!pushService?.publicKey) {
            return res.status(503).json({ error: '웹 푸시가 설정되지 않았습니다.' });
        }
        res.json({ publicKey: pushService.publicKey });
    });

    router.get('/api/categories', async (req, res) => {
        try {
            res.json({ categories: await store.listCategories() });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.get('/api/admin/category-candidates', requireAdmin, async (req, res) => {
        try {
            res.json({ candidates: await refreshCategoryCandidates() });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/category-candidates/:id/approve', requireAdmin, async (req, res) => {
        res.status(409).json({
            error: '공지 주제는 학사·기회·혜택·자치·행사 네 범주로 고정되어 있습니다. 기존 범주에 병합해주세요.'
        });
    });

    router.post('/api/admin/category-candidates/:id/merge', requireAdmin, async (req, res) => {
        const categoryId = Number(req.body?.categoryId);
        if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
            return res.status(400).json({ error: '병합할 카테고리를 선택해주세요.' });
        }
        try {
            const candidate = await store.decideCategoryCandidate(req.params.id, {
                action: 'merge',
                categoryId
            });
            res.json({ candidate });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/category-candidates/:id/reject', requireAdmin, async (req, res) => {
        try {
            const candidate = await store.decideCategoryCandidate(req.params.id, {
                action: 'reject'
            });
            res.json({ candidate });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/category-candidates/:id/defer', requireAdmin, async (req, res) => {
        try {
            const candidate = await store.decideCategoryCandidate(req.params.id, {
                action: 'defer',
                deferredUntil: new Date(Date.now() + 30 * 86_400_000).toISOString()
            });
            res.json({ candidate });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/push/subscriptions', async (req, res) => {
        if (!pushService) return res.status(503).json({ error: '웹 푸시가 설정되지 않았습니다.' });
        if (!validateSubscriptionMutation(req, res, { rateLimit: true })) return;
        try {
            const created = await pushService.createSubscription(
                req.body?.subscription,
                req.body?.preferences
            );
            res.status(201).json(created);
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.put('/api/push/subscriptions/:id', async (req, res) => {
        if (!pushService) return res.status(503).json({ error: '웹 푸시가 설정되지 않았습니다.' });
        if (!validateSubscriptionMutation(req, res)) return;
        try {
            const subscription = await pushService.updateSubscription(
                req.params.id,
                req.get('x-subscription-token'),
                req.body?.preferences
            );
            res.json({ subscription });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.delete('/api/push/subscriptions/:id', async (req, res) => {
        if (!pushService) return res.status(503).json({ error: '웹 푸시가 설정되지 않았습니다.' });
        if (!validateSubscriptionMutation(req, res)) return;
        try {
            await pushService.deleteSubscription(
                req.params.id,
                req.get('x-subscription-token')
            );
            res.status(204).send();
        } catch (error) {
            errorResponse(res, error);
        }
    });

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
                title: analysis.editedTitle || notice.title,
                content: analysis.editedContent || notice.content,
                aiSummary: analysis.summary,
                targets: analysis.targets,
                keywords: analysis.keywords,
                categoryIds: analysis.existingCategoryIds,
                surveyReward: analysis.surveyReward,
                category: analysis.category || null,
                hasReward: analysis.hasReward === true,
                rewardNote: analysis.rewardNote || null,
                requiresAction: analysis.requiresAction === true,
                analysisStatus: 'succeeded',
                analysisConfidence: analysis.confidence
            });
            res.json({ notice: updated, deadlineCandidate: analysis.deadline });
        } catch (error) {
            errorResponse(res, error);
        }
    });

    router.post('/api/admin/review-notices/:id/publish', requireAdmin, async (req, res) => {
        try {
            const pendingNotice = await store.getReviewNotice(req.params.id);
            if (!pendingNotice) {
                return res.status(404).json({ error: '검수 공지를 찾을 수 없습니다.' });
            }
            const requestedEdits = req.body?.edits || {};
            const preparedEdits = prepareNoticePublication
                ? await prepareNoticePublication(pendingNotice, requestedEdits)
                : requestedEdits;
            const notice = await store.publishReviewNotice(
                req.params.id,
                preparedEdits,
                { notify: req.body?.notify !== false }
            );
            if (onNoticePublished) {
                await onNoticePublished({
                    ...notice,
                    categoryIds: Array.isArray(preparedEdits.categoryIds)
                        ? preparedEdits.categoryIds
                        : (notice.categoryIds || [])
                });
            }
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
