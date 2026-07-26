const STOPWORDS = new Set([
    '안내',
    '공지',
    '신청',
    '모집',
    '관련',
    '알림',
    '필독',
    '확인'
]);

export function normalizeKeyword(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('ko-KR')
        .replace(/\s+/g, ' ');
}

function categoryTerms(categories) {
    const terms = new Set();
    for (const category of categories || []) {
        terms.add(normalizeKeyword(category.name));
        for (const alias of category.aliases || []) {
            terms.add(normalizeKeyword(
                typeof alias === 'string' ? alias : alias.alias
            ));
        }
    }
    terms.delete('');
    return terms;
}

export function evaluateCategoryCandidates({
    notices,
    categories,
    candidates,
    now = new Date(),
    config
}) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const cutoff = new Date(
        nowDate.getTime() - Number(config.windowDays) * 86_400_000
    );
    const existingTerms = categoryTerms(categories);
    const candidateByKeyword = new Map(
        (candidates || []).map(candidate => [
            normalizeKeyword(candidate.normalizedKeyword),
            candidate
        ])
    );
    const grouped = new Map();

    for (const notice of notices || []) {
        if (notice.status !== 'published') continue;
        const publishedAt = new Date(notice.publishedAt || notice.createdAt);
        if (Number.isNaN(publishedAt.getTime())
            || publishedAt < cutoff
            || publishedAt > nowDate) continue;
        const confidence = Number(notice.analysisConfidence);
        if (!Number.isFinite(confidence)) continue;
        for (const displayValue of new Set(notice.keywords || [])) {
            const keyword = normalizeKeyword(displayValue);
            if (!keyword
                || STOPWORDS.has(keyword)
                || existingTerms.has(keyword)) continue;
            const existingCandidate = candidateByKeyword.get(keyword);
            if (existingCandidate?.status === 'rejected'
                || existingCandidate?.status === 'approved'
                || existingCandidate?.status === 'merged') continue;
            if (existingCandidate?.status === 'deferred'
                && existingCandidate.deferredUntil
                && new Date(existingCandidate.deferredUntil) > nowDate) continue;
            if (!grouped.has(keyword)) {
                grouped.set(keyword, {
                    displayName: String(displayValue).trim(),
                    notices: new Map()
                });
            }
            grouped.get(keyword).notices.set(String(notice.id), {
                id: Number(notice.id),
                confidence,
                publishedAt
            });
        }
    }

    const results = [];
    for (const [normalizedKeyword, group] of grouped) {
        const supporting = Array.from(group.notices.values());
        const averageConfidence = supporting.reduce(
            (sum, item) => sum + item.confidence,
            0
        ) / supporting.length;
        if (supporting.length < Number(config.minimumNotices)
            || averageConfidence < Number(config.minimumConfidence)) continue;
        supporting.sort((a, b) => a.id - b.id);
        const dates = supporting.map(item => item.publishedAt.getTime());
        const existing = candidateByKeyword.get(normalizedKeyword);
        results.push({
            ...(existing?.id ? { id: existing.id } : {}),
            normalizedKeyword,
            displayName: existing?.displayName || group.displayName,
            status: 'pending',
            occurrenceCount: supporting.length,
            averageConfidence: Number(averageConfidence.toFixed(4)),
            firstSeenAt: new Date(Math.min(...dates)).toISOString(),
            lastSeenAt: new Date(Math.max(...dates)).toISOString(),
            supportingNoticeIds: supporting.map(item => item.id)
        });
    }

    return results.sort((a, b) =>
        b.occurrenceCount - a.occurrenceCount
        || b.averageConfidence - a.averageConfidence
        || a.displayName.localeCompare(b.displayName, 'ko')
    );
}
