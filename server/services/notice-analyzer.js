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
    )).slice(0, 1);
    const rawConfidence = Number(value.confidence);
    if (!Number.isFinite(rawConfidence)) {
        throw new NoticeAnalysisError('confidence must be numeric');
    }

    return {
        editedTitle: String(value.editedTitle || '').trim().slice(0, 300),
        editedContent: String(value.editedContent || '').trim().slice(0, 30000),
        summary,
        deadline: normalizeDeadline(value.deadline),
        targets: targets.length > 0 ? targets : ['전체'],
        keywords,
        existingCategoryIds,
        rewardNote: String(value.rewardNote || value.surveyReward || '').trim().slice(0, 120) || null,
        hasReward: value.hasReward === true || Boolean(String(value.rewardNote || value.surveyReward || '').trim()),
        requiresAction: value.requiresAction === true,
        surveyReward: String(value.rewardNote || value.surveyReward || '').trim().slice(0, 120),
        verifiedNumbers: uniqueStrings(value.verifiedNumbers, { limit: 12, maxLength: 120 }),
        verificationWarnings: uniqueStrings(value.verificationWarnings, { limit: 8, maxLength: 200 }),
        confidence: Math.min(1, Math.max(0, rawConfidence)),
        analysisStatus: 'succeeded'
    };
}

function buildVerificationPrompt({ title, content, categories, draft, correction }) {
    const categoryList = categories.length > 0
        ? categories.map(category =>
            `${category.id}: ${category.name} — ${category.definition || '이름의 의미를 엄격하게 적용'}`
        ).join('\n')
        : '없음';
    const correctionText = correction
        ? '이전 응답이 스키마를 만족하지 못했습니다. 설명 없이 올바른 JSON만 다시 출력하세요.\n\n'
        : '';
    return `${correctionText}당신은 공지 분석 결과를 독립적으로 재검수하는 두 번째 에이전트입니다.
원문을 처음부터 다시 읽고 1차 결과의 날짜·시각·금액·인원·학점·기간·비율·연락처와 카테고리를 대조하세요.
1차 결과는 틀릴 수 있으므로 그대로 승인하지 말고, 잘못된 항목을 고친 최종 JSON 하나만 출력하세요.

형식:
{
  "editedTitle": "원문의 의미를 유지한 제목",
  "editedContent": "원문의 수치·URL·조건을 보존한 읽기 쉬운 본문",
  "summary": ["검증된 요약 1", "검증된 요약 2", "검증된 요약 3"],
  "deadline": "YYYY-MM-DD 또는 null",
  "targets": ["전체 또는 NN학번"],
  "keywords": ["최대 10개"],
  "existingCategoryIds": [검증된 기존 카테고리 ID],
  "hasReward": true 또는 false,
  "rewardNote": "상품·지원금·할인 등 짧은 표기 또는 null",
  "requiresAction": true 또는 false,
  "verifiedNumbers": ["원문과 대조한 주요 수치"],
  "verificationWarnings": ["관리자 확인이 필요한 불명확한 점"],
  "confidence": 0과 1 사이 숫자
}

검수 원칙:
- 원문에 없는 사실·수치·조건은 모두 제거합니다.
- deadline은 실제 신청 또는 제출 마감이 명확할 때만 지정합니다.
- 카테고리는 반드시 학사, 기회, 혜택, 행사 중 가장 핵심적인 하나만 선택합니다.
- requiresAction은 신청·제출·응답이 필요할 때만 true입니다.
- hasReward는 기프티콘·상품·간식·지원금·할인 등 즉시 확인 가능한 보상이 있을 때만 true입니다.

활성 카테고리:
${categoryList}

원문 제목:
${String(title || '').slice(0, 500)}

원문 본문:
${String(content || '').slice(0, 30000)}

1차 분석:
${JSON.stringify(draft)}`.trim();
}

/* 어느 규칙이 깨졌는지까지 남긴다. "스키마를 만족하지 못했다"만으로는
   운영자가 손쓸 수 없고, 크롤러 로그에도 단서가 남지 않는다. */
