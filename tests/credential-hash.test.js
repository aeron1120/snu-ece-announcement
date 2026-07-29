import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    createCredentialHash,
    isLegacyCredentialHash,
    legacyHashToken,
    verifyCredential
} from '../server/services/credential-hash.js';

const sha = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

test('the same password hashes differently every time', () => {
    // salt가 없으면 레인보우 테이블 하나로 세 역할의 비밀번호가 함께 뚫린다.
    const first = createCredentialHash('same-password');
    const second = createCredentialHash('same-password');

    assert.notEqual(first, second);
    assert.match(first, /^scrypt\$/);
    assert.ok(verifyCredential('same-password', first));
    assert.ok(verifyCredential('same-password', second));
});

test('a wrong password never verifies', () => {
    const stored = createCredentialHash('right-password');

    assert.equal(verifyCredential('wrong-password', stored), false);
    assert.equal(verifyCredential('right-passwor', stored), false);
    assert.equal(verifyCredential('right-passwordd', stored), false);
});

test('passwords stored as bare sha256 still open the door', () => {
    // 이미 저장된 해시는 salt 없는 sha256이다. 형식을 바꾸는 순간
    // 관리자 전원이 잠기므로 옛 형식도 계속 확인해야 한다.
    const legacy = sha('old-password');

    assert.ok(isLegacyCredentialHash(legacy));
    assert.ok(verifyCredential('old-password', legacy));
    assert.equal(verifyCredential('other-password', legacy), false);
});

test('a scrypt hash is not mistaken for a legacy one', () => {
    // 옛 형식으로 잘못 읽으면 로그인 성공 뒤 매번 다시 해시를 새로 쓴다.
    assert.equal(isLegacyCredentialHash(createCredentialHash('password')), false);
});

test('an empty password or an empty stored hash never authenticates', () => {
    // 해시 열이 비어 있는 행이 실제로 있다. 빈 값끼리 맞다고 하면
    // 비밀번호 없이 관리자 화면이 열린다.
    assert.equal(verifyCredential('', createCredentialHash('password')), false);
    assert.equal(verifyCredential('password', ''), false);
    assert.equal(verifyCredential('', ''), false);
    assert.equal(verifyCredential('', sha('')), false);
    assert.equal(verifyCredential(null, null), false);
    assert.equal(verifyCredential(undefined, undefined), false);
});

test('a damaged stored hash is rejected instead of throwing', () => {
    // 저장된 값이 깨졌을 때 500을 내면 로그인 화면 전체가 멎는다.
    for (const broken of ['scrypt$', 'scrypt$16384$8$1$notbase64$$$', 'scrypt$a$b$c$d$e', 'zzz', '1234']) {
        assert.equal(verifyCredential('password', broken), false, `${broken}는 거절해야 한다`);
    }
});

test('legacyHashToken still produces the old format', () => {
    // 평문만 남은 옛 행에서 해시를 복원할 때 쓴다. 여기서 scrypt를 쓰면
    // 설정을 읽을 때마다 비싼 연산이 돌아 공개 엔드포인트가 느려진다.
    assert.equal(legacyHashToken('banner-password'), sha('banner-password'));
    assert.ok(isLegacyCredentialHash(legacyHashToken('banner-password')));
});
