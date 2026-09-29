import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { app } from '../server/server.js';
import { createMemberStore } from '../server/storage/member-store.js';
import { TEST_ADMIN_EMAILS, beginGoogleLogin, mockGoogleIdentity, loginWithGoogle } from './fixtures/google-auth-helper.js';

test('membership requires verification; approval, revocation and admin separation are enforced by API', async t => {
    const file = path.resolve('server/data/members.json');
    const original = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    await writeFile(file, '[]');
    t.after(async () => { if (original) await writeFile(file, original); else await unlink(file); });
    const server = await new Promise(resolve => { const handle = app.listen(0, () => resolve(handle)); });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const protectedRoutes = ['/api/notices', '/api/notices/1', '/api/notices/1/thumbnail', '/api/notices/1/attachments/0', '/api/categories', '/api/banner-slides'];
    for (const route of protectedRoutes) assert.equal((await fetch(base + route)).status, 401);
    const login = async (payload, next = '/', previousCookie = '') => {
        const attempt = await beginGoogleLogin(t, base, { purpose: 'member', next });
        mockGoogleIdentity(t, attempt, payload);
        const response = await fetch(attempt.callback, { headers: { Cookie: `${attempt.cookie}; ${previousCookie}` }, redirect: 'manual' });
        return { response, cookie: response.headers.getSetCookie().find(value => value.startsWith('ece_member_session='))?.split(';')[0] };
    };
    const impostor = await login({ email: 'student@snu.ac.kr', sub: 'student-subject', name: '홍길동 / 학생 / 전기·정보공학부' });
    assert.ok(impostor.cookie);
    let session = await (await fetch(`${base}/api/member/session`, { headers: { Cookie: impostor.cookie } })).json();
    assert.equal(session.status, 'pending');
    assert.equal(session.profile.department, '전기·정보공학부');
    for (const route of protectedRoutes) assert.equal((await fetch(base + route, { headers: { Cookie: impostor.cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/members`, { headers: { Cookie: impostor.cookie } })).status, 401);
    const { cookie: admin } = await loginWithGoogle(t, base);
    const review = status => fetch(`${base}/api/admin/members/student%40snu.ac.kr`, {
        method: 'PATCH', headers: { Cookie: admin, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ status })
    });
    assert.equal((await review('approved')).status, 200);
    assert.equal((await fetch(`${base}/api/notices`, { headers: { Cookie: impostor.cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/notices`, { headers: { Cookie: impostor.cookie } })).status, 401);
    const returning = await login({ email: 'student@snu.ac.kr', sub: 'student-subject' }, '/?id=123');
    assert.equal(returning.response.headers.get('location'), `${base}/?id=123`);
    assert.equal((await review('denied')).status, 200);
    assert.equal((await fetch(`${base}/api/notices`, { headers: { Cookie: returning.cookie } })).status, 403);
    const staff = await login({ email: 'kala33@snu.ac.kr', sub: 'staff-subject', name: '박주연 / 직원 / 공과대학' }, '//attacker.test', admin);
    assert.equal((await fetch(`${base}/api/admin/session`, { headers: { Cookie: admin } })).status, 401);
    assert.equal(staff.response.headers.get('location'), `${base}/`);
    assert.equal((await fetch(`${base}/api/notices`, { headers: { Cookie: staff.cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/session`, { headers: { Cookie: staff.cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/member/session`, { method: 'DELETE', headers: { Cookie: staff.cookie, Origin: 'https://attacker.test' } })).status, 403);
    assert.equal((await fetch(`${base}/api/member/session`, { method: 'DELETE', headers: { Cookie: staff.cookie, Origin: base } })).status, 204);
    assert.equal((await fetch(`${base}/api/notices`, { headers: { Cookie: staff.cookie } })).status, 401);
    for (const payload of [{ email: 'outsider@gmail.com' }, { hd: 'other.edu' }, { email_verified: false }]) {
        const rejected = await login(payload);
        assert.equal(rejected.cookie, undefined);
        assert.equal(new URL(rejected.response.headers.get('location')).searchParams.get('error'), 'not_allowed');
    }
});

test('membership decisions survive storage reopen and login cannot overwrite a block', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ece-members-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'members.json');
    const store = createMemberStore({ filePath });
    const identity = { email: 'member@snu.ac.kr', subject: 'stable', profile: { rawName: 'name' } };
    await store.register(identity, 'approved');
    await store.review(identity.email, 'denied', 'reviewer@snu.ac.kr');
    const reopened = createMemberStore({ filePath });
    const member = await reopened.register(identity, 'approved');
    assert.equal(member.status, 'denied');
    assert.equal(member.reviewed_by, 'reviewer@snu.ac.kr');
    await assert.rejects(reopened.register({ ...identity, subject: 'different' }, 'approved'));
});

test('member directory reflects administrator access without overwriting stored membership decisions', async t => {
    const file = path.resolve('server/data/members.json');
    const original = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    t.after(async () => { if (original) await writeFile(file, original); else await unlink(file); });
    const rows = [
        { email: TEST_ADMIN_EMAILS[0], subject: 'google-subject', status: 'pending' },
        { email: TEST_ADMIN_EMAILS[1], subject: 'second-subject', status: 'denied' },
        { email: 'student@snu.ac.kr', subject: 'student-subject', status: 'pending' }
    ].map(row => ({ ...row, profile: {}, updated_at: '2026-09-29T00:00:00Z' }));
    await writeFile(file, JSON.stringify(rows));
    const server = await new Promise(resolve => { const handle = app.listen(0, () => resolve(handle)); });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const { cookie } = await loginWithGoogle(t, base);
    const list = async () => {
        const response = await fetch(`${base}/api/admin/members`, { headers: { Cookie: cookie } });
        assert.equal(response.status, 200);
        return (await response.json()).members;
    };

    const members = await list();
    for (const email of TEST_ADMIN_EMAILS.slice(0, 2)) {
        const member = members.find(row => row.email === email);
        assert.equal(member.status, 'approved');
        assert.equal(member.admin, true);
        for (const status of ['approved', 'denied', 'pending']) {
            const response = await fetch(`${base}/api/admin/members/${encodeURIComponent(email)}`, {
                method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            assert.equal(response.status, 400);
            assert.match((await response.json()).error, /관리자 권한/);
        }
    }
    const student = members.find(row => row.email === 'student@snu.ac.kr');
    assert.equal(student.status, 'pending');
    assert.equal(student.admin, false);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), rows);

    // Removing an administrator must restore their actual stored membership decision.
    process.env.ADMIN_EMAILS = TEST_ADMIN_EMAILS[0];
    const formerAdmin = (await list()).find(row => row.email === TEST_ADMIN_EMAILS[1]);
    assert.equal(formerAdmin.admin, false);
    assert.equal(formerAdmin.status, 'denied');
});
