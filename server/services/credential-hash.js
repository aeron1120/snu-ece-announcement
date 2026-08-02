import crypto from 'node:crypto';

/* 관리자 비밀번호를 보관하는 형식.

   예전에는 salt 없는 sha256 한 번이었다. 그 해시는 초당 수십억 번 계산되므로,
   app_settings 행이 한 번 새면 세 역할의 비밀번호가 사실상 함께 새는 것과 같다.
   scrypt는 메모리를 함께 요구해서 그 계산을 느리게 만들고, 행마다 다른 salt를
   붙여 레인보우 테이블을 무의미하게 만든다.

   저장 형식: scrypt$N$r$p$salt$hash  (salt와 hash는 base64url) */

const ALGORITHM = 'scrypt';
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// 저장된 값이 시키는 대로 계산하므로, 그 값이 오염되면 메모리를 무한정 요구할
// 수 있다. scrypt가 쓰는 메모리는 대략 128 * N * r 바이트다.
const MAX_COST = 1 << 20;
const MAX_BLOCK_SIZE = 32;
const MAX_PARALLELIZATION = 16;

// salt 없는 sha256을 16진수로 적은 옛 형식.
const LEGACY_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function legacyHashToken(token) {
    return crypto.createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

export function isLegacyCredentialHash(stored) {
    return LEGACY_HASH_PATTERN.test(String(stored ?? ''));
}

export function createCredentialHash(password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const derived = crypto.scryptSync(String(password ?? ''), salt, KEY_LENGTH, {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION
    });

    return [
        ALGORITHM,
        COST,
        BLOCK_SIZE,
        PARALLELIZATION,
        salt.toString('base64url'),
        derived.toString('base64url')
    ].join('$');
}

function equalBytes(actual, expected) {
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// 1 이상 max 이하의 정수만 통과시킨다. '8ms'나 'a' 같은 값은 여기서 걸린다.
function parseParameter(value, max) {
    if (!/^\d+$/.test(value)) return 0;
    const parsed = Number(value);
    return parsed >= 1 && parsed <= max ? parsed : 0;
}

/* 맞으면 true. 저장된 값이 옛 형식이든 새 형식이든 이 함수 하나만 부르면 된다.
   깨진 값에는 예외를 던지지 않고 false를 준다 — 로그인 화면 전체가 500으로
   멎는 것보다 그 자격 증명만 거절하는 편이 낫다. */
export function verifyCredential(password, stored) {
    const candidate = String(password ?? '');
    const value = String(stored ?? '');
    // 해시 열이 빈 행이 실제로 있다. 빈 값끼리 맞다고 하면 비밀번호 없이 열린다.
    if (!candidate || !value) return false;

    if (isLegacyCredentialHash(value)) {
        return equalBytes(
            Buffer.from(legacyHashToken(candidate), 'utf8'),
            Buffer.from(value, 'utf8')
        );
    }

    const parts = value.split('$');
    if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

    const cost = parseParameter(parts[1], MAX_COST);
    const blockSize = parseParameter(parts[2], MAX_BLOCK_SIZE);
    const parallelization = parseParameter(parts[3], MAX_PARALLELIZATION);
    if (!cost || !blockSize || !parallelization) return false;

    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length === 0 || expected.length === 0) return false;

    try {
        const derived = crypto.scryptSync(candidate, salt, expected.length, {
            N: cost,
            r: blockSize,
            p: parallelization,
            // 기본 한도는 32MB라 N을 조금만 올려도 걸린다. 위에서 상한을 걸어
            // 두었으니 그 상한까지는 계산할 수 있게 열어 준다.
            maxmem: 256 * 1024 * 1024
        });
        return equalBytes(derived, expected);
    } catch {
        return false;
    }
}
