// ========================================
// SNU ECE 공지방 — core.js
// 뷰 모드와 무관한 공통 레이어.
//   · 서버 통신, 공지 저장소, 필터/정렬, 카드 렌더, 상세 보기, 비교, 알림 구독
//   · 뷰 모듈(desktop.js / mobile.js) 등록 및 전환
// 관리자 기능은 admin.js로 완전히 분리되어 이 파일에 없다.
// ========================================

// D-Day 기준일. 페이지를 열어둔 채 자정을 넘겨도 맞도록 호출 시점마다 계산한다.
function getCurrentDate() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
}

// config.js가 빈 문자열(동일 출처)을 지정했을 수 있으므로 || 대신 타입으로 판별한다.
const API_BASE_URL = (
    typeof window.API_BASE_URL === 'string'
        ? window.API_BASE_URL
        : (localStorage.getItem('eceApiBaseUrl') || '')
).trim().replace(/\/$/, '');

let currentViewId = null;
let currentImageArray = [];
let currentImageIndex = 0;

let notices = [];
let bannerSlides = [];
let compareBlocks = [];   // 비교 패널에 담긴 공지 id들 (최대 4)

let adminInfo = { name: "ECE 학생회장 (이름 : 박지호)", phone: "010-1234-5678", kakao: "snu_ece_pres" };
let bannerAdminInfo = { name: "학생회 대외협력국 (국장 : 이배너)", phone: "010-8888-9999", kakao: "snu_ece_ads" };
let noticeAdminAuthToken = '';
let superAdminAuthToken = '';
let bannerManageAuthToken = '';
let activeCategories = [];
let selectedCategoryFilters = new Set();

const filterState = {
    'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'views': '전체', 'sort': '최신순'
};
const FILTER_DEFAULTS = Object.freeze({
    'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'views': '전체', 'sort': '최신순'
});

function buildApiUrl(path) {
    return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

// ========================================
// 🖥 뷰 모드 (데스크탑 / 모바일)
// 레이아웃은 CSS가 data-view로 가르고, 동작 차이는 등록된 뷰 모듈이 맡는다.
// ========================================

const viewModules = new Map();
let activeViewModule = null;

function getLayoutMode() {
    return document.documentElement.getAttribute('data-view') === 'mobile' ? 'mobile' : 'desktop';
}

function applyViewModule(mode) {
    const next = viewModules.get(mode) || null;
    if (activeViewModule && activeViewModule !== next) activeViewModule.deactivate?.();
    activeViewModule = next;
    activeViewModule?.activate?.();
}

// desktop.js / mobile.js가 자기 자신을 등록한다. 로드 순서에 의존하지 않도록
// 등록 시점이 이미 활성 모드라면 곧바로 활성화한다.
function registerViewModule(name, viewModule) {
    viewModules.set(name, viewModule);
    if (getLayoutMode() === name) applyViewModule(name);
}

function setLayoutMode(mode, { persist = true } = {}) {
    const next = mode === 'mobile' ? 'mobile' : 'desktop';
    document.documentElement.setAttribute('data-view', next);

    // 데스크탑 모드는 좁은 기기에서도 데스크탑 폭을 그대로 보여줘야 의미가 있다.
    const viewport = document.getElementById('viewport-meta');
    if (viewport) {
        viewport.setAttribute('content', next === 'desktop'
            ? 'width=1280'
            : 'width=device-width, initial-scale=1.0');
    }

    if (persist) {
        try { localStorage.setItem('eceLayoutMode', next); } catch { /* 저장 실패는 무시 */ }
    }

    updateLayoutToggleLabel();
    applyViewModule(next);
    renderRightRailAd();
}

function toggleLayoutMode() {
    setLayoutMode(getLayoutMode() === 'desktop' ? 'mobile' : 'desktop');
}

function updateLayoutToggleLabel() {
    const button = document.getElementById('view-mode-toggle');
    if (!button) return;
    button.textContent = '모바일 모드';
    button.setAttribute('aria-label', '모바일 화면 미리보기 열기');
}

// ========================================
// 📱 폰 미리보기
// "모바일 모드"는 데스크탑 화면을 모바일로 바꾸는 게 아니라, 데스크탑은 그대로 두고
// 실제 폰 크기 프레임 안에 모바일 화면을 iframe으로 띄운다. 뒤 배경은 흐려진다.
// ========================================

function openDevicePreview() {
    const preview = document.getElementById('device-preview');
    const iframe = document.getElementById('device-iframe');
    if (!preview || !iframe) return;

    // 먼저 보이게 한 뒤 src를 넣는다. hidden(display:none) 상태에서 넣으면
    // 브라우저가 iframe 로드를 미뤄 흰 화면으로 남을 수 있다.
    // 인라인 style은 어떤 스타일시트보다 세므로, 캐시된 옛 CSS가 있어도 확실히 열고 닫힌다.
    preview.hidden = false;
    preview.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // ?view=mobile 로 iframe 안을 모바일로 강제하고, ?preview=1 로 그 안에서
    // 다시 미리보기 버튼이 뜨지 않게 한다. t 파라미터로 캐시·재사용을 막는다.
    const url = new URL('./index.html', location.href);
    url.searchParams.set('view', 'mobile');
    url.searchParams.set('preview', '1');
    url.searchParams.set('t', String(Date.now()));
    iframe.src = url.toString();

    preview.querySelector('.device-close')?.focus();
}

function closeDevicePreview() {
    const preview = document.getElementById('device-preview');
    const iframe = document.getElementById('device-iframe');
    if (!preview) return;
    preview.hidden = true;
    preview.style.display = 'none';
    document.body.style.overflow = '';
    // iframe을 완전히 멈춰 리소스·소리·타이머가 뒤에서 계속 돌지 않게 한다.
    if (iframe) iframe.src = 'about:blank';
}

function createNoticeViewportLoader(options) {
    const {
        IntersectionObserverCtor,
        resolveUrl,
        defaultUrl
    } = options;
    let thumbnailObserver = null;
    let paginationObserver = null;
    let paginationLoading = false;

    function loadThumbnail(image) {
        const pendingUrl = image?.dataset?.thumbnailSrc;
        if (!pendingUrl) return;
        image.addEventListener('error', () => {
            if (image.dataset.defaultFallbackApplied === 'true') return;
            image.dataset.defaultFallbackApplied = 'true';
            image.src = defaultUrl;
        });
        image.src = resolveUrl(pendingUrl);
        delete image.dataset.thumbnailSrc;
        thumbnailObserver?.unobserve(image);
    }

    if (IntersectionObserverCtor) {
        thumbnailObserver = new IntersectionObserverCtor(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) loadThumbnail(entry.target);
            });
        }, { rootMargin: '0px', threshold: 0.01 });
    }

    function observeThumbnail(image) {
        if (!image?.dataset?.thumbnailSrc) return;
        if (thumbnailObserver) {
            thumbnailObserver.observe(image);
        } else {
            loadThumbnail(image);
        }
    }

    function observePaginationSentinel(sentinel, loadNextPage) {
        if (!sentinel || typeof loadNextPage !== 'function' || !IntersectionObserverCtor) return;
        paginationObserver?.disconnect();
        paginationObserver = new IntersectionObserverCtor(entries => {
            if (paginationLoading || !entries.some(entry => entry.isIntersecting)) return;
            paginationLoading = true;
            Promise.resolve(loadNextPage()).finally(() => {
                paginationLoading = false;
            });
        }, { rootMargin: '0px 0px 240px 0px', threshold: 0 });
        paginationObserver.observe(sentinel);
    }

    return {
        observeThumbnail,
        observePaginationSentinel
    };
}

