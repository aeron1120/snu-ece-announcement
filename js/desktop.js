// ========================================
// SNU ECE 공지방 — desktop.js
// data-view="desktop"일 때만 동작하는 뷰 모듈.
// 좌우 레일이 화면에 고정돼 있고 본문 폭이 넓다는 전제 위에서
// 데스크탑에만 있는 동작(공지 비교, 좌우 화살표 이동)을 담당한다.
// 레이아웃 자체는 css/desktop.css가 맡는다.
// ========================================

(function () {
    let keyboardHandler = null;

    // 목록에서 ← → 로 카드 사이를 옮겨 다닌다. 터치 기기에는 없는 조작이라
    // 데스크탑 모듈에만 둔다.
    function handleKeydown(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

        // 입력 중이거나 모달이 떠 있으면 가로채지 않는다.
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.querySelector('.overlay[style*="flex"]')) return;

        const cards = Array.from(document.querySelectorAll('#notice-grid .card'));
        if (cards.length === 0) return;

        const current = cards.indexOf(document.activeElement);
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = current === -1
            ? (step === 1 ? 0 : cards.length - 1)
            : (current + step + cards.length) % cards.length;

        const next = cards[nextIndex];
        next.setAttribute('tabindex', '-1');
        next.focus();
        event.preventDefault();
    }

    registerViewModule('desktop', {
        // 3열을 나란히 놓을 수 있으므로 공지 비교를 쓴다.
        supportsCompare: true,

        activate() {
            // 모바일에서 서랍을 열어둔 채 모드를 바꿨다면 흔적을 지운다.
            document.getElementById('left-brand-rail')?.classList.remove('drawer-open');
            document.getElementById('drawer-scrim')?.classList.remove('drawer-open');
            document.body.style.overflow = '';

            if (!keyboardHandler) {
                keyboardHandler = handleKeydown;
                document.addEventListener('keydown', keyboardHandler);
            }
        },

        deactivate() {
            if (keyboardHandler) {
                document.removeEventListener('keydown', keyboardHandler);
                keyboardHandler = null;
            }
        }
    });
})();
