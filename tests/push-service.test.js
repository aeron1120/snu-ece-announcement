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
