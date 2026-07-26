export function getAutomationConfig(env = process.env) {
    const crawlSecret = String(env.CRAWL_TRIGGER_SECRET || '');
    const vapidPublicKey = String(env.VAPID_PUBLIC_KEY || '');
    const vapidPrivateKey = String(env.VAPID_PRIVATE_KEY || '');
    const vapidSubject = String(env.VAPID_SUBJECT || '');

    return Object.freeze({
        crawl: Object.freeze({
            enabled: crawlSecret.length >= 32,
            secret: crawlSecret,
            baseUrl: 'https://ece.snu.ac.kr/community/academics',
            pages: 3,
            maxDetails: 20,
            requestDelayMs: 1000,
            timeoutMs: 10000
        }),
        push: Object.freeze({
            enabled: Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject),
            publicKey: vapidPublicKey,
            privateKey: vapidPrivateKey,
            subject: vapidSubject
        }),
        categories: Object.freeze({
            windowDays: 60,
            minimumNotices: 5,
            minimumConfidence: 0.75
        })
    });
}
