// SNU ECE 공지방 — 데스크탑 뷰 모듈
(function () {
    let keyboardHandler = null;

    function handleKeydown(event) {
        handleNoticeCardArrowKey(event);
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
        },

        deactivate() {
            if (keyboardHandler) {
                document.removeEventListener('keydown', keyboardHandler);
                keyboardHandler = null;
            }
        }
    });
})();
