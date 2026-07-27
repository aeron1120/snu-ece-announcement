import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';
import { preparePublic } from '../scripts/prepare-public.mjs';

function readNamedFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    assert.fail(`${name} must have a complete body`);
}

test('preparePublic copies canonical frontend files', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'ece-public-'));
    await mkdir(path.join(rootDir, 'css'));
    await mkdir(path.join(rootDir, 'js'));
    await writeFile(path.join(rootDir, 'index.html'), '<main>ok</main>');
    await writeFile(path.join(rootDir, 'admin.html'), '<main>admin</main>');
    await writeFile(path.join(rootDir, 'css/core.css'), 'body{}');
    await writeFile(path.join(rootDir, 'css/mobile.css'), '.grid{}');
    await writeFile(path.join(rootDir, 'js/core.js'), 'window.ok=true');
    await writeFile(path.join(rootDir, 'js/mobile.js'), 'window.mobile=true');
    await writeFile(path.join(rootDir, 'js/config.js'), 'window.API_BASE_URL=""');

    await preparePublic({ rootDir });

    assert.equal(
        await readFile(path.join(rootDir, 'public/index.html'), 'utf8'),
        '<main>ok</main>'
    );
    assert.equal(
        await readFile(path.join(rootDir, 'public/admin.html'), 'utf8'),
        '<main>admin</main>'
    );
    assert.equal(
        await readFile(path.join(rootDir, 'public/js/core.js'), 'utf8'),
        'window.ok=true'
    );
    // 뷰별로 나뉜 파일이 하나라도 빠지면 그 모드가 통째로 죽는다.
    assert.equal(
        await readFile(path.join(rootDir, 'public/js/mobile.js'), 'utf8'),
        'window.mobile=true'
    );
    assert.equal(
        await readFile(path.join(rootDir, 'public/css/mobile.css'), 'utf8'),
        '.grid{}'
    );
});

test('default notice thumbnail is a square PNG copied byte-for-byte', async () => {
    const canonical = await readFile('icons/default-notice-thumbnail.png');
    const generated = await readFile('public/icons/default-notice-thumbnail.png');
    const metadata = await sharp(canonical).metadata();

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1024);
    assert.equal(metadata.height, 1024);
    assert.deepEqual(generated, canonical);
});

test('administrator surfaces live on admin.html, not the public page', async () => {
    const html = await readFile('admin.html', 'utf8');
    const publicHtml = await readFile('index.html', 'utf8');

    for (const id of [
        'review-notice-list',
        'review-editor',
        'review-pending-count',
        'panel-compose',
        'right-rail-slides-list',
        'category-candidate-list',
        'admin-gate'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /<script src="\.\/js\/admin\.js"><\/script>/);

    // 공개 화면에는 관리자 UI도, 관리자 스크립트도 실려서는 안 된다.
    for (const leaked of [
        'review-notice-list',
        'category-candidate-list',
        'post-content',
        'admin.js'
    ]) {
        assert.doesNotMatch(publicHtml, new RegExp(leaked.replace('.', '\\.')));
    }
    assert.match(publicHtml, /href="\.\/admin\.html"/);
});

test('public shell exposes brand and managed advertising rails', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    for (const id of [
        'left-brand-rail',
        'right-ad-rail',
        'right-rail-ad-content',
        'page-main'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    // 엠블럼이 없을 때 대체 워드마크는 '서울대학교'.
    assert.match(html, /class="brand-mark"[^>]*>서울대학교</);
    assert.match(html, />서울대학교 홈페이지</);
    assert.match(html, />전기정보공학부</);
    assert.match(html, />mySNU</);
    assert.match(app, /function getBannerSlidesByPlacement/);
    assert.match(app, /function renderRightRailAd/);
    assert.match(app, /getBannerSlidesByPlacement\('right_rail'\)/);
});

test('desktop rails stay pinned to the viewport while the page scrolls', async () => {
    const css = await readFile('css/desktop.css', 'utf8');

    // sticky는 부모 안에서만 붙어 있어 스크롤을 따라 올라간다. fixed여야 한다.
    assert.match(
        css,
        /html\[data-view="desktop"\] \.site-rail\s*\{[^}]*position:\s*fixed[^}]*top:\s*0[^}]*bottom:\s*0/s
    );
    assert.match(css, /html\[data-view="desktop"\] \.rail-left\s*\{[^}]*left:\s*0/s);
    assert.match(css, /html\[data-view="desktop"\] \.rail-right\s*\{[^}]*right:\s*0/s);
    // 고정된 레일이 본문을 덮지 않도록 그 폭만큼 자리를 비워둬야 한다.
    assert.match(
        css,
        /html\[data-view="desktop"\] \.page-shell\s*\{[^}]*padding-left:\s*var\(--rail-width\)[^}]*padding-right:\s*var\(--rail-width\)/s
    );
    assert.doesNotMatch(css, /position:\s*sticky/);
});