function describeCause(error) {
    const message = String(error?.message || '').trim();
    return message || 'reason unknown';
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
        ? categories.map(category =>
            `${category.id}: ${category.name} — ${category.definition || '이름의 의미를 엄격하게 적용'}`
        ).join('\n')
        : '없음';
    const correctionText = correction
        ? '\n이전 응답이 스키마를 만족하지 못했습니다. 설명 없이 올바른 JSON만 다시 출력하세요.\n'
        : '';

    return `${correctionText}
서울대학교 전기정보공학부 공지를 분석하세요.
반드시 다음 JSON 형태만 출력하세요.
{
  "editedTitle": "중복·깨진 문자를 정리한 읽기 쉬운 제목",
  "editedContent": "원문의 사실과 링크를 보존하고 문단·목록만 읽기 쉽게 정돈한 본문",
  "summary": ["핵심 요약 1", "핵심 요약 2", "핵심 요약 3"],
  "deadline": "YYYY-MM-DD 또는 null",
  "targets": ["전체 또는 NN학번"],
  "keywords": ["최대 10개"],
  "existingCategoryIds": [기존 카테고리 ID],
  "hasReward": true 또는 false,
  "rewardNote": "상품·지원금·할인 등 짧은 표기 또는 null",
  "requiresAction": true 또는 false,
  "confidence": 0과 1 사이 숫자
}

카테고리 분류 원칙:
- 학사: 수강·학점·졸업·성적·전공진입에 직접 영향을 줍니다.
- 기회: 인턴·연구실·모집·공모전·대회·장학·교환 등 참여 기회입니다.
- 혜택: 할인·지원·물품·제휴처럼 놓쳐도 학사상 불이익이 없는 경제적 혜택입니다.
- 행사: 학생 자치, 학내 행사, 시설·출입·교통 등 공동체와 캠퍼스 생활 정보입니다.
- 네 카테고리 중 가장 핵심적인 하나만 선택합니다.
- requiresAction은 신청·제출·응답이 필요할 때 true입니다.
- hasReward는 상품·기프티콘·사례비·지원금·할인 등이 확인될 때 true이며 rewardNote에 짧게 적습니다.
- 제목의 단어만 보지 말고 본문의 행동 요구, 마감, 실제 영향과 수신 대상을 근거로 판단합니다.

편집 원칙:
- editedTitle은 의미를 바꾸거나 정보를 새로 만들지 말고, 깨진 문자·불필요한 반복만 정리합니다.
- editedContent는 날짜·금액·연락처·URL·신청 조건을 임의로 바꾸지 않습니다.
- 긴 덩어리는 빈 줄과 짧은 문단으로 나누고, 나열은 줄바꿈으로 정돈합니다.
- 원문에 없는 사실을 추정하거나 홍보 문구를 덧붙이지 않습니다.

활성 카테고리:
${categoryList}

제목:
${String(title || '').slice(0, 500)}

본문:
${String(content || '').slice(0, 30000)}`.trim();
}

export function createNoticeAnalyzer({
    apiKey,
    model = 'gemini-flash-latest',
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
                    key: String(category.key || ''),
                    name: String(category.name || ''),
                    definition: String(category.definition || '')
                }))
                .filter(category => Number.isFinite(category.id) && category.name);
            const activeCategoryIds = new Set(categories.map(category => category.id));
            let lastError;
            let draft = null;

            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    const prompt = buildPrompt({
                        title,
                        content,
                        categories,
                        correction: attempt > 0
                    });
                    draft = validateNoticeAnalysis(
                        parseModelJson(await generate(prompt)),
                        activeCategoryIds
                    );
                    break;
                } catch (error) {
                    lastError = error;
                }
            }

            if (!draft) {
                throw new NoticeAnalysisError(
                    `Gemini analysis did not satisfy the required schema: ${describeCause(lastError)}`,
                    { cause: lastError }
                );
            }

            // 검수도 분석과 같은 횟수만큼 기회를 준다. 모델 출력은 확률적이라
            // 한 번의 흔들림으로 분석 전체를 버리면 실패율이 그대로 드러난다.
            let verificationError;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    const verificationPrompt = buildVerificationPrompt({
                        title,
                        content,
                        categories,
                        draft,
                        correction: attempt > 0
                    });
                    const verified = validateNoticeAnalysis(
                        parseModelJson(await generate(verificationPrompt)),
                        activeCategoryIds
                    );
                    return {
                        ...verified,
                        category: categories.find(item =>
                            Number(item.id) === Number(verified.existingCategoryIds[0])
                        )?.key || null
                    };
                } catch (error) {
                    verificationError = error;
                }
            }

            throw new NoticeAnalysisError(
                `Gemini verification did not satisfy the required schema: ${describeCause(verificationError)}`,
                { cause: verificationError }
            );
        }
    };
}
