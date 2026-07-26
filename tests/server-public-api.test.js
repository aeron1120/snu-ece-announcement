import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server/server.js';

test('public notice API is paginated, has detail lookup, and hides Express signature', async t => {
    const server = await new Promise(resolve => {
        const listening = app.listen(0, () => resolve(listening));
    });
    t.after(() => server.close());
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const listResponse = await fetch(`${baseUrl}/api/notices?page=1&limit=1`);
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get('x-powered-by'), null);
    const list = await listResponse.json();
    assert.ok(Array.isArray(list.notices));
    assert.deepEqual(
        Object.keys(list.pagination).sort(),
        ['limit', 'page', 'total', 'totalPages'].sort()
    );
    assert.equal(list.pagination.limit, 1);

    const missing = await fetch(`${baseUrl}/api/notices/9007199254740991`);
    assert.equal(missing.status, 404);
});
