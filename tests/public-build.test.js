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
    await writeFile(path.join(rootDir, 'admin-login.html'), '<main>admin login</main>');
    await writeFile(path.join(rootDir, 'banner-inquiry.html'), '<main>banner inquiry</main>');
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
        await readFile(path.join(rootDir, 'public/admin-login.html'), 'utf8'),
        '<main>admin login</main>'
    );
    assert.equal(
        await readFile(path.join(rootDir, 'public/banner-inquiry.html'), 'utf8'),
        '<main>banner inquiry</main>'
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
        'category-candidate-list'
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
    assert.doesNotMatch(publicHtml, /admin(?:\.html|\/workspace)|관리자 페이지/);
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
    assert.match(html, /class="brand-mark"[^>]*>SNU</);
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

    // 제목은 기능 없는 표제이며, 알림 받기만 종 토글로 유지한다.
    assert.match(html, /<h1 class="site-title" id="site-title">SNU ECE 공지방<\/h1>/);
    assert.doesNotMatch(html, /제목을 누르면 새로고침|site-title-hint|reloadNoticeBoard/);
    assert.match(html, /id="bell-toggle"[\s\S]*?aria-pressed="false"/);
    assert.match(html, /onclick="openNotificationPreferences\(\)"/);
    assert.doesNotMatch(app, /function reloadNoticeBoard/);
    assert.match(app, /function updateBellState/);
    assert.doesNotMatch(css, /site-title:hover[\s\S]*text-decoration:\s*underline/);
    assert.match(css, /\.bell-toggle\s*\{[^}]*filter:\s*grayscale\(1\)/s);
    assert.match(css, /\.bell-toggle\[aria-pressed="true"\]\s*\{[^}]*filter:\s*none/s);
});