test('the public page drops the top banner, the saved-posts feature, and the refresh button', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');

    for (const gone of [
        'header-banner',
        'banner-track',
        'banner-toggle-btn',
        'btn-starred',
        'star-icon',
        'location.reload'
    ]) {
        assert.doesNotMatch(html, new RegExp(gone.replace('.', '\\.')), `${gone} must be gone from index.html`);
        assert.doesNotMatch(app, new RegExp(gone.replace('.', '\\.')), `${gone} must be gone from core.js`);
    }
    assert.doesNotMatch(css, /\.star-icon/);
    assert.doesNotMatch(app, /savedPosts|toggleSave|toggleViewMode/);

    // 새로고침은 제목 클릭으로, 알림 받기는 종 토글로 대체됐다.
    assert.match(html, /<button type="button" class="site-title" id="site-title"[^>]*onclick="reloadNoticeBoard\(\)"/);
    assert.match(html, /id="bell-toggle"[\s\S]*?aria-pressed="false"/);
    assert.match(html, /onclick="openNotificationPreferences\(\)"/);
    assert.match(app, /function reloadNoticeBoard/);
    assert.match(app, /function updateBellState/);
    assert.match(css, /\.bell-toggle\s*\{[^}]*filter:\s*grayscale\(1\)/s);
    assert.match(css, /\.bell-toggle\[aria-pressed="true"\]\s*\{[^}]*filter:\s*none/s);
});

test('layout mode is chosen before first paint and persisted per browser', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    // 인라인 부트스트랩이 CSS보다 먼저 data-view를 확정해야 화면이 깜빡이지 않는다.
    const headScriptIndex = html.indexOf("localStorage.getItem('eceLayoutMode')");
    const coreCssIndex = html.indexOf('css/core.css');
    assert.ok(headScriptIndex > 0 && headScriptIndex < coreCssIndex);

    // "모바일 모드" 버튼은 폰 미리보기를 연다(데스크탑 화면은 그대로 둔다).
    assert.match(html, /id="view-mode-toggle"[^>]*onclick="openDevicePreview\(\)"/);
    assert.match(app, /function setLayoutMode/);
    assert.match(app, /function openDevicePreview/);
    assert.match(app, /localStorage\.setItem\('eceLayoutMode', next\)/);
    // 데스크탑 모드는 좁은 기기에서도 데스크탑 폭을 강제해야 의미가 있다.
    assert.match(app, /'width=1280'/);
});

