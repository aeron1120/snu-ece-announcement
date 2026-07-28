// SNU ECE 공지방 — 데스크탑 뷰 모듈
(function () {
    let keyboardHandler = null;
    let compactQuery = null;
    let compactQueryHandler = null;

    function handleKeydown(event) {
        if (event.key === 'Escape' && isMobileDrawerOpen()) {
            closeMobileDrawer();
            return;
        }
        handleNoticeCardArrowKey(event);
    }

    function handleCompactQueryChange(event) {
        if (!event.matches) closeMobileDrawer();
    }

    registerViewModule('desktop', {
        supportsCompare: true,

        activate() {
            document.getElementById('left-brand-rail')?.classList.remove('drawer-open');
            document.getElementById('drawer-scrim')?.classList.remove('drawer-open');
            document.body.style.overflow = '';

            if (!keyboardHandler) {
                keyboardHandler = handleKeydown;
                document.addEventListener('keydown', keyboardHandler);
            }
            if (!compactQuery) compactQuery = window.matchMedia(COMPACT_DESKTOP_DRAWER_QUERY);
            if (!compactQueryHandler) {
                compactQueryHandler = handleCompactQueryChange;
                compactQuery.addEventListener?.('change', compactQueryHandler);
            }
        },

        deactivate() {
            closeMobileDrawer();
            if (keyboardHandler) {
                document.removeEventListener('keydown', keyboardHandler);
                keyboardHandler = null;
            }
            if (compactQuery && compactQueryHandler) {
                compactQuery.removeEventListener?.('change', compactQueryHandler);
                compactQueryHandler = null;
            }
        }
    });
})();
