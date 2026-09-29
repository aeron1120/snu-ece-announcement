import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile('js/members.js', 'utf8');

async function setup(rows, patchResponse) {
    function element(tagName = 'div') {
        return {
            tagName, textContent: '', value: '', disabled: false, children: [], listeners: {},
            append(...children) { this.children.push(...children); },
            replaceChildren(...children) { this.children = children; },
            addEventListener(type, handler) { this.listeners[type] = handler; }
        };
    }
    const nodes = Object.fromEntries(['members-status', 'members-list', 'member-search', 'members-reload']
        .map(id => [id, element()]));
    const redirects = [];
    const requests = [];
    runInNewContext(source, {
        window: { API_BASE_URL: 'https://api.example.test' },
        document: { getElementById: id => nodes[id], createElement: element },
        location: { replace: url => redirects.push(url) },
        async fetch(url, options) {
            requests.push({ url, ...options });
            if (options.method === 'PATCH') return patchResponse(url, JSON.parse(options.body));
            assert.equal(url, 'https://api.example.test/api/admin/members');
            return { ok: true, status: 200, json: async () => ({ members: rows.map(row => ({ ...row })) }) };
        }
    });
    // The initial load only awaits the two resolved fetch/JSON promises above.
    await new Promise(resolve => setImmediate(resolve));
    return { nodes, redirects, requests };
}

function buttons(node) {
    return node.children.flatMap(child => child.tagName === 'button' ? [child] : buttons(child));
}

test('administrator cards explain automatic access and offer no membership review actions', async () => {
    const { nodes } = await setup([
        { email: 'admin@snu.ac.kr', status: 'approved', admin: true, profile: {} },
        { email: 'student@snu.ac.kr', status: 'pending', admin: false, profile: {} }
    ]);
    const cards = nodes['members-list'].children;
    const admin = cards.find(card => card.children[0].textContent === 'admin@snu.ac.kr');
    assert.match(admin.children[2].textContent, /관리자.*승인 불필요/);
    assert.equal(buttons(admin).length, 0);
    assert.doesNotMatch(admin.children[3].textContent, /검토 기록이 없습니다/);
    assert.match(nodes['members-status'].textContent, /확인 대기 1명/);
    assert.equal(buttons(cards[0]).length, 3);
});

test('a rejected review displays the server reason and restores usable controls', async () => {
    const message = '관리자 권한은 지정된 계정 목록에서 관리합니다.';
    const { nodes } = await setup([
        { email: 'promoted@snu.ac.kr', status: 'pending', admin: false, profile: {} }
    ], async () => ({ ok: false, status: 400, json: async () => ({ error: message }) }));
    await buttons(nodes['members-list'].children[0])[0].listeners.click();
    assert.equal(nodes['members-status'].textContent, message);
    assert.equal(buttons(nodes['members-list'].children[0])[0].disabled, false);
});

test('an expired administrator session returns to login when reviewing a member', async () => {
    const { nodes, redirects } = await setup([
        { email: 'student@snu.ac.kr', status: 'pending', admin: false, profile: {} }
    ], async () => ({ ok: false, status: 401, json: async () => ({ error: '관리자 로그인이 필요합니다.' }) }));
    await buttons(nodes['members-list'].children[0])[0].listeners.click();
    assert.deepEqual(redirects, ['/admin-login.html']);
});

test('ordinary membership approval refreshes the card and pending count', async () => {
    const rows = [{ email: 'student@snu.ac.kr', status: 'pending', admin: false, profile: {} }];
    const { nodes, requests } = await setup(rows, async (url, body) => {
        assert.equal(url, 'https://api.example.test/api/admin/members/student%40snu.ac.kr');
        assert.equal(body.status, 'approved');
        rows[0].status = 'approved';
        return { ok: true, status: 200 };
    });
    await buttons(nodes['members-list'].children[0])[0].listeners.click();
    assert.equal(requests[1].credentials, 'include');
    assert.match(nodes['members-status'].textContent, /확인 대기 0명/);
    assert.equal(nodes['members-list'].children[0].children[2].textContent, '승인됨');
    assert.equal(buttons(nodes['members-list'].children[0])[0].disabled, true);
});
