// ========================================
// SNU ECE 공지방 — mobile.js
// data-view="mobile"일 때만 동작하는 뷰 모듈.
// 왼쪽 브랜드 레일을 서랍으로 열고 닫는 동작과 터치 동작을 맡는다.
// 공지 비교는 좁은 화면에 맞춰 최대 두 블록으로 core가 제한한다.
// ========================================

const COMPACT_DESKTOP_DRAWER_QUERY = '(max-width: 1360px)';

function usesDrawerNavigation() {
    return getLayoutMode() === 'mobile'
        || (getLayoutMode() === 'desktop'
            && window.matchMedia(COMPACT_DESKTOP_DRAWER_QUERY).matches);
}

// 서랍 제어는 index.html의 onclick에서 직접 부르므로 전역에 둔다.
// 폭이 좁은 데스크톱에서도 같은 왼쪽 탐색 서랍을 재사용한다.
function openMobileDrawer() {
    if (!usesDrawerNavigation()) return;
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
        if (event.key === 'Escape' && isMobileDrawerOpen()) {
            closeMobileDrawer();
            return;
        }
        handleNoticeCardArrowKey(event);
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
        supportsCompare: true,

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