test('mobile mode opens a blurred phone preview instead of reflowing the desktop page', async () => {
    const html = await readFile('index.html', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    assert.match(html, /id="device-preview"/);
    assert.match(html, /id="device-iframe"/);
    assert.match(app, /function openDevicePreview/);
    assert.match(app, /function closeDevicePreview/);
    // iframe 은 같은 페이지를 모바일로 강제해서 띄운다.
    assert.match(app, /searchParams\.set\('view', 'mobile'\)/);
    assert.match(app, /searchParams\.set\('preview', '1'\)/);
    // 뒤 배경은 흐리게 처리한다.
    assert.match(css, /\.device-preview\s*\{[^}]*backdrop-filter:\s*blur/s);
    assert.match(css, /\.device-frame\s*\{/);
    // display:flex 가 [hidden]을 이기지 못하도록 명시적으로 숨김을 되살려야 한다.
    // (이게 없으면 로드 즉시 빈 폰이 떠서 닫히지 않는다.)
    assert.match(css, /\.device-preview\[hidden\]\s*\{[^}]*display:\s*none/s);
    assert.match(app, /function closeDevicePreview/);
    assert.match(app, /style\.display\s*=\s*'none'/);
    // 부트스트랩은 ?view=mobile 을 읽어 iframe 안을 모바일로 고정한다.
    assert.match(html, /params\.get\('view'\)/);
});

test('notice comparison is a Notion-style drag-to-block panel, not a modal', async () => {
    const html = await readFile('index.html', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    // 옛 비교 UI(하단 바·모달·목록 담기 버튼)는 사라졌다.
    assert.doesNotMatch(html, /id="compare-bar"/);
    assert.doesNotMatch(html, /id="compare-modal"/);
    assert.doesNotMatch(html, /id="compare-toggle-btn"/);
    assert.doesNotMatch(app, /function openCompareModal|function toggleCompare\b|function updateCompareBar/);

    // 오른쪽 비교 패널 + 블록.
    assert.match(html, /id="compare-panel"/);
    assert.match(html, /id="compare-blocks"/);
    assert.match(html, /ondrop="onComparePanelDrop\(event\)"/);
    assert.match(app, /function onCardDragStart/);
    assert.match(app, /function addCompareBlock/);
    assert.match(app, /function renderCompareBlocks/);
    assert.match(app, /MAX_COMPARE_BLOCKS\s*=\s*4/);
    // 카드는 데스크탑에서 드래그 가능해야 한다.
    assert.match(app, /card\.draggable = true/);
    assert.match(app, /addEventListener\('dragstart'/);
    // 담긴 블록 수에 따라 1~2열로 배치.
    assert.match(css, /\.compare-panel\[data-blocks="2"\][\s\S]*grid-template-columns:\s*1fr 1fr/);
});

test('the notice board opens a full-page detail instead of a modal', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    // 상세는 오버레이 모달이 아니라 목록을 대체하는 article 이다.
    assert.match(html, /<article class="notice-detail-view" id="notice-detail-view"/);
    assert.doesNotMatch(html, /id="detail-modal"/);
    assert.match(app, /function showDetailView/);
    assert.match(app, /function closeDetail/);
    // 상세를 열면 목록을 숨기고 주소창을 공유 링크로 바꾼다.
    const openDetail = app.slice(app.indexOf('async function openDetail'), app.indexOf('function showDetailView'));
    assert.match(openDetail, /showDetailView\(\)/);
    assert.match(openDetail, /syncUrlToNotice/);
    assert.doesNotMatch(app, /openModal\('detail-modal'\)/);
});

test('a category tab bar sits above the filters like the SNU newsroom', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    const tabsIndex = html.indexOf('id="category-tabs"');
    const filterIndex = html.indexOf('id="filter-toggle-bar"');
    assert.ok(tabsIndex > 0 && filterIndex > tabsIndex, '카테고리 탭이 필터보다 위에 있어야 한다');
    assert.match(html, /class="category-tab active"[^>]*onclick="selectCategoryTab\('all'\)"/);
    assert.match(app, /function buildCategoryTabs/);
    assert.match(app, /function selectCategoryTab/);
    // 옛 필터 패널의 카테고리 그룹은 탭으로 대체돼 사라졌다.
    assert.doesNotMatch(html, /id="fg-category"/);
});

test('the top inquiry button is gone and the banner CTA reads 배너 문의하기', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    // 헤더 액션에는 모바일 모드 버튼만 남는다(문의 버튼 제거).
    const headerActions = html.slice(html.indexOf('class="header-actions"'), html.indexOf('</div>', html.indexOf('class="header-actions"')));
    assert.doesNotMatch(headerActions, /openModal\('contact-modal'\)/);
    assert.match(html, />배너 문의하기</);
    assert.match(app, />배너 문의하기</);
});

test('the contact modal is an anonymous feedback box, not admin contact info', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');

    // 관리자 전화·카톡을 나열하던 연락처 블록은 사라졌다.
    assert.doesNotMatch(html, /admin-phone-display/);
    assert.doesNotMatch(html, /banner-admin-phone-display/);
    assert.doesNotMatch(html, /01040953346/);
    // 대신 익명 피드백 입력 상자가 있다.
    assert.match(html, /id="feedback-message"/);
    assert.match(html, /onclick="submitFeedback\(\)"/);
    assert.match(app, /function submitFeedback/);
    assert.match(app, /\/api\/feedback/);
    // 서버는 신원을 저장하지 않고 메시지만 받는다.
    assert.match(server, /app\.post\('\/api\/feedback'/);
    assert.match(server, /app\.get\('\/api\/admin\/feedback'/);
    // 익명성: 피드백 저장 객체에 IP·이름 등 식별자가 없어야 한다.
    const feedbackRoute = server.slice(server.indexOf("app.post('/api/feedback'"), server.indexOf("app.get('/api/admin/feedback'"));
    assert.doesNotMatch(feedbackRoute, /req\.ip|x-forwarded-for|headers\['user-agent'\]/i);
});

test('the compose form leads with content/photo/target, then AI fills date/subject/type', async () => {
    const html = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');

    // 원문 → 사진 → 대상 학번 → AI 분석 순서.
    const contentIdx = html.indexOf('id="post-content"');
    const imagesIdx = html.indexOf('id="post-images"');
    const targetIdx = html.indexOf('id="post-target"');
    const analyzeIdx = html.indexOf('id="ai-analyze-btn"');
    assert.ok(contentIdx > 0 && imagesIdx > contentIdx && targetIdx > imagesIdx && analyzeIdx > targetIdx);

    assert.match(html, /onclick="analyzeNotice\(\)"/);
    assert.match(admin, /async function analyzeNotice/);
    // 유형은 정해진 보기(TITLE_KINDS) 안에서만 채운다.
    assert.match(admin, /TITLE_KINDS\.includes\(parsed\.type\)/);
    // 마감일·핵심내용도 분석으로 채워지되 수정 가능한 필드에 들어간다.
    assert.match(admin, /getElementById\('post-deadline'\)\.value = parsed\.deadline/);
    assert.match(admin, /getElementById\('title-subject'\)\.value/);
    // 잡다한 설명 문구(panel-help)는 제거했다.
    assert.doesNotMatch(html, /class="panel-help"/);
});

test('rails share one bright navy and the emblem sits on it without a white circle', async () => {
    const css = await readFile('css/core.css', 'utf8');
    const html = await readFile('index.html', 'utf8');

    // 좌우 레일은 같은 --rail-bg 를 쓴다(통일).
    assert.match(css, /--rail-bg:\s*#1f3f8f/);
    // 엠블럼은 흰 원판(배경·라운드) 없이 레일 위에 그대로 얹힌다.
    const logoImg = css.slice(css.indexOf('.brand-logo-img'), css.indexOf('.brand-logo-img') + 200);
    assert.doesNotMatch(logoImg, /border-radius:\s*50%/);
    assert.doesNotMatch(logoImg, /background:\s*#fff/i);
    assert.match(html, /id="brand-logo-img"[^>]*src="\.\/icons\/snu-emblem\.png"/);
});

test('the rail shows the SNU emblem with a click-to-refresh and a graceful fallback', async () => {
    const html = await readFile('index.html', 'utf8');
    const css = await readFile('css/core.css', 'utf8');

    assert.match(html, /id="brand-logo-btn"[^>]*onclick="reloadNoticeBoard\(\)"/);
    assert.match(html, /id="brand-logo-img"[^>]*src="\.\/icons\/snu-emblem\.png"/);
    // 엠블럼 파일이 없으면 둥근 SNU 마크로 떨어진다.
    assert.match(html, /id="brand-logo-fallback"/);
    assert.match(css, /\.brand-logo-img\s*\{/);
});

test('view modules register themselves and only one is active at a time', async () => {
    const core = await readFile('js/core.js', 'utf8');
    const desktop = await readFile('js/desktop.js', 'utf8');
    const mobile = await readFile('js/mobile.js', 'utf8');

    const source = readNamedFunction(core, 'applyViewModule');
    const context = { viewModules: new Map() };
    const log = [];
    context.viewModules.set('desktop', {
        activate: () => log.push('desktop:on'),
        deactivate: () => log.push('desktop:off')
    });
    context.viewModules.set('mobile', {
        activate: () => log.push('mobile:on'),
        deactivate: () => log.push('mobile:off')
    });
    runInNewContext(
        `let activeViewModule = null; ${source}; this.applyViewModule = applyViewModule;`,
        context
    );

    context.applyViewModule('desktop');
    context.applyViewModule('mobile');
    assert.deepEqual(log, ['desktop:on', 'desktop:off', 'mobile:on']);

    assert.match(desktop, /registerViewModule\('desktop'/);
    assert.match(mobile, /registerViewModule\('mobile'/);
    // 비교 UI는 데스크탑에서만 쓴다.
    assert.match(desktop, /supportsCompare:\s*true/);
    assert.match(mobile, /supportsCompare:\s*false/);
});

test('the notice title is assembled from a fixed template instead of free text', async () => {
    const html = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');

    // 저장되는 제목은 hidden 필드이고, 사람이 채우는 건 양식 세 칸이다.
    assert.match(html, /<input type="hidden" id="post-title">/);
    for (const id of ['title-host', 'title-subject', 'title-kind', 'title-preview', 'title-manual']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }

    const composeSource = readNamedFunction(admin, 'composeNoticeTitle');
    const values = {
        'title-host': '학생회',
        'title-host-custom': '',
        'title-subject': '개강총회 참가자',
        'title-kind': '모집',
        'post-title-manual': '직접 쓴 제목'
    };
    const context = {
        document: { getElementById: id => ({ value: values[id], checked: false }) },
        isTitleManual: () => false,
        getSelectedTitleHost: () => values['title-host']
    };
    runInNewContext(`${composeSource}; this.composeNoticeTitle = composeNoticeTitle;`, context);
    assert.equal(context.composeNoticeTitle(), '[학생회] 개강총회 참가자 모집');

    values['title-subject'] = '';
    assert.equal(context.composeNoticeTitle(), '');

    // 수정 화면에서 기존 제목을 양식으로 되돌려 읽을 수 있어야 한다.
    assert.match(admin, /function applyTitleToBuilder/);
    assert.match(admin, /TITLE_KINDS/);
});

test('admin compose accepts pasted clipboard images alongside file uploads', async () => {
    const html = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');

    assert.match(html, /id="paste-dropzone"/);
    assert.match(html, /id="paste-preview"/);
    assert.match(admin, /function handleImagePaste/);
    assert.match(admin, /clipboardData/);
    assert.match(admin, /startsWith\('image\/'\)/);
    // 붙여넣은 이미지가 저장 이미지에 합쳐져야 한다.
    const saveSource = admin.slice(admin.indexOf('async function generateAIAndSave'), admin.indexOf('async function loadAdminNoticeList'));
    assert.match(saveSource, /pastedImages/);
    // 붙여넣기 패널은 제목·본문 어디서 붙여넣어도 받도록 패널 전체에 건다.
    const initSource = admin.slice(admin.indexOf('function initImagePaste'), admin.indexOf('function initImagePaste') + 400);
    assert.match(initSource, /getElementById\('panel-compose'\)/);
    assert.match(initSource, /addEventListener\('paste', handleImagePaste\)/);
});

test('right-rail image errors restore the inquiry fallback', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const fallbackSource = app.match(/function renderRightRailInquiryFallback\(\) \{[\s\S]*?\n\}/)?.[0];

    assert.ok(fallbackSource);
    assert.match(fallbackSource, /openModal\('contact-modal'\)/);
    assert.match(app, /onerror="renderRightRailInquiryFallback\(\)"/);
});

test('right-rail images retain their layout contract with and without a link', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const source = app.match(/function renderRightRailAd\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(source);

    const render = slide => {
        const container = { innerHTML: '' };
        const renderRightRailAd = new Function(
            'document', 'getBannerSlidesByPlacement', 'escapeHtml', 'renderRightRailInquiryFallback',
            `${source}; return renderRightRailAd;`
        )(
            { getElementById: () => container },
            () => [slide],
            value => String(value),
            () => { container.innerHTML = 'fallback'; }
        );
        renderRightRailAd();
        return container.innerHTML;
    };

    const linked = render({ src: 'https://example.test/linked.png', linkUrl: 'https://example.test', text: 'Linked' });
    const linkless = render({ src: 'https://example.test/linkless.png', linkUrl: '', text: 'Linkless' });

    assert.match(linked, /class="rail-ad-link"/);
    assert.match(linked, /class="rail-ad-image"/);
    assert.doesNotMatch(linkless, /class="rail-ad-link"/);
    assert.match(linkless, /class="rail-ad-image"/);
    assert.match(css, /\.rail-ad-image\s*\{[^}]*width:\s*100%[^}]*aspect-ratio:\s*9\s*\/\s*16[^}]*object-fit:\s*cover/s);
});

test('right rail chooses the smallest numeric order', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = app.match(/function getBannerSlidesByPlacement\(placement\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(source);

    const getBannerSlidesByPlacement = new Function(
        'bannerSlides',
        `${source}; return getBannerSlidesByPlacement;`
    )([
        { id: 10, placement: 'right_rail', order: '10' },
        { id: 2, placement: 'right_rail', order: '2' },
        { id: 1, placement: 'header', order: '1' }
    ]);

    assert.equal(getBannerSlidesByPlacement('right_rail')[0].id, 2);
});

test('banner manager only publishes right rail ads now that the top banner is gone', async () => {
    const html = await readFile('admin.html', 'utf8');
    const app = await readFile('js/admin.js', 'utf8');

    assert.doesNotMatch(html, /id="header-banner-slides-list"/);
    assert.match(html, /id="right-rail-slides-list"/);
    assert.match(app, /function renderBannerSection/);
    assert.match(app, /new-right_rail-description/);
    assert.match(app, /new-right_rail-link-url/);
    assert.match(app, /new-right_rail-alt-text/);
    assert.match(app, /new-right_rail-expires-at/);
    assert.match(app, /new-right_rail-name/);
    assert.match(app, /async function addNewBannerSlide\(placement\)/);
    assert.match(app, /async function moveBanner\(placement, idx, dir\)/);
});

test('banner manager omits an untouched expiry so storage preserves it', async () => {
    const app = await readFile('js/admin.js', 'utf8');
    const source = app.match(/function resolveUpdateExpiresAt\(input\) \{[\s\S]*?\n\}/)?.[0];

    assert.ok(source);
    const resolveUpdateExpiresAt = new Function(`${source}; return resolveUpdateExpiresAt;`)();
    const originalIso = '2030-04-05T06:07:08.987Z';

    assert.equal(
        resolveUpdateExpiresAt({
            value: '2030-04-05T06:07',
            dataset: {
                originalExpiresAt: originalIso,
                originalLocalValue: '2030-04-05T06:07'
            }
        }),
        ''
    );
    assert.equal(
        resolveUpdateExpiresAt({
            value: '2030-04-05T06:08',
            dataset: {
                originalExpiresAt: originalIso,
                originalLocalValue: '2030-04-05T06:07'
            }
        }),
        new Date('2030-04-05T06:08').toISOString()
    );

    const originalOffsetIso = '2030-04-05T15:07:08.987+09:00';
    assert.equal(
        resolveUpdateExpiresAt({
            value: '2030-04-05T15:07',
            dataset: {
                originalExpiresAt: originalOffsetIso,
                originalLocalValue: '2030-04-05T15:07'
            }
        }),
        ''
    );

    const updateSource = app.slice(
        app.indexOf('async function updateBannerSlide(slideId)'),
        app.indexOf('\nasync function moveBanner(', app.indexOf('async function updateBannerSlide(slideId)'))
    );
    assert.match(updateSource, /expiresAt\s*\n\s*\}\)/);
    assert.doesNotMatch(updateSource, /expiresAt:\s*expiresAt\s*\?\s*new Date\(expiresAt\)\.toISOString\(\)\s*:\s*''/);
});

test('PWA manifest and service worker include install and push contracts', async () => {
    const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
    const worker = await readFile('service-worker.js', 'utf8');

    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.icons[0].src, /app-icon\.svg$/);
    assert.match(worker, /addEventListener\('push'/);
    assert.match(worker, /showNotification/);
    assert.match(worker, /notificationclick/);
    assert.match(worker, /!APP_SHELL\.includes\(url\.pathname\)/);
});

test('service worker replaces the stale app-shell cache during activation', async () => {
    const worker = await readFile('service-worker.js', 'utf8');
    const handlers = {};
    const openedCaches = [];
    const deletedCaches = [];
    const cache = {
        async addAll() {},
        async put() {}
    };
    const context = {
        URL,
        Promise,
        fetch: async () => ({ ok: true, type: 'basic', clone() { return this; } }),
        caches: {
            async open(name) {
                openedCaches.push(name);
                return cache;
            },
            async keys() {
                return ['ece-notices-v1'];
            },
            async delete(name) {
                deletedCaches.push(name);
                return true;
            },
            async match() {
                return null;
            }
        },
        self: {
            location: { origin: 'http://localhost' },
            addEventListener(name, handler) {
                handlers[name] = handler;
            },
            async skipWaiting() {},
            clients: {
                async claim() {},
                async openWindow() {}
            }
        }
    };
    runInNewContext(worker, context);

    let installWork;
    handlers.install({ waitUntil(promise) { installWork = promise; } });
    await installWork;
    let activateWork;
    handlers.activate({ waitUntil(promise) { activateWork = promise; } });
    await activateWork;

    assert.notEqual(openedCaches[0], 'ece-notices-v1');
    assert.deepEqual(deletedCaches, ['ece-notices-v1']);
});

test('service worker loads app-shell files from the network before cached fallback', async () => {
    const worker = await readFile('service-worker.js', 'utf8');
    const handlers = {};
    const calls = [];
    const pendingWrites = [];
    const state = { networkFails: false };
    const cachedResponse = { source: 'cache' };
    const networkResponse = {
        source: 'network',
        ok: true,
        type: 'basic',
        clone() {
            return this;
        }
    };
    const cache = {
        async addAll() {},
        async put() {}
    };
    const context = {
        URL,
        Promise,
        async fetch() {
            calls.push('network');
            if (state.networkFails) throw new Error('offline');
            return networkResponse;
        },
        caches: {
            async open() {
                return cache;
            },
            async keys() {
                return [];
            },
            async delete() {
                return true;
            },
            async match() {
                calls.push('cache');
                return cachedResponse;
            }
        },
        self: {
            location: { origin: 'http://localhost' },
            addEventListener(name, handler) {
                handlers[name] = handler;
            },
            async skipWaiting() {},
            clients: {
                async claim() {},
                async openWindow() {}
            }
        }
    };
    runInNewContext(worker, context);

    const request = { method: 'GET', url: 'http://localhost/css/core.css' };
    let responseWork;
    handlers.fetch({
        request,
        respondWith(promise) {
            responseWork = promise;
        },
        waitUntil(promise) {
            pendingWrites.push(promise);
        }
    });
    assert.equal((await responseWork).source, 'network');
    assert.deepEqual(calls, ['network']);
    await Promise.all(pendingWrites);

    calls.length = 0;
    state.networkFails = true;
    handlers.fetch({
        request,
        respondWith(promise) {
            responseWork = promise;
        },
        waitUntil(promise) {
            pendingWrites.push(promise);
        }
    });
    assert.equal((await responseWork).source, 'cache');
    assert.deepEqual(calls, ['network', 'cache']);
});

test('expired notices use a neutral card and badge state in list and detail views', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const listStart = app.indexOf('function filterCards()');
    const detailStart = app.indexOf('async function openDetail');
    const compareStart = app.indexOf('function renderCompareBlocks');
    const expiredTagBinding = /dDay\.isExpired\s*\?\s*'expired'/;

    assert.match(app, /isExpired:\s*true/);
    assert.match(app, /card-expired/);
    assert.ok(listStart > 0 && detailStart > listStart && compareStart > detailStart);
    // 목록·상세·비교 블록 세 곳 모두 같은 기준으로 마감 상태를 표시해야 한다.
    assert.match(app.slice(listStart, detailStart), expiredTagBinding);
    assert.match(app.slice(detailStart, compareStart), expiredTagBinding);
    assert.match(app.slice(compareStart), expiredTagBinding);
    assert.equal((app.match(/dDay\.isExpired\s*\?\s*'expired'/g) || []).length, 3);
    assert.match(app, /dDay\.isUrgent\s*\?\s*'d-day'/);
    assert.match(css, /\.card\.card-expired\s*\{/);
    assert.match(css, /\.tags \.tag\.expired\s*\{/);
    assert.doesNotMatch(css, /\.card\.card-expired[^{]*\{[^}]*opacity\s*:/s);
    assert.doesNotMatch(css, /\.card\.card-expired[^{]*\{[^}]*text-decoration\s*:/s);
});

test('calcDDay uses calendar-day states for permanent, urgent, and expired notices', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const calendarDayDifferenceSource = app.match(/function getCalendarDayDifference\([^)]*\) \{[\s\S]*?\r?\n\}/)?.[0];
    const calcDDaySource = app.match(/function calcDDay\(deadlineStr\) \{[\s\S]*?\r?\n\}/)?.[0];
    assert.ok(calendarDayDifferenceSource);
    assert.ok(calcDDaySource);

    const onDeadlineDate = new Function(
        'getCurrentDate',
        `${calendarDayDifferenceSource}\n${calcDDaySource}; return calcDDay;`
    )(() => new Date('2026-07-27T00:00:00'));
    const followingDate = new Function(
        'getCurrentDate',
        `${calendarDayDifferenceSource}\n${calcDDaySource}; return calcDDay;`
    )(() => new Date('2026-07-28T00:00:00'));

    assert.deepEqual(onDeadlineDate(null), {
        text: '상시', isUrgent: false, isD1: false, isExpired: false
    });
    assert.equal(onDeadlineDate('2026-07-27').isUrgent, true);
    assert.equal(onDeadlineDate('2026-07-27').isExpired, false);
    assert.equal(followingDate('2026-07-27').isExpired, true);
    assert.equal(followingDate('2026-07-27').isUrgent, false);
    assert.equal(onDeadlineDate('2026-07-30').isUrgent, true);
    assert.equal(onDeadlineDate('2026-07-31').isUrgent, false);
    assert.match(calendarDayDifferenceSource, /Date\.UTC/);
});

test('deadline-status filtering excludes expired notices from urgent results', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const deadlineStatusSource = app.match(/function matchesDeadlineStatus\([^)]*\) \{[\s\S]*?\r?\n\}/)?.[0];
    assert.ok(deadlineStatusSource);
    const matchesDeadlineStatus = new Function(
        `${deadlineStatusSource}; return matchesDeadlineStatus;`
    )();

    const expired = { isUrgent: false, isExpired: true };
    assert.equal(matchesDeadlineStatus('마감임박', expired, true), false);
    assert.equal(matchesDeadlineStatus('마감됨', expired, true), true);
});

test('deadline-soon sorting renders dated notices without an undefined current-date variable', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const start = app.indexOf('function filterCards()');
    const end = app.indexOf('\nfunction navImage(', start);
    const filterCardsSource = app.slice(start, end);
    const cards = [];
    const elements = {
        searchInput: { value: '' },
        targetFilter: { value: '전체' },
        'notice-grid': {
            innerHTML: '',
            appendChild(card) {
                cards.push(card);
            }
        },
        'filter-result-count': { innerHTML: '' }
    };
    const document = {
        getElementById(id) {
            return elements[id] || null;
        },
        createElement() {
            return {};
        }
    };
    const filterCards = new Function(
        'document', 'notices', 'filterState',
        'selectedCategoryFilters', 'calcDDay', 'matchesDeadlineStatus',
        'escapeHtml', 'openDetail', 'formatDateWithWeekday', 'supportsCompare',
        `${filterCardsSource}; return filterCards;`
    )(
        document,
        [
            { id: 'later', title: 'Later deadline', deadline: '2026-07-30' },
            { id: 'sooner', title: 'Sooner deadline', deadline: '2026-07-29' }
        ],
        {
            'deadline-status': '전체', host: '전체', 'has-image': '전체',
            views: '전체', sort: '마감임박순'
        },
        new Set(),
        () => ({ text: 'D-2', isUrgent: true, isExpired: false }),
        () => true,
        value => String(value),
        () => {},
        value => String(value),
        () => false   // 비교 드래그 비활성 → 가짜 DOM에서 addEventListener 호출 안 함
    );

    assert.doesNotThrow(() => filterCards());
    assert.match(cards[0].innerHTML, /Sooner deadline/);
    assert.match(cards[1].innerHTML, /Later deadline/);
});

test('image notices lazy-load a poster; imageless notices show a big title poster', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const start = app.indexOf('function filterCards()');
    const end = app.indexOf('\nfunction navImage(', start);
    const filterCardsSource = app.slice(start, end);

    // 사진 있는 카드: 지연 로드 포스터.
    assert.match(filterCardsSource, /class="card-poster"/);
    assert.match(filterCardsSource, /data-thumbnail-src=/);
    assert.match(filterCardsSource, /notice\.thumbnailUrl\s*\|\|\s*['"]\/icons\/default-notice-thumbnail\.png['"]/);
    // 사진 없는 카드: 포스터 자리에 제목을 크게.
    assert.match(filterCardsSource, /card-poster is-text/);
    assert.match(filterCardsSource, /card-poster-title/);
    // 날짜는 요일까지, 본문 발췌는 요약을 쓴다.
    assert.match(filterCardsSource, /formatDateWithWeekday/);
    assert.match(filterCardsSource, /card-excerpt/);
});

test('notice cards are equal-height SNU-newsroom cards in the shared core layer', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');

    assert.match(css, /\.grid\s*\{[^}]*display:\s*grid/s);
    // 모든 카드가 같은 높이여야 블록 크기가 일정하다.
    assert.match(css, /\.card\s*\{[^}]*height:\s*440px/s);
    // 포스터는 고정 높이, 사진은 cover.
    assert.match(css, /\.card-poster\s*\{[^}]*height:\s*216px/s);
    assert.match(css, /\.card-img-preview\s*\{[^}]*object-fit:\s*cover/s);
    // 사진 없는 카드는 큰 제목을 보여준다.
    assert.match(css, /\.card-poster-title\s*\{[^}]*font-size:\s*24px/s);
    assert.match(css, /\.card-excerpt\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    assert.match(app, /class="notice-empty-state"/);
    assert.doesNotMatch(css, /\.grid\s*\{[^}]*column-count/s);
    // 공지 그리드의 열 수는 뷰별 파일이 정한다. core에 남아 있으면 두 모드가 서로를 덮어쓴다.
    assert.doesNotMatch(css, /(^|\})\s*\.grid\s*\{[^}]*grid-template-columns/s);
});

test('column counts live in the per-view layers, not in core', async () => {
    const desktop = await readFile('css/desktop.css', 'utf8');
    const mobile = await readFile('css/mobile.css', 'utf8');

    assert.match(desktop, /html\[data-view="desktop"\] \.grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
    assert.match(desktop, /@media \(max-width:\s*1200px\)[\s\S]*grid-template-columns:\s*repeat\(3/);
    assert.match(desktop, /@media \(max-width:\s*900px\)[\s\S]*grid-template-columns:\s*repeat\(2/);
    assert.match(mobile, /html\[data-view="mobile"\] \.grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    // 모바일에서는 고정 레일이 화면을 덮으면 안 된다.
    assert.match(mobile, /html\[data-view="mobile"\] \.rail-right\s*\{[^}]*position:\s*static/s);
});

test('notice paging loads one page at a time without duplicate summaries', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = readNamedFunction(app, 'createNoticeRepository');
    const context = {};
    runInNewContext(`${source}; this.createNoticeRepository = createNoticeRepository;`, context);
    const requestedPaths = [];
    const responses = {
        '/api/notices?page=1&limit=20': {
            notices: [{ id: 1, title: 'one' }, { id: 2, title: 'two' }],
            pagination: { page: 1, limit: 20, total: 3, totalPages: 2 }
        },
        '/api/notices?page=2&limit=20': {
            notices: [{ id: 2, title: 'two again' }, { id: 3, title: 'three' }],
            pagination: { page: 2, limit: 20, total: 3, totalPages: 2 }
        }
    };
    const repository = context.createNoticeRepository(async path => {
        requestedPaths.push(path);
        return responses[path];
    });

    await repository.loadPage(1, { replace: true });
    await repository.loadPage(2);

    assert.deepEqual(requestedPaths, [
        '/api/notices?page=1&limit=20',
        '/api/notices?page=2&limit=20'
    ]);
    assert.deepEqual(
        Array.from(repository.notices, notice => notice.id),
        [1, 2, 3]
    );
    assert.deepEqual(
        { ...repository.pagination },
        { page: 2, limit: 20, total: 3, totalPages: 2 }
    );
});

test('lazy notice detail shares an in-flight request and upgrades its summary', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = readNamedFunction(app, 'createNoticeRepository');
    const context = {};
    runInNewContext(`${source}; this.createNoticeRepository = createNoticeRepository;`, context);
    const requestedPaths = [];
    const repository = context.createNoticeRepository(async path => {
        requestedPaths.push(path);
        if (path === '/api/notices?page=1&limit=20') {
            return {
                notices: [{ id: 7, title: 'summary' }],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
            };
        }
        return {
            notice: {
                id: 7,
                title: 'summary',
                content: 'full body',
                images: ['data:image/png;base64,image']
            }
        };
    });
    await repository.loadPage(1, { replace: true });

    const [first, second] = await Promise.all([
        repository.getDetail(7),
        repository.getDetail(7)
    ]);

    assert.equal(first.content, 'full body');
    assert.equal(second, first);
    assert.equal(repository.notices[0].content, 'full body');
    assert.deepEqual(requestedPaths, [
        '/api/notices?page=1&limit=20',
        '/api/notices/7'
    ]);
});

test('notice load-more control reflects paging and loading state', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    assert.match(html, /id="notice-load-more"/);
    assert.match(html, /onclick="loadMoreNotices\(\)"/);

    const source = readNamedFunction(app, 'updateNoticePaginationUI');
    const button = { hidden: false, disabled: false };
    const status = { textContent: '' };
    const context = {
        document: {
            getElementById(id) {
                if (id === 'notice-load-more') return button;
                if (id === 'notice-load-more-status') return status;
                return null;
            }
        }
    };
    runInNewContext(`${source}; this.updateNoticePaginationUI = updateNoticePaginationUI;`, context);

    context.updateNoticePaginationUI(
        { page: 1, totalPages: 2, total: 3 },
        2,
        false
    );
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    assert.equal(status.textContent, '2 / 3');

    context.updateNoticePaginationUI(
        { page: 2, totalPages: 2, total: 3 },
        3,
        false
    );
    assert.equal(button.hidden, true);

    context.updateNoticePaginationUI(
        { page: 1, totalPages: 2, total: 3 },
        2,
        true
    );
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, true);
});

test('notice viewport loader defers thumbnails until they intersect', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = readNamedFunction(app, 'createNoticeViewportLoader');
    const observers = [];
    class FakeIntersectionObserver {
        constructor(callback, options) {
            this.callback = callback;
            this.options = options;
            this.observed = [];
            this.unobserved = [];
            observers.push(this);
        }
        observe(target) {
            this.observed.push(target);
        }
        unobserve(target) {
            this.unobserved.push(target);
        }
        disconnect() {}
        emit(target, isIntersecting = true) {
            return this.callback([{ target, isIntersecting }]);
        }
    }
    const context = {};
    runInNewContext(`${source}; this.createNoticeViewportLoader = createNoticeViewportLoader;`, context);
    const loader = context.createNoticeViewportLoader({
        IntersectionObserverCtor: FakeIntersectionObserver,
        resolveUrl: value => `https://api.example.test${value}`,
        defaultUrl: '/icons/default-notice-thumbnail.png'
    });
    const listeners = {};
    const image = {
        dataset: { thumbnailSrc: '/api/notices/7/thumbnail?v=1' },
        src: '',
        addEventListener(type, callback) {
            listeners[type] = callback;
        }
    };

    loader.observeThumbnail(image);
    assert.equal(image.src, '');
    assert.equal(observers[0].observed[0], image);

    observers[0].emit(image, false);
    assert.equal(image.src, '');

    observers[0].emit(image, true);
    assert.equal(image.src, 'https://api.example.test/api/notices/7/thumbnail?v=1');
    assert.equal(image.dataset.thumbnailSrc, undefined);
    assert.equal(observers[0].unobserved[0], image);

    listeners.error();
    assert.equal(image.src, '/icons/default-notice-thumbnail.png');
});

