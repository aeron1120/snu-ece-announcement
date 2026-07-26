import crypto from 'node:crypto';

function serviceError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function tokensMatch(token, expectedHash) {
    const actual = Buffer.from(hashToken(token));
    const expected = Buffer.from(String(expectedHash || ''));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeCategoryIds(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(Number)
            .filter(value => Number.isSafeInteger(value) && value > 0)
    ));
}

function normalizePreferences(preferences = {}) {
    const admissionYear = String(preferences.admissionYear || '').trim();
    const reminder = preferences.deadlineReminderDays;
    return {
        admissionYear: /^\d{2}학번$/.test(admissionYear) ? admissionYear : null,
        allNotices: Boolean(preferences.allNotices),
        categoryIds: normalizeCategoryIds(preferences.categoryIds),
        urgentEnabled: preferences.urgentEnabled !== false,
        deadlineReminderDays: [1, 3, 7].includes(Number(reminder))
            ? Number(reminder)
            : null
    };
}

function validateBrowserSubscription(subscription) {
    let endpoint;
    try {
        endpoint = new URL(String(subscription?.endpoint || ''));
    } catch {
        throw serviceError('INVALID_PUSH_SUBSCRIPTION', '유효하지 않은 푸시 구독 주소입니다.');
    }
    const p256dh = String(subscription?.keys?.p256dh || '').trim();
    const auth = String(subscription?.keys?.auth || '').trim();
    if (endpoint.protocol !== 'https:' || !p256dh || !auth) {
        throw serviceError('INVALID_PUSH_SUBSCRIPTION', '유효하지 않은 푸시 구독 정보입니다.');
    }
    return { endpoint: endpoint.toString(), p256dh, auth };
}

function publicSubscription(row) {
    const {
        managementTokenHash: _managementTokenHash,
        p256dh: _p256dh,
        auth: _auth,
        ...safe
    } = row;
    return safe;
}

export function matchesSubscription(notice, subscription) {
    if (subscription?.status && subscription.status !== 'active') return false;
    const noticeTargets = Array.isArray(notice?.targets) ? notice.targets : [];
    const audienceMatches = noticeTargets.includes('전체')
        || !subscription?.admissionYear
        || noticeTargets.includes(subscription.admissionYear);
    if (!audienceMatches) return false;
    if (subscription?.allNotices) return true;
    const noticeCategories = normalizeCategoryIds(notice?.categoryIds);
    const subscribedCategories = normalizeCategoryIds(subscription?.categoryIds);
    return noticeCategories.some(id => subscribedCategories.includes(id));
}

export function createPushService({ store, webPushClient, config, now = () => new Date() }) {
    if (!store || !webPushClient || !config) {
        throw new Error('Push service dependencies are required');
    }
    if (config.enabled) {
        webPushClient.setVapidDetails(
            config.subject,
            config.publicKey,
            config.privateKey
        );
    }

    async function authenticatedSubscription(id, managementToken) {
        const subscription = await store.getPushSubscription(id);
        if (!subscription || !tokensMatch(managementToken, subscription.managementTokenHash)) {
            throw serviceError(
                'INVALID_SUBSCRIPTION_TOKEN',
                '알림 구독 관리 토큰이 올바르지 않습니다.'
            );
        }
        return subscription;
    }

    return {
        publicKey: config.enabled ? config.publicKey : null,

        async createSubscription(browserSubscription, preferences = {}) {
            if (!config.enabled) {
                throw serviceError('PUSH_DISABLED', '웹 푸시가 설정되지 않았습니다.');
            }
            const keys = validateBrowserSubscription(browserSubscription);
            const managementToken = crypto.randomBytes(32).toString('base64url');
            const saved = await store.createPushSubscription({
                ...keys,
                ...normalizePreferences(preferences),
                managementTokenHash: hashToken(managementToken),
                status: 'active',
                createdAt: now().toISOString(),
                updatedAt: now().toISOString()
            });
            return {
                subscription: publicSubscription(saved),
                managementToken
            };
        },

        async updateSubscription(id, managementToken, preferences = {}) {
            await authenticatedSubscription(id, managementToken);
            const updated = await store.updatePushSubscription(
                id,
                normalizePreferences(preferences)
            );
            return publicSubscription(updated);
        },

        async deleteSubscription(id, managementToken) {
            await authenticatedSubscription(id, managementToken);
            await store.deletePushSubscription(id);
        }
    };
}