const noticeViewportLoader = createNoticeViewportLoader({
    IntersectionObserverCtor: window.IntersectionObserver,
    resolveUrl: value => value.startsWith('/api/') ? buildApiUrl(value) : value,
    defaultUrl: '/icons/default-notice-thumbnail.png'
});

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

function createNoticeRepository(request) {
    const pageSize = 20;
    let items = [];
    let pageState = { page: 0, limit: pageSize, total: 0, totalPages: 0 };
    const detailRequests = new Map();

    async function loadPage(page, { replace = false } = {}) {
        const result = await request(`/api/notices?page=${page}&limit=${pageSize}`, { method: 'GET' });
        const incoming = Array.isArray(result?.notices) ? result.notices : [];
        if (replace) {
            items = [...incoming];
        } else {
            const knownIds = new Set(items.map(notice => String(notice.id)));
            items = [
                ...items,
                ...incoming.filter(notice => !knownIds.has(String(notice.id)))
            ];
        }
        pageState = {
            page: Number(result?.pagination?.page) || page,
            limit: Number(result?.pagination?.limit) || pageSize,
            total: Number(result?.pagination?.total) || 0,
            totalPages: Number(result?.pagination?.totalPages) || 0
        };
        return { notices: items, pagination: pageState };
    }

    async function getDetail(id) {
        const noticeId = String(id);
        const existing = items.find(notice => String(notice.id) === noticeId);
        if (existing && Object.hasOwn(existing, 'content')) return existing;
        if (detailRequests.has(noticeId)) return detailRequests.get(noticeId);

        const pending = request(`/api/notices/${encodeURIComponent(noticeId)}`, { method: 'GET' })
            .then(result => {
                if (!result?.notice) throw new Error('공지 상세를 불러오지 못했습니다.');
                const index = items.findIndex(notice => String(notice.id) === noticeId);
                if (index === -1) {
                    items.push(result.notice);
                    return result.notice;
                }
                items[index] = { ...items[index], ...result.notice };
                return items[index];
            })
            .finally(() => detailRequests.delete(noticeId));
        detailRequests.set(noticeId, pending);
        return pending;
    }

    return {
        loadPage,
        getDetail,
        get notices() { return items; },
        get pagination() { return pageState; }
    };
}

const noticeRepository = createNoticeRepository(apiRequest);
let noticePageLoading = false;

