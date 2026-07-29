/* 사용 설명서 튜토리얼.

   문서를 읽히는 대신 실제 화면 위에서 한 기능씩 짚는다. 설명하는 자리만
   남기고 나머지는 어둡게 덮으므로 시선이 흩어지지 않는다.

   안내 중에는 아래 화면을 누를 수 없다. 서랍이 열리거나 공지 상세로
   넘어가 버리면 다음에 짚을 자리가 화면에서 사라져 안내가 끊기기 때문이다.
   덮개가 클릭을 모두 받아내고, 사용자는 카드의 이전·다음으로만 움직인다.

   단계마다 target으로 가리킬 곳을 정한다. 그 자리가 화면에 없으면
   (데스크탑 전용 버튼을 모바일에서 볼 때 같은 경우) 그 단계는 조용히 건너뛴다.
   덕분에 데스크탑과 모바일이 한 벌의 단계 목록을 함께 쓴다. */

(function () {
    'use strict';

    const TUTORIAL_SEEN_KEY = 'eceTutorialSeen';
    const RING_PADDING = 8;
    const CARD_GAP = 14;
    const EDGE = 12;
    const MOVE_MS = 420;

    /* hint를 적으면 카드 아래에 한 줄 덧붙는다. */
    const STEPS = [
        {
            target: '.search-container',
            title: '검색으로 시작하세요',
            body: '제목과 본문을 함께 찾습니다. 글자를 입력하는 즉시 아래 목록이 걸러지니 검색 버튼을 따로 누를 필요는 없습니다.',
            hint: '안내를 보는 동안에는 화면이 잠깁니다'
        },
        {
            target: '#search-guide-btn',
            title: '이 안내는 언제든 다시',
            body: '검색은 입력만으로 걸리기 때문에 돋보기 자리는 설명서 입구로 씁니다. 길을 잃으면 여기를 누르세요.'
        },
        {
            target: '.mobile-menu-btn',
            title: '왼쪽 위 손잡이',
            body: '목록을 조금 내리면 나타납니다. 누르면 카테고리와 바로가기 서랍이 열리고, 잠시 두면 다시 숨어 화면을 가리지 않습니다.',
            /* 이 손잡이는 가만두면 스스로 숨는다. 설명하는 동안에는 계속
               보이도록 붙잡아 두었다가, 단계를 떠날 때 손을 뗀다. */
            onEnter(target) {
                const hold = window.setInterval(() => target.classList.add('is-visible'), 600);
                target.classList.add('is-visible');
                return () => window.clearInterval(hold);
            }
        },
        {
            target: '#category-tabs',
            title: '카테고리로 나눠 보기',
            body: '학사·기회·혜택·커뮤니티로 갈라 봅니다. 기회와 혜택은 마감이 급한 순서로, 학사와 커뮤니티는 최신 순서로 자동 정렬됩니다.'
        },
        {
            target: '#notice-quick-filters',
            title: '자주 쓰는 조건은 한 번에',
            body: '마감 임박, 리워드 있음, 신청 필요, 마감을 바로 켜고 끕니다. 여러 개를 함께 켜면 모두 만족하는 공지만 남습니다.'
        },
        {
            target: '#filter-toggle-bar',
            title: '더 좁히고 싶다면',
            body: '학년, 대상, 등록 기간, 조회수까지 상세 조건을 펼쳐 고를 수 있습니다. 켜 둔 조건은 이 줄에 칩으로 남아 한눈에 보입니다.'
        },
        {
            target: '#notice-sort-chips',
            title: '정렬 바꾸기',
            body: '최신순, 마감임박순, 조회순 중에 고릅니다. 마감임박순에서 마감일이 없는 공지는 맨 뒤로 갑니다.'
        },
        {
            target: '#notice-grid .card',
            title: '공지 열어보기',
            body: '카드를 누르면 원문, 첨부파일, AI 3줄 요약을 함께 봅니다. 요약은 참고용이고 판단은 언제나 원문이 기준입니다.'
        },
        {
            target: '#notice-grid .card .card-drag-handle, #notice-grid .card',
            title: '끌어서 나란히 비교',
            body: '카드 왼쪽 위 6점 손잡이를 잡아 왼쪽이나 오른쪽에 놓으면 공지를 나란히 펼쳐 비교합니다. 아래 휴지통에 놓으면 비교에서 뺍니다.',
            desktopOnly: true,
            /* 손잡이는 카드에 마우스를 올려야 나타난다. 설명하는 동안에는
               가리키는 것이 눈에 보여야 하므로 붙잡아 둔다. */
            onEnter(target) {
                const holder = target.closest('.card')?.querySelector('.card-block-controls');
                holder?.classList.add('is-tutorial-shown');
                return () => holder?.classList.remove('is-tutorial-shown');
            }
        },
        {
            target: '#right-ad-rail',
            title: '학내 홍보',
            body: '학생 단체와 학내 행사 홍보가 도는 자리입니다. 검수를 거친 항목만 정해진 기간 동안 걸립니다.'
        },
        {
            target: '.footer-column[aria-label="문의"]',
            title: '문의와 홍보 신청',
            body: '개선 의견은 익명으로 보낼 수 있고, 홍보 신청은 양식을 내면 검수 뒤 배너로 올라갑니다. 자주 묻는 질문도 여기 있습니다.'
        },
        {
            target: '#footer-sync',
            title: '언제 가져온 공지인지',
            body: '마지막으로 학부 홈페이지에서 공지를 가져온 시각입니다. 원문이 방금 올라왔다면 여기 시각 이후에 반영됩니다.'
        },
        {
            final: true,
            title: '준비되었습니다',
            body: '이제 화면 잠금을 풀고 직접 써 보세요. 검색으로 찾고, 조건으로 좁히고, 열어서 확인하면 됩니다. 이 안내는 검색창 오른쪽 돋보기에서 언제든 다시 열 수 있습니다.'
        }
    ];

    let layer = null;
    let shades = {};
    let ring = null;
    let card = null;
    let elements = {};
    let steps = [];
    let index = 0;
    let currentTarget = null;
    let followTimer = 0;
    let leaveStep = null;
    let currentHole = null;   // 지금 뚫려 있는 자리(화면 좌표)
    let currentSpot = null;   // 지금 카드가 앉은 자리
    let currentAlpha = 1;     // 지금 테두리의 진하기

    function buildLayer() {
        if (layer) return;
        layer = document.createElement('div');
        layer.className = 'tutorial-layer';
        layer.id = 'tutorial-layer';
        layer.hidden = true;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '사용 설명서');
        layer.innerHTML = `
            <div class="tutorial-shade" data-shade="top"></div>
            <div class="tutorial-shade" data-shade="bottom"></div>
            <div class="tutorial-shade" data-shade="left"></div>
            <div class="tutorial-shade" data-shade="right"></div>
            <div class="tutorial-ring" aria-hidden="true"></div>
            <div class="tutorial-card">
                <div class="tutorial-progress" aria-hidden="true">
                    <span class="tutorial-progress-fill" style="width:0%"></span>
                </div>
                <p class="tutorial-count"></p>
                <h2 class="tutorial-title"></h2>
                <p class="tutorial-body"></p>
                <p class="tutorial-hint"><span class="tutorial-hint-dot"></span><span class="tutorial-hint-text"></span></p>
                <a class="tutorial-doc" href="./guide.html">글로 된 설명서 보기</a>
                <div class="tutorial-actions">
                    <button type="button" class="tutorial-skip">그만 보기</button>
                    <span class="tutorial-spacer"></span>
                    <button type="button" class="tutorial-prev">이전</button>
                    <button type="button" class="tutorial-next">다음</button>
                </div>
            </div>`;
        document.body.appendChild(layer);

        ring = layer.querySelector('.tutorial-ring');
        card = layer.querySelector('.tutorial-card');
        shades = {
            top: layer.querySelector('[data-shade="top"]'),
            bottom: layer.querySelector('[data-shade="bottom"]'),
            left: layer.querySelector('[data-shade="left"]'),
            right: layer.querySelector('[data-shade="right"]')
        };
        elements = {
            fill: layer.querySelector('.tutorial-progress-fill'),
            count: layer.querySelector('.tutorial-count'),
            title: layer.querySelector('.tutorial-title'),
            body: layer.querySelector('.tutorial-body'),
            hint: layer.querySelector('.tutorial-hint-text'),
            doc: layer.querySelector('.tutorial-doc'),
            prev: layer.querySelector('.tutorial-prev'),
            next: layer.querySelector('.tutorial-next')
        };

        elements.prev.addEventListener('click', () => goTo(index - 1));
        elements.next.addEventListener('click', () => goTo(index + 1));
        layer.querySelector('.tutorial-skip').addEventListener('click', () => closeTutorial());

        /* 안내 중에는 아래 화면이 눌리지 않아야 한다. 층 전체가 화면을 덮고
           클릭을 받으므로 아래로는 아무것도 내려가지 않는다. 여기서 한 번 더
           막는 것은 층에 떨어진 클릭이 문서까지 올라가 다른 처리를 깨우는 것을
           끊기 위해서다. 카드 안에서 난 클릭만 그대로 지나간다. */
        const swallow = (types, cancel) => {
            for (const type of types) {
                layer.addEventListener(type, event => {
                    if (card.contains(event.target)) return;
                    if (cancel) event.preventDefault();
                    event.stopPropagation();
                }, true);
            }
        };
        swallow(['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu'], true);
        /* 손가락과 포인터는 여기서 취소하지 않는다. 취소하면 브라우저가
           탭으로 이어지는 흐름까지 끊어 카드 버튼이 둔해진다. 어차피 층이
           받아내므로 아래로는 내려가지 않는다. */
        swallow(['pointerdown', 'pointerup', 'touchstart', 'touchend'], false);
        /* 손으로 굴리는 것도 막는다. 안내가 짚는 자리로 화면을 옮겨 주는데
           그 위에서 사람이 또 끌면 두 움직임이 겹쳐 위치가 어긋난다. */
        for (const type of ['wheel', 'touchmove']) {
            layer.addEventListener(type, event => {
                if (card.contains(event.target)) return;
                event.preventDefault();
            }, { passive: false, capture: true });
        }
    }

    function isVisible(element) {
        if (!element) return false;
        if (element.hidden) return false;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        return getComputedStyle(element).visibility !== 'hidden';
    }

    function resolveTarget(step) {
        if (step.final) return null;
        for (const selector of String(step.target || '').split(',')) {
            const element = document.querySelector(selector.trim());
            if (isVisible(element)) return element;
        }
        return undefined; // 못 찾았다는 뜻. null(가리킬 곳 없음)과 구분한다.
    }

    function usableSteps() {
        return STEPS.filter(step => {
            if (step.final) return true;
            if (step.desktopOnly && document.documentElement.dataset.view === 'mobile') return false;
            return resolveTarget(step) !== undefined;
        });
    }

    /* 설명 카드를 어디에 놓을지.
       짚는 자리를 가리지 않는 것이 우선이다. 위아래로 붙일 자리가 없으면
       옆으로 돌리고, 세로로 긴 공지 카드처럼 사방이 좁으면 덜 가려지는
       쪽 끝에 붙인다. */
    function pickCardSpot(rect, cw, ch, vw, vh) {
        const clampV = value => Math.min(Math.max(EDGE, value), Math.max(EDGE, vh - ch - EDGE));
        const clampH = value => Math.min(Math.max(EDGE, value), Math.max(EDGE, vw - cw - EDGE));
        const middle = clampH(rect.left + rect.width / 2 - cw / 2);

        const beside = [];
        if (rect.right + CARD_GAP + cw + EDGE <= vw) beside.push({ left: rect.right + CARD_GAP, top: clampV(rect.top) });
        if (rect.left - CARD_GAP - cw - EDGE >= 0) beside.push({ left: rect.left - CARD_GAP - cw, top: clampV(rect.top) });

        const stacked = [];
        if (rect.bottom + CARD_GAP + ch + EDGE <= vh) stacked.push({ top: rect.bottom + CARD_GAP, left: middle });
        if (rect.top - CARD_GAP - ch - EDGE >= 0) stacked.push({ top: rect.top - CARD_GAP - ch, left: middle });

        // 세로로 긴 표적은 옆에 세우는 편이 낫다. 넓적한 것은 아래위가 자연스럽다.
        const tall = rect.height > vh * 0.4;
        const order = tall ? [...beside, ...stacked] : [...stacked, ...beside];
        if (order.length) return order[0];

        return vh - rect.bottom >= rect.top
            ? { top: Math.max(EDGE, vh - ch - EDGE), left: middle }
            : { top: EDGE, left: middle };
    }

    /* 화면을 얼마나 굴려야 표적과 카드가 함께 보이는지.
       둘을 세로로 세워도 들어가면 그 묶음을 가운데로, 표적이 화면보다 길면
       카드가 앉을 자리만 위에 비우고 표적을 그 아래로 내린다. */
    function scrollAmountFor(rect, cardWidth, cardHeight) {
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const fitsBeside = rect.right + CARD_GAP + cardWidth + EDGE <= vw
            || rect.left - CARD_GAP - cardWidth - EDGE >= 0;

        // 옆에 세울 수 있으면 표적만 가운데로 올리면 된다.
        if (fitsBeside) return rect.top - Math.max(EDGE, (vh - Math.min(rect.height, vh)) / 2);

        const group = rect.height + CARD_GAP + cardHeight;
        if (group + EDGE * 2 <= vh) return rect.top - (vh - group) / 2;
        return rect.top - (cardHeight + CARD_GAP + EDGE);
    }

    function padded(rect) {
        return {
            top: Math.max(0, rect.top - RING_PADDING),
            left: Math.max(0, rect.left - RING_PADDING),
            right: Math.min(window.innerWidth, rect.right + RING_PADDING),
            bottom: Math.min(window.innerHeight, rect.bottom + RING_PADDING)
        };
    }

    /* 화면에 실제로 그리는 곳. 여기서는 계산하지 않고 받은 값만 옮긴다.
       마지막 단계는 뚫을 자리가 없는데, 그때는 화면 한가운데에 크기 없는
       구멍을 주면 가림판 넉 장이 저절로 화면을 다 덮는다. 덕분에 마지막으로
       넘어갈 때도 다른 단계와 똑같은 방식으로 이어서 움직인다. */
    function applyFrame(hole, spot, alpha = 1) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        ring.style.opacity = String(alpha);
        const { top, left, right, bottom } = hole;
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);

        Object.assign(shades.top.style, { top: '0px', left: '0px', width: `${vw}px`, height: `${top}px` });
        Object.assign(shades.bottom.style, { top: `${bottom}px`, left: '0px', width: `${vw}px`, height: `${Math.max(0, vh - bottom)}px` });
        Object.assign(shades.left.style, { top: `${top}px`, left: '0px', width: `${left}px`, height: `${height}px` });
        Object.assign(shades.right.style, { top: `${top}px`, left: `${right}px`, width: `${Math.max(0, vw - right)}px`, height: `${height}px` });
        Object.assign(ring.style, { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` });

        card.style.top = `${spot.top}px`;
        card.style.left = `${spot.left}px`;
    }

    /* 다 옮기고 났을 때의 모습을 미리 알아낸다.
       화면을 도착 지점으로 한 번 옮겨 재고 곧바로 되돌리는데, 같은 프레임
       안에서 끝나므로 화면에는 그려지지 않는다. 스크롤을 따라오지 않고
       한자리에 붙어 있는 것(오른쪽 홍보 칸 같은)도 이렇게 재야 정확하다. */
    function finalFrameFor(target) {
        const cardRect = card.getBoundingClientRect();
        const startY = window.scrollY;
        const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const delta = scrollAmountFor(target.getBoundingClientRect(), cardRect.width, cardRect.height);
        const endY = Math.min(Math.max(0, startY + delta), limit);

        if (endY !== startY) window.scrollTo(0, endY);
        const rect = target.getBoundingClientRect();
        const hole = padded(rect);
        const spot = pickCardSpot(rect, cardRect.width, cardRect.height, window.innerWidth, window.innerHeight);
        if (endY !== startY) window.scrollTo(0, startY);

        return { startY, endY, hole, spot };
    }

    /* 마지막 단계의 도착 모습. 구멍은 화면 한가운데로 오므라들고 테두리는
       사라지며, 카드는 가운데에 선다. */
    function farewellFrame() {
        card.classList.add('is-centered');
        const rect = card.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
            startY: window.scrollY,
            endY: window.scrollY,
            hole: { top: vh / 2, left: vw / 2, right: vw / 2, bottom: vh / 2 },
            spot: { top: (vh - rect.height) / 2, left: (vw - rect.width) / 2 },
            alpha: 0
        };
    }

    const lerp = (from, to, t) => from + (to - from) * t;

    function lerpHole(from, to, t) {
        return {
            top: lerp(from.top, to.top, t),
            left: lerp(from.left, to.left, t),
            right: lerp(from.right, to.right, t),
            bottom: lerp(from.bottom, to.bottom, t)
        };
    }

    // 시작과 끝이 부드럽게 붙는 곡선. 가운데가 빠르고 양끝이 느리다.
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    /* 화면 굴리기와 테두리·카드 옮기기를 한 시계로 함께 움직인다.
       예전에는 브라우저에 굴리라고 맡겨 두고 그 결과를 매 프레임 쫓아갔다.
       그래서 굴릴 거리가 없는 단계에서는 쫓아갈 것도 없어 테두리가 그냥
       순간이동했다. 이제는 굴리든 말든 같은 곡선을 따라 이어서 움직인다. */
    function moveTo(target) {
        window.cancelAnimationFrame(followTimer);
        if (target) card.classList.remove('is-centered');

        const { startY, endY, hole, spot, alpha = 1 } = target ? finalFrameFor(target) : farewellFrame();
        const fromHole = currentHole;
        const fromSpot = currentSpot;
        const fromAlpha = currentAlpha;
        currentHole = hole;
        currentSpot = spot;
        currentAlpha = alpha;

        const skip = !fromHole || !fromSpot
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (skip) {
            if (endY !== startY) window.scrollTo(0, endY);
            applyFrame(hole, spot, alpha);
            return;
        }

        const began = performance.now();
        const tick = now => {
            const t = Math.min(1, (now - began) / MOVE_MS);
            const e = ease(t);
            if (endY !== startY) window.scrollTo(0, lerp(startY, endY, e));
            applyFrame(lerpHole(fromHole, hole, e), {
                top: lerp(fromSpot.top, spot.top, e),
                left: lerp(fromSpot.left, spot.left, e)
            }, lerp(fromAlpha, alpha, e));
            if (t < 1) followTimer = window.requestAnimationFrame(tick);
        };
        followTimer = window.requestAnimationFrame(tick);
    }

    // 창 크기가 바뀌면 계산이 통째로 어긋나므로 움직임 없이 다시 맞춘다.
    function reposition() {
        window.cancelAnimationFrame(followTimer);
        if (!currentTarget) {
            const { hole, spot, alpha } = farewellFrame();
            currentHole = hole; currentSpot = spot; currentAlpha = alpha;
            applyFrame(hole, spot, alpha);
            return;
        }
        const rect = currentTarget.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        currentHole = padded(rect);
        currentSpot = pickCardSpot(rect, cardRect.width, cardRect.height, window.innerWidth, window.innerHeight);
        currentAlpha = 1;
        applyFrame(currentHole, currentSpot, 1);
    }

    function render() {
        const step = steps[index];
        if (!step) return closeTutorial();

        if (leaveStep) { leaveStep(); leaveStep = null; }
        currentTarget = step.final ? null : resolveTarget(step) || null;
        if (currentTarget && typeof step.onEnter === 'function') {
            leaveStep = step.onEnter(currentTarget) || null;
        }

        layer.dataset.action = step.hint ? 'note' : 'read';
        elements.count.textContent = `${index + 1} / ${steps.length}`;
        elements.title.textContent = step.title;
        elements.body.textContent = step.body;
        elements.hint.textContent = step.hint || '';
        elements.fill.style.width = `${Math.round(((index + 1) / steps.length) * 100)}%`;
        elements.doc.hidden = !step.final;
        // 카드 폭이 마지막 단계에서만 달라진다. 재기 전에 미리 바꿔 둬야
        // 도착 자리를 제대로 계산한다.
        card.classList.toggle('is-centered', Boolean(step.final));
        elements.prev.disabled = index === 0;
        elements.next.textContent = step.final ? '시작하기' : '다음';

        // 카드 크기는 글을 넣은 뒤에야 정해진다. 한 프레임 기다렸다 재야
        // 어디에 놓고 얼마나 굴릴지 제대로 계산된다.
        window.requestAnimationFrame(() => moveTo(currentTarget));
        elements.next.focus({ preventScroll: true });
    }

    function goTo(next) {
        if (next < 0) return;
        if (next >= steps.length) return closeTutorial(true);
        index = next;
        render();
    }

    function onKeyDown(event) {
        // 키보드로도 아래 화면을 깨울 수 없어야 한다. 카드 밖에 초점이
        // 가 있다면 누르는 시늉만 나고 아무 일도 일어나지 않는다.
        if ((event.key === 'Enter' || event.key === ' ') && card && !card.contains(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === 'Escape') { event.preventDefault(); closeTutorial(); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); goTo(index + 1); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(index - 1); }
    }

    function startTutorial() {
        buildLayer();
        /* 두 번째 단계에서 가리키는 것이 이 안내를 여는 돋보기다. 설명대로
           눌러보는 사람이 있으므로, 이미 열려 있으면 처음으로 되돌리지 않는다. */
        if (!layer.hidden) return;
        /* 서랍이나 상세 화면이 열린 채로 시작하면 짚을 자리가 가려진다.
           안내는 언제나 공지 목록에서 출발한다. */
        window.closeMobileDrawer?.();
        steps = usableSteps();
        if (!steps.length) return;
        index = 0;
        currentHole = null;
        currentSpot = null;
        currentAlpha = 1;
        layer.hidden = false;
        requestAnimationFrame(() => layer.classList.add('is-open'));
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        document.addEventListener('keydown', onKeyDown, true);
        render();
        try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch { /* 저장이 막혀도 진행에는 지장 없다. */ }
    }

    function closeTutorial() {
        if (!layer || layer.hidden) return;
        if (leaveStep) { leaveStep(); leaveStep = null; }
        window.cancelAnimationFrame(followTimer);
        currentHole = null;
        currentSpot = null;
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
        document.removeEventListener('keydown', onKeyDown, true);
        layer.classList.remove('is-open');
        currentTarget = null;
        window.setTimeout(() => { if (layer) layer.hidden = true; }, 220);
    }

    window.startTutorial = startTutorial;
    window.closeTutorial = closeTutorial;

    // 다른 페이지에서 ?tutorial=1로 넘어오면 목록이 그려진 뒤 바로 연다.
    function autoStart() {
        const params = new URLSearchParams(location.search);
        if (params.get('tutorial') !== '1') return;
        history.replaceState(null, '', location.pathname);
        window.setTimeout(startTutorial, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart);
    } else {
        autoStart();
    }
})();
