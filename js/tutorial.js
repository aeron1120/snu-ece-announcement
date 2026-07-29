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
            body: '카드의 손잡이를 잡아 왼쪽이나 오른쪽에 놓으면 공지를 나란히 펼쳐 비교합니다. 아래 휴지통에 놓으면 비교에서 뺍니다.',
            desktopOnly: true
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
        /* 손가락과 포인터는 막기만 하고 취소하지는 않는다. 취소해 버리면
           화면을 쓸어 내리는 동작까지 함께 죽어 아래를 볼 수 없게 된다. */
        swallow(['pointerdown', 'pointerup', 'touchstart', 'touchend'], false);
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

    function place(rect) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (!rect) {
            for (const shade of Object.values(shades)) {
                Object.assign(shade.style, { top: '0px', left: '0px', width: `${vw}px`, height: `${vh}px` });
            }
            shades.bottom.style.height = '0px';
            shades.left.style.height = '0px';
            shades.right.style.height = '0px';
            ring.style.opacity = '0';
            card.classList.add('is-centered');
            card.style.removeProperty('top');
            card.style.removeProperty('left');
            return;
        }

        card.classList.remove('is-centered');
        ring.style.removeProperty('opacity');

        const top = Math.max(0, rect.top - RING_PADDING);
        const left = Math.max(0, rect.left - RING_PADDING);
        const right = Math.min(vw, rect.right + RING_PADDING);
        const bottom = Math.min(vh, rect.bottom + RING_PADDING);

        Object.assign(shades.top.style, { top: '0px', left: '0px', width: `${vw}px`, height: `${top}px` });
        Object.assign(shades.bottom.style, { top: `${bottom}px`, left: '0px', width: `${vw}px`, height: `${Math.max(0, vh - bottom)}px` });
        Object.assign(shades.left.style, { top: `${top}px`, left: '0px', width: `${left}px`, height: `${Math.max(0, bottom - top)}px` });
        Object.assign(shades.right.style, { top: `${top}px`, left: `${right}px`, width: `${Math.max(0, vw - right)}px`, height: `${Math.max(0, bottom - top)}px` });

        Object.assign(ring.style, {
            top: `${top}px`, left: `${left}px`,
            width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px`
        });

        // 카드는 구멍을 가리지 않는 쪽에 붙인다. 아래가 좁으면 위로 올린다.
        const cardRect = card.getBoundingClientRect();
        const belowRoom = vh - bottom - CARD_GAP - EDGE;
        const cardTop = belowRoom >= cardRect.height
            ? bottom + CARD_GAP
            : Math.max(EDGE, top - CARD_GAP - cardRect.height);
        const centered = rect.left + rect.width / 2 - cardRect.width / 2;
        const cardLeft = Math.min(Math.max(EDGE, centered), Math.max(EDGE, vw - cardRect.width - EDGE));

        card.style.top = `${Math.min(cardTop, Math.max(EDGE, vh - cardRect.height - EDGE))}px`;
        card.style.left = `${cardLeft}px`;
    }

    function reposition() {
        place(currentTarget ? currentTarget.getBoundingClientRect() : null);
    }

    /* 화면을 옮긴 뒤에는 곧바로 재지 않는다. 부드럽게 움직이는 중이라
       그때 잰 위치는 이미 지난 위치다. 잠시 따라다니며 다시 그린다. */
    function followScroll(duration = 620) {
        window.clearInterval(followTimer);
        const until = Date.now() + duration;
        followTimer = window.setInterval(() => {
            reposition();
            if (Date.now() > until) window.clearInterval(followTimer);
        }, 60);
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
        elements.prev.disabled = index === 0;
        elements.next.textContent = step.final ? '시작하기' : '다음';

        if (currentTarget) {
            const rect = currentTarget.getBoundingClientRect();
            const offscreen = rect.top < 80 || rect.bottom > window.innerHeight - 80;
            if (offscreen) {
                currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
                followScroll();
            }
        }
        reposition();
        // 카드 높이는 글을 넣은 뒤에야 확정되므로 한 프레임 뒤 다시 맞춘다.
        requestAnimationFrame(reposition);
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
        window.clearInterval(followTimer);
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
