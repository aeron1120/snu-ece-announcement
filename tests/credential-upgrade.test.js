import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, resetAdminLoginAttempts } from '../server/server.js';
import { isLegacyCredentialHash, verifyCredential } from '../server/services/credential-hash.js';

const settingsPath = path.join(process.cwd(), 'server', 'data', 'settings.json');
const sha = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

async function startServer(t) {
    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
}

async function useSettings(t, patch) {
    const original = await readFile(settingsPath, 'utf8');
    await writeFile(settingsPath, JSON.stringify({ ...JSON.parse(original), ...patch }, null, 2), 'utf8');
    t.after(() => writeFile(settingsPath, original, 'utf8'));
}

test('a password stored as bare sha256 is rewritten as scrypt the next time it is used', async t => {
    /* 형식을 바꾸면서 옛 해시를 버리면 관리자 전원이 잠긴다. 반대로 옛 해시를
       그냥 두면 관리자가 비밀번호를 직접 바꾸기 전까지 약한 해시가 남는다.
       로그인에 성공한 순간에만 평문을 알 수 있으므로 그때 다시 적는다. */
    resetAdminLoginAttempts();
    const password = 'legacy-notice-password';
    await useSettings(t, { adminTokenHash: sha(password) });

    const baseUrl = await startServer(t);
    const login = await fetch(`${baseUrl}/api/admin/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, role: 'notice' })
    });

    assert.equal(login.status, 201);

    const stored = JSON.parse(await readFile(settingsPath, 'utf8')).adminTokenHash;
    assert.equal(isLegacyCredentialHash(stored), false, '옛 해시가 그대로 남았다');
    assert.match(stored, /^scrypt\$/);
    assert.ok(verifyCredential(password, stored), '새 해시로 같은 비밀번호가 통해야 한다');

    // 해시를 다시 쓰는 바람에 방금 만든 세션이 끊기면 로그인하자마자 튕긴다.
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const session = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).role, 'notice');
});

test('a wrong header token locks the caller out before it can burn any more CPU', async t => {
    /* 헤더 토큰은 세션 쿠키와 달리 요청마다 scrypt를 다시 돌린다. 그 계산이
       일부러 비싸므로, 틀린 토큰을 계속 던지는 것만으로 서버 CPU를 태울 수
       있다. 로그인 화면과 같은 잠금을 걸어 그 횟수를 막는다. */
    resetAdminLoginAttempts();
    const token = 'header-token-password';
    await useSettings(t, { adminTokenHash: sha(token) });

    const baseUrl = await startServer(t);
    const verify = headers => fetch(`${baseUrl}/api/admin/verify`, { method: 'POST', headers });

    // 맞는 토큰은 통과한다.
    assert.equal((await verify({ 'x-admin-token': token })).status, 200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.equal((await verify({ 'x-admin-token': 'wrong' })).status, 401);
    }

    // 잠긴 동안에는 맞는 토큰도 해시를 계산하지 않고 거절한다.
    assert.equal((await verify({ 'x-admin-token': token })).status, 401);

    resetAdminLoginAttempts();
    assert.equal((await verify({ 'x-admin-token': token })).status, 200);
});

test('the banner screen opens from the hash, not from a stored plaintext password', async t => {
    /* 예전에는 app_settings에 평문이 있었고 그 값과 직접 맞대봤다. 평문을
       지웠으니 해시로 판단해야 하고, 그래도 기존 비밀번호는 통해야 한다. */
    resetAdminLoginAttempts();
    const password = 'legacy-banner-password';
    await useSettings(t, { bannerPassword: undefined, bannerTokenHash: sha(password) });

    const baseUrl = await startServer(t);

    const ok = await fetch(`${baseUrl}/api/banner/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    assert.equal(ok.status, 200);

    const wrong = await fetch(`${baseUrl}/api/banner/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'not-the-password' })
    });
    assert.equal(wrong.status, 401);

    // 비밀번호를 비워 보내면 저장된 해시가 무엇이든 열리면 안 된다.
    const empty = await fetch(`${baseUrl}/api/banner/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' })
    });
    assert.equal(empty.status, 401);
});