function updateNoticePaginationUI(
    pagination = noticeRepository.pagination,
    loadedCount = notices.length,
    isLoading = noticePageLoading
) {
    const button = document.getElementById('notice-load-more');
    const status = document.getElementById('notice-load-more-status');
    if (!button || !status) return;

    const page = Number(pagination?.page) || 0;
    const totalPages = Number(pagination?.totalPages) || 0;
    const total = Number(pagination?.total) || 0;
    status.textContent = `${Math.min(Number(loadedCount) || 0, total)} / ${total}`;
    button.hidden = totalPages === 0 || page >= totalPages;
    button.disabled = Boolean(isLoading);
    button.textContent = isLoading ? '불러오는 중...' : '더 보기';
}

async function loadNoticePage(page, { replace = false } = {}) {
    const result = await noticeRepository.loadPage(page, { replace });
    notices = result.notices;
    updateNoticePaginationUI(result.pagination, notices.length, noticePageLoading);
    return result;
}

async function loadMoreNotices() {
    const { page, totalPages } = noticeRepository.pagination;
    if (noticePageLoading || page >= totalPages) return;

    noticePageLoading = true;
    updateNoticePaginationUI(noticeRepository.pagination, notices.length, true);
    try {
        await loadNoticePage(page + 1);
        buildHostButtons();
        filterCards();
    } catch (error) {
        console.error('공지 목록 추가 로드 실패:', error);
        alert('공지 목록을 더 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
        noticePageLoading = false;
        updateNoticePaginationUI(noticeRepository.pagination, notices.length, false);
    }
}

async function getNoticeDetail(id) {
    const notice = await noticeRepository.getDetail(id);
    notices = noticeRepository.notices;
    return notice;
}

// ========================================
// 💾 초기 데이터 로드
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
        await loadNoticePage(1, { replace: true });
    } catch (error) {
        console.error('공지 목록 불러오기 실패:', error);
        // 가짜 공지를 대신 보여주면 안 되므로 빈 목록으로 두고 실패 사실만 알린다.
        notices = [];
        alert('공지 목록을 불러오지 못했습니다. 잠시 후 새로고침해주세요.');
    }

    await loadBannerSlides();
    startBannerPolling();
}

// 제목을 눌렀을 때의 새로고침. 페이지를 통째로 다시 받지 않고 데이터만 갱신한다.
async function reloadNoticeBoard() {
    const title = document.getElementById('site-title');
    if (title) title.disabled = true;
    try {
        await loadNoticePage(1, { replace: true });
        await loadCategories();
        buildCategoryTabs();
        await loadBannerSlides();
        buildHostButtons();
        filterCards();
    } catch (error) {
        console.error('공지 새로고침 실패:', error);
        alert('공지를 다시 불러오지 못했습니다. 잠시 후 시도해주세요.');
    } finally {
        if (title) title.disabled = false;
    }
}

