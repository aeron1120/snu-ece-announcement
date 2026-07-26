# Expired Notice Visual State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마감된 공지를 회색 카드 상태와 명시적인 `마감` 배지로 구분하되 기존 가독성과 동작을 유지한다.

**Architecture:** 기존 `calcDDay()` 결과에 `isExpired` 불리언을 추가해 카드와 상세 화면이 동일한 판정 결과를 사용한다. 렌더링은 `card-expired`와 `expired` 클래스만 추가하고, 표현은 기존 `css/style.css`의 카드·태그 규칙에 인접한 최소 CSS로 구현한다.

**Tech Stack:** Vanilla JavaScript, CSS, Node.js 내장 테스트 러너, 정적 Cloudflare Pages 빌드

## Global Constraints

- 마감일 당일 23:59:59까지는 진행 중으로 처리한다.
- 빨간색은 마감 임박 상태에만 사용한다.
- 제목과 본문에는 취소선이나 낮은 불투명도를 적용하지 않는다.
- 카드 클릭, 찜, 비교, 조회, 필터 및 정렬 동작을 변경하지 않는다.
- 새로운 런타임 의존성을 추가하지 않는다.

---

### Task 1: 마감 상태 판정과 목록·상세 표현

**Files:**
- Modify: `tests/public-build.test.js`
- Modify: `js/app.js:258-266,1369-1397,1504-1510`
- Modify: `css/style.css:194-234`
- Generated: `public/js/app.js`
- Generated: `public/css/style.css`

**Interfaces:**
- Consumes: `calcDDay(deadlineStr: string | null)`
- Produces: `{ text: string, isUrgent: boolean, isD1: boolean, isExpired: boolean }`
- Produces: 목록 카드 클래스 `card-expired`
- Produces: 목록·상세 상태 배지 클래스 `expired`

- [ ] **Step 1: 정적 UI 계약의 실패 테스트 작성**

`tests/public-build.test.js`에 다음 테스트를 추가한다.

```js
test('expired notices use a neutral card and badge state in list and detail views', async () => {
    const app = await readFile('js/app.js', 'utf8');
    const css = await readFile('css/style.css', 'utf8');

    assert.match(app, /isExpired:\s*true/);
    assert.match(app, /card-expired/);
    assert.match(app, /dDay\.isExpired\s*\?\s*'expired'/);
    assert.match(css, /\.card\.card-expired\s*\{/);
    assert.match(css, /\.tags \.tag\.expired\s*\{/);
    assert.doesNotMatch(css, /\.card\.card-expired[^{]*\{[^}]*opacity\s*:/s);
    assert.doesNotMatch(css, /\.card\.card-expired[^{]*\{[^}]*text-decoration\s*:/s);
});
```

- [ ] **Step 2: 테스트를 실행해 올바르게 실패하는지 확인**

Run: `node --test tests/public-build.test.js`

Expected: FAIL because `isExpired`, `card-expired`, and `.tag.expired` do not exist.

- [ ] **Step 3: `calcDDay`에 마감 상태를 추가**

`js/app.js`의 모든 반환 객체가 `isExpired`를 포함하도록 수정한다.

```js
function calcDDay(deadlineStr) {
    if (!deadlineStr) {
        return { text: "상시", isUrgent: false, isD1: false, isExpired: false };
    }
    const dDate = new Date(deadlineStr + "T23:59:59");
    const diffDays = Math.ceil((dDate - getCurrentDate()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
        return { text: "마감", isUrgent: false, isD1: false, isExpired: true };
    }
    if (diffDays === 0) {
        return { text: "D-Day", isUrgent: true, isD1: false, isExpired: false };
    }
    if (diffDays === 1) {
        return { text: "D-1", isUrgent: true, isD1: true, isExpired: false };
    }
    if (diffDays <= 3) {
        return { text: `D-${diffDays}`, isUrgent: true, isD1: false, isExpired: false };
    }
    return { text: `D-${diffDays}`, isUrgent: false, isD1: false, isExpired: false };
}
```

- [ ] **Step 4: 목록 카드와 목록·상세 배지에 상태 클래스 연결**

목록 카드 클래스는 우선순위를 명시해 계산한다.

```js
const cardClass = dDay.isExpired
    ? "card card-expired"
    : dDay.isUrgent
        ? "card card-urgent"
        : "card";
const deadlineTagClass = dDay.isExpired
    ? 'expired'
    : dDay.isUrgent
        ? 'd-day'
        : '';
```

목록과 상세 화면의 첫 번째 태그에 동일한 `deadlineTagClass` 판정을 적용한다.

```html
<span class="tag ${deadlineTagClass}">${dDay.text}</span>
```

- [ ] **Step 5: 중립적인 마감 카드·배지 CSS 추가**

`css/style.css`의 기존 긴급 카드와 D-day 태그 규칙 옆에 다음 스타일을 추가한다.

```css
.card.card-expired {
    background-color: #f7f8fa;
    border-left-color: #8b929d;
}
.card.card-expired:hover {
    border-color: #c5c9d0;
    border-left-color: #737b87;
}
.tags .tag.expired {
    background: #e8eaee;
    color: #59616d;
}
```

- [ ] **Step 6: 집중 테스트를 실행해 통과 확인**

Run: `node --test tests/public-build.test.js`

Expected: PASS.

- [ ] **Step 7: 정적 배포 산출물 재생성 및 전체 검증**

Run:

```bash
npm run prepare:public
npm test
npm audit --omit=dev
git diff --check
```

Expected: public 소스가 원본과 동기화되고 전체 테스트 및 감사 통과.

- [ ] **Step 8: 변경 커밋**

```bash
git add js/app.js css/style.css public/js/app.js public/css/style.css tests/public-build.test.js
git commit -m "feat: distinguish expired notice cards"
```
