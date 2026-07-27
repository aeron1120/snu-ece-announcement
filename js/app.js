// ========================================
// 🌍 전역 상태 & 초기화
// ========================================

// D-Day 기준일. 페이지를 열어둔 채 자정을 넘겨도 맞도록 호출 시점마다 계산한다.
function getCurrentDate() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
}

const GEMINI_MODEL = "gemini-2.5-flash";
// config.js가 빈 문자열(동일 출처)을 지정했을 수 있으므로 || 대신 타입으로 판별한다.
const API_BASE_URL = (
    typeof window.API_BASE_URL === 'string'
        ? window.API_BASE_URL
        : (localStorage.getItem('eceApiBaseUrl') || '')
).trim().replace(/\/$/, '');

let currentViewId = null;
let editingNoticeId = null;
let viewMode = 'all';
let currentImageArray = [];
let currentImageIndex = 0;
let pendingAuthAction = null;

let notices = [];
let savedPosts = [];
let bannerSlides = [];
let compareList = [];

let currentBannerIdx = 0;
let bannerModeUnlocked = false;
let isDragging = false;
let startPos = 0;
let currentTranslate = 0;
let prevTranslate = 0;
let animationID;
let bannerInterval = null;
let dragSrcIdx = null;

let adminInfo = { name: "ECE 학생회장 (이름 : 박지호)", phone: "010-1234-5678", kakao: "snu_ece_pres" };
let bannerAdminInfo = { name: "학생회 대외협력국 (국장 : 이배너)", phone: "010-8888-9999", kakao: "snu_ece_ads" };
let noticeAdminAuthToken = '';
let superAdminAuthToken = '';
let bannerManageAuthToken = '';
let reviewNotices = [];
let selectedReviewNoticeId = null;
let reviewMutationInFlight = false;
let reviewManagerOpener = null;
let activeCategories = [];
let selectedCategoryFilters = new Set();
let categoryCandidates = [];

// 서버에 등록된 배너가 하나도 없을 때 배너 영역이 비어 보이지 않도록 쓰는 안내 문구.
// 실제 광고가 아니므로 마감일·모집 같은 허위 정보를 넣지 않는다.
const placeholderBannerSlides = [
    {
        name: "배너 광고 안내",
        src: null,
        bgStyle: "background: linear-gradient(90deg, #eff6ff, #dbeafe);",
        textColor: "#1e40af",
        text: "📢 배너 광고 제휴 문의는 상단 '문의' 버튼을 눌러주세요"
    }
];

const filterState = {
    'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'saved': '전체', 'views': '전체', 'sort': '최신순'
};

