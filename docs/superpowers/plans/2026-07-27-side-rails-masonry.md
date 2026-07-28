# Side Rails and Masonry Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대형 데스크톱에 학교 아이덴티티형 왼쪽 레일과 관리자 등록형 오른쪽 세로 학내 홍보를 추가하고, 중앙 공지 목록을 빈 공간을 다음 카드가 채우는 다단 레이아웃으로 변경한다.

**Architecture:** 기존 `banner_slides` 모델에 표시 위치와 학내 홍보 메타데이터를 추가하되 필드가 없는 기존 데이터는 `header`로 정규화한다. 메인 페이지는 브랜드 레일·중앙 콘텐츠·학내 홍보 레일의 3열 셸을 사용하고, 1880px 미만에서는 중앙 콘텐츠만 남긴다. 공지 순서와 카드 동작은 그대로 유지하면서 CSS multi-column으로 시각적 빈 공간만 제거한다.

**Tech Stack:** Node.js 22+, Express 4, Supabase PostgreSQL, Vanilla JavaScript, HTML, CSS, Node.js 내장 테스트 러너, Cloudflare Pages 정적 빌드

## Global Constraints

- 기존 상단 배너 슬라이더를 유지한다.
- `placement`가 없는 기존 배너는 반드시 `header`로 처리한다.
- `placement` 허용값은 `header`, `right_rail` 두 개뿐이다.
- 학내 홍보 링크는 `http:` 또는 `https:` URL만 허용한다.
- 이름은 50자, 배너 텍스트는 100자, 학내 홍보 설명은 240자, 대체 텍스트는 160자로 제한한다.
- 만료일을 생략하면 저장 시점부터 7일 뒤로 설정하고, 입력한 만료일은 유효한 미래 날짜여야 한다.
- 오른쪽 레일에는 만료되지 않고 삭제되지 않은 `right_rail` 항목 중 `order`가 가장 작은 한 건만 표시한다.
- 좌우 레일은 1880px 이상에서만 보이고 `position: sticky`로 동작한다.
- 공식 서울대학교 휘장 파일을 추가하거나 복제하지 않고 임시 `SNU` 문자 마크를 사용한다.
- 공지 DOM 순서, 필터, 정렬, 카드 클릭, 찜, 비교, 조회, 마감 상태 스타일을 변경하지 않는다.
- 공지 목록은 넓은 화면 4열, 중간 화면 3열, 태블릿 2열, 모바일 1열이다.
- 새로운 런타임 의존성을 추가하지 않는다.

---

### Task 1: 배너 위치 및 학내 홍보 필드 정규화

**Files:**
- Create: `tests/banner-slide-model.test.js`
- Modify: `server/server.js:242-283,541-570,745-1015,1265-1339`
- Modify: `server/data/banner-slides.json`
- Modify: `server/sql/supabase-schema.sql:36-50`

**Interfaces:**
- Produces: `normalizeBannerPayload(body: object): NormalizedBannerPayload`
- Produces: `toClientBannerSlide(row: object): ClientBannerSlide`
- `NormalizedBannerPayload` fields: `name`, `text`, `bgStyle`, `textColor`, `src`, `order`, `placement`, `linkUrl`, `altText`, `description`, `expiresAt`
- `ClientBannerSlide` adds `placement`, `linkUrl`, `altText`, `description` to the existing response
- Consumed by: `POST /api/banner-slides`, `PUT /api/banner-slides/:id`, JSON storage, Supabase storage, Tasks 2–3

- [ ] **Step 1: 배너 정규화 실패 테스트 작성**

`tests/banner-slide-model.test.js`를 만든다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeBannerPayload,
    toClientBannerSlide
} from '../server/server.js';

test('legacy banner rows default to header and preserve new metadata', () => {
    assert.deepEqual(
        toClientBannerSlide({
            id: 7,
            name: '협찬',
            text: '학생 할인',
            bg_style: 'background:#fff;',
            text_color: '#111',
            src: null,
            order: 2,
            link_url: 'https://example.com/ad',
            alt_text: '학생 할인 학내 홍보',
            description: '이번 달 혜택'
        }),
        {
            id: 7,
            name: '협찬',
            text: '학생 할인',
            bgStyle: 'background:#fff;',
            textColor: '#111',
            src: null,
            order: 2,
            expiresAt: null,
            placement: 'header',
            linkUrl: 'https://example.com/ad',
            altText: '학생 할인 학내 홍보',
            description: '이번 달 혜택'
        }
    );
});