test('notice viewport loader guards infinite-scroll requests and has a fallback', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = readNamedFunction(app, 'createNoticeViewportLoader');
    const observers = [];
    class FakeIntersectionObserver {
        constructor(callback) {
            this.callback = callback;
            observers.push(this);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        emit(target) {
            return this.callback([{ target, isIntersecting: true }]);
        }
    }
    const context = {};
    runInNewContext(`${source}; this.createNoticeViewportLoader = createNoticeViewportLoader;`, context);
    const loader = context.createNoticeViewportLoader({
        IntersectionObserverCtor: FakeIntersectionObserver,
        resolveUrl: value => value,
        defaultUrl: '/icons/default-notice-thumbnail.png'
    });
    let resolveLoad;
    let calls = 0;
    const loadNextPage = () => {
        calls += 1;
        return new Promise(resolve => {
            resolveLoad = resolve;
        });
    };
    const sentinel = {};
    loader.observePaginationSentinel(sentinel, loadNextPage);

    observers[1].emit(sentinel);
    observers[1].emit(sentinel);
    assert.equal(calls, 1);
    resolveLoad();
    await new Promise(resolve => setImmediate(resolve));
    observers[1].emit(sentinel);
    assert.equal(calls, 2);

    const fallbackLoader = context.createNoticeViewportLoader({
        IntersectionObserverCtor: undefined,
        resolveUrl: value => value,
        defaultUrl: '/icons/default-notice-thumbnail.png'
    });
    const fallbackImage = {
        dataset: { thumbnailSrc: '/icons/default-notice-thumbnail.png' },
        src: '',
        addEventListener() {}
    };
    fallbackLoader.observeThumbnail(fallbackImage);
    assert.equal(fallbackImage.src, '/icons/default-notice-thumbnail.png');
});

test('Cloudflare scheduled worker triggers the protected crawl endpoint', async () => {
    const worker = (await import('../cloudflare/crawl-worker.js')).default;
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
    };
    try {
        const pending = [];
        worker.scheduled({}, {
            API_BASE_URL: 'https://api.example.test/',
            CRAWL_TRIGGER_SECRET: 'secret'
        }, {
            waitUntil(promise) {
                pending.push(promise);
            }
        });
        await Promise.all(pending);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'https://api.example.test/api/internal/crawl/ece-academics'
    );
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['x-crawl-secret'], 'secret');
});
