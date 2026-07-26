import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAutomationStore } from '../server/storage/automation-store.js';
import {
    createPushService,
    matchesSubscription
} from '../server/services/push-service.js';

function browserSubscription(suffix = '') {
    return {
        endpoint: `https://push.example.test/subscription/${suffix || 'one'}`,
        keys: {
            p256dh: `public-key-${suffix || 'one'}`,
            auth: `auth-key-${suffix || 'one'}`
        }
    };
}

async function fixture() {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-push-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    const vapidCalls = [];
    const webPushClient = {
        setVapidDetails(...args) {
            vapidCalls.push(args);
        }
    };
    const service = createPushService({
        store,
        webPushClient,
        config: {
            enabled: true,
            subject: 'mailto:ece@example.com',
            publicKey: 'public',
            privateKey: 'private'
        }
    });
    return { store, service, vapidCalls };
}

async function publishedNotice(store, externalId = 'push-notice') {
    const pending = await store.createPendingNotice({
        sourceType: 'ece_academics',
        sourceExternalId: externalId,
        title: '수강신청 안내',
        content: '공지 본문',
        targets: ['25학번'],
        categoryIds: [2]
    });
    return store.publishReviewNotice(pending.id, {}, { notify: true });
}

test('matches whole-audience or matching year and category preferences', () => {
    assert.equal(matchesSubscription(
        { targets: ['25학번'], categoryIds: [2] },
        { admissionYear: '25학번', allNotices: false, categoryIds: [2] }
    ), true);
    assert.equal(matchesSubscription(
        { targets: ['26학번'], categoryIds: [2] },
        { admissionYear: '25학번', allNotices: true, categoryIds: [] }
    ), false);
    assert.equal(matchesSubscription(
        { targets: ['전체'], categoryIds: [3] },
        { admissionYear: '25학번', allNotices: false, categoryIds: [3] }
    ), true);
});

test('push subscriptions receive unique opaque management tokens', async () => {
    const { service, vapidCalls } = await fixture();

    const first = await service.createSubscription(browserSubscription('one'), {
        admissionYear: '25학번',
        categoryIds: [2]
    });
    const second = await service.createSubscription(browserSubscription('two'), {
        admissionYear: '26학번',
        allNotices: true
    });

    assert.equal(vapidCalls.length, 1);
    assert.match(first.managementToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(second.managementToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.notEqual(first.managementToken, second.managementToken);
    assert.equal(Object.hasOwn(first.subscription, 'managementTokenHash'), false);
});

test('push subscription validates endpoints and requires its token for deletion', async () => {
    const { service, store } = await fixture();
    await assert.rejects(
        () => service.createSubscription({
            endpoint: 'javascript:alert(1)',
            keys: { p256dh: 'key', auth: 'auth' }
        }, {}),
        error => error.code === 'INVALID_PUSH_SUBSCRIPTION'
    );
    const created = await service.createSubscription(browserSubscription('delete'), {
        admissionYear: '25학번'
    });

    await assert.rejects(
        () => service.deleteSubscription(created.subscription.id, 'wrong-token'),
        error => error.code === 'INVALID_SUBSCRIPTION_TOKEN'
    );
    await service.deleteSubscription(created.subscription.id, created.managementToken);

    assert.equal((await store.listPushSubscriptions()).length, 0);
});

test('notification worker sends each matching delivery only once', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-push-worker-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    await publishedNotice(store, 'worker-idempotent');
    const sends = [];
    const webPushClient = {
        setVapidDetails() {},
        async sendNotification(subscription, payload) {
            sends.push({ subscription, payload });
        }
    };
    const service = createPushService({
        store,
        webPushClient,
        config: {
            enabled: true,
            subject: 'mailto:ece@example.com',
            publicKey: 'public',
            privateKey: 'private'
        }
    });
    await service.createSubscription(browserSubscription('worker-one'), {
        admissionYear: '25학번',
        allNotices: true
    });
    await service.createSubscription(browserSubscription('worker-two'), {
        admissionYear: '25학번',
        allNotices: true
    });

    await service.processPendingJobs();
    await service.processPendingJobs();

    assert.equal(sends.length, 2);
    assert.ok((await store.listNotificationDeliveries()).every(item =>
        item.status === 'sent'
    ));
});

test('concurrent notification workers claim a job only once', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-push-claim-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    await publishedNotice(store, 'worker-claim');
    let sends = 0;
    const service = createPushService({
        store,
        webPushClient: {
            setVapidDetails() {},
            async sendNotification() {
                sends += 1;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        },
        config: {
            enabled: true,
            subject: 'mailto:ece@example.com',
            publicKey: 'public',
            privateKey: 'private'
        }
    });
    await service.createSubscription(browserSubscription('claim'), {
        admissionYear: '25학번',
        allNotices: true
    });

    await Promise.all([
        service.processPendingJobs(),
        service.processPendingJobs()
    ]);

    assert.equal(sends, 1);
});

test('manual notices are delivered from their queued snapshot', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-push-manual-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    let sends = 0;
    const service = createPushService({
        store,
        webPushClient: {
            setVapidDetails() {},
            async sendNotification() {
                sends += 1;
            }
        },
        config: {
            enabled: true,
            subject: 'mailto:ece@example.com',
            publicKey: 'public',
            privateKey: 'private'
        }
    });
    await service.createSubscription(browserSubscription('manual'), {
        admissionYear: '25학번',
        allNotices: true
    });
    await store.createManualNotice({
        title: '관리자 직접 등록 공지',
        content: '본문',
        target: '25학번'
    });

    await service.processPendingJobs();

    assert.equal(sends, 1);
    assert.equal((await store.listNotificationJobs())[0].status, 'completed');
});

test('notification worker deactivates gone subscriptions and schedules transient retries', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-push-retry-'));
    const store = createAutomationStore({
        useSupabase: false,
        filePath: path.join(directory, 'automation.json')
    });
    let currentTime = new Date('2026-07-27T00:00:00.000Z');
    const responses = [410, 503, 503, 503];
    const webPushClient = {
        setVapidDetails() {},
        async sendNotification() {
            const error = new Error('push failed');
            error.statusCode = responses.shift();
            throw error;
        }
    };
    const service = createPushService({
        store,
        webPushClient,
        config: {
            enabled: true,
            subject: 'mailto:ece@example.com',
            publicKey: 'public',
            privateKey: 'private'
        },
        now: () => currentTime
    });
    await publishedNotice(store, 'worker-gone');
    await service.createSubscription(browserSubscription('gone'), {
        admissionYear: '25학번',
        allNotices: true
    });
    await service.processPendingJobs();
    assert.equal((await store.listPushSubscriptions())[0].status, 'inactive');

    await publishedNotice(store, 'worker-retry');
    await service.createSubscription(browserSubscription('retry'), {
        admissionYear: '25학번',
        allNotices: true
    });
    await service.processPendingJobs();
    let retry = (await store.listNotificationDeliveries())
        .find(item => item.status === 'retry');
    assert.equal(
        new Date(retry.nextAttemptAt).getTime() - currentTime.getTime(),
        60_000
    );

    currentTime = new Date(retry.nextAttemptAt);
    await service.processPendingJobs();
    retry = (await store.listNotificationDeliveries())
        .find(item => item.status === 'retry');
    assert.equal(
        new Date(retry.nextAttemptAt).getTime() - currentTime.getTime(),
        5 * 60_000
    );
});