test('banner payload accepts only known placements and web links', () => {
    const payload = normalizeBannerPayload({
        name: '세로 학내 홍보',
        text: '가입 안내',
        placement: 'right_rail',
        linkUrl: 'https://example.com/join',
        altText: '가입 안내 포스터',
        description: '학생 대상 서비스',
        expiresAt: '2999-08-31T23:59:59+09:00',
        order: 1
    });
    assert.equal(payload.placement, 'right_rail');
    assert.equal(payload.linkUrl, 'https://example.com/join');
    assert.equal(payload.expiresAt, '2999-08-31T14:59:59.000Z');

    assert.throws(
        () => normalizeBannerPayload({ text: '학내 홍보', placement: 'footer' }),
        /표시 위치/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '학내 홍보', linkUrl: 'javascript:alert(1)' }),
        /http 또는 https/
    );
    assert.throws(
        () => normalizeBannerPayload({ text: '학내 홍보', expiresAt: 'not-a-date' }),
        /만료일/
    );
});

test('banner payload enforces text limits and requires text or image', () => {
    assert.throws(
        () => normalizeBannerPayload({ text: 'x'.repeat(101) }),
        /100자/
    );
    assert.throws(
        () => normalizeBannerPayload({ placement: 'right_rail' }),
        /텍스트 또는 이미지/
    );
});
```

- [ ] **Step 2: 테스트를 실행해 올바르게 실패하는지 확인**

Run: `node --test tests/banner-slide-model.test.js`

Expected: FAIL because `normalizeBannerPayload` is not exported and `toClientBannerSlide` lacks the new fields.

- [ ] **Step 3: 서버에 단일 정규화·검증 경로 구현**

`server/server.js`에서 라우트가 직접 필드를 조립하지 않도록 다음 순수 함수를 추가한다.

```js
function normalizeBannerPayload(body = {}) {
    const placement = String(body.placement || 'header').trim() || 'header';
    if (!['header', 'right_rail'].includes(placement)) {
        throw new TypeError('배너 표시 위치는 header 또는 right_rail이어야 합니다.');
    }

    const linkUrl = String(body.linkUrl || '').trim();
    if (linkUrl) {
        let parsed;
        try {
            parsed = new URL(linkUrl);
        } catch {
            throw new TypeError('학내 홍보 링크는 유효한 http 또는 https URL이어야 합니다.');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new TypeError('학내 홍보 링크는 http 또는 https URL이어야 합니다.');
        }
    }

    const payload = {
        name: String(body.name || '').trim(),
        text: String(body.text || '').trim(),
        bgStyle: String(body.bgStyle || '').trim(),
        textColor: String(body.textColor || '').trim(),
        src: body.src || null,
        order: Number(body.order) || 0,
        placement,
        linkUrl,
        altText: String(body.altText || '').trim(),
        description: String(body.description || '').trim(),
        expiresAt: ''
    };

    const rawExpiresAt = String(body.expiresAt || '').trim();
    if (rawExpiresAt) {
        const expiresAt = new Date(rawExpiresAt);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
            throw new TypeError('만료일은 유효한 미래 날짜여야 합니다.');
        }
        payload.expiresAt = expiresAt.toISOString();
    }

    const limits = [
        ['name', 50, '이름'],
        ['text', 100, '배너 텍스트'],
        ['description', 240, '학내 홍보 설명'],
        ['altText', 160, '대체 텍스트']
    ];
    for (const [field, max, label] of limits) {
        if (payload[field].length > max) {
            throw new TypeError(`${label}은 ${max}자 이하여야 합니다.`);
        }
    }
    if (!payload.text && !payload.src) {
        throw new TypeError('배너 텍스트 또는 이미지는 필수입니다.');
    }
    return payload;
}
```

`POST`와 `PUT` 라우트는 `normalizeBannerPayload(req.body)`를 호출하고 다음 분기로 `TypeError`를 400 응답으로 변환한다.

```js
} catch (error) {
    if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || '배너 저장 실패' });
}
```

`createBannerSlide()`와 `updateBannerSlide()`는 `payload.expiresAt`이 있으면 그 값을 사용하고, 없으면 기존과 같이 7일 뒤 ISO 시각을 만든다. `toClientBannerSlide()`는 다음 필드를 추가하고 파일·Supabase 양쪽 CRUD 및 기본 시드도 동일 필드를 저장한다.

```js
placement: row.placement || 'header',
linkUrl: row.link_url || row.linkUrl || '',
altText: row.alt_text || row.altText || '',
description: row.description || ''
```

서버 마지막 export는 다음처럼 변경한다.

```js
export { app, normalizeBannerPayload, toClientBannerSlide };
```

- [ ] **Step 4: JSON 기본 행과 Supabase 스키마를 하위 호환 방식으로 확장**

`server/data/banner-slides.json`의 기존 행에는 `"placement": "header"`, 빈 `linkUrl`, `altText`, `description`을 추가한다. `createDefaultBannerFileRows()`와 Supabase 기본 시드에도 같은 기본값을 기록한다.

`server/sql/supabase-schema.sql`의 테이블 정의에 다음 열을 넣고, 이미 생성된 테이블용 `alter table`도 바로 뒤에 추가한다.

```sql
  placement text not null default 'header'
    check (placement in ('header', 'right_rail')),
  link_url text,
  alt_text text,
  description text,
