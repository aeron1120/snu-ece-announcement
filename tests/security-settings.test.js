import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { securitySettingsFromRow, securitySettingsToRow } from '../server/server.js';

const sha = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const adminInfo = { name: '공지 담당', phone: '010-0000-0000', kakao: 'notice' };
const bannerInfo = { name: '배너 담당', phone: '010-1111-1111', kakao: 'banner' };

test('supabase keeps the password of every admin role', () => {
    // 파일 모드는 세 해시를 모두 보관하는데 Supabase 모드만 공지 해시와
    // 평문 배너 비밀번호만 저장했다. 그래서 마스터·배너 비밀번호를 바꿔도
    // 다음 재시작에 사라지고 환경변수 값으로 되돌아갔다.
    const row = securitySettingsToRow({
        adminInfo,
        bannerInfo,
        bannerPassword: 'banner-plain',
        adminTokenHash: sha('notice-password'),
        bannerTokenHash: sha('banner-password'),
        masterTokenHash: sha('master-password')
    });

    assert.equal(row.banner_token_hash, sha('banner-password'));
    assert.equal(row.master_token_hash, sha('master-password'));

    const restored = securitySettingsFromRow(row);
    assert.equal(restored.adminTokenHash, sha('notice-password'));
    assert.equal(restored.bannerTokenHash, sha('banner-password'));
    assert.equal(restored.masterTokenHash, sha('master-password'));
});

test('a row written before the hash columns existed still opens the banner screen', () => {
    // 예전 행에는 배너 비밀번호가 평문으로만 있다. 파일 저장소와 똑같이
    // 그 값을 해시로 옮겨 읽어야 기존 비밀번호가 계속 통한다.
    const restored = securitySettingsFromRow({
        admin_name: adminInfo.name,
        admin_phone: adminInfo.phone,
        admin_kakao: adminInfo.kakao,
        banner_admin_name: bannerInfo.name,
        banner_admin_phone: bannerInfo.phone,
        banner_admin_kakao: bannerInfo.kakao,
        banner_password: 'legacy-plain',
        admin_token_hash: sha('notice-password')
    });

    assert.equal(restored.bannerTokenHash, sha('legacy-plain'));
    assert.equal(restored.adminTokenHash, sha('notice-password'));
    // 마스터 해시는 저장된 적이 없으므로 환경변수에서 온 기본값으로 남는다.
    // 기본값은 이제 scrypt라 salt 때문에 값을 직접 맞대볼 수 없다.
    assert.match(restored.masterTokenHash, /^scrypt\$/);
});

test('the plaintext banner password is read once and never written back', () => {
    // 평문이 app_settings에 남아 있으면 그 행이 새는 순간 배너 비밀번호가
    // 그대로 새어 나간다. 옛 행에서 해시를 복원하는 데만 쓰고, 저장할 때는
    // 열을 비워 예전에 적힌 값을 지운다.
    const restored = securitySettingsFromRow({
        admin_name: adminInfo.name,
        admin_phone: adminInfo.phone,
        admin_kakao: adminInfo.kakao,
        banner_admin_name: bannerInfo.name,
        banner_admin_phone: bannerInfo.phone,
        banner_admin_kakao: bannerInfo.kakao,
        banner_password: 'legacy-plain',
        admin_token_hash: sha('notice-password')
    });

    assert.equal(restored.bannerPassword, undefined);
    assert.equal(securitySettingsToRow(restored).banner_password, '');
});

test('the admin contact details survive the round trip', () => {
    const restored = securitySettingsFromRow(securitySettingsToRow({
        adminInfo,
        bannerInfo,
        bannerPassword: 'banner-plain',
        adminTokenHash: sha('notice-password'),
        bannerTokenHash: sha('banner-password'),
        masterTokenHash: sha('master-password')
    }));

    assert.deepEqual(restored.adminInfo, adminInfo);
    assert.deepEqual(restored.bannerInfo, bannerInfo);
});

test('the schema has a column for every field the server writes', async () => {
    // 이 결함은 코드가 쓰는 열과 스키마가 어긋나서 생겼다. 저장은 조용히
    // 성공한 것처럼 보이고 값만 사라진다. 두 목록을 맞대어 묶어 둔다.
    const { readFile } = await import('node:fs/promises');
    const schema = await readFile('server/sql/supabase-schema.sql', 'utf8');
    const row = securitySettingsToRow({
        adminInfo,
        bannerInfo,
        bannerPassword: 'p',
        adminTokenHash: 'a',
        bannerTokenHash: 'b',
        masterTokenHash: 'm'
    });

    for (const column of Object.keys(row)) {
        if (column === 'id' || column === 'updated_at') continue;
        assert.ok(
            new RegExp(`\\b${column}\\b`).test(schema),
            `app_settings에 ${column} 열이 있어야 한다`
        );
    }
});

test('settings still save on a database that has not been migrated yet', async () => {
    // 스키마 적용과 배포 순서는 보장되지 않는다. 새 열이 아직 없는 DB에
    // 그대로 쓰면 upsert가 통째로 실패해 비밀번호 재설정 화면까지 막힌다.
    const { legacySecuritySettingsRow } = await import('../server/server.js');
    const row = securitySettingsToRow({
        adminInfo,
        bannerInfo,
        bannerPassword: 'p',
        adminTokenHash: 'a',
        bannerTokenHash: 'b',
        masterTokenHash: 'm'
    });

    const legacy = legacySecuritySettingsRow(row);
    assert.equal(Object.hasOwn(legacy, 'banner_token_hash'), false);
    assert.equal(Object.hasOwn(legacy, 'master_token_hash'), false);
    // 나머지는 그대로 저장되어야 한다.
    assert.equal(legacy.admin_token_hash, 'a');
    assert.equal(legacy.admin_name, adminInfo.name);
    // 열이 not null이라 남겨 두되 평문은 담지 않는다.
    assert.equal(legacy.banner_password, '');
});