async function loadBannerSlides() {
    try {
        const result = await apiRequest('/api/banner-slides', { method: 'GET' });
        if (Array.isArray(result?.slides)) {
            bannerSlides = result.slides;
            renderRightRailAd();
        }
    } catch (error) {
        console.error('배너 슬라이드 로드 실패:', error);
        // 배너 로드 실패 시 기본 안내 문구 유지
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
                if (JSON.stringify(bannerSlides) !== JSON.stringify(newSlides)) {
                    bannerSlides = newSlides;
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

function renderRightRailInquiryFallback() {
    const container = document.getElementById('right-rail-ad-content');
    if (!container) return;

    container.innerHTML = `
        <span class="ad-label">AD</span>
        <h2>배너 광고 문의</h2>
        <p>학생들에게 소식을 알릴 세로 배너를 등록해보세요.</p>
        <button class="rail-cta" type="button" onclick="openModal('contact-modal')">배너 문의하기</button>
    `;
}

function renderRightRailAd() {
    const container = document.getElementById('right-rail-ad-content');
    if (!container) return;
    const slide = getBannerSlidesByPlacement('right_rail')[0];

    if (!slide) {
        renderRightRailInquiryFallback();
        return;
    }

    const image = slide.src
        ? `<img class="rail-ad-image" src="${escapeHtml(slide.src)}" alt="${escapeHtml(slide.altText || slide.name || '광고 이미지')}" onerror="renderRightRailInquiryFallback()">`
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
function copyBannerPhone() { copyToClipboard(bannerAdminInfo.phone); }
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

// 서울대 소식처럼 요일까지 붙인 날짜. "2026.07.27.(월)" 형태.
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithWeekday(value) {
    if (!value) return '';
    // 'YYYY-MM-DD'는 로컬 자정으로 파싱해 시간대에 따라 하루가 밀리지 않게 한다.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(value + 'T00:00:00')
        : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}.(${WEEKDAY_KO[date.getDay()]})`;
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

function safeHttpUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch {
        return '#';
    }
}

// ========================================
// 🎨 모달
// ========================================

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'none';
}

function openContactFromRail() {
    if (typeof closeMobileDrawer === 'function') closeMobileDrawer();
    const status = document.getElementById('feedback-status');
    if (status) status.textContent = '';
    openModal('contact-modal');
    document.getElementById('feedback-message')?.focus();
}

// 익명 피드백 전송. 서버는 메시지와 시각만 저장하고 신원은 남기지 않는다.
async function submitFeedback() {
    const input = document.getElementById('feedback-message');
    const status = document.getElementById('feedback-status');
    const button = document.getElementById('feedback-submit');
    const message = (input?.value || '').trim();

    const setStatus = (text, isError = false) => {
        if (!status) return;
        status.textContent = text;
        status.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
    };

    if (message.length < 5) {
        setStatus('5자 이상 입력해주세요.', true);
        input?.focus();
        return;
    }

    button.disabled = true;
    setStatus('보내는 중입니다...');
    try {
        await apiRequest('/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        input.value = '';
        setStatus('보내주셔서 감사합니다. 익명으로 전달되었습니다.');
    } catch (error) {
        setStatus(error.message || '전송에 실패했습니다. 잠시 후 다시 시도해주세요.', true);
    } finally {
        button.disabled = false;
    }
}

window.onclick = function(event) {
    if (event.target.classList?.contains('overlay')) {
        event.target.style.display = 'none';
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
            await getNoticeDetail(requestedId);
            exists = true;
        } catch {
            // 아래의 사용자 안내로 통합한다.
        }
        if (!exists) {
            alert('링크에 해당하는 공지를 찾을 수 없습니다.\n삭제되었거나 주소가 잘못되었습니다.');
            clearNoticeUrl();
            return;
        }
    }

    await openDetail(requestedId);
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
    const requestedId = new URLSearchParams(location.search).get(NOTICE_URL_PARAM);

    // ?id= 가 사라졌으면(뒤로가기) 목록으로 돌아가고, 있으면 그 공지를 연다.
    if (!requestedId) {
        const board = document.getElementById('board-view');
        const detail = document.getElementById('notice-detail-view');
        if (detail) detail.hidden = true;
        if (board) board.hidden = false;
        currentViewId = null;
        return;
    }

    if (String(currentViewId) !== String(requestedId)) openDetail(requestedId);
});

// ========================================
// 👤 연락처 표시 (관리자 편집은 admin.html)
// ========================================

function renderAdminInfo() {
    const nameEl = document.getElementById('admin-name-display');
    const phoneEl = document.getElementById('admin-phone-display');
    const kakaoEl = document.getElementById('admin-kakao-display');
    if (nameEl) nameEl.innerText = adminInfo.name;
    if (phoneEl) phoneEl.innerText = adminInfo.phone;
    if (kakaoEl) kakaoEl.innerText = adminInfo.kakao;
}

function renderBannerAdminInfo() {
    const nameEl = document.getElementById('banner-admin-name-display');
    const phoneEl = document.getElementById('banner-admin-phone-display');
    const kakaoEl = document.getElementById('banner-admin-kakao-display');
    if (nameEl) nameEl.innerText = bannerAdminInfo.name;
    if (phoneEl) phoneEl.innerText = bannerAdminInfo.phone;
    if (kakaoEl) kakaoEl.innerText = bannerAdminInfo.kakao;
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
    if (!container) return;
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
    buildCategoryTabs();
}

// 서울대 소식 스타일 카테고리 탭. '전체' + 서버 카테고리 하나를 골라 걸러 본다(단일 선택).
function buildCategoryTabs() {
    const inner = document.getElementById('category-tabs-inner');
    if (!inner) return;
    const current = selectedCategoryFilters.size === 1 ? [...selectedCategoryFilters][0] : 'all';
    let html = `<button type="button" class="category-tab ${current === 'all' ? 'active' : ''}" data-category="all" onclick="selectCategoryTab('all')">전체</button>`;
    html += activeCategories.map(category => {
        const id = Number(category.id);
        return `<button type="button" class="category-tab ${current === id ? 'active' : ''}" data-category="${id}" onclick="selectCategoryTab('${id}')">${escapeHtml(category.name)}</button>`;
    }).join('');
    inner.innerHTML = html;
}

function selectCategoryTab(value) {
    selectedCategoryFilters.clear();
    if (value !== 'all') selectedCategoryFilters.add(Number(value));
    buildCategoryTabs();
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
    if (!chipsArea || !bar || !labelEl) return;
    chipsArea.innerHTML = '';

    const labelMap = { 'deadline-status': '마감', 'host': '기관', 'has-image': '이미지', 'views': '조회수', 'sort': '정렬' };
    let hasActive = false;

    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo = document.getElementById('filter-date-to')?.value;

    Object.entries(filterState).forEach(([group, val]) => {
        if (val !== FILTER_DEFAULTS[group]) {
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
    const count = chipsArea.children.length;
    const svg = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h18M7 8h10M11 12h2M9 16h6"/></svg>`;
    labelEl.innerHTML = `${svg} 상세 필터${hasActive ? ` <span style="background:var(--primary);color:white;font-size:11px;padding:2px 7px;border-radius:10px;">${count}</span>` : ''}`;
}

function resetFilterGroup(group) {
    filterState[group] = FILTER_DEFAULTS[group];
    document.querySelectorAll(`[data-group="${group}"]`).forEach(b => { b.classList.toggle('active', b.dataset.val === FILTER_DEFAULTS[group]); });
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
    buildCategoryTabs();
    filterCards();
    updateFilterChips();
}

function resetAllFilters() {
    Object.keys(filterState).forEach(g => { filterState[g] = FILTER_DEFAULTS[g]; });
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.toggle('active', b.dataset.val === FILTER_DEFAULTS[b.dataset.group]); });
    selectedCategoryFilters.clear();
    buildCategoryTabs();
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
    const fViews = filterState['views'];
    const fSort = filterState['sort'];
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo = document.getElementById('filter-date-to')?.value || '';

    const grid = document.getElementById('notice-grid');
    grid.innerHTML = "";

    // 비교 블록(2개 이상)에 담긴 공지는 목록 맨 위 인라인 블록으로 묶어 보여주고,
    // 아래 일반 목록에서는 뺀다.
    const blockIds = compareBlocks.filter(id => notices.some(n => String(n.id) === String(id)));
    const blockSet = new Set(blockIds);
    if (blockIds.length >= 2) grid.appendChild(buildCompareInline(blockIds));

    let filtered = [];

    notices.forEach(notice => {
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

        const hasImg = Object.hasOwn(notice, 'hasImages')
            ? notice.hasImages
            : Boolean(notice.images && notice.images.length > 0);
        if (fHasImage === '있음' && !hasImg) return;
        if (fHasImage === '없음' && hasImg) return;

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
        if (blockSet.has(String(notice.id))) return;   // 비교 블록에 든 공지는 목록에서 뺀다
        const dDay = calcDDay(notice.deadline);
        const safeTitle = escapeHtml(notice.title || "제목 없음");
        const hasImg = Object.hasOwn(notice, 'hasImages')
            ? notice.hasImages
            : Boolean(notice.images && notice.images.length > 0);

        // 사진이 있으면 포스터를 지연 로드한다. 없으면 포스터 자리에 제목을 크게 보여준다.
        const posterHtml = hasImg
            ? `<div class="card-poster">
                   <img class="card-img-preview" alt="" data-thumbnail-src="${escapeHtml(notice.thumbnailUrl || '/icons/default-notice-thumbnail.png')}">
               </div>`
            : `<div class="card-poster is-text"><p class="card-poster-title">${safeTitle}</p></div>`;

        const cardClass = dDay.isExpired ? "card card-expired" : "card";
        const deadlineTagClass = dDay.isExpired ? 'expired' : dDay.isUrgent ? 'd-day' : '';

        // 날짜는 요일까지 보여준다. 마감일이 있으면 마감일을, 없으면 등록일을 기준으로.
        const dateLabel = notice.deadline
            ? `마감 ${formatDateWithWeekday(notice.deadline)}`
            : (notice.createdAt ? `등록 ${formatDateWithWeekday(notice.createdAt)}` : '상시 접수');
        // 본문 발췌: 목록 응답은 원문을 담지 않으므로 AI 3줄 요약을 발췌로 쓴다.
        const excerpt = Array.isArray(notice.aiSummary) ? notice.aiSummary.join(' ') : '';
        // 이미지 카드만 본문 위에 제목을 다시 보여준다(텍스트 카드는 포스터가 곧 제목).
        const titleHtml = hasImg ? `<h3 class="card-title">${safeTitle}</h3>` : '';

        const card = document.createElement('div');
        card.className = cardClass;
        card.onclick = () => openDetail(notice.id);
        // 노션처럼: 카드를 다른 카드 위로 끌어다 놓으면 둘이 비교 블록으로 묶인다.
        card.draggable = true;
        card.addEventListener('dragstart', event => onCardDragStart(event, notice.id));
        card.addEventListener('dragend', onCardDragEnd);
        card.addEventListener('dragover', event => onCardDragOver(event, card));
        card.addEventListener('dragleave', () => onCardDragLeave(card));
        card.addEventListener('drop', event => onCardDrop(event, notice.id));
        card.innerHTML = `
            <span class="card-drag-handle" aria-hidden="true" title="끌어서 비교 블록 만들기"><svg width="10" height="16" viewBox="0 0 10 16"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></g></svg></span>
            ${posterHtml}
            <div class="card-body">
                <div class="tags">
                    <span class="tag ${deadlineTagClass}">${dDay.text}</span>
                    <span class="tag target">${escapeHtml(notice.target || '전체')}</span>
                    ${notice.host ? `<span class="tag">${escapeHtml(notice.host)}</span>` : ''}
                </div>
                ${titleHtml}
                <div class="card-date">${escapeHtml(dateLabel)}</div>
                ${excerpt ? `<p class="card-excerpt">${escapeHtml(excerpt)}</p>` : ''}
                <div class="card-meta">
                    <span class="view-count">조회 ${Number(notice.views) || 0}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    if (grid.childElementCount === 0) {
        grid.innerHTML = '<div class="notice-empty-state">조건에 맞는 공지가 없습니다.</div>';
    }

    grid.querySelectorAll?.('img[data-thumbnail-src]')
        ?.forEach(image => noticeViewportLoader.observeThumbnail(image));

    const countEl = document.getElementById('filter-result-count');
    if (countEl) countEl.innerHTML = `결과 <strong>${filtered.length}</strong>건 / 전체 ${notices.length}건`;
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

async function openDetail(idStr) {
    currentViewId = String(idStr);
    let notice;
    try {
        notice = await getNoticeDetail(currentViewId);
    } catch (error) {
        console.error('공지 상세 불러오기 실패:', error);
        alert('공지 상세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
    }

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
        ${notice.host ? `<span class="tag">${escapeHtml(notice.host)}</span>` : ''}
    `;
    document.getElementById('detail-title').innerText = notice.title || "";
    const metaDate = notice.deadline ? `마감일: ${formatDateWithWeekday(notice.deadline)}` : '상시 접수';
    document.getElementById('detail-meta').innerHTML = `${escapeHtml(metaDate)} &nbsp;|&nbsp; 조회: ${Number(notice.views) || 0}`;
    document.getElementById('detail-summary').innerHTML = (notice.aiSummary || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
    document.getElementById('detail-content').innerHTML = linkify(notice.content || "");

    // 수정·삭제는 관리자 페이지로 넘긴다. 공개 화면에는 인증 UI를 두지 않는다.
    const adminLink = document.getElementById('detail-admin-edit-link');
    if (adminLink) adminLink.href = `./admin.html?edit=${encodeURIComponent(currentViewId)}`;

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

    // 대표 이미지는 상세 상단에 크게, 나머지는 갤러리로 보여준다.
    const hero = document.getElementById('detail-hero');
    const heroImg = document.getElementById('detail-hero-img');
    const gallery = document.getElementById('detail-gallery');
    gallery.innerHTML = '';
    if (notice.images && notice.images.length > 0) {
        heroImg.src = notice.images[0];
        heroImg.onclick = () => openImageViewer(0);
        heroImg.style.cursor = 'zoom-in';
        hero.hidden = false;
        if (notice.images.length > 1) {
            notice.images.forEach((src, idx) => {
                gallery.innerHTML += `<img src="${escapeHtml(src)}" class="gallery-img" onclick="openImageViewer(${idx})">`;
            });
            gallery.style.display = 'flex';
        } else {
            gallery.style.display = 'none';
        }
    } else {
        hero.hidden = true;
        gallery.style.display = 'none';
    }

    showDetailView();
    syncUrlToNotice(currentViewId);
}

// 목록을 숨기고 상세 페이지를 보인다. 모달이 아니라 화면 전체가 바뀐다.
function showDetailView() {
    const board = document.getElementById('board-view');
    const detail = document.getElementById('notice-detail-view');
    if (board) board.hidden = true;
    if (detail) detail.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
}

// 상세에서 목록으로 돌아온다. 주소창의 ?id= 도 지운다.
function closeDetail() {
    const board = document.getElementById('board-view');
    const detail = document.getElementById('notice-detail-view');
    if (detail) detail.hidden = true;
    if (board) board.hidden = false;
    currentViewId = null;
    // ?id= 를 남기지 않으려면 히스토리를 하나 되돌린다(직접 진입이면 그냥 지운다).
    if (new URLSearchParams(location.search).has(NOTICE_URL_PARAM) && window.history.length > 1) {
        history.back();
    } else {
        clearNoticeUrl();
    }
}

// ========================================
// 🧩 노션식 인라인 블록 비교
// 카드에 마우스를 올리면 6점 핸들이 뜨고, 카드를 다른 카드 위로 끌어다 놓으면
// 목록 맨 위에 두 공지가 나란히(모바일은 위아래로) 묶인 비교 블록이 생긴다.
// 별도 창이 아니라 기존 화면 안에서 블록화된다.
// ========================================

const NOTICE_DRAG_TYPE = 'application/x-ece-notice';

// 블록 최대 개수: 데스크탑 4개(가로), 모바일 2개(세로).
function maxCompareBlocks() {
    return getLayoutMode() === 'mobile' ? 2 : 4;
}

function onCardDragStart(event, id) {
    event.dataTransfer.setData(NOTICE_DRAG_TYPE, String(id));
    event.dataTransfer.setData('text/plain', String(id));
    event.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('dragging-notice');
}

function onCardDragEnd() {
    document.body.classList.remove('dragging-notice');
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
}

function draggedNoticeId(event) {
    return event.dataTransfer.getData(NOTICE_DRAG_TYPE) || event.dataTransfer.getData('text/plain') || '';
}

function onCardDragOver(event, targetEl) {
    if (![...event.dataTransfer.types].includes(NOTICE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (targetEl) targetEl.classList.add('is-drop-target');
}

function onCardDragLeave(targetEl) {
    if (targetEl) targetEl.classList.remove('is-drop-target');
}

// 카드 위에 다른 카드를 놓으면 둘을 하나의 비교 블록으로 묶는다.
async function onCardDrop(event, targetId) {
    event.preventDefault();
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    const draggedId = draggedNoticeId(event);
    if (!draggedId) return;
    await groupIntoCompareBlock(targetId, draggedId);
}

// 이미 만들어진 비교 블록 위에 카드를 놓으면 블록에 추가한다.
async function onBlockDrop(event) {
    event.preventDefault();
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    const draggedId = draggedNoticeId(event);
    if (!draggedId) return;
    await groupIntoCompareBlock(null, draggedId);
}

async function groupIntoCompareBlock(targetId, draggedId) {
    const dragged = String(draggedId);
    const target = targetId == null ? null : String(targetId);
    if (target !== null && target === dragged) return;

    const toAdd = [];
    if (target !== null && !compareBlocks.includes(target)) toAdd.push(target);
    if (!compareBlocks.includes(dragged)) toAdd.push(dragged);
    if (toAdd.length === 0) return;

    if (compareBlocks.length + toAdd.length > maxCompareBlocks()) {
        alert(`비교 블록은 최대 ${maxCompareBlocks()}개까지 묶을 수 있습니다.`);
        return;
    }

    try {
        // 원문·요약을 나란히 보여주려면 상세를 확보해야 한다.
        await Promise.all(toAdd.map(id => getNoticeDetail(id)));
    } catch (error) {
        console.error('비교 블록 상세 불러오기 실패:', error);
    }
    toAdd.forEach(id => compareBlocks.push(id));
    filterCards();
}

function removeFromCompareBlock(idStr) {
    compareBlocks = compareBlocks.filter(x => x !== String(idStr));
    // 블록은 2개 이상일 때만 의미가 있다. 하나만 남으면 해제한다.
    if (compareBlocks.length < 2) compareBlocks = [];
    filterCards();
}

function clearCompareBlock() {
    compareBlocks = [];
    filterCards();
}

// 목록 맨 위에 들어갈 비교 블록 DOM. 최소 2개일 때만 만든다.
function buildCompareInline(blockIds) {
    const wrap = document.createElement('div');
    wrap.className = 'compare-inline';
    wrap.dataset.blocks = String(blockIds.length);
    wrap.addEventListener('dragover', event => onCardDragOver(event, wrap));
    wrap.addEventListener('dragleave', () => onCardDragLeave(wrap));
    wrap.addEventListener('drop', event => onBlockDrop(event));

    const columns = blockIds.map((id, index) => {
        const notice = notices.find(n => String(n.id) === String(id));
        if (!notice) return '';
        const dDay = calcDDay(notice.deadline);
        const deadlineTagClass = dDay.isExpired ? 'expired' : dDay.isUrgent ? 'd-day' : '';
        const summary = (notice.aiSummary || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')
            || '<li style="color:var(--text-sub)">요약 없음</li>';
        const thumb = (notice.images && notice.images.length > 0)
            ? `<img class="compare-col-thumb" src="${escapeHtml(notice.images[0])}" alt="">`
            : '';
        const dateText = notice.deadline ? `마감 ${formatDateWithWeekday(notice.deadline)}` : '상시 접수';
        const safeId = escapeHtml(String(id));
        return `
            <article class="compare-col">
                <header class="compare-col-head">
                    <span class="compare-col-idx">${index + 1}</span>
                    <button class="compare-col-remove" type="button" aria-label="블록에서 빼기"
                            onclick="removeFromCompareBlock('${safeId}')">×</button>
                </header>
                <div class="compare-col-body">
                    ${thumb}
                    <div class="tags">
                        <span class="tag ${deadlineTagClass}">${dDay.text}</span>
                        <span class="tag target">${escapeHtml(notice.target || '전체')}</span>
                        ${notice.host ? `<span class="tag">${escapeHtml(notice.host)}</span>` : ''}
                    </div>
                    <h3 class="compare-col-title">${escapeHtml(notice.title || '')}</h3>
                    <div class="compare-col-meta">${escapeHtml(dateText)} · 조회 ${Number(notice.views) || 0}</div>
                    <h4 class="compare-col-label">AI 3줄 요약</h4>
                    <ul class="compare-col-summary">${summary}</ul>
                    <h4 class="compare-col-label">공지 원문</h4>
                    <div class="compare-col-content">${linkify(notice.content || '')}</div>
                    <button class="btn btn-outline btn-small" type="button" onclick="openDetail('${safeId}')">전체 보기</button>
                </div>
            </article>`;
    }).join('');

    wrap.innerHTML = `
        <div class="compare-inline-head">
            <span class="compare-inline-title">공지 비교 <strong>${blockIds.length}</strong> / ${maxCompareBlocks()}
                <span class="compare-inline-hint">— 카드를 더 끌어다 놓아 추가</span></span>
            <button class="btn btn-outline btn-small" type="button" onclick="clearCompareBlock()">비교 해제</button>
        </div>
        <div class="compare-inline-cols">${columns}</div>`;
    return wrap;
}

// ========================================
// 🔔 알림 구독 (제목 옆 종 아이콘)
// ========================================

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

function isPushSubscribed() {
    return Boolean(localStorage.getItem('ecePushSubscriptionId'));
}

// 종은 구독 상태를 그대로 비춘다. 꺼짐이면 흑백, 켜짐이면 노란색.
function updateBellState() {
    const bell = document.getElementById('bell-toggle');
    if (!bell) return;
    const subscribed = isPushSubscribed();
    bell.classList.toggle('active', subscribed);
    bell.setAttribute('aria-pressed', subscribed ? 'true' : 'false');
    bell.title = subscribed ? '알림 켜짐 — 눌러서 설정 변경' : '공지 알림 받기';
    bell.setAttribute('aria-label', subscribed ? '알림 설정 변경' : '공지 알림 받기');
}

function setNotificationStatus(message, isError = false) {
    const status = document.getElementById('notification-status');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
}

async function loadNotificationCategories() {
    const list = document.getElementById('notification-category-list');
    if (!list) return;
    if (activeCategories.length === 0) await loadCategories();
    if (activeCategories.length === 0) {
        list.innerHTML = '<span class="review-list-meta">등록된 카테고리가 없습니다.</span>';
        return;
    }
    list.innerHTML = activeCategories.map(category => `
        <label><input type="checkbox" name="notification-category" value="${Number(category.id)}">
        ${escapeHtml(category.name)}</label>
    `).join('');
}

async function openNotificationPreferences() {
    if (typeof closeMobileDrawer === 'function') closeMobileDrawer();
    const modal = document.getElementById('notification-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    const unsupported = document.getElementById('notification-unsupported');
    const form = document.getElementById('notification-form');
    if (!pushSupported()) {
        unsupported.hidden = false;
        form.hidden = true;
        return;
    }
    unsupported.hidden = true;
    form.hidden = false;

    await loadNotificationCategories();
    document.getElementById('notification-delete').hidden = !isPushSubscribed();
    setNotificationStatus(isPushSubscribed()
        ? '이 브라우저는 이미 알림을 받고 있습니다. 설정을 바꾸고 저장하세요.'
        : '알림을 허용하면 새 공지를 바로 알려드립니다.');
    modal.querySelector('.close-btn')?.focus();
}

function closeNotificationPreferences() {
    const modal = document.getElementById('notification-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function collectNotificationPreferences() {
    const categoryIds = Array.from(
        document.querySelectorAll('input[name="notification-category"]:checked')
    ).map(input => Number(input.value));
    return {
        year: document.getElementById('notification-year').value || null,
        allCategories: document.getElementById('notification-all').checked,
        categoryIds,
        includeUrgent: document.getElementById('notification-urgent').checked,
        reminderDaysBefore: Number(document.getElementById('notification-reminder').value) || null
    };
}

async function saveNotificationPreferences() {
    if (!pushSupported()) return;
    const button = document.getElementById('notification-save');
    button.disabled = true;
    setNotificationStatus('알림 권한을 확인하고 있습니다.');
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            setNotificationStatus('브라우저에서 알림이 차단되어 있습니다. 사이트 설정에서 허용해주세요.', true);
            return;
        }

        const config = await apiRequest('/api/push/public-key', { method: 'GET' });
        if (!config?.publicKey) throw new Error('서버에 알림 키가 설정되어 있지 않습니다.');

        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing || await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToBytes(config.publicKey)
        });

        const result = await apiRequest('/api/push/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                preferences: collectNotificationPreferences()
            })
        });

        if (result?.subscriptionId) localStorage.setItem('ecePushSubscriptionId', String(result.subscriptionId));
        if (result?.managementToken) localStorage.setItem('ecePushManagementToken', result.managementToken);

        document.getElementById('notification-delete').hidden = false;
        updateBellState();
        setNotificationStatus('알림 설정이 저장되었습니다.');
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
        updateBellState();
        setNotificationStatus('알림 구독을 해지했습니다.');
    } catch (error) {
        setNotificationStatus(error.message, true);
    } finally {
        button.disabled = false;
    }
}

// ========================================
// 🔐 초기화 & 이벤트
// ========================================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(error => {
            console.error('서비스 워커 등록 실패:', error);
        });
    });
}

