import dotenv from 'dotenv';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createNoticeAnalyzer } from '../server/services/notice-analyzer.js';
import { CANONICAL_NOTICE_CATEGORIES } from '../server/config/notice-categories.js';

dotenv.config();

const sourcePath = path.resolve('server/data/automation.json');
const backupPath = path.resolve(
    `server/data/automation.before-ai-reclassify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
const requestIntervalMs = Math.max(8_500, Number(process.env.GEMINI_THROTTLE_MS) || 9_500);
let nextRequestAt = 0;

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function retrySecondsFromMessage(message) {
    const match = String(message || '').match(/retry in\s+([\d.]+)s/i);
    return match ? Math.ceil(Number(match[1])) : 60;
}

async function throttledFetch(url, options) {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
        const delay = Math.max(0, nextRequestAt - Date.now());
        if (delay > 0) await wait(delay);
        nextRequestAt = Date.now() + requestIntervalMs;
        const response = await fetch(url, options);
        if (response.status !== 429) return response;
        const body = await response.clone().json().catch(() => ({}));
        const retrySeconds = retrySecondsFromMessage(body?.error?.message);
        console.log(`RATE_LIMIT request ${retrySeconds}s`);
        await wait((retrySeconds + 1) * 1000);
    }
    return fetch(url, options);
}

async function writeDocument(document) {
    const temporaryPath = `${sourcePath}.reclassify.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(document, null, 2), 'utf8');
    await fs.rename(temporaryPath, sourcePath);
}

const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
if (!apiKey) throw new Error('GEMINI_API_KEY가 필요합니다.');

const original = await fs.readFile(sourcePath, 'utf8');
const document = JSON.parse(original);
await fs.writeFile(backupPath, original, 'utf8');

const canonicalSlugs = new Set(CANONICAL_NOTICE_CATEGORIES.map(category => category.slug));
const categories = Array.isArray(document.categories)
    ? document.categories.filter(category =>
        category.isActive !== false && canonicalSlugs.has(category.slug)
    )
    : CANONICAL_NOTICE_CATEGORIES.map((category, index) => ({ id: index + 1, ...category }));
const analyzer = createNoticeAnalyzer({
    apiKey,
    model: process.env.GEMINI_RECLASSIFY_MODEL || 'gemini-3.1-flash-lite',
    fetchImpl: throttledFetch,
    categoryProvider: async () => categories
});
const notices = (document.notices || []).filter(notice =>
    notice.status === 'published'
    && !notice.isDeleted
    && !notice.analysisVerification?.checkedAt
);

console.log(`BACKUP ${path.basename(backupPath)}`);
console.log(`START ${notices.length}`);

for (let index = 0; index < notices.length; index += 1) {
    const notice = notices[index];
    let analysis = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            analysis = await analyzer.analyzeNotice({
                title: notice.rawTitle || notice.title,
                content: notice.rawContent || notice.content
            });
            break;
        } catch (error) {
            lastError = error;
            const errorMessage = [
                error?.message,
                error?.cause?.message,
                error?.cause?.cause?.message
            ].filter(Boolean).join(' <- ');
            const isRateLimit = /quota|rate limit|resource_exhausted|429/i.test(errorMessage);
            const retrySeconds = isRateLimit ? retrySecondsFromMessage(errorMessage) : 3;
            console.log(`RETRY ${index + 1}/${notices.length} ${notice.id} ${retrySeconds}s ${errorMessage.slice(0, 280)}`);
            await wait((retrySeconds + 1) * 1000);
        }
    }
    if (!analysis) {
        console.log(`FAILED ${index + 1}/${notices.length} ${notice.id} ${lastError?.message || 'unknown'}`);
        continue;
    }

    const categoryIds = Array.from(new Set(analysis.existingCategoryIds || []))
        .map(Number)
        .filter(categoryId => categories.some(category => Number(category.id) === categoryId));
    document.noticeCategories = (document.noticeCategories || []).filter(item =>
        Number(item.noticeId) !== Number(notice.id)
    );
    const now = new Date().toISOString();
    for (const categoryId of categoryIds) {
        document.noticeCategories.push({
            noticeId: notice.id,
            categoryId,
            createdAt: now
        });
    }
    notice.categoryIds = categoryIds;
    notice.category = categories.find(category =>
        Number(category.id) === Number(categoryIds[0])
    )?.key || null;
    notice.hasReward = analysis.hasReward === true;
    notice.rewardNote = analysis.rewardNote || null;
    notice.requiresAction = analysis.requiresAction === true;
    notice.analysisStatus = 'succeeded';
    notice.analysisConfidence = analysis.confidence;
    notice.analysisVerification = {
        verifiedNumbers: analysis.verifiedNumbers || [],
        warnings: analysis.verificationWarnings || [],
        checkedAt: now
    };
    notice.surveyReward = analysis.rewardNote || analysis.surveyReward || '';
    notice.updatedAt = now;
    await writeDocument(document);
    const labels = categoryIds
        .map(id => categories.find(category => Number(category.id) === id)?.name)
        .filter(Boolean)
        .join(',') || '분류 없음';
    console.log(`DONE ${index + 1}/${notices.length} ${notice.id} ${labels}`);
}

console.log('COMPLETE');
