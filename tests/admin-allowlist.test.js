import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminEmail } from '../server/services/google-admin-auth.js';

test('administrator access comes only from the configured school email list', () => {
    const env = { ADMIN_EMAILS: ' Test-Admin@snu.ac.kr,second-admin@snu.ac.kr\nthird-admin@snu.ac.kr ' };
    for (const email of ['test-admin@snu.ac.kr', 'TEST-ADMIN@SNU.AC.KR', 'second-admin@snu.ac.kr', 'third-admin@snu.ac.kr']) {
        assert.equal(isAdminEmail(email, env), true);
    }
    for (const email of ['student@snu.ac.kr', 'test-admin@snu.ac.kr.attacker.test', '', null]) {
        assert.equal(isAdminEmail(email, env), false);
    }
});

test('missing, empty, or invalid administrator configuration grants no access', () => {
    for (const env of [{}, { ADMIN_EMAILS: '' }, { ADMIN_EMAILS: ' , \n' },
        { ADMIN_EMAILS: 'outsider@example.com,invalid address@snu.ac.kr,*@snu.ac.kr' }]) {
        for (const email of ['test-admin@snu.ac.kr', 'outsider@example.com', 'invalid address@snu.ac.kr']) {
            assert.equal(isAdminEmail(email, env), false);
        }
    }
});

test('removing an email takes effect on subsequent authorization checks', () => {
    const env = { ADMIN_EMAILS: 'test-admin@snu.ac.kr' };
    assert.equal(isAdminEmail('test-admin@snu.ac.kr', env), true);
    env.ADMIN_EMAILS = '';
    assert.equal(isAdminEmail('test-admin@snu.ac.kr', env), false);
});