function buildApiUrl(path) {
    return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function getNoticeAdminHeaders(tokenOverride = '') {
    const token = (tokenOverride || noticeAdminAuthToken || '').trim();
    return token ? { 'x-admin-token': token } : {};
}

function getSuperAdminHeaders(tokenOverride = '') {
    const token = (tokenOverride || superAdminAuthToken || '').trim();
    return token ? { 'x-super-admin-token': token } : {};
}

function getBannerManageHeaders(tokenOverride = '') {
    const token = (tokenOverride || bannerManageAuthToken || '').trim();
    return token ? { 'x-banner-token': token } : {};
}

async function apiRequest(path, options = {}) {
    const response = await fetch(buildApiUrl(path), {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    if (response.status === 204) {
        return null;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || `요청 실패 (${response.status})`);
    }
    return data;
}

async function fetchAllPublishedNotices() {
    const collected = [];
    let page = 1;
    let totalPages = 1;
    do {
        const result = await apiRequest(`/api/notices?page=${page}&limit=50`, { method: 'GET' });
        collected.push(...(Array.isArray(result?.notices) ? result.notices : []));
        totalPages = Math.max(1, Number(result?.pagination?.totalPages) || 1);
        page += 1;
    } while (page <= totalPages && page <= 100);
    return collected;
}

// ========================================
// 💾 localStorage 로드
// ========================================

async function loadData() {
    noticeAdminAuthToken = sessionStorage.getItem('eceNoticeAdminToken') || sessionStorage.getItem('eceAdminToken') || '';
    superAdminAuthToken = sessionStorage.getItem('eceSuperAdminToken') || '';
    bannerManageAuthToken = sessionStorage.getItem('eceBannerManageToken') || '';

    try {
        const settings = await apiRequest('/api/settings', { method: 'GET' });
        if (settings?.adminInfo) {
            adminInfo = {
                name: settings.adminInfo.name || adminInfo.name,
                phone: settings.adminInfo.phone || adminInfo.phone,
                kakao: settings.adminInfo.kakao || adminInfo.kakao
            };
        }

        if (settings?.bannerInfo) {
            bannerAdminInfo = {
                name: settings.bannerInfo.name || bannerAdminInfo.name,
                phone: settings.bannerInfo.phone || bannerAdminInfo.phone,
                kakao: settings.bannerInfo.kakao || bannerAdminInfo.kakao
            };
        }
    } catch (error) {
        console.error('관리자 설정 불러오기 실패:', error);
    }

    try {
        notices = await fetchAllPublishedNotices();
    } catch (error) {
        console.error('공지 목록 불러오기 실패:', error);
        // 가짜 공지를 대신 보여주면 안 되므로 빈 목록으로 두고 실패 사실만 알린다.
        notices = [];
        alert('공지 목록을 불러오지 못했습니다. 잠시 후 새로고침해주세요.');
    }

    try { const storedSaved = localStorage.getItem('eceSaved'); savedPosts = storedSaved ? JSON.parse(storedSaved) : []; if (!Array.isArray(savedPosts)) savedPosts = []; } catch (e) { savedPosts = []; }
    if (bannerSlides.length === 0) bannerSlides = JSON.parse(JSON.stringify(placeholderBannerSlides));

    await loadBannerSlides();
    startBannerPolling();
}

async function loadBannerSlides() {
    try {
        const result = await apiRequest('/api/banner-slides', { method: 'GET' });
        if (Array.isArray(result?.slides) && result.slides.length > 0) {
            bannerSlides = result.slides;
            refreshBannerDOM();
            renderRightRailAd();
        }
    } catch (error) {
        console.error('배너 슬라이드 로드 실패:', error);
        // 배너 로드 실패 시 기본값 유지
    }
}

let bannerPollingInterval = null;

function startBannerPolling() {
    // 30초마다 배너 업데이트 확인
    bannerPollingInterval = setInterval(async () => {
        try {
            const result = await apiRequest('/api/banner-slides', { method: 'GET' });
            if (Array.isArray(result?.slides)) {
                const newSlides = result.slides;
                const oldLength = bannerSlides.length;
                const newLength = newSlides.length;

                // 배너 수가 변경되었거나 컨텐츠가 달라졌으면 업데이트
                if (oldLength !== newLength || JSON.stringify(bannerSlides) !== JSON.stringify(newSlides)) {
                    bannerSlides = newSlides;
                    currentBannerIdx = 0;
                    refreshBannerDOM();
                    renderRightRailAd();
                }
            }
        } catch (error) {
            console.error('배너 폴링 오류:', error);
        }
    }, 30000);
}

function stopBannerPolling() {
    if (bannerPollingInterval) {
        clearInterval(bannerPollingInterval);
        bannerPollingInterval = null;
    }
}

function getBannerSlidesByPlacement(placement) {
    return bannerSlides
        .filter(slide => (slide.placement || 'header') === placement)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function refreshBannerDOM() {
    const bannerTrack = document.getElementById('banner-track');
    if (!bannerTrack) return;

    bannerTrack.innerHTML = '';
    getBannerSlidesByPlacement('header').forEach(slide => {
        const slideEl = document.createElement('a');
        slideEl.href = '#';
        slideEl.className = 'banner-slide';
        // bgStyle은 "background: ...;" 형태의 선언문이므로 style.background(값)이 아니라 cssText에 넣어야 적용된다.
        slideEl.style.cssText = slide.src ? 'padding: 0;' : (slide.bgStyle || 'background: #f8fafc;');
        slideEl.onclick = (e) => {
            if (isDragging) e.preventDefault();
        };

        if (slide.src) {
            const imgEl = document.createElement('img');
            imgEl.src = slide.src;
            imgEl.alt = slide.altText || slide.name || '배너 이미지';
            imgEl.className = 'banner-slide-image';
            slideEl.appendChild(imgEl);
        } else {
            const spanEl = document.createElement('span');
            spanEl.style.color = slide.textColor || '#000';
            spanEl.style.fontWeight = '700';
            spanEl.textContent = slide.text || '';
            slideEl.appendChild(spanEl);
        }

        bannerTrack.appendChild(slideEl);
    });

    currentBannerIdx = 0;
    updateBannerPosition();
}

function renderRightRailAd() {
    const container = document.getElementById('right-rail-ad-content');
    if (!container) return;
    const slide = getBannerSlidesByPlacement('right_rail')[0];

    if (!slide) {
        container.innerHTML = `
            <span class="ad-label">AD</span>
            <h2>배너 광고 문의</h2>
            <p>학생들에게 소식을 알릴 세로 배너를 등록해보세요.</p>
            <button class="rail-cta" type="button" onclick="openModal('contact-modal')">문의하기</button>
        `;
        return;
    }

    const image = slide.src
        ? `<img src="${escapeHtml(slide.src)}" alt="${escapeHtml(slide.altText || slide.name || '광고 이미지')}" onerror="this.hidden=true">`
        : '';
    const content = `
        <span class="ad-label">AD</span>
        ${image}
        <h2>${escapeHtml(slide.text || slide.name || '광고')}</h2>
        ${slide.description ? `<p>${escapeHtml(slide.description)}</p>` : ''}
        ${slide.linkUrl ? '<span class="rail-cta">자세히 보기</span>' : ''}
    `;
    if (slide.linkUrl) {
        container.innerHTML = `<a class="rail-ad-link" href="${escapeHtml(slide.linkUrl)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
    } else {
        container.innerHTML = content;
    }
}

// ========================================
// 🎯 유틸 함수
// ========================================

function copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => { alert("전화번호가 복사되었습니다: " + text); }).catch(err => { alert("복사에 실패했습니다. 브라우저 설정을 확인해주세요."); }); }
function copyAdminPhone() { copyToClipboard(adminInfo.phone); }
function getBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result); reader.onerror = e => reject(e); }); }

function getCalendarDayDifference(firstDate, secondDate) {
    const firstDay = Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    const secondDay = Date.UTC(secondDate.getFullYear(), secondDate.getMonth(), secondDate.getDate());
    return (firstDay - secondDay) / 86400000;
}

function calcDDay(deadlineStr) {
    if (!deadlineStr) return { text: "상시", isUrgent: false, isD1: false, isExpired: false };
    const diffDays = getCalendarDayDifference(new Date(deadlineStr + "T00:00:00"), getCurrentDate());
    if (diffDays < 0) return { text: "마감됨", isUrgent: false, isD1: false, isExpired: true };
    if (diffDays === 0) return { text: "D-Day", isUrgent: true, isD1: false, isExpired: false };
    if (diffDays === 1) return { text: "D-1", isUrgent: true, isD1: true, isExpired: false };
    if (diffDays <= 3) return { text: `D-${diffDays}`, isUrgent: true, isD1: false, isExpired: false };
    return { text: `D-${diffDays}`, isUrgent: false, isD1: false, isExpired: false };
}

function matchesDeadlineStatus(deadlineStatus, dDay, hasDeadline) {
    if (deadlineStatus === '전체') return true;
    if (deadlineStatus === '진행중') return !dDay.isExpired;
    if (deadlineStatus === '마감임박') return dDay.isUrgent && !dDay.isExpired;
    if (deadlineStatus === '상시') return !hasDeadline;
    if (deadlineStatus === '마감됨') return dDay.isExpired;
    return true;
}

// 공지 제목·기관·배너 문구는 관리자가 자유롭게 입력하므로, HTML로 조립하기 전에 반드시 이스케이프한다.
// 따옴표까지 처리해야 value="..." 같은 속성 안에 넣어도 빠져나가지 못한다.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function linkify(text) {
    if(!text) return "";
    // 먼저 전체를 이스케이프하므로, 뒤이어 매칭되는 URL에는 따옴표가 남아 있지 않다.
    const safeText = escapeHtml(text);
    return safeText.replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g, `<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>`);
}

// ========================================
// 🎨 UI 함수 (모달, 배너)
// ========================================

function openModal(id) { document.getElementById(id).style.display = 'flex'; if(id === 'pwd-modal') document.getElementById('admin-pwd').focus(); }
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
    if (id === 'detail-modal') clearNoticeUrl();
}

window.onclick = function(event) {
    if (event.target.classList.contains('overlay')) {
        event.target.style.display = 'none';
        if(event.target.id === 'pwd-modal') pendingAuthAction = null;
        if(event.target.id === 'detail-modal') clearNoticeUrl();
    }
}

// ========================================
// 🔗 공지 딥링크
// 카톡 공지방에 링크를 올리면 학생이 눌렀을 때 해당 공지가 바로 열려야 한다.
// ========================================

const NOTICE_URL_PARAM = 'id';

function getNoticeShareUrl(id) {
    const url = new URL(location.href);
    url.hash = '';
    url.search = '';
    url.searchParams.set(NOTICE_URL_PARAM, String(id));
    return url.toString();
}

// 상세를 열면 주소창을 그 공지의 공유 링크로 바꾼다. 히스토리에 쌓아 뒤로가기로 닫히게 한다.
function syncUrlToNotice(id) {
    if (!window.history?.pushState) return;
    const target = getNoticeShareUrl(id);
    if (location.href === target) return;   // 링크로 직접 진입한 경우 중복 push 방지
    history.pushState({ noticeId: String(id) }, '', target);
}

function clearNoticeUrl() {
    if (!window.history?.replaceState) return;
    if (!new URLSearchParams(location.search).has(NOTICE_URL_PARAM)) return;
    history.replaceState({}, '', location.pathname);
}

// 최초 진입 시 ?id=... 가 있으면 그 공지를 연다.
async function openNoticeFromUrl() {
    const requestedId = new URLSearchParams(location.search).get(NOTICE_URL_PARAM);
    if (!requestedId) return;

    let exists = notices.some(n => String(n.id) === String(requestedId));
    if (!exists) {
        try {
            const result = await apiRequest(
                `/api/notices/${encodeURIComponent(requestedId)}`,
                { method: 'GET' }
            );
            if (result?.notice) {
                notices.push(result.notice);
                exists = true;
            }
        } catch {
            // 아래의 사용자 안내로 통합한다.
        }
        if (!exists) {
            alert('링크에 해당하는 공지를 찾을 수 없습니다.\n삭제되었거나 주소가 잘못되었습니다.');
            clearNoticeUrl();
            return;
        }
    }

    openDetail(requestedId);
}

async function copyNoticeLink() {
    if (!currentViewId) return;
    const url = getNoticeShareUrl(currentViewId);

    try {
        await navigator.clipboard.writeText(url);
        alert('공지 링크가 복사되었습니다.\n카톡 공지방에 붙여넣으세요.\n\n' + url);
    } catch (error) {
        // 클립보드 권한이 없는 브라우저(카톡 인앱 등) 대비 수동 복사 경로
        prompt('아래 링크를 복사하세요.', url);
    }
}

window.addEventListener('popstate', function () {
    const detail = document.getElementById('detail-modal');
    const requestedId = new URLSearchParams(location.search).get(NOTICE_URL_PARAM);

    if (!requestedId) {
        if (detail) detail.style.display = 'none';
        return;
    }

    if (String(currentViewId) !== String(requestedId)) openDetail(requestedId);
});

// 배너 드래그 로직
function slideBanner() {
    const total = getBannerSlidesByPlacement('header').length || (document.getElementById('banner-track') ? document.getElementById('banner-track').children.length : 0);
    if (total === 0) return;
    currentBannerIdx = (currentBannerIdx + 1) % total;
    updateBannerPosition();
}

function dragStart(event) {
    const headerBanner = document.getElementById('header-banner');
    const bannerTrack = document.getElementById('banner-track');
    if (headerBanner.classList.contains('hidden')) return;
    isDragging = true;
    startPos = getPositionX(event);
    clearInterval(bannerInterval); 
    bannerTrack.classList.add('dragging');
    animationID = requestAnimationFrame(animation);
}

function drag(event) {
    if (isDragging) {
        const headerBanner = document.getElementById('header-banner');
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
    const headerBanner = document.getElementById('header-banner');
    const bannerTrack = document.getElementById('banner-track');
    isDragging = false;
    cancelAnimationFrame(animationID);
    bannerTrack.classList.remove('dragging');
    
    const movedBy = currentTranslate - prevTranslate;
    const total = getBannerSlidesByPlacement('header').length || (document.getElementById('banner-track') ? document.getElementById('banner-track').children.length : 0);

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
        const bannerTrack = document.getElementById('banner-track');
        bannerTrack.style.transform = `translateX(${currentTranslate}%)`;
        requestAnimationFrame(animation);
    }
}

function updateBannerPosition() {
    const bannerTrack = document.getElementById('banner-track');
    currentTranslate = currentBannerIdx * -100;
    prevTranslate = currentTranslate;
    bannerTrack.style.transform = `translateX(${currentTranslate}%)`;
}

function toggleBanner() {
    const headerBanner = document.getElementById('header-banner');
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

// ========================================
// 📋 관리자 기능
// ========================================

function renderAdminInfo() {
    document.getElementById('admin-name-display').innerText = adminInfo.name;
    document.getElementById('admin-phone-display').innerText = adminInfo.phone;
    document.getElementById('admin-kakao-display').innerText = adminInfo.kakao;
}

function renderBannerAdminInfo() {
    const nameEl = document.getElementById('banner-admin-name-display');
    const phoneEl = document.getElementById('banner-admin-phone-display');
    const kakaoEl = document.getElementById('banner-admin-kakao-display');
    if (nameEl) nameEl.innerText = bannerAdminInfo.name;
    if (phoneEl) phoneEl.innerText = bannerAdminInfo.phone;
    if (kakaoEl) kakaoEl.innerText = bannerAdminInfo.kakao;
}

function copyBannerPhone() {
    copyToClipboard(bannerAdminInfo.phone);
}

function setPasswordModalTexts(title, description) {
    const titleEl = document.getElementById('pwd-modal-title');
    const descEl = document.getElementById('pwd-modal-description');
    if (titleEl) titleEl.innerText = title;
    if (descEl) descEl.innerText = description;
}

function openAddNotice() {
    pendingAuthAction = 'add';
    document.getElementById('admin-pwd').value = '';
    setPasswordModalTexts('공지 관리자 인증', '공지 관리자 비밀번호를 입력하세요.');
    openModal('pwd-modal');
}

function safeHttpUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch {
        return '#';
    }
}

function openReviewManager() {
    reviewManagerOpener = document.activeElement;
    if (!noticeAdminAuthToken) {
        pendingAuthAction = 'review';
        document.getElementById('admin-pwd').value = '';
        setPasswordModalTexts('공지 검수 관리자 인증', '자동 수집 공지를 검수하려면 관리자 비밀번호를 입력하세요.');
        openModal('pwd-modal');
        return;
    }
    const modal = document.getElementById('review-manager-modal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    loadReviewNotices();
    modal.querySelector('.close-btn')?.focus();
}

function closeReviewManager() {
    const modal = document.getElementById('review-manager-modal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    reviewManagerOpener?.focus();
}

function openCategoryManager() {
    if (!noticeAdminAuthToken) {
        pendingAuthAction = 'category';
        document.getElementById('admin-pwd').value = '';
        setPasswordModalTexts('카테고리 관리자 인증', '추천 카테고리를 관리하려면 관리자 비밀번호를 입력하세요.');
        openModal('pwd-modal');
        return;
    }
    const modal = document.getElementById('category-manager-modal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    loadCategoryCandidates();
    modal.querySelector('.close-btn')?.focus();
}

function closeCategoryManager() {
    const modal = document.getElementById('category-manager-modal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function triggerEditNotice() {
    if(!currentViewId) return;
    pendingAuthAction = 'edit';
    document.getElementById('admin-pwd').value = '';
    setPasswordModalTexts('공지 관리자 인증', '공지 관리자 비밀번호를 입력하세요.');
    openModal('pwd-modal');
}

function triggerDeletePost() {
    if(!currentViewId) return;
    pendingAuthAction = 'delete';
    document.getElementById('admin-pwd').value = '';
    setPasswordModalTexts('공지 관리자 인증', '공지 관리자 비밀번호를 입력하세요.');
    openModal('pwd-modal');
}

function triggerAdminEdit() {
    pendingAuthAction = 'admin';
    document.getElementById('admin-pwd').value = '';
    setPasswordModalTexts('절대 관리자 인증', '절대 관리자 비밀번호를 입력하세요.');
    openModal('pwd-modal');
}

async function verifyPassword() {
    const pwd = document.getElementById('admin-pwd').value;
    if (!pwd) {
        alert("관리자 비밀번호를 입력해주세요.");
        document.getElementById('admin-pwd').focus();
        return;
    }

    const isSuperAdminAction = pendingAuthAction === 'admin';

    try {
        await apiRequest(isSuperAdminAction ? '/api/super-admin/verify' : '/api/admin/verify', {
            method: 'POST',
            headers: isSuperAdminAction ? getSuperAdminHeaders(pwd) : getNoticeAdminHeaders(pwd)
        });
    } catch (error) {
        alert(`관리자 인증 실패: ${error.message}`);
        document.getElementById('admin-pwd').focus();
        return;
    }

    if (isSuperAdminAction) {
        superAdminAuthToken = pwd;
        sessionStorage.setItem('eceSuperAdminToken', superAdminAuthToken);
    } else {
        noticeAdminAuthToken = pwd;
        sessionStorage.setItem('eceNoticeAdminToken', noticeAdminAuthToken);
        sessionStorage.setItem('eceAdminToken', noticeAdminAuthToken);
    }

    closeModal('pwd-modal');
    document.getElementById('admin-pwd').value = '';

    if (pendingAuthAction === 'add') {
        editingNoticeId = null;
        document.getElementById('modal-title-text').innerText = "새 공지 등록";
        document.getElementById('submit-btn-text').innerText = "공지 등록 및 AI 요약 실행";
        ['post-title', 'post-host', 'post-deadline', 'post-content', 'post-images'].forEach(id => document.getElementById(id).value = '');
        openModal('add-modal');

    } else if (pendingAuthAction === 'edit') {
        const notice = notices.find(n => String(n.id) === currentViewId);
        if (notice) {
            editingNoticeId = notice.id;
            document.getElementById('post-title').value = notice.title || "";
            document.getElementById('post-target').value = notice.target || "전체";
            document.getElementById('post-host').value = notice.host || "";
            document.getElementById('post-deadline').value = notice.deadline || "";
            document.getElementById('post-content').value = notice.content || "";
            document.getElementById('post-images').value = '';
            document.getElementById('modal-title-text').innerText = "공지 수정";
            document.getElementById('submit-btn-text').innerText = "수정 완료 (AI 요약 업데이트)";
            closeModal('detail-modal');
            openModal('add-modal');
        }

    } else if (pendingAuthAction === 'delete') {
        try {
            await apiRequest(`/api/notices/${currentViewId}`, {
                method: 'DELETE',
                headers: getNoticeAdminHeaders()
            });
        } catch (error) {
            alert(`삭제 실패: ${error.message}`);
            pendingAuthAction = null;
            return;
        }

        notices = notices.filter(n => String(n.id) !== currentViewId);
        const saveIdx = savedPosts.findIndex(savedId => String(savedId) === currentViewId);
        if(saveIdx > -1) { savedPosts.splice(saveIdx, 1); localStorage.setItem('eceSaved', JSON.stringify(savedPosts)); }
        alert("삭제되었습니다.");
        closeModal('detail-modal');
        filterCards();

    } else if (pendingAuthAction === 'admin') {
        document.getElementById('admin-display-area').style.display = 'none';
        document.getElementById('admin-edit-area').style.display = 'block';
        document.getElementById('edit-admin-name').value = adminInfo.name;
        document.getElementById('edit-admin-phone').value = adminInfo.phone;
        document.getElementById('edit-admin-kakao').value = adminInfo.kakao;
        document.getElementById('edit-banner-admin-name').value = bannerAdminInfo.name;
        document.getElementById('edit-banner-admin-phone').value = bannerAdminInfo.phone;
        document.getElementById('edit-banner-admin-kakao').value = bannerAdminInfo.kakao;
    } else if (pendingAuthAction === 'review') {
        const modal = document.getElementById('review-manager-modal');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        await loadReviewNotices();
    } else if (pendingAuthAction === 'category') {
        const modal = document.getElementById('category-manager-modal');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        await loadCategoryCandidates();
    }

    pendingAuthAction = null;
}

function saveAdminInfo() {
    const nextAdminInfo = {
        name: document.getElementById('edit-admin-name').value.trim(),
        phone: document.getElementById('edit-admin-phone').value.trim(),
        kakao: document.getElementById('edit-admin-kakao').value.trim()
    };
    const nextBannerInfo = {
        name: document.getElementById('edit-banner-admin-name').value.trim(),
        phone: document.getElementById('edit-banner-admin-phone').value.trim(),
        kakao: document.getElementById('edit-banner-admin-kakao').value.trim()
    };
    const newAdminPwd = document.getElementById('edit-admin-pwd').value.trim();
    const newBannerPwd = document.getElementById('edit-banner-pwd').value.trim();

    apiRequest('/api/settings', {
        method: 'PUT',
        headers: getSuperAdminHeaders(),
        body: JSON.stringify({ adminInfo: nextAdminInfo, bannerInfo: nextBannerInfo })
    })
        .then(async result => {
            adminInfo = {
                name: result?.adminInfo?.name || nextAdminInfo.name || adminInfo.name,
                phone: result?.adminInfo?.phone || nextAdminInfo.phone || adminInfo.phone,
                kakao: result?.adminInfo?.kakao || nextAdminInfo.kakao || adminInfo.kakao
            };
            renderAdminInfo();

            bannerAdminInfo = {
                name: result?.bannerInfo?.name || nextBannerInfo.name || bannerAdminInfo.name,
                phone: result?.bannerInfo?.phone || nextBannerInfo.phone || bannerAdminInfo.phone,
                kakao: result?.bannerInfo?.kakao || nextBannerInfo.kakao || bannerAdminInfo.kakao
            };
            renderBannerAdminInfo();

            const pwdChanged = [];
            if (newAdminPwd || newBannerPwd) {
                await apiRequest('/api/settings/passwords', {
                    method: 'PUT',
                    headers: getSuperAdminHeaders(),
                    body: JSON.stringify({
                        newNoticeAdminToken: newAdminPwd || undefined,
                        newBannerPassword: newBannerPwd || undefined
                    })
                });

                if (newAdminPwd) {
                    noticeAdminAuthToken = newAdminPwd;
                    sessionStorage.setItem('eceNoticeAdminToken', noticeAdminAuthToken);
                    sessionStorage.setItem('eceAdminToken', noticeAdminAuthToken);
                    pwdChanged.push('관리자 비밀번호');
                }
                if (newBannerPwd) {
                    pwdChanged.push('배너 모드 비밀번호');
                }
            }

            document.getElementById('edit-admin-pwd').value = '';
            document.getElementById('edit-banner-pwd').value = '';
            cancelAdminEdit();
            const pwdMsg = pwdChanged.length > 0 ? `\n✅ ${pwdChanged.join(', ')} 변경 완료` : '';
            alert("관리자 설정이 업데이트되었습니다." + pwdMsg);
        })
        .catch(error => {
            alert(`관리자 설정 업데이트 실패: ${error.message}`);
        });
}

function cancelAdminEdit() {
    document.getElementById('admin-edit-area').style.display = 'none';
    document.getElementById('admin-display-area').style.display = 'block';
}

// ========================================
// 🎠 배너 관리
// ========================================

async function openBannerManager() {
    pendingAuthAction = 'banner-admin';
    document.getElementById('admin-pwd').value = '';
    setPasswordModalTexts('배너 관리자 인증', '배너 관리자 비밀번호를 입력하세요.');
    openModal('pwd-modal');
}

function triggerBannerManagerAuth() {
    pendingAuthAction = 'banner-admin';
    document.getElementById('admin-pwd').value = '';
    setPasswordModalTexts('배너 관리자 인증', '배너 관리자 비밀번호를 입력하세요.');
    openModal('pwd-modal');
}

async function verifyBannerPassword() {
    const pwd = document.getElementById('banner-mode-pwd').value;
    const errEl = document.getElementById('banner-pwd-error');
    if (!pwd) {
        alert("배너 관리자 비밀번호를 입력해주세요.");
        document.getElementById('banner-mode-pwd').focus();
        return;
    }

    try {
        await apiRequest('/api/banner/verify', {
            method: 'POST',
            body: JSON.stringify({ password: pwd })
        });
    } catch (error) {
        if (errEl) errEl.style.display = 'block';
        alert(`배너 비밀번호 실패: ${error.message}`);
        document.getElementById('banner-mode-pwd').focus();
        return;
    }

    bannerManageAuthToken = pwd;
    sessionStorage.setItem('eceBannerManageToken', bannerManageAuthToken);
    if (errEl) errEl.style.display = 'none';
    document.getElementById('banner-pwd-section').style.display = 'none';
    openBannerEditPanel();
}

function openBannerEditPanel() {
    document.getElementById('banner-list-area').style.display = 'block';
    renderBannerList();
}

function closeBannerEditPanel() {
    document.getElementById('banner-list-area').style.display = 'none';
    document.getElementById('banner-pwd-section').style.display = 'block';
    document.getElementById('banner-mode-pwd').value = '';
}

function toggleBannerModePanel() {
    const body = document.getElementById('banner-mode-body');
    const header = body?.previousElementSibling;
    if (!body || !header) return;

    const isOpen = body.classList.toggle('show');
    header.classList.toggle('collapsed', isOpen);
}

function renderBannerList() {
    const container = document.getElementById('banner-slides-list');
    if (!container) return;

    container.innerHTML = '';

    bannerSlides.forEach((slide, idx) => {
        const safeId = Number(slide.id);
        const safeText = escapeHtml(slide.text || '');
        const slideItem = document.createElement('div');
        slideItem.className = 'banner-item';
        slideItem.innerHTML = `
            <div class="banner-item-header">
                <span class="banner-item-text">${safeText}</span>
                <div class="banner-item-actions">
                    <button class="btn btn-outline btn-small" onclick="moveBanner(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn btn-outline btn-small" onclick="moveBanner(${idx}, 1)" ${idx === bannerSlides.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="btn btn-small btn-danger" onclick="deleteBannerSlide(${safeId})">삭제</button>
                </div>
            </div>
            <div class="banner-item-form">
                <input type="text" placeholder="배너 텍스트" value="${safeText}" class="banner-input-text-${safeId}">
                <input type="color" value="${escapeHtml(slide.textColor || '#000000')}" class="banner-input-color-${safeId}">
                <input type="file" accept="image/*" class="banner-input-file-${safeId}">
                <button class="btn btn-small" onclick="updateBannerSlide(${safeId})">수정</button>
            </div>
        `;
        container.appendChild(slideItem);
    });

    const addForm = document.createElement('div');
    addForm.className = 'banner-item banner-item-add';
    addForm.innerHTML = `
        <div class="banner-item-header">
            <span>새 배너 추가</span>
        </div>
        <div class="banner-item-form">
            <input type="text" id="new-banner-text" placeholder="배너 텍스트" maxlength="100">
            <input type="color" id="new-banner-color" value="#000000" placeholder="텍스트 색">
            <input type="color" id="new-banner-bg" value="#ffffff" placeholder="배경 색">
            <input type="file" id="new-banner-image" accept="image/*">
            <button class="btn btn-small" onclick="addNewBannerSlide()">추가</button>
        </div>
    `;
    container.appendChild(addForm);
}

async function addNewBannerSlide() {
    const text = (document.getElementById('new-banner-text').value || '').trim();
    const textColor = document.getElementById('new-banner-color').value || '#000000';
    const bgColor = document.getElementById('new-banner-bg').value || '#ffffff';
    const imageInput = document.getElementById('new-banner-image');
    const imageFile = imageInput?.files?.[0] || null;

    if (!text && !imageFile) {
        alert('배너 텍스트 또는 이미지를 입력해주세요.');
        return;
    }

    const imageSrc = imageFile ? await getBase64(imageFile) : null;
    const normalizedText = text || '이미지 배너';

    try {
        const result = await apiRequest('/api/banner-slides', {
            method: 'POST',
            headers: getBannerManageHeaders(),
            body: JSON.stringify({
                name: normalizedText.substring(0, 50),
                text: normalizedText,
                bgStyle: `background: ${bgColor};`,
                textColor: textColor,
                src: imageSrc,
                order: bannerSlides.length
            })
        });

        bannerSlides.push(result.slide);
        refreshBannerDOM();
        renderRightRailAd();
        renderBannerList();
        document.getElementById('new-banner-text').value = '';
        if (imageInput) imageInput.value = '';
        alert('배너가 추가되었습니다! (7일 동안 유지됩니다)');
    } catch (error) {
        alert(`배너 추가 실패: ${error.message}`);
    }
}

async function updateBannerSlide(slideId) {
    if (!Number.isFinite(Number(slideId))) {
        await loadBannerSlides();
        renderBannerList();
        alert('서버 배너와 동기화 중입니다. 잠시 후 다시 시도해주세요.');
        return;
    }

    const newText = document.querySelector(`.banner-input-text-${slideId}`).value.trim();
    const newColor = document.querySelector(`.banner-input-color-${slideId}`).value;
    const imageInput = document.querySelector(`.banner-input-file-${slideId}`);
    const imageFile = imageInput?.files?.[0] || null;
    const imageSrc = imageFile ? await getBase64(imageFile) : null;
    const prevSlide = bannerSlides.find(s => Number(s.id) === Number(slideId));

    if (!newText && !imageSrc && !prevSlide?.src) {
        alert('배너 텍스트 또는 이미지를 입력해주세요.');
        return;
    }

    try {
        const result = await apiRequest(`/api/banner-slides/${slideId}`, {
            method: 'PUT',
            headers: getBannerManageHeaders(),
            body: JSON.stringify({
                name: (newText || prevSlide?.name || '이미지 배너').substring(0, 50),
                text: newText || prevSlide?.text || '이미지 배너',
                textColor: newColor,
                bgStyle: prevSlide?.bgStyle || 'background: #ffffff;',
                src: imageSrc || prevSlide?.src || null,
                order: Number(prevSlide?.order) || 0
            })
        });

        const idx = bannerSlides.findIndex(s => s.id === slideId);
        if (idx !== -1) {
            bannerSlides[idx] = result.slide;
        }
        refreshBannerDOM();
        renderRightRailAd();
        renderBannerList();
        alert('배너가 수정되었습니다!');
    } catch (error) {
        alert(`배너 수정 실패: ${error.message}`);
    }
}

async function deleteBannerSlide(slideId) {
    if (!Number.isFinite(Number(slideId))) {
        await loadBannerSlides();
        renderBannerList();
        alert('서버 배너와 동기화 중입니다. 잠시 후 다시 시도해주세요.');
        return;
    }

    if (!confirm('이 배너를 삭제하시겠습니까?')) return;

    try {
        await apiRequest(`/api/banner-slides/${slideId}`, {
            method: 'DELETE',
            headers: getBannerManageHeaders()
        });

        bannerSlides = bannerSlides.filter(s => s.id !== slideId);
        refreshBannerDOM();
        renderRightRailAd();
        renderBannerList();
        alert('배너가 삭제되었습니다!');
    } catch (error) {
        alert(`배너 삭제 실패: ${error.message}`);
    }
}

async function moveBanner(idx, dir) {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= bannerSlides.length) return;

    const reordered = [...bannerSlides];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(nextIdx, 0, moved);

    const items = reordered
        .filter(slide => Number.isFinite(Number(slide.id)))
        .map((slide, order) => ({ id: Number(slide.id), order }));

    if (items.length === 0) {
        bannerSlides = reordered;
        refreshBannerDOM();
        renderRightRailAd();
        renderBannerList();
        return;
    }

    try {
        const result = await apiRequest('/api/banner-slides/reorder', {
            method: 'PUT',
            headers: getBannerManageHeaders(),
            body: JSON.stringify({ items })
        });

        if (Array.isArray(result?.slides)) {
            bannerSlides = result.slides;
        } else {
            bannerSlides = reordered;
        }
        refreshBannerDOM();
        renderRightRailAd();
        renderBannerList();
    } catch (error) {
        alert(`배너 순서 변경 실패: ${error.message}`);
    }
}

// ========================================
// 🤖 Gemini AI 요약
// ========================================

async function getGeminiSummary(text) {
    const prompt = `다음 공지를 3줄로 요약해. 각 줄은 '- '로 시작. 명사형 종결.\n\n${text}`;

    try {
        const response = await fetch(buildApiUrl('/api/summary'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getNoticeAdminHeaders()
            },
            body: JSON.stringify({ prompt, model: GEMINI_MODEL })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data?.error || 'AI 요약 요청 실패');
        }

        const resultText = data?.text || '';
        const lines = resultText.split('\n').map(line => line.trim()).filter(line => line.startsWith('-')).map(line => line.replace(/^-+\s*/, '').trim());

        return lines.length > 0 ? lines.slice(0, 3) : ['요약 생성에 실패했습니다.', '본문을 직접 확인해주세요.', ''];
    } catch (error) {
        console.error('Gemini 요약 실패:', error);
        return ['AI 요약 생성 실패', error.message || '서버 오류', '본문을 직접 확인해주세요.'];
    }
}

// ========================================
// 📝 공지 생성/수정/삭제
// ========================================

async function generateAIAndSave() {
    const title = document.getElementById('post-title').value.trim();
    const target = document.getElementById('post-target').value;
    const host = document.getElementById('post-host').value.trim() || "기타";
    const deadline = document.getElementById('post-deadline').value;
    const content = document.getElementById('post-content').value.trim();
    const fileInput = document.getElementById('post-images');

    if (!title || !content) return alert("제목과 원문은 필수입니다!");

    document.getElementById('ai-loading').style.display = 'flex';
    
    let aiSummary = [];
    let finalImages = [];
    let noticeIndex = -1;

    if (editingNoticeId) {
        noticeIndex = notices.findIndex(n => n.id === editingNoticeId);
    }

    if (noticeIndex === -1 || notices[noticeIndex].content !== content) {
        aiSummary = await getGeminiSummary(content);
    } else {
        aiSummary = notices[noticeIndex].aiSummary;
    }

    if (fileInput.files.length > 0) {
        for (let i = 0; i < fileInput.files.length; i++) {
            if (i >= 20) break;
            finalImages.push(await getBase64(fileInput.files[i]));
        }
    } else if (editingNoticeId && noticeIndex !== -1) {
        finalImages = notices[noticeIndex].images || [];
    }

    const newNoticeData = {
        title,
        host,
        target,
        deadline,
        content,
        aiSummary,
        images: finalImages
    };

    try {
        if (editingNoticeId && noticeIndex !== -1) {
            const result = await apiRequest(`/api/notices/${editingNoticeId}`, {
                method: 'PUT',
                headers: getNoticeAdminHeaders(),
                body: JSON.stringify(newNoticeData)
            });
            notices[noticeIndex] = result.notice;
        } else {
            const result = await apiRequest('/api/notices', {
                method: 'POST',
                headers: getNoticeAdminHeaders(),
                body: JSON.stringify(newNoticeData)
            });
            notices.unshift(result.notice);
        }
    } catch (error) {
        document.getElementById('ai-loading').style.display = 'none';
        alert(`공지 저장 실패: ${error.message}`);
        return;
    }

    document.getElementById('ai-loading').style.display = 'none';
    closeModal('add-modal');
    editingNoticeId = null;
    
    if(viewMode === 'saved') toggleViewMode(); 
    else filterCards();
}

// ========================================
// 🔍 필터링
// ========================================

function toggleFilterPanel() {
    let filterPanelOpen = document.getElementById('filter-panel').classList.contains('open');
    filterPanelOpen = !filterPanelOpen;
    document.getElementById('filter-panel').classList.toggle('open', filterPanelOpen);
    document.getElementById('filter-chevron').style.transform = filterPanelOpen ? 'rotate(180deg)' : '';
    if (filterPanelOpen) buildHostButtons();
}

function buildHostButtons() {
    const container = document.getElementById('fg-host');
    const hosts = [...new Set(notices.map(n => n.host || '기타').filter(Boolean))].sort();
    const current = filterState['host'];
    container.innerHTML = `<button class="filter-btn ${current === '전체' ? 'active' : ''}" data-group="host" data-val="전체" onclick="toggleFilterBtn(this)">전체</button>`;
    hosts.forEach(h => {
        const safeHost = escapeHtml(h);
        container.innerHTML += `<button class="filter-btn ${current === h ? 'active' : ''}" data-group="host" data-val="${safeHost}" onclick="toggleFilterBtn(this)">${safeHost}</button>`;
    });
}

async function loadCategories() {
    try {
        const result = await apiRequest('/api/categories', { method: 'GET' });
        activeCategories = Array.isArray(result?.categories) ? result.categories : [];
    } catch (error) {
        console.error('카테고리 불러오기 실패:', error);
        activeCategories = [];
    }
    buildCategoryButtons();
}

function buildCategoryButtons() {
    const container = document.getElementById('fg-category');
    if (!container) return;
    if (activeCategories.length === 0) {
        container.innerHTML = '<span class="review-list-meta">등록된 카테고리가 없습니다.</span>';
        return;
    }
    container.innerHTML = activeCategories.map(category => {
        const id = Number(category.id);
        return `<button class="filter-btn ${selectedCategoryFilters.has(id) ? 'active' : ''}"
            type="button" data-category-id="${id}" onclick="toggleCategoryFilter(${id})">${escapeHtml(category.name)}</button>`;
    }).join('');
}

function toggleCategoryFilter(categoryId) {
    const id = Number(categoryId);
    if (selectedCategoryFilters.has(id)) selectedCategoryFilters.delete(id);
    else selectedCategoryFilters.add(id);
    buildCategoryButtons();
    filterCards();
    updateFilterChips();
}

function toggleFilterBtn(btn) {
    const group = btn.dataset.group;
    const val = btn.dataset.val;
    document.querySelectorAll(`[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterState[group] = val;
    filterCards();
    updateFilterChips();
}

function updateFilterChips() {
    const chipsArea = document.getElementById('filter-active-chips');
    const bar = document.getElementById('filter-toggle-bar');
    const labelEl = document.getElementById('filter-toggle-label');
    chipsArea.innerHTML = '';

    const defaultState = { 'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'saved': '전체', 'views': '전체', 'sort': '최신순' };
    const labelMap = { 'deadline-status': '마감', 'host': '기관', 'has-image': '이미지', 'saved': '찜', 'views': '조회수', 'sort': '정렬' };
    let hasActive = false;

    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo = document.getElementById('filter-date-to')?.value;

    Object.entries(filterState).forEach(([group, val]) => {
        if (val !== defaultState[group]) {
            hasActive = true;
            const chip = document.createElement('div');
            chip.className = 'filter-chip';
            chip.innerHTML = `<span>${labelMap[group]}: ${val}</span><button onclick="event.stopPropagation(); resetFilterGroup('${group}')">×</button>`;
            chipsArea.appendChild(chip);
        }
    });

    if (dateFrom || dateTo) {
        hasActive = true;
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.innerHTML = `<span>기간: ${dateFrom || '?'} ~ ${dateTo || '?'}</span><button onclick="event.stopPropagation(); clearDateRange()">×</button>`;
        chipsArea.appendChild(chip);
    }

    if (selectedCategoryFilters.size > 0) {
        hasActive = true;
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.innerHTML = `<span>카테고리: ${selectedCategoryFilters.size}개</span><button onclick="event.stopPropagation(); clearCategoryFilters()">×</button>`;
        chipsArea.appendChild(chip);
    }

    bar.classList.toggle('has-active', hasActive);
    const count = document.getElementById('filter-active-chips').children.length;
    const svg = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h18M7 8h10M11 12h2M9 16h6"/></svg>`;
    labelEl.innerHTML = `${svg} 상세 필터${hasActive ? ` <span style="background:var(--primary);color:white;font-size:11px;padding:2px 7px;border-radius:10px;">${count}</span>` : ''}`;
}

function resetFilterGroup(group) {
    const defaults = { 'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'saved': '전체', 'views': '전체', 'sort': '최신순' };
    filterState[group] = defaults[group];
    document.querySelectorAll(`[data-group="${group}"]`).forEach(b => { b.classList.toggle('active', b.dataset.val === defaults[group]); });
    filterCards();
    updateFilterChips();
}

function clearDateRange() {
    const f = document.getElementById('filter-date-from');
    const t = document.getElementById('filter-date-to');
    if (f) f.value = '';
    if (t) t.value = '';
    filterCards();
    updateFilterChips();
}

function clearCategoryFilters() {
    selectedCategoryFilters.clear();
    buildCategoryButtons();
    filterCards();
    updateFilterChips();
}

function resetAllFilters() {
    const defaults = { 'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'saved': '전체', 'views': '전체', 'sort': '최신순' };
    Object.keys(filterState).forEach(g => { filterState[g] = defaults[g]; });
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.toggle('active', b.dataset.val === defaults[b.dataset.group]); });
    selectedCategoryFilters.clear();
    buildCategoryButtons();
    clearDateRange();
    updateFilterChips();
    filterCards();
}

function filterCards() {
    const inputVal = document.getElementById('searchInput');
    if(!inputVal) return; 

    const rawText = (inputVal.value || "").trim().toLowerCase();
    const keywords = rawText ? rawText.split(/\s+/) : []; 
    const targetFilter = document.getElementById('targetFilter').value;

    const fDeadlineStatus = filterState['deadline-status'];
    const fHost = filterState['host'];
    const fHasImage = filterState['has-image'];
    const fSaved = filterState['saved'];
    const fViews = filterState['views'];
    const fSort = filterState['sort'];
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo = document.getElementById('filter-date-to')?.value || '';

    const grid = document.getElementById('notice-grid');
    grid.innerHTML = "";

    let filtered = [];

    notices.forEach(notice => {
        const noticeIdStr = String(notice.id);
        const isSaved = savedPosts.includes(noticeIdStr);

        if (viewMode === 'saved' && !isSaved) return;
        if (targetFilter !== "전체" && notice.target !== "전체" && notice.target !== targetFilter) return;

        const safeTitle = notice.title || "";
        const safeContent = notice.content || "";
        const searchTarget = (safeTitle + " " + safeContent).toLowerCase();
        const isMatch = keywords.length === 0 || keywords.every(kw => searchTarget.includes(kw));
        if (!isMatch) return;

        const dDay = calcDDay(notice.deadline);

        if (!matchesDeadlineStatus(fDeadlineStatus, dDay, Boolean(notice.deadline))) return;

        if (fHost !== '전체' && (notice.host || '기타') !== fHost) return;

        if (selectedCategoryFilters.size > 0) {
            const noticeCategoryIds = (notice.categoryIds || []).map(Number);
            if (![...selectedCategoryFilters].some(id => noticeCategoryIds.includes(id))) return;
        }

        const hasImg = notice.images && notice.images.length > 0;
        if (fHasImage === '있음' && !hasImg) return;
        if (fHasImage === '없음' && hasImg) return;

        if (fSaved === '찜한것만' && !isSaved) return;

        const views = notice.views || 0;
        if (fViews === '100이상' && views < 100) return;
        if (fViews === '50이상' && views < 50) return;
        if (fViews === '10미만' && views >= 10) return;

        if (dateFrom && notice.deadline && notice.deadline < dateFrom) return;
        if (dateTo && notice.deadline && notice.deadline > dateTo) return;
        if (dateFrom && !notice.deadline) return;

        filtered.push(notice);
    });

    if (fSort === '마감임박순') {
        filtered.sort((a, b) => {
            const da = a.deadline ? new Date(a.deadline + 'T00:00:00').getTime() : Infinity;
            const db = b.deadline ? new Date(b.deadline + 'T00:00:00').getTime() : Infinity;
            return da - db;
        });
    } else if (fSort === '조회수순') {
        filtered.sort((a, b) => (b.views || 0) - (a.views || 0));
    } else if (fSort === '조회수낮은순') {
        filtered.sort((a, b) => (a.views || 0) - (b.views || 0));
    }

    filtered.forEach(notice => {
        const noticeIdStr = String(notice.id);
        const isSaved = savedPosts.includes(noticeIdStr);
        const dDay = calcDDay(notice.deadline);
        const safeTitle = escapeHtml(notice.title || "");
        let imgHtml = (notice.images && notice.images.length > 0) ? `<img src="${escapeHtml(notice.images[0])}" class="card-img-preview" style="display:block;">` : '';
        // 태그 색과 같은 기준(마감 3일 이내)으로 카드 왼쪽 세로선을 붉게 한다.
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
        const starClass = isSaved ? 'star-icon active' : 'star-icon';
        const starChar = isSaved ? '★' : '☆';

        const card = document.createElement('div');
        card.className = cardClass;
        card.onclick = () => openDetail(notice.id);
        // 포스터는 카드 맨 위에 온다. 이미지가 없는 공지는 썸네일 영역 자체를 만들지 않는다.
        card.innerHTML = `
            ${imgHtml}
            <div class="card-body">
                <div class="${starClass}" onclick="toggleSave(event, '${escapeHtml(notice.id)}')">${starChar}</div>
                <div class="tags">
                    <span class="tag ${deadlineTagClass}">${dDay.text}</span>
                    <span class="tag target">${escapeHtml(notice.target || '전체')}</span>
                    <span class="tag">${escapeHtml(notice.host || '')}</span>
                </div>
                <h3>${safeTitle}</h3>
                <div class="card-meta">
                    <span>마감 ${escapeHtml(notice.deadline || '상시')}</span>
                    <span class="view-count">조회 ${Number(notice.views) || 0}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    if (grid.innerHTML === "") {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: var(--text-sub); font-size: 16px;">조건에 맞는 공지가 없습니다.</div>`;
    }

    const countEl = document.getElementById('filter-result-count');
    if (countEl) countEl.innerHTML = `결과 <strong>${filtered.length}</strong>건 / 전체 ${notices.length}건`;
}

function toggleViewMode() {
    viewMode = viewMode === 'all' ? 'saved' : 'all';
    const btn = document.getElementById('btn-starred');
    if (viewMode === 'saved') {
        btn.style.background = 'var(--primary-light)';
        btn.style.color = 'var(--primary)';
        btn.style.borderColor = 'var(--primary)';
        btn.innerText = '⭐ 전체 보기로 돌아가기';
    } else {
        btn.style.background = 'white';
        btn.style.color = 'var(--primary)';
        btn.style.borderColor = 'var(--border)';
        btn.innerText = '⭐ 찜 게시물';
    }
    filterCards();
}

function toggleSave(event, idStr) {
    event.stopPropagation(); 
    const id = String(idStr); 
    const index = savedPosts.findIndex(savedId => String(savedId) === id);
    if (index === -1) {
        savedPosts.push(id);
        event.target.classList.add('active');
        event.target.innerText = '★';
    } else {
        savedPosts.splice(index, 1);
        event.target.classList.remove('active');
        event.target.innerText = '☆';
        if(viewMode === 'saved') filterCards(); 
    }
    localStorage.setItem('eceSaved', JSON.stringify(savedPosts));
}

// ========================================
// 📄 상세 공지 & 이미지 & 비교
// ========================================

function navImage(dir, event) {
    if(event) event.stopPropagation();
    currentImageIndex += dir;
    if (currentImageIndex < 0) currentImageIndex = currentImageArray.length - 1;
    if (currentImageIndex >= currentImageArray.length) currentImageIndex = 0;
    updateImageViewer();
}

function openImageViewer(index) {
    const notice = notices.find(n => String(n.id) === currentViewId);
    if (!notice || !notice.images) return;
    currentImageArray = notice.images;
    currentImageIndex = index;
    
    if(currentImageArray.length <= 1) {
        document.getElementById('nav-left').style.display = 'none';
        document.getElementById('nav-right').style.display = 'none';
    } else {
        document.getElementById('nav-left').style.display = 'flex';
        document.getElementById('nav-right').style.display = 'flex';
    }
    
    updateImageViewer();
    openModal('image-viewer-modal');
}

function updateImageViewer() {
    const src = currentImageArray[currentImageIndex];
    document.getElementById('viewer-img').src = src;
    document.getElementById('viewer-download-btn').href = src;
    document.getElementById('img-counter').innerText = `${currentImageIndex + 1} / ${currentImageArray.length}`;
}

function openDetail(idStr) {
    currentViewId = String(idStr); 
    const noticeIndex = notices.findIndex(n => String(n.id) === currentViewId);
    if(noticeIndex === -1) return;

    const notice = notices[noticeIndex];
    notice.views = (notice.views || 0) + 1;
    filterCards(); 

    apiRequest(`/api/notices/${currentViewId}/view`, { method: 'POST' })
        .then(result => {
            if (!result?.notice) return;
            const freshIdx = notices.findIndex(n => String(n.id) === String(result.notice.id));
            if (freshIdx !== -1) {
                notices[freshIdx].views = result.notice.views;
                if (String(currentViewId) === String(result.notice.id)) {
                    document.getElementById('detail-meta').innerHTML = `마감일: ${escapeHtml(notice.deadline || '상시')} &nbsp;|&nbsp; 조회: ${Number(result.notice.views) || 0}`;
                }
                filterCards();
            }
        })
        .catch(error => {
            console.error('조회수 반영 실패:', error);
        });

    const dDay = calcDDay(notice.deadline);
    const deadlineTagClass = dDay.isExpired
        ? 'expired'
        : dDay.isUrgent
            ? 'd-day'
            : '';
    document.getElementById('detail-tags').innerHTML = `
        <span class="tag ${deadlineTagClass}">${dDay.text}</span>
        <span class="tag target">${escapeHtml(notice.target || '전체')}</span>
        <span class="tag">${escapeHtml(notice.host || '')}</span>
    `;
    document.getElementById('detail-title').innerText = notice.title || "";
    document.getElementById('detail-meta').innerHTML = `마감일: ${escapeHtml(notice.deadline || '상시')} &nbsp;|&nbsp; 조회: ${Number(notice.views) || 0}`;
    document.getElementById('detail-summary').innerHTML = (notice.aiSummary || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
    document.getElementById('detail-content').innerHTML = linkify(notice.content || "");
    const sourceArea = document.getElementById('detail-source-area');
    const source = document.getElementById('detail-source');
    const attachmentList = document.getElementById('detail-attachments');
    const attachments = Array.isArray(notice.attachments) ? notice.attachments : [];
    source.innerHTML = notice.sourceUrl
        ? `<a href="${escapeHtml(safeHttpUrl(notice.sourceUrl))}" target="_blank" rel="noopener noreferrer">ECE 원문 열기</a>`
        : '';
    attachmentList.innerHTML = attachments.map(file =>
        `<li><a href="${escapeHtml(safeHttpUrl(file.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name || '첨부파일')}</a></li>`
    ).join('');
    sourceArea.hidden = !notice.sourceUrl && attachments.length === 0;

    const gallery = document.getElementById('detail-gallery');
    gallery.innerHTML = '';
    if (notice.images && notice.images.length > 0) {
        notice.images.forEach((src, idx) => {
            gallery.innerHTML += `<img src="${escapeHtml(src)}" class="gallery-img" onclick="openImageViewer(${idx})">`;
        });
        gallery.style.display = 'flex';
    } else { gallery.style.display = 'none'; }
    
    openModal('detail-modal');
    syncUrlToNotice(currentViewId);
    setTimeout(() => { if(typeof updateCompareButton === 'function') updateCompareButton(String(idStr)); }, 30);
}

// 공지 비교
function toggleCompare(idStr) {
    const id = String(idStr);
    const idx = compareList.indexOf(id);
    if (idx > -1) {
        compareList.splice(idx, 1);
    } else {
        if (compareList.length >= 3) {
            alert("비교는 최대 3개까지 가능합니다.\n기존 항목을 먼저 제거해주세요.");
            return;
        }
        compareList.push(id);
    }
    updateCompareBar();
    updateCompareButton(id);
}

function updateCompareButton(id) {
    const btn = document.getElementById('compare-toggle-btn');
    if (!btn) return;
    const inList = compareList.includes(String(id));
    if (inList) {
        btn.innerText = '✅ 비교 목록에서 제거';
        btn.style.background = 'var(--primary-light)';
        btn.style.color = 'var(--primary)';
        btn.style.borderColor = 'var(--primary)';
    } else {
        btn.innerText = '🔍 비교 목록에 추가';
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    }
}

function updateCompareBar() {
    const bar = document.getElementById('compare-bar');
    const slotsArea = document.getElementById('compare-slots-area');
    const countNum = document.getElementById('compare-count-num');
    const execBtn = document.getElementById('compare-exec-btn');
    countNum.innerText = compareList.length;
    slotsArea.innerHTML = '';
    compareList.forEach(id => {
        const notice = notices.find(n => String(n.id) === id);
        if (!notice) return;
        const slot = document.createElement('div');
        slot.className = 'compare-slot';
        const safeTitle = escapeHtml(notice.title || '');
        slot.innerHTML = `<span title="${safeTitle}">${safeTitle}</span><button class="remove-btn" onclick="toggleCompare('${escapeHtml(id)}')">×</button>`;
        slotsArea.appendChild(slot);
    });
    if (compareList.length > 0) {
        bar.classList.add('active');
    } else {
        bar.classList.remove('active');
    }
    execBtn.disabled = compareList.length < 2;
    execBtn.style.opacity = compareList.length < 2 ? '0.5' : '1';
    document.body.style.paddingBottom = compareList.length > 0 ? '80px' : '40px';
}

function clearCompare() {
    compareList = [];
    updateCompareBar();
    updateCompareButton(currentViewId);
}

function openCompareModal() {
    if (compareList.length < 2) { alert("2개 이상의 공지를 선택해주세요."); return; }
    const grid = document.getElementById('compare-modal-grid');
    grid.style.gridTemplateColumns = `repeat(${compareList.length}, 1fr)`;
    grid.innerHTML = '';

    compareList.forEach(id => {
        const notice = notices.find(n => String(n.id) === id);
        if (!notice) return;
        const dDay = calcDDay(notice.deadline);
        const col = document.createElement('div');
        col.className = 'compare-col';

        const summaryHtml = (notice.aiSummary || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li style="color:var(--text-sub)">요약 없음</li>';
        const thumbHtml = (notice.images && notice.images.length > 0) ? `<img src="${escapeHtml(notice.images[0])}" style="width:100%; height:110px; object-fit:cover; border-radius:10px; margin-bottom:10px; border:1px solid var(--border); flex-shrink:0;">` : '';
        const colId = 'compare-col-' + id;
        const safeContent = escapeHtml(notice.content || '');
        const contentWithLinks = safeContent.replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g, `<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">$1</a>`);

        col.innerHTML = `${thumbHtml}
            <div class="tags" style="margin-bottom:6px; flex-wrap:wrap; padding-right:0;">
                <span class="tag ${dDay.isUrgent ? 'd-day' : ''}">${dDay.text}</span>
                <span class="tag target">${escapeHtml(notice.target || '전체')}</span>
                <span class="tag">${escapeHtml(notice.host || '')}</span>
            </div>
            <h3>${escapeHtml(notice.title || '')}</h3>
            <div class="compare-meta">📅 마감: ${escapeHtml(notice.deadline || '상시')} &nbsp;|&nbsp; 👀 조회 ${Number(notice.views) || 0}</div>
            <div class="compare-tabs" id="${colId}-tabs">
                <button class="compare-tab-btn active" onclick="switchCompareTab('${id}','summary')">✨ AI 요약</button>
                <button class="compare-tab-btn" onclick="switchCompareTab('${id}','original')">📄 원문</button>
            </div>
            <div class="compare-content-area" id="${colId}-summary">
                <ul class="compare-summary">${summaryHtml}</ul>
            </div>
            <div class="compare-content-area text-pane" id="${colId}-original" style="display:none;">${contentWithLinks}</div>
            <div style="margin-top:10px; flex-shrink:0;">
                <button class="btn btn-outline btn-small" style="width:100%;" onclick="closeModal('compare-modal'); openDetail('${id}')">🔗 상세 보기</button>
            </div>`;
        grid.appendChild(col);

        ['summary','original'].forEach(pane => {
            const el = col.querySelector(`#${colId}-${pane}`);
            if (!el) return;
            let isDown = false, startY, scrollTop;
            el.addEventListener('mousedown', e => {
                isDown = true; startY = e.pageY - el.offsetTop; scrollTop = el.scrollTop;
                el.style.cursor = 'grabbing';
                e.preventDefault();
            });
            el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = 'grab'; });
            el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = 'grab'; });
            el.addEventListener('mousemove', e => {
                if (!isDown) return;
                const y = e.pageY - el.offsetTop;
                el.scrollTop = scrollTop - (y - startY);
            });
        });
    });

    openModal('compare-modal');
}

function switchCompareTab(id, pane) {
    const colId = 'compare-col-' + id;
    const summaryEl = document.getElementById(`${colId}-summary`);
    const originalEl = document.getElementById(`${colId}-original`);
    const tabs = document.getElementById(`${colId}-tabs`);
    if (!tabs) return;
    const btns = tabs.querySelectorAll('.compare-tab-btn');
    if (pane === 'summary') {
        summaryEl.style.display = '';
        originalEl.style.display = 'none';
        btns[0].classList.add('active');
        btns[1].classList.remove('active');
    } else {
        summaryEl.style.display = 'none';
        originalEl.style.display = '';
        btns[0].classList.remove('active');
        btns[1].classList.add('active');
    }
}

// ========================================
// 🔐 초기화 & 이벤트
// ========================================

document.addEventListener('keydown', function(e) {
    const viewer = document.getElementById('image-viewer-modal');
    if (viewer && viewer.style.display === 'flex') {
        if (e.key === 'ArrowLeft') navImage(-1);
        if (e.key === 'ArrowRight') navImage(1);
        if (e.key === 'Escape') closeModal('image-viewer-modal');
    }
});

document.addEventListener('DOMContentLoaded', async function () {
    await loadData();
    await loadCategories();
    renderAdminInfo();
    renderBannerAdminInfo();
    refreshBannerDOM();
    renderRightRailAd();
    buildHostButtons();
    filterCards();
    updateCompareBar();
    openNoticeFromUrl();   // 카톡 링크로 들어온 경우 해당 공지를 바로 연다

    // 배너 드래그 이벤트 리스너
    const headerBanner = document.getElementById('header-banner');
    if (headerBanner) {
        headerBanner.addEventListener('mousedown', dragStart);
        headerBanner.addEventListener('touchstart', dragStart, {passive: true});
        headerBanner.addEventListener('mouseup', dragEnd);
        headerBanner.addEventListener('touchend', dragEnd);
        headerBanner.addEventListener('mouseleave', dragEnd);
        headerBanner.addEventListener('mousemove', drag);
        headerBanner.addEventListener('touchmove', drag, {passive: true});
    }
    
    clearInterval(bannerInterval);
    bannerInterval = setInterval(slideBanner, 15000);
});

function setReviewStatus(message, isError = false) {
    const status = document.getElementById('review-status');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
}

function splitReviewValues(value) {
    return String(value || '').split(',').map(item => item.trim())
        .filter((item, index, all) => item && all.indexOf(item) === index);
}

async function loadReviewNotices() {
    const list = document.getElementById('review-notice-list');
    if (!list) return;
    list.innerHTML = '<div class="review-empty">검수 대기 공지를 불러오는 중입니다.</div>';
    setReviewStatus('목록을 갱신하고 있습니다.');
    try {
        const result = await apiRequest('/api/admin/review-notices', {
            method: 'GET',
            headers: getNoticeAdminHeaders()
        });
        reviewNotices = Array.isArray(result?.notices) ? result.notices : [];
        document.getElementById('review-pending-count').textContent = String(reviewNotices.length);
        renderReviewNoticeList();
        setReviewStatus(reviewNotices.length > 0
            ? `검수 대기 공지 ${reviewNotices.length}건`
            : '현재 검수 대기 공지가 없습니다.');
        if (reviewNotices.length === 0) {
            selectedReviewNoticeId = null;
            document.getElementById('review-editor').innerHTML =
                '<div class="review-empty">현재 검수 대기 공지가 없습니다.</div>';
        } else if (!reviewNotices.some(item =>
            String(item.id) === String(selectedReviewNoticeId))) {
            await openReviewNotice(reviewNotices[0].id);
        }
    } catch (error) {
        list.innerHTML = '<div class="review-empty">검수 목록을 불러오지 못했습니다.</div>';
        setReviewStatus(error.message, true);
    }
}

function renderReviewNoticeList() {
    const list = document.getElementById('review-notice-list');
    list.innerHTML = '';
    for (const notice of reviewNotices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `review-list-item ${
            String(notice.id) === String(selectedReviewNoticeId) ? 'active' : ''
        }`;
        button.innerHTML = `
            <span class="review-list-title">${escapeHtml(notice.title || '제목 없음')}</span>
            <span class="review-list-meta">
                ${escapeHtml(notice.sourcePublishedAt?.slice(0, 10) || '날짜 미상')}
                · 분석 ${escapeHtml(notice.analysisStatus || '대기')}
            </span>`;
        button.addEventListener('click', () => openReviewNotice(notice.id));
        list.appendChild(button);
    }
}

async function openReviewNotice(id) {
    selectedReviewNoticeId = String(id);
    renderReviewNoticeList();
    setReviewStatus('공지 상세를 불러오는 중입니다.');
    try {
        const result = await apiRequest(
            `/api/admin/review-notices/${encodeURIComponent(id)}`,
            { method: 'GET', headers: getNoticeAdminHeaders() }
        );
        renderReviewEditor(result.notice);
        setReviewStatus('원문과 AI 분석 결과를 확인한 뒤 승인 또는 반려하세요.');
    } catch (error) {
        setReviewStatus(error.message, true);
    }
}

function renderReviewEditor(notice) {
    const editor = document.getElementById('review-editor');
    const summaries = Array.isArray(notice.aiSummary) ? notice.aiSummary : [];
    const attachments = Array.isArray(notice.attachments) ? notice.attachments : [];
    const keywords = Array.isArray(notice.keywords) ? notice.keywords : [];
    const selectedCategoryIds = new Set((notice.categoryIds || []).map(Number));
    const categoryCheckboxHtml = activeCategories.length > 0
        ? activeCategories.map(category => `
            <label class="notification-check">
                <input type="checkbox" name="review-category" value="${Number(category.id)}"
                    ${selectedCategoryIds.has(Number(category.id)) ? 'checked' : ''}>
                ${escapeHtml(category.name)}
            </label>`).join('')
        : '<span class="review-list-meta">등록된 카테고리가 없습니다.</span>';
    const attachmentHtml = attachments.length
        ? `<ul class="review-attachments">${attachments.map(file => `
            <li><a href="${escapeHtml(file.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name || '첨부파일')}</a></li>
        `).join('')}</ul>`
        : '<p class="review-list-meta">첨부파일 없음</p>';
    editor.innerHTML = `
        <div class="review-source">
            <strong>출처</strong>
            <a href="${escapeHtml(notice.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">ECE 원문 열기</a>
            <span>분석 상태: ${escapeHtml(notice.analysisStatus || '대기')}</span>
            <span>신뢰도: ${notice.analysisConfidence == null ? '—' : escapeHtml(notice.analysisConfidence)}</span>
        </div>
        <div class="review-editor-grid">
            <div class="form-group wide">
                <label for="review-title">공지 제목</label>
                <input id="review-title" type="text" value="${escapeHtml(notice.title || '')}">
            </div>
            <div class="form-group">
                <label for="review-targets">대상 학번 (쉼표로 구분)</label>
                <input id="review-targets" type="text" value="${escapeHtml((notice.targets || []).join(', '))}">
            </div>
            <div class="form-group">
                <label for="review-host">주관 기관</label>
                <input id="review-host" type="text" value="${escapeHtml(notice.host || '')}">
            </div>
            <div class="form-group">
                <label for="review-deadline">마감일</label>
                <input id="review-deadline" type="date" value="${escapeHtml(notice.deadline || '')}">
            </div>
            <div class="form-group">
                <label for="review-keywords">키워드 (쉼표로 구분)</label>
                <input id="review-keywords" type="text" value="${escapeHtml(keywords.join(', '))}">
            </div>
            <div class="form-group wide">
                <label for="review-summary">AI 요약 (한 줄에 하나)</label>
                <textarea id="review-summary">${escapeHtml(summaries.join('\n'))}</textarea>
            </div>
            <div class="form-group wide">
                <label for="review-content">공지 원문</label>
                <textarea id="review-content">${escapeHtml(notice.content || '')}</textarea>
            </div>
        </div>
        <div class="review-analysis">
            <strong>카테고리</strong>
            <div id="review-category-checkboxes" class="review-keywords">
                ${categoryCheckboxHtml}
            </div>
            <div class="review-keywords">${keywords.map(keyword =>
                `<span class="review-keyword">${escapeHtml(keyword)}</span>`
            ).join('')}</div>
        </div>
        <strong>첨부파일</strong>
        ${attachmentHtml}
        <div class="review-actions">
            <button class="btn btn-outline btn-small review-action" type="button" onclick="reanalyzeReviewNotice()">재분석</button>
            <button class="btn btn-danger btn-small review-action" type="button" onclick="rejectReviewNotice()">반려</button>
            <button class="btn btn-outline btn-small review-action" type="button" onclick="publishReviewNotice(false)">승인만</button>
            <button class="btn btn-small review-action" type="button" onclick="publishReviewNotice(true)">승인 및 알림</button>
        </div>`;
}

function setReviewMutationBusy(busy) {
    reviewMutationInFlight = busy;
    document.querySelectorAll('.review-action').forEach(button => {
        button.disabled = busy;
    });
}

function collectReviewEdits() {
    return {
        title: document.getElementById('review-title').value.trim(),
        content: document.getElementById('review-content').value.trim(),
        host: document.getElementById('review-host').value.trim(),
        deadline: document.getElementById('review-deadline').value || null,
        targets: splitReviewValues(document.getElementById('review-targets').value),
        keywords: splitReviewValues(document.getElementById('review-keywords').value),
        categoryIds: Array.from(
            document.querySelectorAll('input[name="review-category"]:checked')
        ).map(input => Number(input.value)),
        aiSummary: document.getElementById('review-summary').value
            .split('\n').map(item => item.trim()).filter(Boolean)
    };
}

async function refreshPublishedNotices() {
    notices = await fetchAllPublishedNotices();
    filterCards();
}

async function publishReviewNotice(notify) {
    if (reviewMutationInFlight || !selectedReviewNoticeId) return;
    const edits = collectReviewEdits();
    if (!edits.title || !edits.content || edits.targets.length === 0) {
        setReviewStatus('제목, 원문, 대상 학번을 확인해주세요.', true);
        return;
    }
    setReviewMutationBusy(true);
    setReviewStatus(notify ? '승인하고 알림 작업을 만들고 있습니다.' : '공지를 승인하고 있습니다.');
    try {
        await apiRequest(`/api/admin/review-notices/${encodeURIComponent(selectedReviewNoticeId)}/publish`, {
            method: 'POST',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify({ edits, notify })
        });
        selectedReviewNoticeId = null;
        await Promise.all([loadReviewNotices(), refreshPublishedNotices()]);
        setReviewStatus(notify ? '공지 승인과 알림 예약이 완료되었습니다.' : '공지가 승인되었습니다.');
    } catch (error) {
        setReviewStatus(error.message, true);
    } finally {
        setReviewMutationBusy(false);
    }
}

async function rejectReviewNotice() {
    if (reviewMutationInFlight || !selectedReviewNoticeId) return;
    const reason = window.prompt('반려 사유를 입력하세요. (선택)') ?? '';
    setReviewMutationBusy(true);
    setReviewStatus('공지를 반려하고 있습니다.');
    try {
        await apiRequest(`/api/admin/review-notices/${encodeURIComponent(selectedReviewNoticeId)}/reject`, {
            method: 'POST',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify({ reason })
        });
        selectedReviewNoticeId = null;
        await loadReviewNotices();
        setReviewStatus('공지가 반려되었습니다.');
    } catch (error) {
        setReviewStatus(error.message, true);
    } finally {
        setReviewMutationBusy(false);
    }
}

async function reanalyzeReviewNotice() {
    if (reviewMutationInFlight || !selectedReviewNoticeId) return;
    setReviewMutationBusy(true);
    setReviewStatus('AI가 원문을 다시 분석하고 있습니다.');
    try {
        const result = await apiRequest(
            `/api/admin/review-notices/${encodeURIComponent(selectedReviewNoticeId)}/reanalyze`,
            { method: 'POST', headers: getNoticeAdminHeaders() }
        );
        const index = reviewNotices.findIndex(item =>
            String(item.id) === String(selectedReviewNoticeId));
        if (index >= 0) reviewNotices[index] = result.notice;
        renderReviewEditor(result.notice);
        renderReviewNoticeList();
        setReviewStatus('AI 재분석이 완료되었습니다.');
    } catch (error) {
        setReviewStatus(error.message, true);
    } finally {
        setReviewMutationBusy(false);
    }
}

async function runManualCrawl() {
    if (reviewMutationInFlight) return;
    setReviewMutationBusy(true);
    setReviewStatus('ECE 사이트에서 새 공지를 확인하고 있습니다.');
    try {
        const result = await apiRequest('/api/admin/crawl/ece-academics', {
            method: 'POST',
            headers: getNoticeAdminHeaders()
        });
        await loadReviewNotices();
        setReviewStatus(`확인 완료: 새 검수 공지 ${Number(result.createdCount) || 0}건`);
    } catch (error) {
        setReviewStatus(error.message, true);
    } finally {
        setReviewMutationBusy(false);
    }
}

window.addEventListener('keydown', event => {
    if (event.key === 'Escape'
        && document.getElementById('review-manager-modal')?.style.display === 'flex') {
        closeReviewManager();
    }
});

function setCategoryManagerStatus(message, isError = false) {
    const element = document.getElementById('category-manager-status');
    element.textContent = message || '';
    element.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
}

async function loadCategoryCandidates() {
    const list = document.getElementById('category-candidate-list');
    list.innerHTML = '<div class="review-empty">추천 후보를 계산하고 있습니다.</div>';
    setCategoryManagerStatus('최근 공지의 키워드와 신뢰도를 확인하고 있습니다.');
    try {
        await loadCategories();
        const result = await apiRequest('/api/admin/category-candidates', {
            method: 'GET',
            headers: getNoticeAdminHeaders()
        });
        categoryCandidates = Array.isArray(result?.candidates) ? result.candidates : [];
        renderCategoryCandidates();
        setCategoryManagerStatus(categoryCandidates.length > 0
            ? `관리자 결정이 필요한 후보 ${categoryCandidates.length}건`
            : '현재 기준을 충족한 새 카테고리 후보가 없습니다.');
    } catch (error) {
        list.innerHTML = '<div class="review-empty">추천 후보를 불러오지 못했습니다.</div>';
        setCategoryManagerStatus(error.message, true);
    }
}

function renderCategoryCandidates() {
    const list = document.getElementById('category-candidate-list');
    if (categoryCandidates.length === 0) {
        list.innerHTML = '<div class="review-empty">현재 추천 후보가 없습니다.</div>';
        return;
    }
    const categoryOptions = activeCategories.map(category =>
        `<option value="${Number(category.id)}">${escapeHtml(category.name)}</option>`
    ).join('');
    list.innerHTML = categoryCandidates.map(candidate => {
        const evidence = (candidate.supportingNotices || []).slice(0, 5);
        return `
            <article class="category-candidate">
                <div class="category-candidate-header">
                    <h3>${escapeHtml(candidate.displayName)}</h3>
                    <span class="category-candidate-metrics">
                        ${Number(candidate.occurrenceCount)}개 공지 · 신뢰도 ${Math.round(Number(candidate.averageConfidence) * 100)}%
                    </span>
                </div>
                <p class="review-list-meta">
                    ${escapeHtml(String(candidate.firstSeenAt || '').slice(0, 10))}
                    ~ ${escapeHtml(String(candidate.lastSeenAt || '').slice(0, 10))}
                </p>
                <ul class="category-evidence">${evidence.map(notice =>
                    `<li>${escapeHtml(notice.title || `공지 ${notice.id}`)}</li>`
                ).join('')}</ul>
                <div class="category-candidate-actions">
                    <button class="btn btn-small" type="button" onclick="approveCategoryCandidate(${Number(candidate.id)})">새 카테고리로 추가</button>
                    <select id="category-merge-${Number(candidate.id)}" aria-label="${escapeHtml(candidate.displayName)} 병합 대상">
                        <option value="">기존 카테고리 선택</option>${categoryOptions}
                    </select>
                    <button class="btn btn-outline btn-small" type="button" onclick="mergeCategoryCandidate(${Number(candidate.id)})">병합</button>
                    <button class="btn btn-outline btn-small" type="button" onclick="deferCategoryCandidate(${Number(candidate.id)})">30일 보류</button>
                    <button class="btn btn-danger btn-small" type="button" onclick="rejectCategoryCandidate(${Number(candidate.id)})">다시 추천 안 함</button>
                </div>
            </article>`;
    }).join('');
}

async function decideCategoryCandidate(id, action, body = {}) {
    setCategoryManagerStatus('카테고리 결정을 저장하고 있습니다.');
    try {
        await apiRequest(`/api/admin/category-candidates/${encodeURIComponent(id)}/${action}`, {
            method: 'POST',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify(body)
        });
        await Promise.all([
            loadCategoryCandidates(),
            refreshPublishedNotices()
        ]);
    } catch (error) {
        setCategoryManagerStatus(error.message, true);
    }
}

async function approveCategoryCandidate(id) {
    const candidate = categoryCandidates.find(item => Number(item.id) === Number(id));
    if (!candidate) return;
    const name = window.prompt('새 카테고리 이름', candidate.displayName);
    if (!name?.trim()) return;
    const suggestedSlug = String(candidate.normalizedKeyword)
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/[가-힣]/g, '')
        .replace(/^-|-$/g, '') || `category-${id}`;
    const slug = window.prompt('URL용 영문 슬러그 (예: scholarships)', suggestedSlug);
    if (!slug?.trim()) return;
    await decideCategoryCandidate(id, 'approve', {
        name: name.trim(),
        slug: slug.trim().toLowerCase()
    });
}

async function mergeCategoryCandidate(id) {
    const select = document.getElementById(`category-merge-${id}`);
    const categoryId = Number(select?.value);
    if (!categoryId) {
        setCategoryManagerStatus('병합할 기존 카테고리를 선택해주세요.', true);
        return;
    }
    await decideCategoryCandidate(id, 'merge', { categoryId });
}

async function deferCategoryCandidate(id) {
    await decideCategoryCandidate(id, 'defer');
}

async function rejectCategoryCandidate(id) {
    if (!window.confirm('이 키워드를 앞으로 다시 추천하지 않도록 반려할까요?')) return;
    await decideCategoryCandidate(id, 'reject');
}

window.addEventListener('keydown', event => {
    if (event.key === 'Escape'
        && document.getElementById('category-manager-modal')?.style.display === 'flex') {
        closeCategoryManager();
    }
});

function pushSupported() {
    return 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window;
}

function base64UrlToBytes(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, character => character.charCodeAt(0));
}

function setNotificationStatus(message, isError = false) {
    const element = document.getElementById('notification-status');
    element.textContent = message || '';
    element.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
}

async function loadNotificationCategories() {
    const list = document.getElementById('notification-category-list');
    try {
        const result = await apiRequest('/api/categories', { method: 'GET' });
        const categories = Array.isArray(result?.categories) ? result.categories : [];
        list.innerHTML = categories.length > 0
            ? categories.map(category => `
                <label>
                    <input type="checkbox" name="notification-category" value="${escapeHtml(category.id)}">
                    ${escapeHtml(category.name)}
                </label>`).join('')
            : '<span class="review-list-meta">등록된 카테고리가 없습니다. 모든 카테고리 알림을 선택하세요.</span>';
    } catch {
        list.innerHTML = '<span class="review-list-meta">카테고리를 불러오지 못했습니다. 모든 카테고리 알림을 선택할 수 있습니다.</span>';
    }
}

async function openNotificationPreferences() {
    const modal = document.getElementById('notification-modal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    const supported = pushSupported();
    document.getElementById('notification-unsupported').hidden = supported;
    document.getElementById('notification-form').hidden = !supported;
    const hasManagementToken = Boolean(localStorage.getItem('ecePushManagementToken'));
    document.getElementById('notification-delete').hidden = !hasManagementToken;
    setNotificationStatus(
        supported
            ? (Notification.permission === 'denied'
                ? '브라우저 설정에서 이 사이트의 알림 권한을 허용해주세요.'
                : '저장 버튼을 누를 때 브라우저가 알림 권한을 요청합니다.')
            : '현재 브라우저에서는 웹 푸시를 사용할 수 없습니다.',
        supported && Notification.permission === 'denied'
    );
    await loadNotificationCategories();
    modal.querySelector('.close-btn')?.focus();
}

function closeNotificationPreferences() {
    const modal = document.getElementById('notification-modal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function collectNotificationPreferences() {
    return {
        admissionYear: document.getElementById('notification-year').value || null,
        allNotices: document.getElementById('notification-all').checked,
        categoryIds: Array.from(
            document.querySelectorAll('input[name="notification-category"]:checked')
        ).map(input => Number(input.value)),
        urgentEnabled: document.getElementById('notification-urgent').checked,
        deadlineReminderDays: Number(document.getElementById('notification-reminder').value) || null
    };
}

async function saveNotificationPreferences() {
    if (!pushSupported()) return;
    const button = document.getElementById('notification-save');
    button.disabled = true;
    setNotificationStatus('알림 권한과 구독 정보를 확인하고 있습니다.');
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('알림 권한이 허용되지 않았습니다.');
        }
        const registration = await navigator.serviceWorker.ready;
        let browserSubscription = await registration.pushManager.getSubscription();
        const subscriptionId = localStorage.getItem('ecePushSubscriptionId');
        const managementToken = localStorage.getItem('ecePushManagementToken');
        const preferences = collectNotificationPreferences();

        if (subscriptionId && managementToken && browserSubscription) {
            await apiRequest(`/api/push/subscriptions/${encodeURIComponent(subscriptionId)}`, {
                method: 'PUT',
                headers: { 'x-subscription-token': managementToken },
                body: JSON.stringify({ preferences })
            });
        } else {
            const keyResult = await apiRequest('/api/push/public-key', { method: 'GET' });
            browserSubscription = browserSubscription || await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: base64UrlToBytes(keyResult.publicKey)
            });
            const result = await apiRequest('/api/push/subscriptions', {
                method: 'POST',
                body: JSON.stringify({
                    subscription: browserSubscription.toJSON(),
                    preferences
                })
            });
            localStorage.setItem('ecePushSubscriptionId', String(result.subscription.id));
            localStorage.setItem('ecePushManagementToken', result.managementToken);
        }
        document.getElementById('notification-delete').hidden = false;
        setNotificationStatus('이 기기의 알림 설정을 저장했습니다.');
    } catch (error) {
        setNotificationStatus(error.message, true);
    } finally {
        button.disabled = false;
    }
}

async function unsubscribeNotifications() {
    const subscriptionId = localStorage.getItem('ecePushSubscriptionId');
    const managementToken = localStorage.getItem('ecePushManagementToken');
    if (!subscriptionId || !managementToken) return;
    const button = document.getElementById('notification-delete');
    button.disabled = true;
    setNotificationStatus('알림 구독을 해지하고 있습니다.');
    try {
        await apiRequest(`/api/push/subscriptions/${encodeURIComponent(subscriptionId)}`, {
            method: 'DELETE',
            headers: { 'x-subscription-token': managementToken },
            body: JSON.stringify({})
        });
        const registration = await navigator.serviceWorker.ready;
        const browserSubscription = await registration.pushManager.getSubscription();
        await browserSubscription?.unsubscribe();
        localStorage.removeItem('ecePushSubscriptionId');
        localStorage.removeItem('ecePushManagementToken');
        button.hidden = true;
        setNotificationStatus('알림 구독을 해지했습니다.');
    } catch (error) {
        setNotificationStatus(error.message, true);
    } finally {
        button.disabled = false;
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(error => {
            console.error('서비스 워커 등록 실패:', error);
        });
    });
}

window.addEventListener('keydown', event => {
    if (event.key === 'Escape'
        && document.getElementById('notification-modal')?.style.display === 'flex') {
        closeNotificationPreferences();
    }
});
