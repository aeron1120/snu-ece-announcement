export class NoticeAnalysisError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'NoticeAnalysisError';
    }
}

function uniqueStrings(values, { limit, maxLength = 200 } = {}) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const result = [];
    for (const rawValue of values) {
        const value = String(rawValue || '').trim().slice(0, maxLength);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
        if (result.length >= limit) break;
    }
    return result;
}

function isAllowedTarget(value) {
    return value === '전체' || /^\d{2}학번(?: 이상)?$/.test(value);
}

function normalizeDeadline(value) {
    if (value == null || value === '') return null;
    const deadline = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
        throw new NoticeAnalysisError('deadline must be an ISO date or null');
    }
    const date = new Date(`${deadline}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== deadline) {
        throw new NoticeAnalysisError('deadline is not a valid date');
    }
    return deadline;
}

export function validateNoticeAnalysis(value, activeCategoryIds = new Set()) {
    if (!value || typeof value !== 'object') {
        throw new NoticeAnalysisError('analysis must be an object');
    }

    const summary = uniqueStrings(value.summary, { limit: 3, maxLength: 300 });
    if (summary.length === 0) {
        throw new NoticeAnalysisError('analysis summary is required');
    }

    const targets = uniqueStrings(value.targets, { limit: 20, maxLength: 20 })
        .filter(isAllowedTarget);
    const keywords = uniqueStrings(value.keywords, { limit: 10, maxLength: 40 });
    const existingCategoryIds = Array.from(new Set(
        (Array.isArray(value.existingCategoryIds) ? value.existingCategoryIds : [])
            .map(Number)
            .filter(id => Number.isFinite(id) && activeCategoryIds.has(id))
    ));
    const rawConfidence = Number(value.confidence);
    if (!Number.isFinite(rawConfidence)) {
        throw new NoticeAnalysisError('confidence must be numeric');
    }

    return {
        summary,
        deadline: normalizeDeadline(value.deadline),
        targets: targets.length > 0 ? targets : ['전체'],
        keywords,
        existingCategoryIds,
        confidence: Math.min(1, Math.max(0, rawConfidence)),
        analysisStatus: 'succeeded'
    };
}

function parseModelJson(text) {
    const normalized = String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    try {
        return JSON.parse(normalized);
    } catch (error) {
        throw new NoticeAnalysisError('model response is not valid JSON', { cause: error });
    }
}

function buildPrompt({ title, content, categories, correction }) {
    const categoryList = categories.length > 0
        ? categories.map(category => `${category.id}: ${category.name}`).join('\n')
        : '없음';
    const correctionText = correction
        ? '\n이전 응답이 스키마를 만족하지 못했습니다. 설명 없이 올바른 JSON만 다시 출력하세요.\n'
        : '';

    return `${correctionText}
서울대학교 전기정보공학부 공지를 분석하세요.
반드시 다음 JSON 형태만 출력하세요.
{
  "summary": ["핵심 요약 1", "핵심 요약 2", "핵심 요약 3"],
  "deadline": "YYYY-MM-DD 또는 null",
  "targets": ["전체 또는 NN학번"],
  "keywords": ["최대 10개"],
  "existingCategoryIds": [기존 카테고리 ID],
  "confidence": 0과 1 사이 숫자
}

활성 카테고리:
${categoryList}

제목:
${String(title || '').slice(0, 500)}

본문:
${String(content || '').slice(0, 30000)}`.trim();
}

export function createNoticeAnalyzer({
    apiKey,
    model = 'gemini-2.5-flash',
    fetchImpl = fetch,
    categoryProvider = async () => []
}) {
    if (!apiKey) throw new Error('Gemini API key is required');

    async function generate(prompt) {
        const response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: 'application/json' }
                })
            }
        );
        const data = await response.json();
        if (!response.ok) {
            throw new NoticeAnalysisError(
                data?.error?.message || `Gemini request failed (${response.status})`
            );
        }
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    return {
        async analyzeNotice({ title, content }) {
            const categories = (await categoryProvider())
                .filter(category => category?.isActive !== false)
                .map(category => ({
                    id: Number(category.id),
                    name: String(category.name || '')
                }))
                .filter(category => Number.isFinite(category.id) && category.name);
            const activeCategoryIds = new Set(categories.map(category => category.id));
            let lastError;

            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    const prompt = buildPrompt({
                        title,
                        content,
                        categories,
                        correction: attempt > 0
                    });
                    return validateNoticeAnalysis(
                        parseModelJson(await generate(prompt)),
                        activeCategoryIds
                    );
                } catch (error) {
                    lastError = error;
                }
            }

            throw new NoticeAnalysisError(
                'Gemini analysis did not satisfy the required schema',
                { cause: lastError }
            );
        }
    };
}