```

```sql
alter table public.banner_slides
  add column if not exists placement text not null default 'header',
  add column if not exists link_url text,
  add column if not exists alt_text text,
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'banner_slides_placement_check'
      and conrelid = 'public.banner_slides'::regclass
  ) then
    alter table public.banner_slides
      add constraint banner_slides_placement_check
      check (placement in ('header', 'right_rail'));
  end if;
end;
$$;

create index if not exists banner_slides_placement_active_order_idx
  on public.banner_slides (placement, is_deleted, "order" asc);
```

- [ ] **Step 5: 모델 테스트와 기존 서버 테스트 실행**

Run: `node --test tests/banner-slide-model.test.js tests/server-public-api.test.js`

Expected: PASS.

- [ ] **Step 6: 배너 모델 변경 커밋**

```bash
git add tests/banner-slide-model.test.js server/server.js server/data/banner-slides.json server/sql/supabase-schema.sql
git commit -m "feat: extend banner model for side rail ads"
```

---

### Task 2: 상단 배너와 오른쪽 학내 홍보의 분리 렌더링

**Files:**
- Modify: `tests/public-build.test.js`
- Modify: `index.html:28-178`
- Modify: `js/app.js:27-243,1719-1744`
- Modify: `css/style.css:31-119`

**Interfaces:**
- Consumes: `ClientBannerSlide[]` from `GET /api/banner-slides`
- Produces: `getBannerSlidesByPlacement(placement: 'header' | 'right_rail'): ClientBannerSlide[]`
- Produces: `refreshBannerDOM(): void`, rendering only `header`
- Produces: `renderRightRailAd(): void`, rendering one `right_rail` item or fallback
- Produces HTML IDs: `left-brand-rail`, `right-ad-rail`, `right-rail-ad-content`, `page-main`

- [ ] **Step 1: 레일 HTML과 분리 렌더링 계약의 실패 테스트 작성**

`tests/public-build.test.js`에 다음 테스트를 추가한다.

```js
test('desktop shell exposes brand and managed advertising rails', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/app.js', 'utf8');

    for (const id of [
        'left-brand-rail',
        'right-ad-rail',
        'right-rail-ad-content',
        'page-main'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /class="brand-mark"[^>]*>SNU</);
    assert.match(html, />서울대학교 홈페이지</);
    assert.match(html, />전기정보공학부</);
    assert.match(html, />mySNU</);
    assert.match(app, /function getBannerSlidesByPlacement/);
    assert.match(app, /function renderRightRailAd/);
    assert.match(app, /getBannerSlidesByPlacement\('header'\)/);
    assert.match(app, /getBannerSlidesByPlacement\('right_rail'\)/);
});
```

- [ ] **Step 2: 테스트를 실행해 올바르게 실패하는지 확인**

Run: `node --test tests/public-build.test.js`

Expected: FAIL because the rail IDs and placement render functions do not exist.

- [ ] **Step 3: 중앙 콘텐츠를 3열 셸로 감싸고 두 레일 마크업 추가**

`index.html`에서 기존 `.header` 바로 앞에 다음 여는 마크업을 삽입한다.

```html
<div class="page-shell">
    <aside class="site-rail brand-rail" id="left-brand-rail" aria-label="학교 바로가기">
        <div class="brand-mark" aria-label="SNU 임시 문자 마크">SNU</div>
        <p class="brand-site-name">SNU ECE<br>공지방</p>
        <nav class="brand-links" aria-label="서울대학교 관련 링크">
            <a href="https://www.snu.ac.kr/" target="_blank" rel="noopener noreferrer">서울대학교 홈페이지</a>
            <a href="https://ece.snu.ac.kr/" target="_blank" rel="noopener noreferrer">전기정보공학부</a>
            <a href="https://my.snu.ac.kr/" target="_blank" rel="noopener noreferrer">mySNU</a>
            <button type="button" onclick="openAddNotice()">공지 등록</button>
        </nav>
    </aside>

    <main class="page-main" id="page-main">
