import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server/server.js';
import { getGoogleAuthConfig } from '../server/services/google-admin-auth.js';
import { TEST_ADMIN_EMAILS, beginGoogleLogin, loginWithGoogle, mockGoogleIdentity } from './fixtures/google-auth-helper.js';

async function startServer(t) {
    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}

test('school users sharing an IP can start and finish more than five OAuth flows', async t => {
    const base = await startServer(t);
    await beginGoogleLogin(t, base);
    for (let i = 0; i < 12; i++) {
        const start = await fetch(`${base}/api/auth/google?purpose=member`, { redirect: 'manual' });
        assert.equal(start.status, 302, `shared-IP login ${i + 1}`);
        const state = new URL(start.headers.get('location')).searchParams.get('state');
        const cookie = start.headers.getSetCookie().find(value => value.startsWith('ece_google_oauth=')).split(';')[0];
        const callback = await fetch(`${base}/api/auth/google/callback?state=${state}&error=access_denied`, {
            headers: { Cookie: cookie }, redirect: 'manual'
        });
        assert.equal(callback.status, 302, `browser-bound callback ${i + 1}`);
    }
});

for (const email of TEST_ADMIN_EMAILS) {
    test(`Google login grants full access to ${email} and logout revokes it`, async t => {
        const base = await startServer(t);
        const { cookie, response, setCookie } = await loginWithGoogle(t, base, { payload: { email }, edit: '42' });
        assert.equal(response.headers.get('location'), `${base}/admin.html?edit=42`);
        assert.match(setCookie, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=28800/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        for (const route of ['/api/admin/notices', '/api/banner-slides/manage', '/api/admin/feedback']) {
            assert.equal((await fetch(base + route, { headers: { Cookie: cookie } })).status, 200);
        }
        const session = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
        assert.deepEqual(await session.json(), { authenticated: true, role: 'master', email });
        const logout = await fetch(`${base}/api/admin/session`, { method: 'DELETE', headers: { Cookie: cookie } });
        assert.equal(logout.status, 204);
        assert.equal((await fetch(`${base}/api/admin/notices`, { headers: { Cookie: cookie } })).status, 401);
    });
}

for (const payload of [
    { email: 'other@snu.ac.kr' }, { email: 'test-admin@snu.ac.kr.attacker.test' },
    { email_verified: false }, { hd: undefined }, { hd: 'attacker.test' },
    { nonce: 'wrong-nonce' }, { sub: '' }
]) {
    test(`Google claims cannot bypass the allowlist: ${JSON.stringify(payload)}`, async t => {
        const base = await startServer(t);
        const attempt = await beginGoogleLogin(t, base);
        mockGoogleIdentity(t, attempt, payload);
        const response = await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
        assert.equal(response.headers.get('location'), `${base}/admin-login.html?error=not_allowed`);
        assert.ok(response.headers.getSetCookie().every(value => !value.startsWith('ece_admin_session=')));
    });
}

test('OAuth binds state to the browser, uses PKCE, and rejects replays', async t => {
    const base = await startServer(t);
    const attempt = await beginGoogleLogin(t, base, { edit: '//attacker.test' });
    assert.equal(attempt.url.origin, 'https://accounts.google.com');
    assert.equal(attempt.url.searchParams.get('scope'), 'openid email profile');
    assert.equal(attempt.url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(attempt.url.searchParams.get('code_challenge').length >= 43);
    assert.ok(!attempt.url.href.includes('test-secret'));
    assert.match(attempt.start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal((await fetch(attempt.callback, { redirect: 'manual' })).status, 400);
    assert.equal((await fetch(attempt.callback, { headers: { Cookie: 'ece_google_oauth=wrong' }, redirect: 'manual' })).status, 400);
    assert.equal((await fetch(attempt.callback.replace(/state=[^&]+/, 'state=wrong'), { headers: { Cookie: attempt.cookie } })).status, 400);
    mockGoogleIdentity(t, attempt);
    const success = await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
    assert.equal(new URL(success.headers.get('location')).origin, base);
    assert.equal((await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' })).status, 400);
});

test('an unset admin list rejects login and removing an admin revokes existing access', async t => {
    const base = await startServer(t);
    const { cookie } = await loginWithGoogle(t, base);
    delete process.env.ADMIN_EMAILS;
    assert.equal((await fetch(`${base}/api/admin/notices`, { headers: { Cookie: cookie } })).status, 401);

    const attempt = await beginGoogleLogin(t, base);
    delete process.env.ADMIN_EMAILS;
    mockGoogleIdentity(t, attempt);
    const result = await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
    assert.equal(result.headers.get('location'), `${base}/admin-login.html?error=not_allowed`);
    assert.ok(result.headers.getSetCookie().every(value => !value.startsWith('ece_admin_session=')));
});

test('invalid Google tokens never create a session', async t => {
    const base = await startServer(t);
    const attempt = await beginGoogleLogin(t, base);
    mockGoogleIdentity(t, attempt, {}, { invalidToken: true });
    const result = await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
    assert.equal(result.headers.get('location'), `${base}/admin-login.html?error=failed`);
    assert.ok(result.headers.getSetCookie().every(value => !value.startsWith('ece_admin_session=')));
});

test('cancelled and expired logins cannot create sessions', async t => {
    const base = await startServer(t);
    const attempt = await beginGoogleLogin(t, base);
    const cancelled = await fetch(`${attempt.callback}&error=access_denied`, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
    assert.equal(cancelled.headers.get('location'), `${base}/admin-login.html?error=cancelled`);
    const expired = await beginGoogleLogin(t, base);
    const now = Date.now();
    const clock = t.mock.method(Date, 'now', () => now + 11 * 60 * 1000);
    assert.equal((await fetch(expired.callback, { headers: { Cookie: expired.cookie }, redirect: 'manual' })).status, 400);
    clock.mock.restore();
});

test('production session cookies allow the configured frontend and block cross-origin writes', async t => {
    const base = await startServer(t);
    const { response, cookie, setCookie } = await loginWithGoogle(t, base, { production: true });
    assert.match(setCookie, /SameSite=None; Secure/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://snu-ece-announcement.pages.dev');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    const call = origin => fetch(`${base}/api/banner/verify`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
    assert.equal((await call('https://attacker.test')).status, 403);
    assert.equal((await call('https://snu-ece-announcement.pages.dev')).status, 200);
});

test('missing or unsafe OAuth configuration fails closed', async t => {
    const base = await startServer(t);
    const previous = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    t.after(() => { if (previous !== undefined) process.env.GOOGLE_CLIENT_ID = previous; });
    assert.equal((await fetch(`${base}/api/auth/google`)).status, 503);
    assert.equal(getGoogleAuthConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'http://attacker.test/api/auth/google/callback' }), null);
    assert.equal((await fetch(`${base}/api/admin/session`, { headers: { Cookie: 'ece_admin_session=%ZZ' } })).status, 401);
});
