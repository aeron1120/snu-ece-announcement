// ========================================
// SNU ECE 공지방 — mobile.js
// data-view="mobile"일 때만 동작하는 뷰 모듈.
// 왼쪽 브랜드 레일을 서랍으로 열고 닫는 동작과, 좁은 화면에서 의미가 없는
// 기능(공지 비교)을 감추는 일을 맡는다. 레이아웃은 css/mobile.css가 맡는다.
// ========================================

// 서랍 제어는 index.html의 onclick에서 직접 부르므로 전역에 둔다.
// 데스크탑 모드에서 눌릴 일은 없지만, 눌려도 아무 일도 일어나지 않아야 한다.
function openMobileDrawer() {
    if (getLayoutMode() !== 'mobile') return;
    document.getElementById('left-brand-rail')?.classList.add('drawer-open');
    document.getElementById('drawer-scrim')?.classList.add('drawer-open');
    document.body.style.overflow = 'hidden';
}

function closeMobileDrawer() {
    document.getElementById('left-brand-rail')?.classList.remove('drawer-open');
    document.getElementById('drawer-scrim')?.classList.remove('drawer-open');
    document.body.style.overflow = '';
}

function isMobileDrawerOpen() {
    return Boolean(document.getElementById('left-brand-rail')?.classList.contains('drawer-open'));
}

(function () {
    let escapeHandler = null;
    let linkHandler = null;
    let touchStartX = null;

    function handleEscape(event) {
        if (event.key === 'Escape' && isMobileDrawerOpen()) closeMobileDrawer();
    }

    // 서랍 안의 링크를 누르면 서랍이 남아 있으면 안 된다.
    function handleRailClick(event) {
        if (event.target.closest('a')) closeMobileDrawer();
    }

    // 왼쪽 가장자리에서 오른쪽으로 밀면 서랍이 열리고, 열린 상태에서
    // 왼쪽으로 밀면 닫힌다.
    function handleTouchStart(event) {
        touchStartX = event.touches[0]?.clientX ?? null;
    }

    function handleTouchEnd(event) {
        if (touchStartX === null) return;
        const endX = event.changedTouches[0]?.clientX ?? touchStartX;
        const delta = endX - touchStartX;
        const startedAtEdge = touchStartX < 24;
        touchStartX = null;

        if (!isMobileDrawerOpen() && startedAtEdge && delta > 60) openMobileDrawer();
        else if (isMobileDrawerOpen() && delta < -60) closeMobileDrawer();
    }

    registerViewModule('mobile', {
        // 3열 비교는 좁은 화면에서 읽을 수 없다. 담아둔 목록은 core가 그대로 들고 있다.
        supportsCompare: false,

        activate() {
            if (!escapeHandler) {
                escapeHandler = handleEscape;
                document.addEventListener('keydown', escapeHandler);
            }
            if (!linkHandler) {
                linkHandler = handleRailClick;
                document.getElementById('left-brand-rail')?.addEventListener('click', linkHandler);
            }
            document.addEventListener('touchstart', handleTouchStart, { passive: true });
            document.addEventListener('touchend', handleTouchEnd, { passive: true });
        },

        deactivate() {
            closeMobileDrawer();
            if (escapeHandler) {
                document.removeEventListener('keydown', escapeHandler);
                escapeHandler = null;
            }
            if (linkHandler) {
                document.getElementById('left-brand-rail')?.removeEventListener('click', linkHandler);
                linkHandler = null;
            }
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchend', handleTouchEnd);
        }
    });
})();