```

기존 `.header`, `.search-wrapper`, `#notice-grid` 노드는 내용과 순서를 바꾸지 않고 위 `<main>`의 자식으로 둔다. 기존 `#notice-grid` 닫는 태그 바로 뒤에는 다음 닫는 마크업과 오른쪽 레일을 삽입한다. 따라서 뒤이어 나오는 모달과 하단 비교 바는 셸 밖에 그대로 남는다.

```html
    </main>
    <aside class="site-rail ad-rail" id="right-ad-rail" aria-label="학내 홍보">
        <div id="right-rail-ad-content" aria-live="polite">
            <span class="ad-label">PROMO</span>
            <h2>배너 학내 홍보 문의</h2>
            <p>학생들에게 소식을 알릴 세로 배너를 등록해보세요.</p>
            <button class="rail-cta" type="button" onclick="openModal('contact-modal')">문의하기</button>
        </div>
    </aside>
</div>
```

- [ ] **Step 4: 배너 데이터를 위치별로 분리하고 오른쪽 한 건 렌더링**

`js/app.js`에 다음 함수를 추가하고, `refreshBannerDOM()`의 반복 대상을 `getBannerSlidesByPlacement('header')`로 바꾼다.

```js
function getBannerSlidesByPlacement(placement) {
    return bannerSlides
        .filter(slide => (slide.placement || 'header') === placement)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function renderRightRailAd() {
    const container = document.getElementById('right-rail-ad-content');
    if (!container) return;
    const slide = getBannerSlidesByPlacement('right_rail')[0];

    if (!slide) {
        container.innerHTML = `
            <span class="ad-label">PROMO</span>
            <h2>배너 학내 홍보 문의</h2>
            <p>학생들에게 소식을 알릴 세로 배너를 등록해보세요.</p>
            <button class="rail-cta" type="button" onclick="openModal('contact-modal')">문의하기</button>
        `;
        return;
    }

    const image = slide.src
        ? `<img src="${escapeHtml(slide.src)}" alt="${escapeHtml(slide.altText || slide.name || '학내 홍보 이미지')}" onerror="this.hidden=true">`
        : '';
    const content = `
        <span class="ad-label">PROMO</span>
        ${image}
        <h2>${escapeHtml(slide.text || slide.name || '학내 홍보')}</h2>
        ${slide.description ? `<p>${escapeHtml(slide.description)}</p>` : ''}
        ${slide.linkUrl ? '<span class="rail-cta">자세히 보기</span>' : ''}
    `;
    if (slide.linkUrl) {
        container.innerHTML = `<a class="rail-ad-link" href="${escapeHtml(slide.linkUrl)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
    } else {
        container.innerHTML = content;
    }
}
```

`loadBannerSlides()`, 폴링 갱신, 배너 생성·수정·삭제·재정렬 성공 지점에서 `refreshBannerDOM()`과 `renderRightRailAd()`를 함께 호출한다. `DOMContentLoaded` 초기화에서도 두 함수를 호출한다. 서버 조회가 실패하면 초기 HTML 문의 카드가 유지되도록 오류 경로에서는 컨테이너를 비우지 않는다.

- [ ] **Step 5: 1880px 대형 화면용 셸과 레일 스타일 구현**

`css/style.css`에서 `body`의 기존 최대 폭과 패딩을 `.page-main`으로 옮기고 다음 구조를 추가한다.

```css
body {
    background-color: var(--bg-color);
    margin: 0;
    color: var(--text-main);
    line-height: 1.55;
}
.page-shell {
    width: 100%;
    margin: 0 auto;
}
.page-main {
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 40px;
}
.site-rail { display: none; }