test('layout mode is chosen before first paint and follows the real viewport', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    // 인라인 부트스트랩이 CSS보다 먼저 data-view를 확정해야 화면이 깜빡이지 않는다.
    const headScriptIndex = html.indexOf("window.matchMedia('(max-width: 820px)')");
    const coreCssIndex = html.indexOf('css/core.css');
    assert.ok(headScriptIndex > 0 && headScriptIndex < coreCssIndex);

    // "모바일 모드" 버튼은 폰 미리보기를 연다(데스크탑 화면은 그대로 둔다).
    assert.match(html, /id="view-mode-toggle"[^>]*onclick="openDevicePreview\(\)"/);
    assert.match(app, /function setLayoutMode/);
    assert.match(app, /function openDevicePreview/);
    assert.match(app, /function initializeResponsiveLayout/);
    assert.match(app, /responsiveLayoutMedia\.addEventListener\('change', apply\)/);
    assert.doesNotMatch(html, /localStorage\.getItem\('eceLayoutMode'\)/);
    assert.doesNotMatch(app, /localStorage\.setItem\('eceLayoutMode'/);
    assert.doesNotMatch(app, /'width=1280'/);
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

test('notice blocks use six-dot handles and expose only left/right split targets', async () => {
    const html = await readFile('index.html', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const renderSource = readNamedFunction(app, 'renderCompareSpace');

    assert.doesNotMatch(html, /id="spatial-ar-preview"/);
    assert.match(html, /id="split-drop-overlay"/);
    assert.match(html, /data-split-side="left"/);
    assert.match(html, /data-split-side="right"/);
    assert.doesNotMatch(html, /id="compare-add-zones"/);
    assert.match(renderSource, /class="compare-empty-slot/);
    assert.match(renderSource, /data-placement="\$\{emptyPlacement\}"/);
    assert.doesNotMatch(html, /data-placement="bottom"/);
    assert.match(html, /id="compare-space"[\s\S]*id="notice-base-block"[\s\S]*id="notice-grid"/);
    assert.match(renderSource, /class="compare-col notion-block\$\{expanded/);
    assert.match(renderSource, /class="compare-col-controls"/);
    assert.doesNotMatch(renderSource, /class="compare-col-add"/);
    assert.match(renderSource, /class="compare-col-drag-handle"[^>]*draggable="true"/s);
    assert.doesNotMatch(renderSource, /<header|compare-col-head/);
    assert.doesNotMatch(renderSource, /<article[^>]*draggable=/);
    assert.match(app, /class="card-drag-handle"[^>]*draggable="true"/s);
    assert.doesNotMatch(app, /class="card-block-add"/);
    assert.match(app, /function addNoticeToCompareBlock/);
    assert.match(app, /function onNoticeSplitDragStart/);
    assert.match(app, /function onSplitDropZoneDrop/);
    assert.match(app, /function applyPendingNoticeSplit/);
    assert.match(app, /function onCompareExternalNoticeDrop/);
    assert.doesNotMatch(app, /function splitCompareBlockWithNotice/);
    assert.match(app, /compareLayoutMode = 'columns'/);
    assert.match(app, /function onCompareBlockDrop/);
    assert.match(app, /DESKTOP_MAX_COMPARE_BLOCKS\s*=\s*4/);
    assert.match(app, /MOBILE_MAX_COMPARE_BLOCKS\s*=\s*2/);
    assert.doesNotMatch(html, /id="notice-block-menu"/);
    assert.doesNotMatch(app, /function openNoticeBlockMenu/);
    assert.match(app, /function moveCompareBlock/);
    assert.doesNotMatch(css, /split-drop-dash|\.split-drop-border/);
    assert.doesNotMatch(css, /\.compare-add-zone\.is-bottom\s*\{/);
    assert.doesNotMatch(css, /\.compare-col\.is-notice-split-left::after/);
    assert.match(css, /\.split-drop-overlay\s*\{[^}]*position:\s*relative;[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(css, /\.spatial-workspace\.is-split\s*\{[^}]*display:\s*block;/s);
    assert.match(css, /\.spatial-workspace\.is-split \.compare-space-stage\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(css, /\.spatial-workspace\.is-split\[data-blocks="1"\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(css, /\.spatial-workspace\.is-split\[data-blocks="1"\]\[data-dock="right"\]\s*\{[^}]*grid-template-areas:\s*"base blocks"/s);
    assert.match(css, /\.spatial-workspace\.is-split\[data-blocks="1"\] \.notice-base-block > \.grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    assert.match(css, /\.compare-space\.is-notice-drop-active \.compare-empty-slot\s*\{[^}]*display:\s*flex;/s);
    assert.match(css, /\.compare-col-controls\s*\{[^}]*position:\s*absolute;[^}]*left:\s*-54px;[^}]*opacity:\s*0;/s);
    assert.match(css, /\.compare-col:hover > \.compare-col-controls[\s\S]*opacity:\s*1;/);
    assert.match(css, /\.compare-col\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    assert.match(css, /\.compare-col-content\s*\{[^}]*max-height:\s*none;[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
    assert.match(css, /\.compare-col-body\s*\{[^}]*max-height:\s*440px;[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.compare-col\.is-expanded \.compare-col-body\s*\{[^}]*max-height:\s*none/s);
    assert.match(renderSource, /class="compare-col-more"/);
    assert.match(renderSource, /toggleCompareBlockExpansion/);
    assert.match(renderSource, /emptyOnLeft \? `\$\{emptySlot\}\$\{blocks\}` : `\$\{blocks\}\$\{emptySlot\}`/);
    assert.doesNotMatch(app, /document\.startViewTransition/);
});

test('an established comparison closes automatically when removal would leave one block', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const removeSource = readNamedFunction(app, 'removeFromCompareBlock');
    const result = new Function(`
        let compareBlocks = ['one', 'two'];
        let compareWorkspaceOpen = true;
        let expandedCompareBlocks = new Set();
        let renderCount = 0;
        function renderCompareChange() { renderCount += 1; }
        ${removeSource}
        removeFromCompareBlock('two');
        return { compareBlocks, compareWorkspaceOpen, renderCount };
    `)();

    assert.deepEqual(result.compareBlocks, []);
    assert.equal(result.compareWorkspaceOpen, false);
    assert.equal(result.renderCount, 1);
});

test('compare blocks reorder before, after, and at the document end', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const moveCompareBlockSource = readNamedFunction(app, 'moveCompareBlock');
    const result = new Function(`
        let compareBlocks = ['one', 'two', 'three'];
        let renderCount = 0;
        function renderCompareChange() { renderCount += 1; }
        ${moveCompareBlockSource}
        moveCompareBlock('one', 'two', 'after');
        const after = [...compareBlocks];
        moveCompareBlock('three', 'two', 'before');
        const before = [...compareBlocks];
        moveCompareBlock('three', '', 'end');
        return {
            after,
            before,
            end: [...compareBlocks],
            renderCount
        };
    `)();

    assert.deepEqual(result.after, ['two', 'one', 'three']);
    assert.deepEqual(result.before, ['three', 'two', 'one']);
    assert.deepEqual(result.end, ['two', 'one', 'three']);
    assert.equal(result.renderCount, 3);
});

test('drag listeners and overlays are attached only through six-dot handles', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const renderSource = readNamedFunction(app, 'renderCompareSpace');
    const dragStartSource = readNamedFunction(app, 'onCompareBlockDragStart');

    assert.match(renderSource, /handle\.addEventListener\('dragstart'/);
    assert.doesNotMatch(renderSource, /block\.setAttribute\(['"]draggable/);
    assert.match(app, /splitHandle\.addEventListener\('dragstart'/);
    assert.match(app, /splitHandle\.addEventListener\('pointerdown'[\s\S]*suspendNoticeHoverPreview/);
    assert.match(app, /body\.classList\.add\('notice-dragging'\)/);
    assert.match(app, /body\.classList\.remove\('notice-dragging'\)/);
    assert.match(app, /noticeSplitOverlayTimer = window\.setTimeout/);
    assert.match(app, /\}, 110\);/);
    assert.match(app, /event\.dataTransfer\.setData\('text\/plain'/);
    assert.match(app, /suppressNoticeClickUntil = Date\.now\(\) \+ 300/);
    assert.doesNotMatch(app, /card\.setAttribute\(['"]draggable/);
    assert.match(dragStartSource, /event\.currentTarget\.closest\('\.compare-col'\)/);
    assert.match(dragStartSource, /createCompareDragOverlay\(block\)/);
    assert.match(dragStartSource, /setDragImage/);
    assert.match(app, /function onCompareHandlePointerDown/);
    assert.match(app, /function onCompareHandlePointerMove/);
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

test('detail and board use a lightweight transition and restore scroll', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const closeDetailSource = readNamedFunction(app, 'closeDetail');
    const showBoardSource = readNamedFunction(app, 'showBoardView');

    assert.match(app, /function runNoticeSurfaceTransition/);
    assert.doesNotMatch(app, /document\.startViewTransition/);
    assert.match(closeDetailSource, /detailHistoryPushed[\s\S]*history\.back\(\);[\s\S]*return;/);
    assert.doesNotMatch(closeDetailSource, /\.hidden\s*=/);
    assert.match(showBoardSource, /window\.scrollTo\(\{ top: boardScrollPosition/);
    assert.doesNotMatch(css, /::view-transition-|view-transition-name/);
    assert.match(css, /\.surface-entering\s*\{[^}]*animation:\s*notice-surface-in 0\.16s ease-out/s);
    assert.match(css, /\.btn:active\s*\{[^}]*scale\(0\.985\)/s);
    assert.match(css, /\.filter-btn:active,[\s\S]*\.gallery-thumb:active\s*\{[\s\S]*scale\(0\.97\)/);
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
    // 상단의 1차 카테고리 탐색을 상세 필터 안에 중복 노출하지 않는다.
    assert.doesNotMatch(html, /id="fg-category"/);
    assert.doesNotMatch(app, /function buildCategoryFilterButtons/);
    assert.doesNotMatch(app, /function toggleCategoryFilter/);
});

test('the public rail presents approved campus promotion instead of advertising language', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const schema = await readFile('server/sql/supabase-schema.sql', 'utf8');

    // 헤더 액션에는 모바일 모드 버튼만 남는다(문의 버튼 제거).
    const headerActions = html.slice(html.indexOf('class="header-actions"'), html.indexOf('</div>', html.indexOf('class="header-actions"')));
    assert.doesNotMatch(headerActions, /openModal\('contact-modal'\)/);
    assert.match(html, />홍보 신청하기</);
    assert.match(app, />홍보 신청하기</);
    assert.match(html, /class="rail-section-label">학내 홍보</);
    assert.match(html, /class="rail-section-label">문의</);
    assert.match(html, /onclick="openContactFromRail\(\)">일반 문의하기/);
    assert.match(html, /onclick="openBannerInquiryFromRail\(\)">홍보 신청하기/);
    assert.doesNotMatch(html, /class="rail-section-label">일반 문의</);
    assert.doesNotMatch(html, /class="rail-section-label">배너 문의</);
    assert.match(app, /function openBannerInquiryFromRail/);
    assert.match(app, /window\.location\.href = '\.\/banner-inquiry\.html'/);
    assert.match(app, /function getPromoTypeLabel/);
    assert.match(app, /club: '동아리'[\s\S]*project: '프로젝트'[\s\S]*council: '학생회'/);
    assert.match(schema, /create table if not exists public\.promo_slots/);
    assert.match(schema, /type text[\s\S]*title text[\s\S]*image_url text[\s\S]*link_url text[\s\S]*owner text[\s\S]*starts_at timestamptz[\s\S]*ends_at timestamptz[\s\S]*status text/);
});

test('sort chips are exposed beside result count and category tabs restore their defaults', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    assert.match(html, /class="notice-results-toolbar"/);
    assert.match(html, /data-sort="마감임박순"[\s\S]*data-sort="최신순"[\s\S]*data-sort="조회순"/);
    assert.doesNotMatch(html, /id="fg-sort"/);
    const defaults = readNamedFunction(app, 'getDefaultSortForCategory');
    assert.match(defaults, /application[\s\S]*benefits-partnerships[\s\S]*campus/);
    assert.match(app, /function selectCategoryTab[\s\S]*getDefaultSortForCategory\(value\)[\s\S]*syncNoticeSortChips/);
});

test('notice dates use one deadline, always-open, or registration presentation', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const presentation = readNamedFunction(app, 'getNoticeDatePresentation');
    const cards = readNamedFunction(app, 'renderNoticeCards');
    assert.match(presentation, /notice\.isAlwaysOpen[\s\S]*badgeText: '상시'/);
    assert.match(presentation, /dateLabel: `마감/);
    assert.match(presentation, /dateLabel: createdLabel/);
    assert.match(cards, /getNoticeDatePresentation\(notice\)/);
    assert.match(app, /diffDays === 0[\s\S]*오늘 마감/);
    assert.match(app, /return `\$\{y\}\.\$\{m\}\.\$\{d\}\(\$\{WEEKDAY_KO/);
});

test('the contact modal is an anonymous feedback box, not admin contact info', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const adminHtml = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');

    // 관리자 전화·카톡을 나열하던 연락처 블록은 사라졌다.
    assert.doesNotMatch(html, /admin-phone-display/);
    assert.doesNotMatch(html, /banner-admin-phone-display/);
    assert.doesNotMatch(html, /01040953346/);
    // 대신 익명 피드백 입력 상자가 있다.
    assert.match(html, /id="feedback-message"/);
    assert.doesNotMatch(html, /data-feedback-category="banner"/);
    assert.match(html, /onclick="submitFeedback\(\)"/);
    assert.match(app, /function submitFeedback/);
    assert.match(app, /JSON\.stringify\(\{ message, category: activeFeedbackCategory \}\)/);
    assert.match(app, /\/api\/feedback/);
    // 서버는 신원을 저장하지 않고 메시지만 받는다.
    assert.match(server, /app\.post\('\/api\/feedback'/);
    assert.match(server, /app\.get\('\/api\/admin\/feedback'/);
    assert.match(server, /id:\s*crypto\.randomUUID\(\),\s*category,/s);
    assert.match(adminHtml, /data-feedback-filter="general"/);
    assert.match(adminHtml, /data-feedback-filter="banner"/);
    assert.match(admin, /function setAdminFeedbackFilter/);
    assert.match(admin, /item\.category === 'banner'/);
    // 익명성: 피드백 저장 객체에 IP·이름 등 식별자가 없어야 한다.
    const feedbackRoute = server.slice(server.indexOf("app.post('/api/feedback'"), server.indexOf("app.get('/api/admin/feedback'"));
    assert.doesNotMatch(feedbackRoute, /req\.ip|x-forwarded-for|headers\['user-agent'\]/i);
});

test('AI summaries disclose their limits and can be reported for admin review', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const adminHtml = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');
    const guide = await readFile('service-guide.html', 'utf8');
    const prepare = await readFile('scripts/prepare-public.mjs', 'utf8');

    assert.match(html, />AI 3줄 요약</);
    assert.doesNotMatch(html, /Gemini AI 3줄 요약/);
    assert.match(html, /원문 확인 필수/);
    assert.match(html, /요약이 원문과 다릅니다/);
    assert.match(html, /href="\.\/service-guide\.html">서비스 안내/);
    assert.match(app, /function reportSummaryMismatch/);
    assert.match(app, /\/summary-report/);
    assert.match(app, /compare-summary-heading[\s\S]*원문 확인 필수/);
    assert.match(server, /app\.post\('\/api\/notices\/:id\/summary-report', feedbackLimiter/);
    assert.match(server, /category: 'summary_mismatch'/);
    assert.match(adminHtml, /data-feedback-filter="summary_mismatch"/);
    assert.match(admin, /isSummaryMismatch/);
    assert.match(guide, /AI 3줄 요약은 공지의 핵심을 빠르게 훑기 위한 참고 정보/);
    assert.match(guide, /원문의 내용이 우선/);
    assert.match(prepare, /service-guide\.html/);
});

test('banner inquiries use a dedicated identified submission page and protected admin image access', async () => {
    const html = await readFile('banner-inquiry.html', 'utf8');
    const app = await readFile('js/banner-inquiry.js', 'utf8');
    const css = await readFile('css/banner-inquiry.css', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');

    assert.match(html, /id="banner-inquiry-form"/);
    assert.match(html, /id="inquiry-name"[^>]*required/);
    assert.match(html, /id="inquiry-organization"[^>]*required/);
    assert.match(html, /id="inquiry-type"[^>]*required/);
    assert.match(html, /id="inquiry-image"[^>]*type="file"/);
    assert.match(html, /세로형 9 : 16/);
    assert.match(html, /개인정보 수집 및 이용/);
    assert.match(app, /application\/vnd\.ece-banner\+json/);
    assert.match(app, /\/api\/banner-inquiries/);
    assert.match(app, /function validateBannerInquiry/);
    assert.match(server, /app\.post\('\/api\/banner-inquiries', bannerInquiryJson/);
    assert.match(server, /category: 'banner'/);
    assert.match(server, /bannerInquiryImageDir/);
    assert.match(server, /imageFileName/);
    assert.match(server, /status: 'pending'/);
    assert.match(server, /await createBannerSlide\(normalizeBannerPayload/);
    assert.match(server, /app\.get\('\/api\/admin\/feedback\/:id\/image', requireNoticeAdmin/);
    assert.match(admin, /function openBannerInquiryImage/);
    assert.match(admin, /class="banner-inquiry-details"/);
    assert.match(css, /\.inquiry-layout\s*\{[^}]*grid-template-columns:/s);
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
    // AI 마감일은 후보로만 보여주고 관리자가 적용해야 입력란에 들어간다.
    assert.match(admin, /aiDeadlineCandidate = parsed\.deadline/);
    assert.match(admin, /function applyAiDeadlineCandidate/);
    assert.doesNotMatch(admin, /getElementById\('post-deadline'\)\.value = parsed\.deadline/);
    assert.match(admin, /getElementById\('title-subject'\)\.value/);
    // 잡다한 설명 문구(panel-help)는 제거했다.
    assert.doesNotMatch(html, /class="panel-help"/);
});

test('public category tabs keep the canonical application-to-governance order', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const categoryConfig = await readFile('server/config/notice-categories.js', 'utf8');
    const orderSource = app.match(/const NOTICE_CATEGORY_ORDER = Object\.freeze\(\[[\s\S]*?\]\);/)?.[0] || '';

    assert.match(orderSource, /'application'[\s\S]*'academics'[\s\S]*'benefits-partnerships'[\s\S]*'campus'[\s\S]*'governance'/);
    assert.match(categoryConfig, /신청[\s\S]*학사[\s\S]*혜택\/제휴[\s\S]*캠퍼스[\s\S]*자치/);
    assert.match(server, /canonicalSlugs[\s\S]*categories\.filter/);
    assert.match(app, /function orderedNoticeCategories/);
});

test('manual Gemini analysis saves canonical category ids with the notice', async () => {
    const admin = await readFile('js/admin.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const schema = await readFile('server/sql/supabase-schema.sql', 'utf8');

    assert.match(admin, /"categorySlugs":\["application\|academics\|benefits-partnerships\|campus\|governance/);
    assert.match(admin, /가능한 한 핵심 범주 하나만 선택/);
    assert.match(admin, /categoryIds:\s*categorySlugs/);
    assert.match(admin, /const newNoticeData = \{[\s\S]*categoryIds,/);
    assert.match(server, /const categoryIds = Array\.from\(new Set/);
    assert.match(schema, /notice_payload \? 'categoryIds'[\s\S]*insert into public\.notice_categories/);
});

test('admin AI work shows progress while login is isolated in a server-session page', async () => {
    const html = await readFile('admin.html', 'utf8');
    const loginHtml = await readFile('admin-login.html', 'utf8');
    const loginApp = await readFile('js/admin-login.js', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');

    assert.match(html, /id="ai-progress-bar"/);
    assert.match(html, /id="ai-progress-percent"/);
    for (const step of ['prepare', 'analyze', 'process', 'save']) {
        assert.match(html, new RegExp(`data-ai-step="${step}"`));
    }
    assert.match(admin, /beginAiProgress\('공지 원문을 준비하고 있습니다\.'/);
    assert.match(admin, /updateAiProgress\(18, 'Gemini가 원문을 분석하고 있습니다\.'/);
    assert.match(admin, /finishAiProgress\('Gemini 분석이 완료되었습니다\.'/);

    assert.doesNotMatch(html, /id="admin-gate"|id="admin-gate-password"/);
    assert.match(loginHtml, /id="admin-login-password"[^>]*value=""/);
    assert.match(loginHtml, /autocomplete="current-password"/);
    assert.match(loginApp, /\/api\/admin\/session/);
    assert.match(loginApp, /location\.replace\(getAdminWorkspaceUrl\(\)\)/);
    assert.doesNotMatch(admin, /sessionStorage\.getItem\('eceNoticeAdminToken'\)/);
    assert.doesNotMatch(admin, /function submitAdminGate/);
});

test('Gemini quota errors show only a retry countdown and admin mode has one exit control', async () => {
    const html = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');

    assert.match(server, /code:\s*'GEMINI_RATE_LIMIT'/);
    assert.match(server, /retryAfterSeconds/);
    assert.match(admin, /function showGeminiRetryCountdown/);
    assert.match(admin, /분당 호출 초과로 \$\{remaining\}초 뒤에 다시 실행 부탁드립니다\./);
    assert.match(admin, /isGeminiRateLimitError\(error\)/);
    assert.match(html, /id="admin-mode-exit"[^>]*onclick="exitAdminMode\(\)"/);
    assert.match(html, />관리자 모드 나가기<\/button>/);
    assert.doesNotMatch(html, /id="admin-logout"|>로그아웃<|공개 화면으로/);
    assert.match(admin, /getElementById\('admin-mode-exit'\)\.textContent = '관리자 모드 나가기'/);
    assert.match(admin, /async function exitAdminMode\(\)[\s\S]*fetch\('\/api\/admin\/session', \{ method: 'DELETE' \}\)[\s\S]*location\.replace\('\.\/index\.html'\)/);
});

test('automatic ECE crawling feeds a live review inbox and original text is black', async () => {
    const html = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');
    const crawler = await readFile('server/services/ece-crawler.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');

    assert.match(crawler, /store\.createPendingNotice\(/);
    assert.match(html, /자동 수집되어 이 검수함에 들어오며/);
    assert.match(admin, /function startReviewInboxPolling\(\)/);
    assert.match(admin, /loadReviewNotices\(\{ quiet: true \}\)/);
    assert.match(admin, /60_000/);
    assert.match(css, /\.original-text-content\s*\{[^}]*color:\s*#111111/s);
    assert.match(css, /\.compare-col-content\s*\{[^}]*color:\s*#111111/s);
});

test('Kakao backfill is previewed and human-edited before entering the review inbox', async () => {
    const html = await readFile('admin.html', 'utf8');
    const admin = await readFile('js/admin.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const parser = await readFile('server/services/kakao-backfill.js', 'utf8');
    const schema = await readFile('server/sql/supabase-schema.sql', 'utf8');

    assert.match(html, /data-tab="backfill"/);
    assert.match(html, /id="kakao-backfill-file"/);
    assert.match(html, /id="kakao-backfill-rows"/);
    assert.match(admin, /function previewKakaoBackfill/);
    assert.match(admin, /function importKakaoBackfill/);
    assert.match(server, /express\.raw\([\s\S]*text\/plain/);
    assert.match(server, /\/api\/admin\/backfill\/kakao\/preview/);
    assert.match(server, /\/api\/admin\/backfill\/kakao\/import/);
    assert.match(server, /analysisStatus: 'backfill_draft'/);
    assert.match(parser, /raw\.split\('\\r\\n'\)/);
    assert.match(parser, /Math\.abs\(sentAtMs - Date\.parse\(candidate\.latestSentAt\)\) <= 30 \* DAY_MS/);
    assert.match(schema, /source_group text/);
    assert.match(schema, /thread_key text/);
});

test('image-only notices can add private OCR search text from the review inbox', async () => {
    const admin = await readFile('js/admin.js', 'utf8');
    const server = await readFile('server/server.js', 'utf8');
    const store = await readFile('server/storage/automation-store.js', 'utf8');
    const schema = await readFile('server/sql/supabase-schema.sql', 'utf8');

    assert.match(admin, /function runReviewOcr/);
    assert.match(admin, /OCR 결과는 검색 인덱스에만 저장되며 공개 원문에는 표시되지 않습니다/);
    assert.match(server, /\/api\/admin\/review-notices\/:id\/ocr/);
    assert.match(server, /visibleText\.length >= 15/);
    assert.match(server, /\$\{notice\.title\} \$\{notice\.content\} \$\{ocrText\}/);
    assert.match(store, /ocrText: 'ocr_text'/);
    assert.match(schema, /ocr_text text/);
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
    const app = await readFile('js/core.js', 'utf8');

    assert.match(html, /id="brand-logo-btn"[^>]*onclick="goHomeAndReload\(\)"/);
    assert.match(html, /id="brand-logo-img"[^>]*src="\.\/icons\/snu-emblem\.png"/);
    assert.match(html, /class="brand-university-name">서울대학교<\/p>/);
    assert.match(app, /function goHomeAndReload\(\)[\s\S]*location\.assign\(window\.location\.pathname\)/);
    // 엠블럼 파일이 없으면 둥근 SNU 마크로 떨어진다.
    assert.match(html, /id="brand-logo-fallback"/);
    assert.match(css, /\.brand-logo-img\s*\{/);
    assert.match(css, /\.brand-university-name\s*\{/);
});

test('the left rail labels related pages and shows a full live clock', async () => {
    const html = await readFile('index.html', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const app = await readFile('js/core.js', 'utf8');

    assert.match(html, /class="rail-section-label">관련 페이지</);
    assert.match(
        html,
        /id="left-brand-rail"[^>]*draggable="false"[^>]*ondragstart="return false"/s
    );
    assert.match(
        css,
        /\.brand-rail,\s*\.brand-rail \*\s*\{[^}]*-webkit-user-drag:\s*none;[^}]*user-select:\s*none;/s
    );
    assert.match(html, /id="rail-clock-time"/);
    assert.match(html, /id="rail-clock-date"/);
    assert.match(css, /\.rail-clock\s*\{[^}]*margin-top:\s*auto/s);
    assert.match(app, /function updateRailClock/);
    assert.match(app, /second:\s*'2-digit'/);
    assert.match(app, /weekday:\s*'long'/);
    assert.match(app, /setInterval\(updateRailClock,\s*1000\)/);
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
    assert.match(mobile, /supportsCompare:\s*true/);
    assert.match(desktop, /handleNoticeCardArrowKey\(event\)/);
    assert.match(mobile, /handleNoticeCardArrowKey\(event\)/);
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
    assert.match(fallbackSource, /openBannerInquiryFromRail\(\)/);
    assert.match(app, /onerror="renderRightRailInquiryFallback\(\)"/);
});

test('right-rail banners start randomly, auto-rotate, and keep manual arrows directly below the image', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const desktopCss = await readFile('css/desktop.css', 'utf8');
    assert.match(app, /function renderRightRailAd\(\{ restartRotation = true, transitionDirection = 0 \} = \{\}\)/);
    assert.match(app, /slide\.linkUrl[\s\S]*class="rail-ad-link\b/);
    assert.match(app, /class="rail-ad-image"/);
    assert.match(app, /getBannerSlidesByPlacement\('right_rail'\)\.slice\(0, 5\)/);
    assert.match(app, /Math\.floor\(Math\.random\(\) \* slides\.length\)/);
    assert.match(app, /function stepRightRailBanner/);
    assert.match(app, /이전 배너[\s\S]*&lt;[\s\S]*다음 배너[\s\S]*&gt;/);
    assert.match(app, /function startBannerRotation/);
    assert.match(app, /setInterval\([\s\S]*6500\)/);
    assert.match(app, /class="rail-ad-image-stage\$\{transitionClass\}"[\s\S]*\$\{imageContent\}[\s\S]*\$\{controls\}/);
    assert.doesNotMatch(app, /class="rail-ad-dot/);
    assert.match(css, /\.rail-ad-image\s*\{[^}]*width:\s*100%[^}]*height:\s*min\(58vh,\s*560px\)[^}]*object-fit:\s*contain/s);
    assert.match(css, /\.rail-ad-controls\s*\{[^}]*grid-template-columns:\s*34px 1fr 34px/s);
    assert.match(css, /\.rail-ad-image-stage\.is-leaving-left\s*\{[^}]*translateX\(-42px\)/s);
    assert.match(css, /\.rail-ad-image-stage\.is-entering-right\s*\{[^}]*rail-banner-enter-right/s);
    assert.match(css, /@keyframes rail-banner-enter-left/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(app, /function transitionRightRailBanner/);
    const renderSource = readNamedFunction(app, 'renderRightRailAd');
    assert.doesNotMatch(renderSource, /slide\.description|자세히 보기|<h2>/);
    assert.match(app, /container\.innerHTML = `<div class="rail-ad-viewport">\$\{content\}<\/div>`/);
    assert.match(desktopCss, /\.rail-right\s*\{[^}]*overflow:\s*hidden/s);
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

test('campus promotion manager captures type, owner, status, and exposure period', async () => {
    const html = await readFile('admin.html', 'utf8');
    const app = await readFile('js/admin.js', 'utf8');

    assert.doesNotMatch(html, /id="header-banner-slides-list"/);
    assert.match(html, /id="right-rail-slides-list"/);
    assert.match(app, /function renderBannerSection/);
    assert.match(app, /new-right_rail-description/);
    assert.match(app, /new-right_rail-link-url/);
    assert.match(app, /new-right_rail-alt-text/);
    assert.match(app, /new-right_rail-expires-at/);
    assert.match(app, /new-right_rail-starts-at/);
    assert.match(app, /new-right_rail-type/);
    assert.match(app, /new-right_rail-owner/);
    assert.match(app, /new-right_rail-status/);
    assert.match(app, /new-right_rail-name/);
    assert.match(app, /async function addNewBannerSlide\(placement\)/);
    assert.match(app, /async function moveBanner\(placement, idx, dir\)/);
    assert.match(html, /id="banner-limit-status"/);
    assert.match(app, /previewBannerUpload/);
    assert.match(app, /최대 5개/);
    assert.match(app, /banner-image-preview/);
});

test('category tabs keep text-sized targets with evenly balanced outer and inner spacing', async () => {
    const css = await readFile('css/core.css', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    assert.match(css, /\.category-tabs-inner\s*\{[^}]*display:\s*grid;[^}]*justify-content:\s*space-evenly;[^}]*width:\s*100%/s);
    assert.match(css, /\.category-tab\s*\{[^}]*justify-content:\s*flex-start;[^}]*flex:\s*0 0 auto/s);
    assert.match(css, /\.card\.is-filter-entering\s*\{[^}]*opacity:\s*0;[^}]*translateY\(8px\)/s);
    assert.match(app, /function selectCategoryTab[\s\S]*classList\.toggle\('active', selected\)[\s\S]*filterCards\(true\)/);
    assert.doesNotMatch(readNamedFunction(app, 'selectCategoryTab'), /buildCategoryTabs\(\)/);
    assert.match(css, /\.rail-clock strong\s*\{[^}]*font-size:\s*19px/s);
    assert.match(css, /\.rail-clock span\s*\{[^}]*font-size:\s*13px/s);
});

test('desktop notice cards expose a delayed hover preview without enabling it on mobile', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const mobileCss = await readFile('css/mobile.css', 'utf8');

    assert.match(html, /id="notice-hover-preview"/);
    assert.match(app, /function queueNoticeHoverPreview/);
    assert.match(app, /\(hover: hover\) and \(pointer: fine\)/);
    assert.match(app, /\}, 620\);/);
    assert.match(app, /card\.addEventListener\('mouseenter'/);
    assert.match(app, /const previewLines = summary\.length \? summary : \[content/);
    assert.match(app, /AI 3줄 미리보기/);
    assert.match(app, /notice-hover-preview-summary-list/);
    assert.match(app, /right-ad-rail/);
    assert.match(css, /\.notice-hover-preview\s*\{[^}]*position:\s*fixed/s);
    assert.match(css, /\.notice-hover-preview-summary-list li\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    assert.match(mobileCss, /\.notice-hover-preview\s*\{\s*display:\s*none !important;/);
});

test('one fixed block keeps two base notice rows in the opposite half without a base load-more', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');
    const queueSource = readNamedFunction(app, 'queueNoticeHoverPreview');
    const dragSource = readNamedFunction(app, 'onNoticeSplitDragStart');
    const showDropSource = readNamedFunction(app, 'showSplitDropOverlay');
    const filterSource = readNamedFunction(app, 'renderNoticeCards');

    assert.doesNotMatch(html, /id="split-notice-more"|showMoreSplitNotices/);
    assert.match(queueSource, /noticeDragInProgress \|\| activeNoticeSplitDragId/);
    assert.match(dragSource, /suspendNoticeHoverPreview\(\)/);
    assert.match(dragSource, /classList\.add\('notice-dragging'\)/);
    assert.match(filterSource, /singleBlockMode[\s\S]*baseNotices\.slice\(0, 2\)/);
    assert.doesNotMatch(app, /SPLIT_NOTICE_PAGE_SIZE|showMoreSplitNotices|updateSplitNoticeMore/);
    assert.match(css, /body\.notice-dragging \.notice-hover-preview\s*\{[^}]*display:\s*none !important;/s);
    assert.doesNotMatch(css, /\.split-notice-more/);
    assert.match(showDropSource, /spatial-workspace[\s\S]*is-notice-drop-active/);
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
    const listStart = app.indexOf('function renderNoticeCards(');
    const detailStart = app.indexOf('async function openDetail');
    const compareStart = app.indexOf('function renderCompareSpace');
    const datePresentation = readNamedFunction(app, 'getNoticeDatePresentation');

    assert.match(app, /isExpired:\s*true/);
    assert.match(app, /card-expired/);
    assert.ok(listStart > 0 && detailStart > listStart && compareStart > detailStart);
    assert.match(datePresentation, /dDay\.isExpired\s*\?\s*'expired'/);
    assert.match(app.slice(listStart, detailStart), /datePresentation\.badgeClass/);
    assert.match(app.slice(detailStart, compareStart), /datePresentation\.badgeClass/);
    assert.match(app.slice(compareStart), /compare-col-kicker[\s\S]*datePresentation\.badgeText/);
    assert.match(css, /\.card\.card-expired\s*\{/);
    assert.match(css, /\.tags \.tag\.expired\s*\{/);
    assert.match(css, /\.card\.is-archived\s*\{[^}]*opacity\s*:/s);
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

test('notice filtering and sorting are requested from the server before cards render', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const filtersSource = readNamedFunction(app, 'getNoticeListFilters');
    const requestSource = readNamedFunction(app, 'filterCards');
    const renderSource = readNamedFunction(app, 'renderNoticeCards');
    assert.match(filtersSource, /sort:\s*filterState\.sort/);
    assert.match(requestSource, /loadNoticePage\(1\)/);
    assert.doesNotMatch(renderSource, /\.sort\(/);
});

test('student-year preference is optional, asked once, and keeps out-of-target notices visible', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');

    const searchMarkup = html.slice(
        html.indexOf('<div class="search-container">'),
        html.indexOf('<!-- 고급 필터 토글 바 -->')
    );
    const filterMarkup = html.slice(
        html.indexOf('<div class="filter-panel"'),
        html.indexOf('<div class="notice-results-toolbar"')
    );
    assert.doesNotMatch(searchMarkup, /id="targetFilter"/);
    assert.match(filterMarkup, /id="targetFilter"/);
    assert.match(html, /id="student-year-modal"/);
    assert.match(html, /선택하지 않아도 모든 기능을 그대로 쓸 수 있습니다/);
    assert.match(app, /STUDENT_YEAR_PROMPTED_KEY/);
    assert.match(app, /function saveStudentYearPreference/);
    assert.match(app, /function skipStudentYearPreference/);
    assert.match(app, /preferredNotices[\s\S]*otherNotices/);
    assert.match(app, /is-outside-student-target/);
    assert.match(app, /replace\(\/\(\\d\{2\}\)학번\\s\*이상\/g, '\$1학번↑'\)/);
    assert.match(css, /\.card\.is-outside-student-target/);
});

test('image notices lazy-load a poster; imageless notices show a big title poster', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const start = app.indexOf('function renderNoticeCards(');
    const end = app.indexOf('\nfunction navImage(', start);
    const filterCardsSource = app.slice(start, end);

    // 사진 있는 카드: 지연 로드 포스터.
    assert.match(filterCardsSource, /class="card-poster"/);
    assert.match(filterCardsSource, /data-thumbnail-src=/);
    assert.match(filterCardsSource, /notice\.thumbnailUrl\s*\|\|\s*['"]\/icons\/default-notice-thumbnail\.png['"]/);
    // 사진 없는 카드: 포스터 자리에 제목을 크게.
    assert.match(filterCardsSource, /card-poster is-text/);
    assert.match(filterCardsSource, /card-poster-title/);
    assert.match(filterCardsSource, /renderPosterTitle\(rawTitle\)/);
    const posterLinesSource = readNamedFunction(app, 'posterTitleLines');
    const posterTitleLines = new Function(`${posterLinesSource}; return posterTitleLines;`)();
    assert.deepEqual(
        posterTitleLines('[화생회] WE–Meet Project 참가자 모집'),
        ['[화생회]', 'WE–Meet Project', '참가자 모집']
    );
    // 날짜 표시는 공통 규칙을, 본문 발췌는 요약을 쓴다.
    assert.match(filterCardsSource, /getNoticeDatePresentation/);
    assert.match(filterCardsSource, /card-excerpt/);
});

test('notice detail supports inline image navigation, image copying, and a shadowed body', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    const css = await readFile('css/core.css', 'utf8');

    assert.match(html, /id="detail-image-prev"[^>]*onclick="navDetailImage\(-1, event\)"/);
    assert.match(html, /id="detail-image-next"[^>]*onclick="navDetailImage\(1, event\)"/);
    assert.match(html, /id="detail-image-counter"/);
    assert.match(html, /id="viewer-copy-btn"[^>]*onclick="copyCurrentViewerImage\(event\)"/);
    assert.match(html, /id="viewer-img"[^>]*title="우클릭으로도 이미지를 복사할 수 있습니다"/s);
    assert.match(html, /class="overlay image-viewer"[^>]*role="dialog"/);
    assert.match(html, /class="image-viewer-stage"[\s\S]*ontouchstart="startImageSwipe\(event\)"[\s\S]*ontouchend="endImageSwipe\(event, 'viewer'\)"/);
    assert.match(html, /id="detail-hero"[\s\S]*ontouchend="endImageSwipe\(event, 'detail'\)"/);
    assert.match(app, /function updateDetailImage/);
    assert.match(app, /function copyCurrentViewerImage/);
    assert.match(app, /function startImageSwipe/);
    assert.match(app, /function endImageSwipe/);
    assert.match(app, /new ClipboardItem\(\{ 'image\/png': pngBlob \}\)/);
    assert.match(css, /\.original-text-box\s*\{[^}]*box-shadow:\s*0 8px 24px/s);
    assert.match(css, /\.image-viewer-toolbar\s*\{/);
    assert.match(css, /\.image-viewer-stage\s*\{/);
    assert.match(css, /\.image-viewer-action\s*,\s*\.image-viewer-close\s*\{/s);
    assert.doesNotMatch(html, /id="image-viewer-modal"[^>]*style=/);

    const source = readNamedFunction(app, 'navDetailImage');
    const result = new Function(`
        let detailImageArray = ['one', 'two', 'three'];
        let detailImageIndex = 0;
        let updates = 0;
        function updateDetailImage() { updates += 1; }
        ${source}
        navDetailImage(-1);
        const wrappedBack = detailImageIndex;
        navDetailImage(1);
        navDetailImage(1);
        return { wrappedBack, current: detailImageIndex, updates };
    `)();
    assert.deepEqual(result, { wrappedBack: 2, current: 1, updates: 3 });
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
    assert.match(css, /\.card-poster-title\s*\{[^}]*font-family:\s*'Pretendard'[^}]*font-size:\s*25px/s);
    assert.match(css, /\.card-poster-title-line\.is-host\s*\{/);
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
    assert.match(desktop, /@media \(max-width:\s*1500px\)[\s\S]*grid-template-columns:\s*repeat\(2/);
    assert.doesNotMatch(desktop, /grid-template-columns:\s*repeat\(3/);
    assert.match(mobile, /html\[data-view="mobile"\] \.grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    assert.match(mobile, /html\[data-view="mobile"\] \.category-tabs\s*\{[^}]*overflow-x:\s*hidden/s);
    assert.match(mobile, /@media \(max-width:\s*420px\)[\s\S]*\.category-tabs-inner\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*space-between/s);
    assert.doesNotMatch(mobile, /\.notice-base-block \.grid,\s*\nhtml\[data-view="mobile"\] \.compare-space-stage/);
    assert.match(mobile, /\.image-viewer-action\s*\{[^}]*min-height:\s*38px/s);
    assert.match(mobile, /\.image-viewer \.nav-btn\.left\s*\{[^}]*left:\s*8px/s);
    // 모바일에서는 고정 레일이 화면을 덮으면 안 된다.
    assert.match(mobile, /html\[data-view="mobile"\] \.rail-right\s*\{[^}]*position:\s*static/s);
});

test('notice paging loads one page at a time without duplicate summaries', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = readNamedFunction(app, 'createNoticeRepository');
    const context = { URLSearchParams };
    runInNewContext(`${source}; this.createNoticeRepository = createNoticeRepository;`, context);
    const requestedPaths = [];
    const responses = {
        '/api/notices?page=1&limit=16': {
            notices: [{ id: 1, title: 'one' }, { id: 2, title: 'two' }],
            pagination: { page: 1, limit: 16, total: 3, totalPages: 2 }
        },
        '/api/notices?page=2&limit=16': {
            notices: [{ id: 2, title: 'two again' }, { id: 3, title: 'three' }],
            pagination: { page: 2, limit: 16, total: 3, totalPages: 2 }
        }
    };
    const repository = context.createNoticeRepository(async path => {
        requestedPaths.push(path);
        return responses[path];
    });

    await repository.loadPage(1, { replace: true });
    await repository.loadPage(2);

    assert.deepEqual(requestedPaths, [
        '/api/notices?page=1&limit=16',
        '/api/notices?page=2&limit=16'
    ]);
    assert.deepEqual(
        Array.from(repository.notices, notice => notice.id),
        [1, 2, 3]
    );
    assert.deepEqual(
        { ...repository.pagination },
        { page: 2, limit: 16, total: 3, totalPages: 2 }
    );
});

test('lazy notice detail shares an in-flight request and upgrades its summary', async () => {
    const app = await readFile('js/core.js', 'utf8');
    const source = readNamedFunction(app, 'createNoticeRepository');
    const context = { URLSearchParams };
    runInNewContext(`${source}; this.createNoticeRepository = createNoticeRepository;`, context);
    const requestedPaths = [];
    const repository = context.createNoticeRepository(async path => {
        requestedPaths.push(path);
        if (path === '/api/notices?page=1&limit=16') {
            return {
                notices: [{ id: 7, title: 'summary' }],
                pagination: { page: 1, limit: 16, total: 1, totalPages: 1 }
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
        '/api/notices?page=1&limit=16',
        '/api/notices/7'
    ]);
});

test('notice pagination renders previous, numbered, and next page controls', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/core.js', 'utf8');
    assert.match(html, /id="notice-page-prev"/);
    assert.match(html, /id="notice-page-numbers"/);
    assert.match(html, /id="notice-page-next"/);
    assert.match(html, /id="notice-page-prev"[\s\S]*?&lt;<\/button>/);
    assert.match(html, /id="notice-page-next"[\s\S]*?&gt;<\/button>/);
    assert.doesNotMatch(html, /onclick="goToPreviousNoticePage\(\)">이전<\/button>/);
    assert.doesNotMatch(html, /onclick="goToNextNoticePage\(\)">다음<\/button>/);
    assert.match(app, /async function goToNoticePage/);
    assert.doesNotMatch(html, /notice-load-more|더 보기|notice-scroll-sentinel/);

    const source = readNamedFunction(app, 'updateNoticePaginationUI');
    const previous = { disabled: false };
    const next = { disabled: false };
    const numbers = { innerHTML: '' };
    const status = { textContent: '' };
    const container = { hidden: false };
    const context = {
        document: {
            getElementById(id) {
                if (id === 'notice-page-prev') return previous;
                if (id === 'notice-page-next') return next;
                if (id === 'notice-page-numbers') return numbers;
                if (id === 'notice-page-status') return status;
                if (id === 'notice-pagination') return container;
                return null;
            }
        }
    };
    runInNewContext(`${source}; this.updateNoticePaginationUI = updateNoticePaginationUI;`, context);

    context.updateNoticePaginationUI(
        { page: 3, totalPages: 8, total: 153 },
        false
    );
    assert.equal(previous.disabled, false);
    assert.equal(next.disabled, false);
    assert.equal(numbers.hidden, false);
    assert.match(numbers.innerHTML, /aria-current="page"[\s\S]*>3<\/button>/);
    assert.equal(status.textContent, '3 / 8 페이지 · 전체 153건');

    context.updateNoticePaginationUI({ page: 1, totalPages: 8, total: 153 }, true);
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, true);
    assert.match(numbers.innerHTML, /disabled/);

    context.updateNoticePaginationUI({ page: 1, totalPages: 1, total: 3 }, false);
    assert.equal(previous.hidden, true);
    assert.equal(numbers.hidden, true);
    assert.equal(next.hidden, true);

    context.updateNoticePaginationUI({ page: 1, totalPages: 0, total: 0 }, false);
    assert.equal(container.hidden, true);
    assert.equal(status.textContent, '');
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
