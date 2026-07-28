import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_NOTICE_CATEGORIES } from '../server/config/notice-categories.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(here, '../server/data/automation.json');
const args = process.argv.slice(2);
const mode = args.includes('--apply') ? 'apply' : (args.includes('--rollback') ? 'rollback' : 'dry-run');

const OLD_DIRECT_MAP = Object.freeze({
    academics: 'ACADEMIC',
    'benefits-partnerships': 'BENEFIT',
    campus: 'COMMUNITY',
    governance: 'COMMUNITY',
    survey: 'BENEFIT'
});
const ACADEMIC_RE = /수강\s*신청|수강신청|수강\s*정정|졸업|성적|전공\s*진입/i;
const OPPORTUNITY_RE = /인턴|연구실|모집|공모전|경진대회|대회|장학|교환\s*학생|교환학생/i;
const BENEFIT_RE = /혜택|제휴|할인|지원금|기프티콘|상품권|쿠폰|간식|증정/i;
const COMMUNITY_RE = /학생회|대의원|총회|축제|행사|정전|출입|시설|교통|캠퍼스/i;
const REWARD_RE = /(?:추첨|선착순|참여자|응답자|사례비|리워드|상품|경품|기프티콘|쿠폰)[^.!?\n]{0,80}(?:원|명|개|기프티콘|쿠폰|상품권|사례비|지급|증정|제공)/i;

function classifyApplication(title, content) {
    if (OPPORTUNITY_RE.test(title)) return 'OPPORTUNITY';
    if (ACADEMIC_RE.test(title)) return 'ACADEMIC';
    if (ACADEMIC_RE.test(content)) return 'ACADEMIC';
    if (OPPORTUNITY_RE.test(content)) return 'OPPORTUNITY';
    return null;
}

function inferFallback(text) {
    if (ACADEMIC_RE.test(text)) return 'ACADEMIC';
    if (OPPORTUNITY_RE.test(text)) return 'OPPORTUNITY';
    if (BENEFIT_RE.test(text)) return 'BENEFIT';
    if (COMMUNITY_RE.test(text)) return 'COMMUNITY';
    return null;
}

function rewardNoteFor(notice) {
    const existing = String(notice.rewardNote || notice.surveyReward || '').trim();
    if (existing) return existing.slice(0, 120);
    const match = String(notice.content || notice.rawContent || '').replace(/\s+/g, ' ').match(REWARD_RE);
    return match ? match[0].trim().slice(0, 120) : null;
}

function buildMigration(document) {
    const canonicalKeys = new Set(CANONICAL_NOTICE_CATEGORIES.map(category => category.key));
    const categoriesAreCanonical = Array.isArray(document.categories)
        && document.categories.length === CANONICAL_NOTICE_CATEGORIES.length
        && document.categories.every(category => canonicalKeys.has(category.key));
    const alreadyMigrated = Number(document.categorySchemaVersion) >= 2
        || (categoriesAreCanonical && document.notices.every(notice =>
            Object.hasOwn(notice, 'category')
            && Object.hasOwn(notice, 'hasReward')
            && Object.hasOwn(notice, 'requiresAction')
        ));
    const oldSlugById = new Map(document.categories.map(category => [Number(category.id), category.slug]));
    const oldSlugsByNotice = new Map();
    for (const row of document.noticeCategories || []) {
        const list = oldSlugsByNotice.get(Number(row.noticeId)) || [];
        const slug = oldSlugById.get(Number(row.categoryId));
        if (slug) list.push(slug);
        oldSlugsByNotice.set(Number(row.noticeId), list);
    }

    const categories = CANONICAL_NOTICE_CATEGORIES.map((category, index) => ({
        id: index + 1,
        ...category,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }));
    const idByKey = new Map(categories.map(category => [category.key, category.id]));
    const noticeCategories = [];
    const rows = [];
    const failures = [];

    const notices = document.notices.map(notice => {
        const oldSlugs = oldSlugsByNotice.get(Number(notice.id)) || [];
        const title = String(notice.title || notice.rawTitle || '');
        const content = String(notice.content || notice.rawContent || '');
        const text = `${title}\n${content}`;
        let category = null;
        let reason = '';
        if (alreadyMigrated) {
            category = idByKey.has(notice.category) ? notice.category : null;
            reason = category ? '이미 마이그레이션됨' : '수동 분류 대기';
        } else if (oldSlugs.includes('application')) {
            category = classifyApplication(title, content);
            reason = category ? '신청 키워드 분류' : '신청 공지 수동 분류 필요';
        } else {
            category = oldSlugs.map(slug => OLD_DIRECT_MAP[slug]).find(Boolean) || inferFallback(text);
            reason = category ? '기존 주제 매핑' : '주제 근거 없음';
        }

        const isSurvey = !alreadyMigrated && oldSlugs.includes('survey');
        const rewardNote = rewardNoteFor(notice);
        const hasReward = notice.hasReward === true || isSurvey || Boolean(rewardNote);
        const requiresAction = notice.requiresAction === true
            || (!alreadyMigrated && (oldSlugs.includes('application') || isSurvey));
        if (category) {
            noticeCategories.push({
                noticeId: Number(notice.id),
                categoryId: idByKey.get(category),
                createdAt: new Date().toISOString()
            });
        } else {
            failures.push({ id: notice.id, title: notice.title, oldCategories: oldSlugs.join(', ') || '없음' });
        }
        rows.push({
            id: notice.id,
            title: String(notice.title || '').slice(0, 42),
            before: oldSlugs.join('+') || '없음',
            after: category || '분류 실패',
            action: requiresAction ? 'Y' : 'N',
            reward: hasReward ? 'Y' : 'N',
            reason
        });
        return {
            ...notice,
            category,
            categoryIds: category ? [idByKey.get(category)] : [],
            deadline: notice.deadline || null,
            hasReward,
            rewardNote,
            requiresAction,
            surveyReward: rewardNote || ''
        };
    });

    return {
        document: {
            ...document,
            version: Math.max(2, Number(document.version) || 1),
            categorySchemaVersion: 2,
            notices,
            categories,
            categoryAliases: [],
            noticeCategories
        },
        rows,
        failures
    };
}

async function rollback() {
    const index = args.indexOf('--rollback');
    const backupArg = args[index + 1];
    if (!backupArg) throw new Error('--rollback 뒤에 백업 JSON 경로가 필요합니다.');
    const backupPath = path.resolve(process.cwd(), backupArg);
    JSON.parse(await fs.readFile(backupPath, 'utf8'));
    await fs.copyFile(backupPath, dataPath);
    console.log(`복원 완료: ${backupPath} -> ${dataPath}`);
}

async function run() {
    if (mode === 'rollback') return rollback();
    const original = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const migration = buildMigration(original);
    console.table(migration.rows);
    console.log(`총 ${migration.rows.length}건 / 분류 성공 ${migration.rows.length - migration.failures.length}건 / 실패 ${migration.failures.length}건`);
    if (migration.failures.length) {
        console.log('수동 분류 필요:');
        console.table(migration.failures);
    }
    if (mode !== 'apply') {
        console.log('dry-run만 수행했습니다. 적용하려면 --apply를 사용하세요.');
        return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(path.dirname(dataPath), `automation.before-category-v2-${stamp}.json`);
    await fs.copyFile(dataPath, backupPath);
    const tempPath = `${dataPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(migration.document, null, 2), 'utf8');
    await fs.rename(tempPath, dataPath);
    console.log(`적용 완료. 백업: ${backupPath}`);
}

await run();