@media (min-width: 1880px) {
    .page-shell {
        max-width: 1880px;
        padding: 40px 24px;
        display: grid;
        grid-template-columns: 200px minmax(0, 1fr) 200px;
        gap: 20px;
        align-items: start;
    }
    .page-main { padding: 0; max-width: none; }
    .site-rail {
        display: flex;
        position: sticky;
        top: 40px;
        min-height: calc(100vh - 80px);
    }
}
```

브랜드 레일은 `#17408b` 배경과 흰색 텍스트, 세로 링크를 사용한다. 학내 홍보 레일은 흰색 배경, `1px` 테두리, `PROMO` 라벨을 사용한다. 학내 홍보 이미지는 `width:100%`, `aspect-ratio:9/16`, `object-fit:cover`로 표시한다. 모든 링크와 버튼에 `:focus-visible` 외곽선을 제공한다.

- [ ] **Step 6: 레일 렌더링 테스트 실행**

Run: `node --test tests/public-build.test.js`

Expected: PASS.

- [ ] **Step 7: 페이지 셸과 학내 홍보 렌더링 커밋**

```bash
git add tests/public-build.test.js index.html js/app.js css/style.css
git commit -m "feat: add desktop brand and advertising rails"
```

---

### Task 3: 관리자 화면을 위치별 배너 관리로 확장

**Files:**
- Modify: `tests/public-build.test.js`
- Modify: `index.html:255-280`
- Modify: `js/app.js:819-1033`
- Modify: `css/style.css:337-365,489-520`

**Interfaces:**
- Consumes: `bannerSlides`, `normalizeBannerPayload()` server contract
- Produces: `renderBannerSection(placement, title): void`
- Produces: `addNewBannerSlide(placement: 'header' | 'right_rail'): Promise<void>`
- Produces: location-scoped `moveBanner(placement, index, direction): Promise<void>`
- HTML IDs: `header-banner-slides-list`, `right-rail-slides-list`

- [ ] **Step 1: 관리자 구역 및 입력 필드 실패 테스트 작성**

`tests/public-build.test.js`에 다음 테스트를 추가한다.

```js
test('banner manager separates header slides from right rail ads', async () => {
    const html = await readFile('index.html', 'utf8');
    const app = await readFile('js/app.js', 'utf8');

    assert.match(html, /id="header-banner-slides-list"/);
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
```

- [ ] **Step 2: 테스트를 실행해 올바르게 실패하는지 확인**

Run: `node --test tests/public-build.test.js`

Expected: FAIL because the separate list IDs and placement-aware functions do not exist.

- [ ] **Step 3: 관리자 HTML에 두 목록 컨테이너 추가**

기존 `#banner-slides-list`를 다음 두 구역으로 교체한다.

```html
<section class="banner-placement-section" aria-labelledby="header-banner-manager-title">
    <h4 id="header-banner-manager-title">상단 배너</h4>
    <div class="banner-slides-list" id="header-banner-slides-list"></div>
</section>
<section class="banner-placement-section" aria-labelledby="right-rail-manager-title">
    <h4 id="right-rail-manager-title">오른쪽 세로 학내 홍보</h4>
    <div class="banner-slides-list" id="right-rail-slides-list"></div>
</section>
```

- [ ] **Step 4: 위치별 목록·폼 렌더러 구현**

`renderBannerList()`는 다음처럼 두 섹션을 호출한다.

```js
function renderBannerList() {
    renderBannerSection('header', '상단 배너');
    renderBannerSection('right_rail', '오른쪽 세로 학내 홍보');
}
```

`renderBannerSection(placement, title)`은 해당 위치의 슬라이드만 사용한다. 기존 항목의 수정 폼에는 공통 이름·텍스트·이미지·만료일 필드를 유지하고, `right_rail`일 때 다음 필드를 추가한다.

서버 ISO 시각을 `datetime-local` 값으로 바꾸는 함수는 브라우저 현지 시각을 보존한다.

```js
function toDateTimeLocalValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}
```

