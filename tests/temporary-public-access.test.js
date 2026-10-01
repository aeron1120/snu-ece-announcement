import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { app } from '../server/server.js';
import { beginGoogleLogin, mockGoogleIdentity, loginWithGoogle } from './fixtures/google-auth-helper.js';

test('temporary public access admits Google members without persisting approval and revokes access when disabled', async t => {
    const file = new URL('../server/data/members.json', import.meta.url);
    const original = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    const previous = process.env.TEMPORARY_PUBLIC_ACCESS;
    await writeFile(file, '[]');
    t.after(async () => {
        if (original) await writeFile(file, original); else await unlink(file);
        if (previous === undefined) delete process.env.TEMPORARY_PUBLIC_ACCESS;
        else process.env.TEMPORARY_PUBLIC_ACCESS = previous;
    });
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = async (payload, purpose = 'member') => {
        const attempt = await beginGoogleLogin(t, base, { purpose, next: '/?id=123' });
        mockGoogleIdentity(t, attempt, payload);
        const response = await fetch(attempt.callback, { headers: { Cookie: attempt.cookie }, redirect: 'manual' });
        const cookie = response.headers.getSetCookie().find(value => value.startsWith('ece_member_session='))?.split(';')[0];
        return { response, cookie, attempt };
    };
    const access = cookie => fetch(`${base}/api/categories`, { headers: { Cookie: cookie || '' } });
    const outsider = { email: 'reviewer@gmail.com', hd: undefined, sub: 'reviewer' };
    delete process.env.TEMPORARY_PUBLIC_ACCESS;
    assert.equal((await login(outsider)).cookie, undefined);
    process.env.TEMPORARY_PUBLIC_ACCESS = 'true';
    const publicSession = await fetch(`${base}/api/member/session`);
    assert.equal(publicSession.status, 401);
    assert.equal((await publicSession.json()).temporaryPublicAccess, true);
    assert.equal((await access()).status, 401);
    const guest = await login(outsider);
    assert.ok(guest.cookie);
    assert.equal(guest.attempt.url.searchParams.has('hd'), false);
    assert.equal(guest.response.headers.get('location'), `${base}/?id=123`);
    assert.equal((await access(guest.cookie)).status, 200);
    const student = await login({ email: 'student@snu.ac.kr', sub: 'student' });
    assert.equal((await access(student.cookie)).status, 200);
    const unhosted = await login({ email: 'unhosted@snu.ac.kr', hd: undefined, sub: 'unhosted' });
    assert.equal((await access(unhosted.cookie)).status, 200);
    for (const row of JSON.parse(await readFile(file, 'utf8'))) assert.equal(row.status, 'pending');
    assert.equal((await fetch(`${base}/api/admin/members`, { headers: { Cookie: guest.cookie } })).status, 401);
    const adminAttempt = await login(outsider, 'admin');
    assert.equal(adminAttempt.attempt.url.searchParams.get('hd'), 'snu.ac.kr');
    assert.equal(adminAttempt.response.headers.getSetCookie().some(value => value.startsWith('ece_admin_session=')), false);
    for (const payload of [{ ...outsider, email_verified: false }, { ...outsider, nonce: 'wrong' }, { ...outsider, sub: '' }, { ...outsider, email: '' }]) {
        assert.equal((await login(payload)).cookie, undefined);
    }
    const admin = await loginWithGoogle(t, base);
    const review = async (email, status) => {
        const response = await fetch(`${base}/api/admin/members/${encodeURIComponent(email)}`, {
            method: 'PATCH', headers: { Cookie: admin.cookie, 'Content-Type': 'application/json', Origin: base },
            body: JSON.stringify({ status })
        });
        assert.equal(response.status, 200);
    };
    await review(outsider.email, 'denied');
    assert.equal((await access(guest.cookie)).status, 403);
    assert.equal((await access((await login(outsider)).cookie)).status, 403);
    await review(outsider.email, 'approved');
    assert.equal((await access(guest.cookie)).status, 200);
    const inFlight = await beginGoogleLogin(t, base, { purpose: 'member' });
    process.env.TEMPORARY_PUBLIC_ACCESS = 'false';
    mockGoogleIdentity(t, inFlight, outsider);
    const callback = await fetch(inFlight.callback, { headers: { Cookie: inFlight.cookie }, redirect: 'manual' });
    assert.equal(new URL(callback.headers.get('location')).searchParams.get('error'), 'not_allowed');
    assert.equal((await access(guest.cookie)).status, 401);
    assert.equal((await access(unhosted.cookie)).status, 401);
    assert.equal((await access(student.cookie)).status, 403);
    await review('student@snu.ac.kr', 'approved');
    assert.equal((await access(student.cookie)).status, 200);
    const closed = await fetch(`${base}/api/member/session`, { headers: { Cookie: guest.cookie } });
    assert.equal(closed.status, 401);
    assert.equal((await closed.json()).temporaryPublicAccess, false);
    for (const value of ['', 'false', 'TRUE', '1']) {
        process.env.TEMPORARY_PUBLIC_ACCESS = value;
        assert.equal((await login(outsider)).cookie, undefined);
    }
});
