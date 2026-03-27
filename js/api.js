    const GEMINI_API_KEY = "AIzaSyA1P_gCwEa4RArerq6_J8EowI1DwcR80Js";
    const GEMINI_MODEL = "gemini-2.5-flash";
    const CURRENT_DATE = new Date("2026-03-27T00:00:00"); 
    let currentViewId = null;
    let editingNoticeId = null; 
    let viewMode = 'all'; 

    let currentImageArray = [];
    let currentImageIndex = 0;
    let pendingAuthAction = null; 

    // --- 🌟 배너 슬라이드 & 드래그 로직 ---
    let currentBannerIdx = 0;
    // ⚠️ totalBanners 하드코딩 제거 → 항상 bannerSlides.length 참조 (refreshBannerDOM 이후에도 정확)
    const bannerTrack = document.getElementById('banner-track');
    const headerBanner = document.getElementById('header-banner');
    
    let isDragging = false;
    let startPos = 0;
    let currentTranslate = 0;
    let prevTranslate = 0;
    let animationID;

    // slideBanner: 항상 동적 개수 참조
    function slideBanner() {
        const total = bannerSlides.length || document.getElementById('banner-track').children.length;
        if (total === 0) return;
        currentBannerIdx = (currentBannerIdx + 1) % total;
        updateBannerPosition();
    }

    let bannerInterval = setInterval(slideBanner, 15000); // 15초 간격

    // 드래그 이벤트 리스너
    headerBanner.addEventListener('mousedown', dragStart);
    headerBanner.addEventListener('touchstart', dragStart, {passive: true});
    headerBanner.addEventListener('mouseup', dragEnd);
    headerBanner.addEventListener('touchend', dragEnd);
    headerBanner.addEventListener('mouseleave', dragEnd);
    headerBanner.addEventListener('mousemove', drag);
    headerBanner.addEventListener('touchmove', drag, {passive: true});

    function dragStart(event) {
        if (headerBanner.classList.contains('hidden')) return;
        isDragging = true;
        startPos = getPositionX(event);
        clearInterval(bannerInterval); 
        bannerTrack.classList.add('dragging');
        animationID = requestAnimationFrame(animation);
    }

    function drag(event) {
        if (isDragging) {
            const currentPosition = getPositionX(event);
            const diff = currentPosition - startPos;
            const slideWidth = headerBanner.clientWidth;
            const percentageMove = (diff / slideWidth) * 100;
            currentTranslate = prevTranslate + percentageMove;
        }
    }

    function getPositionX(event) {
        return event.type.includes('mouse') ? event.pageX : event.touches[0].clientX;
    }

    function dragEnd() {
        if (!isDragging) return;
        isDragging = false;
        cancelAnimationFrame(animationID);
        bannerTrack.classList.remove('dragging');
        
        const movedBy = currentTranslate - prevTranslate;
        // ⚠️ 항상 동적 개수 참조 — 빈 배너 버그 원인이었던 하드코딩 제거
        const total = bannerSlides.length || document.getElementById('banner-track').children.length;

        if (movedBy < -20) {
            currentBannerIdx = (currentBannerIdx + 1) % total;
        } else if (movedBy > 20) {
            currentBannerIdx = (currentBannerIdx - 1 + total) % total;
        }
        
        updateBannerPosition();
        bannerInterval = setInterval(slideBanner, 15000); 
    }

    function animation() {
        if (isDragging) {
            bannerTrack.style.transform = `translateX(${currentTranslate}%)`;
            requestAnimationFrame(animation);
        }
    }

    function updateBannerPosition() {
        currentTranslate = currentBannerIdx * -100;
        prevTranslate = currentTranslate;
        bannerTrack.style.transform = `translateX(${currentTranslate}%)`;
    }

    function toggleBanner() {
        const iconClose = document.getElementById('icon-close-banner');
        const iconOpen = document.getElementById('icon-open-banner');
        const isHidden = headerBanner.classList.toggle('hidden');

        if(isHidden) {
            iconClose.style.display = 'none';
            iconOpen.style.display = 'block';
            clearInterval(bannerInterval); 
        } else {
            iconClose.style.display = 'block';
            iconOpen.style.display = 'none';
            bannerInterval = setInterval(slideBanner, 15000); 
        }
    }
    // --- 배너 로직 끝 ---

    let adminInfo = { name: "ECE 학생회장 (이름 : 박지호)", phone: "010-1234-5678", kakao: "snu_ece_pres" };
    try {
        const storedAdmin = localStorage.getItem('eceAdminInfo');
        if (storedAdmin) adminInfo = JSON.parse(storedAdmin);
    } catch(e) {}

    // 비밀번호는 별도 키로 관리 (기본값 유지)
    let adminPassword = "0327";
    let bannerPassword = "1234";
    try {
        const sp = localStorage.getItem('ecePasswords');
        if (sp) { const p = JSON.parse(sp); adminPassword = p.admin || adminPassword; bannerPassword = p.banner || bannerPassword; }
    } catch(e) {}