```js
const rightRailFields = placement === 'right_rail' ? `
    <textarea class="banner-input-description-${safeId}" maxlength="240"
        placeholder="짧은 학내 홍보 설명">${escapeHtml(slide.description || '')}</textarea>
    <input type="url" class="banner-input-link-${safeId}"
        value="${escapeHtml(slide.linkUrl || '')}" placeholder="https://...">
    <input type="text" class="banner-input-alt-${safeId}" maxlength="160"
        value="${escapeHtml(slide.altText || '')}" placeholder="이미지 대체 텍스트">
` : '';
```

추가 폼 ID에는 위치를 포함한다.

```js
<input type="text" id="new-${placement}-name" maxlength="50" placeholder="관리용 이름">
<input type="text" id="new-${placement}-text" maxlength="100">
<textarea id="new-${placement}-description" maxlength="240"></textarea>
<input type="url" id="new-${placement}-link-url" placeholder="https://...">
<input type="text" id="new-${placement}-alt-text" maxlength="160">
<input type="datetime-local" id="new-${placement}-expires-at">
<input type="file" id="new-${placement}-image" accept="image/*">
<button type="button" onclick="addNewBannerSlide('${placement}')">추가</button>
```

상단 배너 추가 폼에서는 설명·URL·대체 텍스트를 렌더링하지 않는다.

- [ ] **Step 5: 생성·수정·정렬 요청에 위치와 학내 홍보 메타데이터 연결**

`addNewBannerSlide(placement)`은 위치가 포함된 ID에서 값을 읽고 다음 body를 전송한다.

```js
{
    name: name || normalizedText.substring(0, 50),
    text: normalizedText,
    bgStyle: `background: ${bgColor};`,
    textColor,
    src: imageSrc,
    order: getBannerSlidesByPlacement(placement).length,
    placement,
    description,
    linkUrl,
    altText,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : ''
}
```

`updateBannerSlide(slideId)`은 기존 `prevSlide.placement || 'header'`, 이름, 만료일과 학내 홍보 필드를 보존하고 수정 입력값을 덮어쓴다. `datetime-local` 값은 요청 직전에 `new Date(value).toISOString()`으로 변환한다. `moveBanner(placement, idx, dir)`은 `getBannerSlidesByPlacement(placement)` 배열 안에서만 순서를 바꾸며, 서버 응답을 받은 뒤 전체 `bannerSlides`를 다시 저장한다. 생성·수정·삭제·정렬 후 상단 배너, 오른쪽 학내 홍보, 관리자 목록을 모두 재렌더링한다.

- [ ] **Step 6: 관리자 폼 스타일 및 모바일 줄바꿈 추가**

`css/style.css`에 `.banner-placement-section`, 제목, `textarea`, `input[type="url"]` 규칙을 추가하고, 768px 이하에서 각 입력이 `width:100%`가 되도록 한다. 위치 섹션 사이에는 `border-top`과 `padding-top`을 사용하되 새 모서리·그림자 스타일은 추가하지 않는다.

- [ ] **Step 7: 관리자 계약 테스트와 전체 프론트 테스트 실행**

Run: `node --test tests/public-build.test.js`

Expected: PASS.

- [ ] **Step 8: 관리자 학내 홍보 관리 커밋**

```bash
git add tests/public-build.test.js index.html js/app.js css/style.css
git commit -m "feat: manage banners by display placement"
```

---

### Task 4: 공지 카드 빈틈없는 다단 배치

**Files:**
- Modify: `tests/public-build.test.js`
- Modify: `js/app.js:1311-1418`
- Modify: `css/style.css:188-220,478-521`

**Interfaces:**
- Consumes: existing `filterCards()` output order and `.card` elements
- Produces: `.grid` multi-column layout
- Produces: `.notice-empty-state` full-width empty result
- No JavaScript ordering or notice card behavior changes

- [ ] **Step 1: 다단 레이아웃과 빈 상태 실패 테스트 작성**

`tests/public-build.test.js`에 다음 테스트를 추가한다.

