const KAKAO_NOTICE_CATEGORY_PRIORITY = Object.freeze([
    ['application', '신청'],
    ['academics', '학사']
]);

function cleanBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

export function buildNoticePermalink(publicBaseUrl, noticeId) {
    const baseUrl = cleanBaseUrl(publicBaseUrl);
    if (!baseUrl) return `/?id=${encodeURIComponent(noticeId)}`;
    const url = new URL(baseUrl);
    url.searchParams.set('id', String(noticeId));
    return url.toString();
}

export function getKakaoNoticeCategory(categorySlugs = []) {
    const slugSet = new Set(categorySlugs.map(value => String(value || '').trim()));
    return KAKAO_NOTICE_CATEGORY_PRIORITY.find(([slug]) => slugSet.has(slug)) || null;
}

function deadlineDateKey(notice) {
    return String(notice?.deadlineAt || notice?.deadline || '').slice(0, 10);
}

function calculateDDay(dateKey, now = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const [year, month, day] = dateKey.split('-').map(Number);
    const targetUtc = Date.UTC(year, month - 1, day);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const todayUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
    return Math.round((targetUtc - todayUtc) / 86_400_000);
}

function formatDeadline(notice, now) {
    if (notice?.isAlwaysOpen) return { date: '상시', dDay: null, text: '상시' };
    const date = deadlineDateKey(notice);
    if (!date) return { date: '미정', dDay: null, text: '마감 미정' };
    const dDay = calculateDDay(date, now);
    const dDayText = dDay === 0 ? 'D-Day' : (dDay > 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`);
    return {
        date,
        dDay,
        text: `마감 ${date.replaceAll('-', '.')} (${dDayText})`
    };
}

export function buildKakaoNoticeEvent({
    notice,
    categorySlugs,
    publicBaseUrl,
    now = new Date()
}) {
    const category = getKakaoNoticeCategory(categorySlugs);
    if (!category) return null;
    const [categorySlug, categoryLabel] = category;
    const permalink = buildNoticePermalink(publicBaseUrl, notice.id);
    const deadline = formatDeadline(notice, now);
    const title = String(notice.title || '').replace(/\s+/g, ' ').trim();
    return {
        event: 'notice.published',
        message: `[${categoryLabel}] ${title} · ${deadline.text} · ${permalink}`,
        notice: {
            id: notice.id,
            title,
            deadline: deadline.date,
            dDay: deadline.dDay,
            category: categorySlug,
            categoryLabel,
            permalink
        }
    };
}

export function createKakaoBotWebhookService({
    webhookUrl,
    publicBaseUrl,
    categoryProvider,
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000
}) {
    const endpoint = String(webhookUrl || '').trim();
    const siteUrl = cleanBaseUrl(publicBaseUrl);
    const enabled = Boolean(endpoint && siteUrl && typeof fetchImpl === 'function');

    async function notifyPublishedNotice(notice) {
        if (!enabled) return { sent: false, reason: 'disabled' };
        const categories = await categoryProvider();
        const categorySlugById = new Map(categories.map(category => [
            Number(category.id),
            category.slug
        ]));
        const categorySlugs = (notice.categoryIds || [])
            .map(id => categorySlugById.get(Number(id)))
            .filter(Boolean);
        const payload = buildKakaoNoticeEvent({
            notice,
            categorySlugs,
            publicBaseUrl: siteUrl
        });
        if (!payload) return { sent: false, reason: 'category_not_eligible' };

        try {
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (!response.ok) {
                return { sent: false, reason: 'webhook_error', status: response.status };
            }
            return { sent: true, payload };
        } catch (error) {
            return {
                sent: false,
                reason: 'webhook_error',
                error: error?.message || String(error)
            };
        }
    }

    return { enabled, notifyPublishedNotice };
}