document.addEventListener('keydown', function(e) {
    const viewer = document.getElementById('image-viewer-modal');
    if (viewer && viewer.style.display === 'flex') {
        if (e.key === 'ArrowLeft') navImage(-1);
        if (e.key === 'ArrowRight') navImage(1);
        if (e.key === 'Escape') closeModal('image-viewer-modal');
        return;
    }
    if (e.key !== 'Escape') return;

    // ESC 우선순위: 폰 미리보기 → 알림 설정 → 상세 페이지
    if (document.getElementById('device-preview') && !document.getElementById('device-preview').hidden) {
        closeDevicePreview();
    } else if (document.getElementById('notification-modal')?.style.display === 'flex') {
        closeNotificationPreferences();
    } else if (document.getElementById('notice-detail-view') && !document.getElementById('notice-detail-view').hidden) {
        closeDetail();
    }
});

// 공개 화면에서만 목록을 렌더한다. admin.html은 core.js의 유틸만 빌려 쓴다.
document.addEventListener('DOMContentLoaded', async function () {
    if (document.body.dataset.page !== 'public') return;

    updateLayoutToggleLabel();
    applyViewModule(getLayoutMode());
    updateBellState();

    await loadData();
    await loadCategories();
    buildCategoryTabs();
    renderRightRailAd();
    buildHostButtons();
    filterCards();
    noticeViewportLoader.observePaginationSentinel(
        document.getElementById('notice-scroll-sentinel'),
        loadMoreNotices
    );
    openNoticeFromUrl();   // 카톡 링크로 들어온 경우 해당 공지를 바로 연다
});
