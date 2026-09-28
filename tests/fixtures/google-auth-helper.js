import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { resetAdminLoginAttempts } from '../../server/server.js';

export const TEST_ADMIN_EMAILS = ['test-admin@snu.ac.kr', 'second-admin@snu.ac.kr', 'third-admin@snu.ac.kr'];

// Mock only Google's network boundary; exercise our real state/cookie/session routes.
export async function beginGoogleLogin(t, baseUrl, { edit = '', production = false, purpose = 'admin', next = '/' } = {}) {
    resetAdminLoginAttempts();
    const env = {
        ADMIN_EMAILS: TEST_ADMIN_EMAILS.join(','),
        GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test-secret',
        GOOGLE_REDIRECT_URI: `${baseUrl}/api/auth/google/callback`,
        FRONTEND_ORIGIN: production ? 'https://snu-ece-announcement.pages.dev' : baseUrl,
        NODE_ENV: production ? 'production' : 'test'
    };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
    const start = await fetch(`${baseUrl}/api/auth/google?edit=${encodeURIComponent(edit)}&purpose=${purpose}&next=${encodeURIComponent(next)}`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const url = new URL(start.headers.get('location'));
    const cookie = start.headers.getSetCookie().find(value => value.startsWith('ece_google_oauth=')).split(';')[0];
    return { start, url, cookie, callback: `${baseUrl}/api/auth/google/callback?state=${url.searchParams.get('state')}&code=test-code` };
}

export function mockGoogleIdentity(t, attempt, payload = {}, { invalidToken = false } = {}) {
    t.mock.method(OAuth2Client.prototype, 'getToken', async function (options) {
        assert.equal(options.code, 'test-code');
        assert.ok(options.codeVerifier);
        return { tokens: { id_token: 'test-id-token' } };
    });
    t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async function (options) {
        assert.equal(options.audience, 'test-client.apps.googleusercontent.com');
        assert.equal(options.idToken, 'test-id-token');
        if (invalidToken) throw new Error('Invalid signature or claims');
        return { getPayload: () => ({
            sub: 'google-subject', email: TEST_ADMIN_EMAILS[0], email_verified: true,
            hd: 'snu.ac.kr', nonce: attempt.url.searchParams.get('nonce'), ...payload
        }) };
    });
}

export async function loginWithGoogle(t, baseUrl, options = {}) {
    const attempt = await beginGoogleLogin(t, baseUrl, options);
    mockGoogleIdentity(t, attempt, options.payload);
    const response = await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    const setCookie = response.headers.getSetCookie().find(value => value.startsWith('ece_admin_session='));
    assert.ok(setCookie, 'Google callback must issue an admin session');
    return { response, setCookie, cookie: setCookie.split(';')[0] };
}
