/* npm test 앞에 붙는 pretest 훅. server/data는 커밋하지 않으므로 새로 받은
   저장소나 CI에는 파일 모드가 읽을 기본 파일이 없다. 그대로 두면 관리자
   화면을 다루는 테스트가 코드와 무관하게 무더기로 실패한다.

   이미 있는 파일과 이미 들어 있는 공지는 건드리지 않으므로, 손에 든 데이터를
   덮어쓸 걱정 없이 몇 번을 돌려도 된다. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureFileStorageSeed } from '../server/server.js';

const noticesPath = path.join(process.cwd(), 'server', 'data', 'notices.json');

/* defaultNotices가 비어 있어서 갓 만든 저장소에는 공지가 한 건도 없다. 공개
   목록에서 공지 하나를 집어 쓰는 테스트가 있으므로 표본을 하나 넣어 둔다.
   마감일을 넉넉히 미래로 두어야 수명 계산에서 '마감'으로 걸러지지 않는다. */
function sampleNotice() {
    const deadline = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return {
        id: 1,
        title: '[테스트] 공개 목록이 비어 있지 않도록 두는 표본 공지',
        content: '테스트 픽스처입니다. server/data가 비어 있을 때만 만들어집니다.',
        target: '전체',
        host: '기타',
        deadline: deadline.toISOString().slice(0, 10),
        aiSummary: ['테스트 픽스처'],
        images: [],
        views: 0
    };
}

async function ensureOneNotice() {
    let stored = [];
    try {
        const parsed = JSON.parse(await readFile(noticesPath, 'utf8'));
        if (Array.isArray(parsed)) stored = parsed;
    } catch {
        // 파일이 없거나 깨졌으면 아래에서 새로 쓴다.
    }

    if (stored.length > 0) return;
    await writeFile(noticesPath, JSON.stringify([sampleNotice()], null, 2), 'utf-8');
}

await ensureFileStorageSeed();
await ensureOneNotice();

// server.js를 불러오는 것만으로 express 앱과 정리용 setInterval이 생겨
// 이벤트 루프가 비지 않는다. 할 일은 끝났으니 여기서 끊는다.
process.exit(0);
