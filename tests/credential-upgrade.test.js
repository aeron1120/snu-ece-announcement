import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { app, resetAdminLoginAttempts } from '../server/server.js';

test('stored legacy passwords and tokens cannot authenticate any admin route', async t => {
    const settingsPath = 'server/data/settings.json';
    const original = await readFile(settingsPath, 'utf8');
    const password = 'previous-valid-admin-password';
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await writeFile(settingsPath, JSON.stringify({ ...JSON.parse(original),
        adminTokenHash: hash, masterTokenHash: hash, bannerTokenHash: hash,
        bannerPassword: password
    }));
    t.after(() => writeFile(settingsPath, original));
    resetAdminLoginAttempts();
    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/admin/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, role: 'master', email: 'test-admin@snu.ac.kr' })
    });
    assert.equal(login.status, 410);
    assert.equal(login.headers.get('set-cookie'), null);
    for (const route of ['/api/admin/verify', '/api/super-admin/verify', '/api/banner/verify']) {
        const response = await fetch(base + route, {
            method: 'POST', headers: { 'Content-Type': 'application/json',
                'x-admin-token': password, 'x-super-admin-token': password, 'x-banner-token': password },
            body: JSON.stringify({ password })
        });
        assert.equal(response.status, 401);
    }
    for (const route of ['/api/admin/notices', '/api/admin/feedback', '/api/banner-slides/manage']) {
        assert.equal((await fetch(base + route, { headers: { 'x-admin-token': password,
            'x-super-admin-token': password, 'x-banner-token': password } })).status, 401);
    }
});