```js
test('notice list uses masonry columns without splitting cards', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const css = await readFile('css/style.css', 'utf8');

    assert.match(css, /\.grid\s*\{[^}]*column-count:\s*4/s);
    assert.match(css, /\.card\s*\{[^}]*break-inside:\s*avoid/s);
    assert.match(css, /\.card\s*\{[^}]*margin-bottom:\s*20px/s);
    assert.match(css, /@media \(max-width:\s*1200px\)[\s\S]*column-count:\s*3/);
    assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*column-count:\s*2/);
    assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*column-count:\s*1/);
    assert.match(app, /class="notice-empty-state"/);
    assert.doesNotMatch(css, /\.grid\s*\{[^}]*display:\s*grid/s);
});
```

- [ ] **Step 2: 테스트를 실행해 올바르게 실패하는지 확인**

Run: `node --test tests/public-build.test.js`

Expected: FAIL because `.grid` still uses CSS Grid and the empty state has only inline grid styling.

- [ ] **Step 3: 공지 목록을 CSS multi-column으로 교체**

기존 `.grid` 규칙을 다음으로 바꾼다.

```css
.grid {
    column-count: 4;
    column-gap: 20px;
}
.grid .card {
    width: 100%;
    display: inline-flex;
    break-inside: avoid;
    margin: 0 0 20px;
}
.notice-empty-state {
    column-span: all;
    text-align: center;
    padding: 60px 0;
    color: var(--text-sub);
    font-size: 16px;
}

@media (max-width: 1200px) {
    .grid { column-count: 3; }
}
@media (max-width: 900px) {
    .grid { column-count: 2; }
}
@media (max-width: 768px) {
    .grid { column-count: 1; column-gap: 0; }
    .grid .card { margin-bottom: 14px; }
}
```

`.card`의 기존 `display:flex`와 충돌하지 않도록 기본 카드 규칙은 레이아웃 방향만 담당하고, `.grid .card`가 `inline-flex`로 다단 흐름에 참여하게 한다.

- [ ] **Step 4: 빈 결과 마크업을 전용 클래스로 변경**

`filterCards()`의 빈 결과 분기를 다음으로 바꾼다.

```js
if (grid.childElementCount === 0) {
    grid.innerHTML = '<div class="notice-empty-state">조건에 맞는 공지가 없습니다.</div>';
}
```

필터링과 정렬 로직, `filtered.forEach()` 순서, 카드 이벤트는 수정하지 않는다.

- [ ] **Step 5: 다단 레이아웃 테스트와 기존 마감 상태 테스트 실행**

Run: `node --test tests/public-build.test.js`

Expected: PASS, including the expired-notice and sorting regression tests.

- [ ] **Step 6: 다단 공지 배치 커밋**

```bash
git add tests/public-build.test.js js/app.js css/style.css
git commit -m "feat: pack notice cards into masonry columns"
```

---

### Task 5: 정적 산출물 동기화와 전체 회귀 검증

**Files:**
- Generated: `public/index.html`
- Generated: `public/css/style.css`
- Generated: `public/js/app.js`
- Generated: `public/js/config.js`
- Verify: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: canonical `index.html`, `css/`, `js/`, `icons/`
- Produces: Cloudflare Pages deployable `public/`

- [ ] **Step 1: 정적 산출물 재생성**

Run: `npm run prepare:public`

Expected: exit code 0 and regenerated `public/index.html`, `public/css/style.css`, `public/js/app.js`.

- [ ] **Step 2: 원본과 정적 산출물 동기화 검증**

Run:

```powershell
@(
  @('index.html', 'public/index.html'),
  @('css/style.css', 'public/css/style.css'),
  @('js/app.js', 'public/js/app.js'),
  @('js/config.js', 'public/js/config.js')
) | ForEach-Object {
  if ((Get-FileHash $_[0]).Hash -ne (Get-FileHash $_[1]).Hash) {
    throw "public mismatch: $($_[0])"
  }
}
```

Expected: no output and exit code 0.

- [ ] **Step 3: 전체 테스트 실행**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 4: 의존성 보안 감사 실행**

Run: `npm audit`

Expected: exit code 0 with zero known vulnerabilities. 네트워크 제한으로 실행 자체가 실패하면 동일 명령을 네트워크 권한으로 한 번 재시도하고 결과를 기록한다.

- [ ] **Step 5: 정적 소스와 작업 트리 검사**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only intended canonical files and generated `public/` files are modified.

- [ ] **Step 6: 정적 산출물 및 검증 커밋**

```bash
git add public/index.html public/css/style.css public/js/app.js public/js/config.js
git commit -m "build: refresh Cloudflare public assets"
```
