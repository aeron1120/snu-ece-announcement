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
let detailImageArray = [];
let detailImageIndex = 0;
let imageSwipeStartX = null;
let boardScrollPosition = 0;
let detailHistoryPushed = false;

let notices = [];
let bannerSlides = [];
let activeBannerSlideIndex = 0;
let initialBannerRandomized = false;
let bannerRotationInterval = null;
let bannerTransitionTimer = null;
let bannerSwipePointerId = null;
let bannerSwipeStartX = 0;
let bannerSwipeStartY = 0;
let bannerSwipeDeltaX = 0;
let suppressBannerLinkUntil = 0;
let compareBlocks = [];   // 독립 비교 공간에 담긴 공지 id들 (데스크톱 전용, 최대 4)
let compareWorkspaceOpen = false;
let compareDockSide = 'left';
let compareLayoutMode = 'stack';
let expandedCompareBlocks = new Set();
let activeNoticeSplitDragId = '';
let noticeSplitDragOverlay = null;
let noticeSplitOverlayTimer = null;
let noticeDragInProgress = false;
let suppressNoticeClickUntil = 0;
let pointerNoticeDrag = null;
let pointerDraggedCompareId = '';
let pointerDragHandle = null;
let compareDragOverlay = null;
let activeCompareDropTargetId = '';
let activeCompareDropPosition = 'after';
let activeFeedbackCategory = 'general';
let noticeHoverPreviewTimer = null;
let activeHoverPreviewNoticeId = '';

let adminInfo = { name: "ECE 학생회장 (이름 : 박지호)", phone: "010-1234-5678", kakao: "snu_ece_pres" };
let bannerAdminInfo = { name: "학생회 대외협력국 (국장 : 이배너)", phone: "010-8888-9999", kakao: "snu_ece_ads" };
let noticeAdminAuthToken = '';
let superAdminAuthToken = '';
let bannerManageAuthToken = '';
let activeCategories = [];
let selectedCategoryFilters = new Set();
let archiveTabActive = false;
const quickNoticeFilters = {
    urgent: false,
    reward: false,
    action: false,
    past: false
};

const NOTICE_CATEGORY_ORDER = Object.freeze([
    'academic',
    'opportunity',
    'benefit',
    'community'
]);

function orderedNoticeCategories(categories = activeCategories) {
    const order = new Map(NOTICE_CATEGORY_ORDER.map((slug, index) => [slug, index]));
    return categories
        .filter(category => order.has(category.slug))
        .sort((a, b) => order.get(a.slug) - order.get(b.slug));
}

const filterState = {
    'deadline-status': '전체', 'host': '전체', 'views': '전체', 'sort': '최신순'
};
const FILTER_DEFAULTS = Object.freeze({
    'deadline-status': '전체', 'host': '전체', 'views': '전체', 'sort': '최신순'
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

function handleNoticeCardArrowKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (document.getElementById('board-view')?.hidden) return;
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

let responsiveLayoutMedia = null;

function setLayoutMode(mode) {
    const next = mode === 'mobile' ? 'mobile' : 'desktop';
    if (getLayoutMode() === next) return;
    document.documentElement.setAttribute('data-view', next);

    const viewport = document.getElementById('viewport-meta');
    if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');

    updateLayoutToggleLabel();
    applyViewModule(next);
    renderRightRailAd();
    if (document.body?.dataset.page === 'public' && document.getElementById('notice-grid')) {
        renderNoticeCards();
    }
}

function toggleLayoutMode() {
    setLayoutMode(getLayoutMode() === 'desktop' ? 'mobile' : 'desktop');
}

function initializeResponsiveLayout() {
    const forced = new URLSearchParams(location.search).get('view');
    if (forced === 'mobile' || forced === 'desktop') return;
    responsiveLayoutMedia = window.matchMedia('(max-width: 820px)');
    const apply = event => setLayoutMode(event.matches ? 'mobile' : 'desktop');
    if (typeof responsiveLayoutMedia.addEventListener === 'function') {
        responsiveLayoutMedia.addEventListener('change', apply);
    } else {
        responsiveLayoutMedia.addListener?.(apply);
    }
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

    return {
        observeThumbnail
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
        const requestError = new Error(data?.error || `요청 실패 (${response.status})`);
        requestError.status = response.status;
        requestError.code = data?.code || '';
        requestError.retryAfterSeconds = Number(
            data?.retryAfterSeconds || response.headers.get('retry-after') || 0
        );
        throw requestError;
    }
    return data;
}

function createNoticeRepository(request) {
    const pageSize = 16;
    let items = [];
    let pageState = { page: 0, limit: pageSize, total: 0, totalPages: 0 };
    let facetState = { hosts: [] };
    const detailRequests = new Map();

    async function loadPage(page, { replace = false, filters = {} } = {}) {
        const params = new URLSearchParams({
            page: String(page),
            limit: String(pageSize)
        });
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== '' && value !== null && value !== undefined) {
                params.set(key, String(value));
            }
        });
        const result = await request(`/api/notices?${params.toString()}`, { method: 'GET' });
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
        facetState = {
            hosts: Array.isArray(result?.facets?.hosts)
                ? result.facets.hosts.map(value => String(value || '').trim()).filter(Boolean)
                : facetState.hosts
        };
        return { notices: items, pagination: pageState, facets: facetState };
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
        get pagination() { return pageState; },
        get facets() { return facetState; }
    };
}

const noticeRepository = createNoticeRepository(apiRequest);
let noticePageLoading = false;
let noticeListRequestVersion = 0;
let noticeSearchTimer = null;

function updateNoticePaginationUI(
    pagination = noticeRepository.pagination,
    isLoading = noticePageLoading
) {
    const previous = document.getElementById('notice-page-prev');
    const next = document.getElementById('notice-page-next');
    const numbers = document.getElementById('notice-page-numbers');
    const status = document.getElementById('notice-page-status');
    const container = document.getElementById('notice-pagination');
    if (!previous || !next || !numbers || !status || !container) return;

    const page = Math.max(1, Number(pagination?.page) || 1);
    const totalPages = Number(pagination?.totalPages) || 0;
    const total = Number(pagination?.total) || 0;
    container.hidden = total === 0;
    if (total === 0) {
        previous.hidden = true;
        numbers.hidden = true;
        next.hidden = true;
        numbers.innerHTML = '';
        status.textContent = '';
        return;
    }
    const hasMultiplePages = totalPages > 1;
    const visibleTotalPages = Math.max(1, totalPages);
    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    const end = Math.min(visibleTotalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    numbers.innerHTML = Array.from(
        { length: end - start + 1 },
        (_, index) => start + index
    ).map(pageNumber => `
        <button type="button" class="${pageNumber === page ? 'active' : ''}"
                aria-label="${pageNumber}페이지" aria-current="${pageNumber === page ? 'page' : 'false'}"
                onclick="goToNoticePage(${pageNumber})"
                ${isLoading ? 'disabled' : ''}>${pageNumber}</button>
    `).join('');
    previous.hidden = !hasMultiplePages;
    numbers.hidden = !hasMultiplePages;
    next.hidden = !hasMultiplePages;
    previous.disabled = Boolean(isLoading) || page <= 1 || totalPages === 0;
    next.disabled = Boolean(isLoading) || totalPages === 0 || page >= totalPages;
    status.textContent = totalPages > 0
        ? `${page} / ${totalPages} 페이지 · 전체 ${total}건`
        : '';
}

function getNoticeListFilters() {
    return {
        category: [...selectedCategoryFilters].join(','),
        search: document.getElementById('searchInput')?.value.trim() || '',
        target: document.getElementById('targetFilter')?.value || '전체',
        deadlineStatus: filterState['deadline-status'],
        host: filterState.host,
        views: filterState.views,
        sort: filterState.sort,
        dateFrom: document.getElementById('filter-date-from')?.value || '',
        dateTo: document.getElementById('filter-date-to')?.value || '',
        urgent: quickNoticeFilters.urgent,
        reward: quickNoticeFilters.reward,
        action: quickNoticeFilters.action,
        past: quickNoticeFilters.past
    };
}

async function loadNoticePage(page, { replace = true } = {}) {
    const result = await noticeRepository.loadPage(page, {
        replace,
        filters: getNoticeListFilters()
    });
    notices = result.notices;
    updateNoticePaginationUI(result.pagination, noticePageLoading);
    return result;
}

async function goToNoticePage(page) {
    const targetPage = Number(page);
    const totalPages = Number(noticeRepository.pagination.totalPages) || 0;
    if (noticePageLoading || !Number.isInteger(targetPage)
        || targetPage < 1 || targetPage > totalPages
        || targetPage === noticeRepository.pagination.page) return;

    noticePageLoading = true;
    updateNoticePaginationUI(noticeRepository.pagination, true);
    try {
        if (compareBlocks.length > 0) {
            compareBlocks = [];
            compareWorkspaceOpen = false;
            compareLayoutMode = 'stack';
        }
        await loadNoticePage(targetPage);
        buildHostButtons();
        renderNoticeCards();
        syncNoticeListUrl(targetPage);
        document.getElementById('spatial-workspace')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error('공지 페이지 이동 실패:', error);
        alert('공지 페이지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
        noticePageLoading = false;
        updateNoticePaginationUI(noticeRepository.pagination, false);
    }
}

function goToPreviousNoticePage() {
    return goToNoticePage((Number(noticeRepository.pagination.page) || 1) - 1);
}

function goToNextNoticePage() {
    return goToNoticePage((Number(noticeRepository.pagination.page) || 1) + 1);
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

// 엠블럼은 어디서 눌러도 쿼리·해시·상세 상태가 없는 홈을 새 문서로 다시 연다.
function goHomeAndReload() {
    window.location.assign(window.location.pathname);
}

async function loadBannerSlides(includeUnpublished = false) {
    try {
        const result = await apiRequest(includeUnpublished ? '/api/banner-slides/manage' : '/api/banner-slides', {
            method: 'GET',
            headers: includeUnpublished ? getBannerManageHeaders() : {}
        });
        if (Array.isArray(result?.slides)) {
            bannerSlides = result.slides;
            randomizeInitialBanner();
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
                    randomizeInitialBanner();
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

function randomizeInitialBanner() {
    if (initialBannerRandomized) return;
    const slides = getBannerSlidesByPlacement('right_rail').slice(0, 5);
    if (!slides.length) return;
    activeBannerSlideIndex = Math.floor(Math.random() * slides.length);
    initialBannerRandomized = true;
}

function stopBannerRotation() {
    if (!bannerRotationInterval) return;
    clearInterval(bannerRotationInterval);
    bannerRotationInterval = null;
}

function startBannerRotation() {
    stopBannerRotation();
    const slides = getBannerSlidesByPlacement('right_rail').slice(0, 5);
    if (slides.length < 2) return;
    bannerRotationInterval = window.setInterval(() => {
        transitionRightRailBanner(
            (activeBannerSlideIndex + 1) % slides.length,
            { restartRotation: false, direction: 1 }
        );
    }, 6500);
}

function transitionRightRailBanner(index, { restartRotation = true, direction = 1 } = {}) {
    const slides = getBannerSlidesByPlacement('right_rail').slice(0, 5);
    if (!slides.length) return;
    const nextIndex = (Number(index || 0) + slides.length) % slides.length;
    const imageStage = document.querySelector('#right-rail-ad-content .rail-ad-image-stage');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(bannerTransitionTimer);
    if (!imageStage || reduceMotion) {
        activeBannerSlideIndex = nextIndex;
        renderRightRailAd({ restartRotation, transitionDirection: 0 });
        return;
    }
    imageStage.classList.add(direction < 0 ? 'is-leaving-right' : 'is-leaving-left');
    bannerTransitionTimer = window.setTimeout(() => {
        activeBannerSlideIndex = nextIndex;
        renderRightRailAd({ restartRotation, transitionDirection: direction });
        bannerTransitionTimer = null;
    }, 220);
}

function selectRightRailBanner(index, direction = 1) {
    const slides = getBannerSlidesByPlacement('right_rail').slice(0, 5);
    if (!slides.length) return;
    transitionRightRailBanner(index, { direction });
}

function stepRightRailBanner(direction, event) {
    event?.preventDefault();
    event?.stopPropagation();
    const step = Number(direction || 0);
    selectRightRailBanner(activeBannerSlideIndex + step, step);
}

function startBannerSwipe(event) {
    if (getLayoutMode() !== 'mobile' || event.button > 0) return;
    const stage = event.currentTarget;
    bannerSwipePointerId = event.pointerId;
    bannerSwipeStartX = event.clientX;
    bannerSwipeStartY = event.clientY;
    bannerSwipeDeltaX = 0;
    try {
        stage.setPointerCapture?.(event.pointerId);
    } catch {
        // 합성 이벤트나 이미 취소된 포인터에서는 캡처가 거절될 수 있다.
    }
    stopBannerRotation();
}

function moveBannerSwipe(event) {
    if (event.pointerId !== bannerSwipePointerId) return;
    const deltaX = event.clientX - bannerSwipeStartX;
    const deltaY = event.clientY - bannerSwipeStartY;
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) return;
    bannerSwipeDeltaX = deltaX;
    if (Math.abs(deltaX) < 6) return;
    event.preventDefault();
    const stage = event.currentTarget;
    stage.classList.add('is-swiping');
    stage.style.transform = `translateX(${deltaX * 0.38}px)`;
    stage.style.opacity = String(Math.max(0.72, 1 - Math.abs(deltaX) / 520));
}

function finishBannerSwipe(event, cancelled = false) {
    if (event.pointerId !== bannerSwipePointerId) return;
    const stage = event.currentTarget;
    const deltaY = event.clientY - bannerSwipeStartY;
    const shouldMove = !cancelled
        && Math.abs(bannerSwipeDeltaX) >= 44
        && Math.abs(bannerSwipeDeltaX) > Math.abs(deltaY) * 1.15;
    if (stage.hasPointerCapture?.(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
    }
    stage.classList.remove('is-swiping');
    stage.style.removeProperty('transform');
    stage.style.removeProperty('opacity');
    bannerSwipePointerId = null;

    if (shouldMove) {
        suppressBannerLinkUntil = Date.now() + 550;
        stepRightRailBanner(bannerSwipeDeltaX < 0 ? 1 : -1, event);
        return;
    }
    bannerSwipeDeltaX = 0;
    startBannerRotation();
}

function allowBannerLinkClick(event) {
    if (Date.now() >= suppressBannerLinkUntil) return true;
    event.preventDefault();
    event.stopPropagation();
    return false;
}

function renderRightRailInquiryFallback() {
    const container = document.getElementById('right-rail-ad-content');
    if (!container) return;
    stopBannerRotation();

    container.innerHTML = `<button class="rail-cta rail-ad-fallback" type="button"
        onclick="openBannerInquiryFromRail()">홍보 신청하기</button>`;
}

function renderRightRailAd({ restartRotation = true, transitionDirection = 0 } = {}) {
    const container = document.getElementById('right-rail-ad-content');
    if (!container) return;
    const slides = getBannerSlidesByPlacement('right_rail').slice(0, 5);
    if (activeBannerSlideIndex >= slides.length) activeBannerSlideIndex = 0;
    const slide = slides[activeBannerSlideIndex];

    if (!slide) {
        renderRightRailInquiryFallback();
        return;
    }

    const useMobileBanner = document.documentElement.dataset.view === 'mobile';
    const bannerImageSrc = useMobileBanner
        ? slide.mobileSrc
        : slide.src;
    if (!bannerImageSrc) {
        renderRightRailInquiryFallback();
        return;
    }
    const image = bannerImageSrc
        ? `<img class="rail-ad-image" src="${escapeHtml(bannerImageSrc)}" alt="${escapeHtml(slide.altText || slide.name || '학내 홍보 이미지')}" onerror="renderRightRailInquiryFallback()">`
        : '';
    const controls = slides.length > 1 ? `
        <div class="rail-ad-controls" role="group" aria-label="배너 넘기기">
            <button type="button" aria-label="이전 배너" title="이전 배너"
                    onclick="stepRightRailBanner(-1, event)">&lt;</button>
            <span class="rail-ad-count">${activeBannerSlideIndex + 1} / ${slides.length}</span>
            <button type="button" aria-label="다음 배너" title="다음 배너"
                    onclick="stepRightRailBanner(1, event)">&gt;</button>
        </div>
    ` : '';
    const imageContent = slide.linkUrl
        ? `<a class="rail-ad-link rail-ad-image-link" href="${escapeHtml(slide.linkUrl)}" target="_blank"
                rel="noopener noreferrer" onclick="return allowBannerLinkClick(event)">${image}</a>`
        : image;
    const transitionClass = transitionDirection < 0
        ? ' is-entering-left'
        : (transitionDirection > 0 ? ' is-entering-right' : '');
    const content = `
        <div class="rail-ad-image-stage${transitionClass}"
             onpointerdown="startBannerSwipe(event)"
             onpointermove="moveBannerSwipe(event)"
             onpointerup="finishBannerSwipe(event)"
             onpointercancel="finishBannerSwipe(event, true)">
            ${imageContent}
            ${controls}
        </div>
    `;
    container.innerHTML = `<div class="rail-ad-viewport">${content}</div>`;
    container.onmouseenter = stopBannerRotation;
    container.onmouseleave = startBannerRotation;
    if (restartRotation) startBannerRotation();
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
    if (diffDays === 0) return { text: "오늘 마감", isUrgent: true, isD1: false, isExpired: false };
    if (diffDays === 1) return { text: "D-1", isUrgent: true, isD1: true, isExpired: false };
    if (diffDays <= 3) return { text: `D-${diffDays}`, isUrgent: true, isD1: false, isExpired: false };
    return { text: `D-${diffDays}`, isUrgent: false, isD1: false, isExpired: false };
}

function getNoticeDatePresentation(notice) {
    const createdLabel = notice.createdAt
        ? `등록 ${formatDateWithWeekday(notice.createdAt)}`
        : '등록일 없음';
    if (notice.isAlwaysOpen) {
        return {
            badgeText: '상시',
            badgeClass: '',
            dateLabel: createdLabel
        };
    }
    const deadline = String(notice.deadlineAt || notice.deadline || '').slice(0, 10);
    if (!deadline) {
        return {
            badgeText: '',
            badgeClass: '',
            dateLabel: createdLabel
        };
    }
    const dDay = calcDDay(deadline);
    return {
        badgeText: dDay.text,
        badgeClass: dDay.isExpired ? 'expired' : (dDay.isUrgent ? 'd-day' : ''),
        dateLabel: `마감 ${formatDateWithWeekday(deadline)}`
    };
}

function matchesDeadlineStatus(deadlineStatus, dDay, hasDeadline) {
    if (deadlineStatus === '전체') return true;
    if (deadlineStatus === '진행중') return !dDay.isExpired;
    if (deadlineStatus === '마감임박') return dDay.isUrgent && !dDay.isExpired;
    if (deadlineStatus === '상시') return !hasDeadline;
    if (deadlineStatus === '마감됨') return dDay.isExpired;
    return true;
}

// 서울대 소식처럼 요일까지 붙인 날짜. "2026.07.27(월)" 형태.
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
let railClockTimer = null;

function updateRailClock(now = new Date()) {
    const time = document.getElementById('rail-clock-time');
    const date = document.getElementById('rail-clock-date');
    if (!time || !date) return;
    time.textContent = new Intl.DateTimeFormat('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(now);
    date.textContent = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    }).format(now);
}

function startRailClock() {
    updateRailClock();
    if (railClockTimer) clearInterval(railClockTimer);
    railClockTimer = setInterval(updateRailClock, 1000);
}

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
    return `${y}.${m}.${d}(${WEEKDAY_KO[date.getDay()]})`;
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

function posterTitleLines(value, maxLines = 4) {
    const normalized = String(value || '제목 없음').replace(/\s+/g, ' ').trim();
    const lines = [];
    const hostMatch = normalized.match(/^(\[[^\]]+\])\s*(.*)$/);
    let remainder = normalized;
    if (hostMatch) {
        lines.push(hostMatch[1]);
        remainder = hostMatch[2];
    }

    let words = remainder.split(' ').filter(Boolean)
        .filter((word, index, all) => index === 0 || word !== all[index - 1]);
    const titleEndings = new Set(['모집', '안내', '신청', '접수', '공지', '행사', '발표', '연장']);
    let endingLine = '';
    if (words.length >= 3 && titleEndings.has(words.at(-1))) {
        endingLine = words.slice(-2).join(' ');
        words = words.slice(0, -2);
    }
    const availableLines = Math.max(1, maxLines - lines.length - (endingLine ? 1 : 0));
    const targetLength = Math.max(15, Math.min(18, Math.ceil(
        words.reduce((sum, word) => sum + word.length + 1, 0) / availableLines
    )));
    let current = '';

    words.forEach((word, index) => {
        const candidate = current ? `${current} ${word}` : word;
        const remainingSlots = maxLines - lines.length;
        if (current && candidate.length > targetLength && remainingSlots > 1) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
        if (index === words.length - 1 && current) lines.push(current);
    });
    if (endingLine) lines.push(endingLine);

    return lines.slice(0, maxLines);
}

function renderPosterTitle(value) {
    return posterTitleLines(value)
        .map(line => `<span class="card-poster-title-line${/^\[[^\]]+\]$/.test(line) ? ' is-host' : ''}">${escapeHtml(line)}</span>`)
        .join('');
}

function positionNoticeHoverPreview(card) {
    const preview = document.getElementById('notice-hover-preview');
    if (!preview || !card) return;
    const cardRect = card.getBoundingClientRect();
    const leftRail = document.getElementById('left-brand-rail')?.getBoundingClientRect();
    const rightRail = document.getElementById('right-ad-rail')?.getBoundingClientRect();
    const contentLeft = leftRail?.right ? leftRail.right + 12 : 16;
    const contentRight = rightRail?.left ? rightRail.left - 12 : window.innerWidth - 16;
    const previewWidth = Math.min(360, contentRight - contentLeft);
    const previewHeight = Math.min(preview.offsetHeight || 150, window.innerHeight - 32);
    let left = cardRect.right + 14;
    if (left + previewWidth > contentRight) left = cardRect.left - previewWidth - 14;
    left = Math.max(contentLeft, Math.min(left, contentRight - previewWidth));
    const top = Math.max(16, Math.min(cardRect.top, window.innerHeight - previewHeight - 16));
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.width = `${previewWidth}px`;
}

function renderNoticeHoverPreview(notice, card) {
    const preview = document.getElementById('notice-hover-preview');
    if (!preview || !notice || !card) return;
    if (noticeDragInProgress || activeNoticeSplitDragId) {
        suspendNoticeHoverPreview();
        return;
    }
    const summary = Array.isArray(notice.aiSummary) ? notice.aiSummary.filter(Boolean).slice(0, 3) : [];
    const content = String(notice.content || '').replace(/\s+/g, ' ').trim();
    const previewLines = summary.length ? summary : [content || '요약이 아직 없습니다.'];
    preview.innerHTML = `
        <div class="notice-hover-preview-body">
            <span class="notice-hover-preview-label">AI 3줄 미리보기</span>
            <h3>${escapeHtml(notice.title || '제목 없음')}</h3>
            <ul class="notice-hover-preview-summary-list">
                ${previewLines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}
            </ul>
        </div>
    `;
    preview.hidden = false;
    requestAnimationFrame(() => {
        positionNoticeHoverPreview(card);
        preview.classList.add('visible');
    });
}

function queueNoticeHoverPreview(noticeId, card) {
    if (noticeDragInProgress || activeNoticeSplitDragId) return;
    if (getLayoutMode() !== 'desktop' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    clearTimeout(noticeHoverPreviewTimer);
    activeHoverPreviewNoticeId = String(noticeId);
    noticeHoverPreviewTimer = setTimeout(async () => {
        if (noticeDragInProgress || activeNoticeSplitDragId) return;
        if (activeHoverPreviewNoticeId !== String(noticeId) || !card?.isConnected) return;
        const summary = notices.find(item => String(item.id) === String(noticeId));
        if (summary) renderNoticeHoverPreview(summary, card);
        try {
            const detail = await getNoticeDetail(noticeId);
            if (activeHoverPreviewNoticeId === String(noticeId) && card.matches(':hover')) {
                renderNoticeHoverPreview(detail, card);
            }
        } catch {
            // 요약 미리보기는 유지하고 상세 조회 실패만 조용히 무시한다.
        }
    }, 620);
}

function cancelNoticeHoverPreview(noticeId) {
    if (noticeId && activeHoverPreviewNoticeId !== String(noticeId)) return;
    clearTimeout(noticeHoverPreviewTimer);
    noticeHoverPreviewTimer = null;
    activeHoverPreviewNoticeId = '';
    const preview = document.getElementById('notice-hover-preview');
    if (!preview) return;
    preview.classList.remove('visible');
    window.setTimeout(() => {
        if (!preview.classList.contains('visible')) preview.hidden = true;
    }, 120);
}

function suspendNoticeHoverPreview() {
    clearTimeout(noticeHoverPreviewTimer);
    noticeHoverPreviewTimer = null;
    activeHoverPreviewNoticeId = '';
    const preview = document.getElementById('notice-hover-preview');
    if (!preview) return;
    preview.classList.remove('visible');
    preview.hidden = true;
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

function noticeTargetLabels(notice) {
    return [...new Set([
        ...(Array.isArray(notice?.targets) ? notice.targets : []),
        notice?.target
    ].map(value => String(value || '').trim()).filter(Boolean))];
}

function formatNoticeTargetBadge(notice) {
    const label = String(notice?.target || noticeTargetLabels(notice)[0] || '전체');
    return label.replace(/(\d{2})학번\s*이상/g, '$1학번↑');
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
    setFeedbackCategory('general');
    const status = document.getElementById('feedback-status');
    if (status) status.textContent = '';
    const title = document.getElementById('feedback-title');
    const help = document.getElementById('feedback-help');
    const message = document.getElementById('feedback-message');
    if (title) title.textContent = '익명 피드백';
    if (help) help.textContent = '이름·연락처·IP를 저장하지 않습니다. 개선 의견이나 오류를 편하게 남겨주세요.';
    if (message) message.placeholder = '개선 의견이나 오류 제보를 적어주세요. (5자 이상)';
    openModal('contact-modal');
    message?.focus();
}

function openBannerInquiryFromRail() {
    if (typeof closeMobileDrawer === 'function') closeMobileDrawer();
    window.location.href = './banner-inquiry.html';
}

function setFeedbackCategory(category) {
    activeFeedbackCategory = category === 'banner' ? 'banner' : 'general';
    document.querySelectorAll('[data-feedback-category]').forEach(button => {
        const active = button.dataset.feedbackCategory === activeFeedbackCategory;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    const title = document.getElementById('feedback-title');
    const help = document.getElementById('feedback-help');
    const message = document.getElementById('feedback-message');
    if (activeFeedbackCategory === 'banner') {
        if (title) title.textContent = '배너 문의';
        if (help) help.textContent = '학내 홍보 등록과 제휴에 관한 문의로 분류해 전달합니다.';
        if (message) message.placeholder = '배너 게재 기간, 내용, 연락 방법을 적어주세요. (5자 이상)';
    } else {
        if (title) title.textContent = '익명 피드백';
        if (help) help.textContent = '이름·연락처·IP를 저장하지 않습니다. 개선 의견이나 오류를 편하게 남겨주세요.';
        if (message) message.placeholder = '개선 의견이나 오류 제보를 적어주세요. (5자 이상)';
    }
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
            body: JSON.stringify({ message, category: activeFeedbackCategory })
        });
        input.value = '';
        setStatus('보내주셔서 감사합니다. 익명으로 전달되었습니다.');
    } catch (error) {
        setStatus(error.message || '전송에 실패했습니다. 잠시 후 다시 시도해주세요.', true);
    } finally {
        button.disabled = false;
    }
}

async function reportSummaryMismatch(id, button) {
    const noticeId = String(id || '').trim();
    if (!noticeId || button?.disabled) return;
    const originalLabel = button?.textContent || '요약 오류 신고';
    if (button) {
        button.disabled = true;
        button.textContent = '전달 중…';
    }
    try {
        await apiRequest(`/api/notices/${encodeURIComponent(noticeId)}/summary-report`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        if (button) button.textContent = '검수함에 전달했습니다';
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
        }
        alert(error.message || '전달하지 못했습니다. 잠시 후 다시 시도해주세요.');
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
    if (!window.history?.pushState) return false;
    const target = getNoticeShareUrl(id);
    if (location.href === target) return Boolean(history.state?.noticeId);
    history.pushState({ noticeId: String(id) }, '', target);
    return true;
}

function clearNoticeUrl() {
    if (!window.history?.replaceState) return;
    const params = new URLSearchParams(location.search);
    if (!params.has(NOTICE_URL_PARAM)) return;
    params.delete(NOTICE_URL_PARAM);
    const query = params.toString();
    history.replaceState({}, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
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
        detailHistoryPushed = false;
        showBoardView();
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

function closeFilterPanel() {
    const panel = document.getElementById('filter-panel');
    const chevron = document.getElementById('filter-chevron');
    panel?.classList.remove('open');
    if (chevron) chevron.style.transform = '';
    document.getElementById('filter-toggle-bar')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleMobileQuickFilters() {
    const filters = document.getElementById('notice-quick-filters');
    const toggle = document.getElementById('mobile-special-filter-toggle');
    if (!filters || !toggle) return;
    const open = !filters.classList.contains('is-mobile-open');
    filters.classList.toggle('is-mobile-open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.querySelector('.sr-only').textContent = open
        ? '빠른 필터 접기'
        : '빠른 필터 펼치기';
}

function buildHostButtons() {
    const select = document.getElementById('hostFilter');
    if (!select) return;
    const hosts = [...new Set(
        (noticeRepository.facets.hosts.length
            ? noticeRepository.facets.hosts
            : notices.map(n => n.host || '기타'))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'ko'));
    const current = filterState.host;
    select.innerHTML = [
        '<option value="전체">전체 기관</option>',
        ...hosts.map(host => `<option value="${escapeHtml(host)}">${escapeHtml(host)}</option>`)
    ].join('');
    select.value = hosts.includes(current) ? current : '전체';
    if (select.value !== current) filterState.host = select.value;
}

function setHostFilter(value) {
    filterState.host = String(value || '전체');
    filterCards();
    updateFilterChips();
}

async function loadCategories() {
    try {
        const result = await apiRequest('/api/categories', { method: 'GET' });
        activeCategories = orderedNoticeCategories(
            Array.isArray(result?.categories) ? result.categories : []
        );
    } catch (error) {
        console.error('카테고리 불러오기 실패:', error);
        activeCategories = [];
    }
    buildCategoryTabs();
}

const LEGACY_CATEGORY_REDIRECTS = Object.freeze({
    application: 'opportunity',
    academics: 'academic',
    'benefits-partnerships': 'benefit',
    campus: 'community',
    governance: 'community',
    survey: 'benefit',
    expired: 'all'
});

function categoryFromTabValue(value) {
    const normalized = LEGACY_CATEGORY_REDIRECTS[value] || value;
    if (normalized === 'all') return null;
    return activeCategories.find(category =>
        category.slug === normalized || Number(category.id) === Number(normalized)
    ) || null;
}

// 주제 축만 남긴 5개 탭. 상태와 행동 여부는 아래 빠른 필터가 맡는다.
function buildCategoryTabs() {
    const inner = document.getElementById('category-tabs-inner');
    if (!inner) return;
    const current = selectedCategoryFilters.size === 0
        ? 'all'
        : (selectedCategoryFilters.size === 1 ? [...selectedCategoryFilters][0] : 'multi');
    let html = `<button type="button" class="category-tab ${current === 'all' ? 'active' : ''}" data-category="all" onclick="selectCategoryTab('all')">전체</button>`;
    html += orderedNoticeCategories().map(category => {
        const id = Number(category.id);
        return `<button type="button" class="category-tab ${current === id ? 'active' : ''}" data-category="${escapeHtml(category.slug)}" onclick="selectCategoryTab('${escapeHtml(category.slug)}')">${escapeHtml(category.name)}</button>`;
    }).join('');
    inner.innerHTML = html;
}

function selectCategoryTab(value) {
    const category = categoryFromTabValue(value);
    selectedCategoryFilters.clear();
    archiveTabActive = false;
    if (category) selectedCategoryFilters.add(Number(category.id));
    document.querySelectorAll('#category-tabs-inner .category-tab').forEach(tab => {
        const selected = !category
            ? tab.dataset.category === 'all'
            : tab.dataset.category === category.slug;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-current', selected ? 'true' : 'false');
    });
    filterState.sort = getDefaultSortForCategory(category?.slug || 'all');
    syncNoticeSortChips();
    updateFilterChips();
    filterCards(true);
}

function getDefaultSortForCategory(value = 'all') {
    if (value === 'all') return '최신순';
    const category = categoryFromTabValue(value);
    return ['opportunity', 'benefit'].includes(category?.slug)
        ? '마감임박순'
        : '최신순';
}

function syncQuickNoticeFilterButtons() {
    document.querySelectorAll('[data-quick-filter]').forEach(button => {
        const active = Boolean(quickNoticeFilters[button.dataset.quickFilter]);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function toggleQuickNoticeFilter(name) {
    if (!Object.hasOwn(quickNoticeFilters, name)) return;
    quickNoticeFilters[name] = !quickNoticeFilters[name];
    syncQuickNoticeFilterButtons();
    updateFilterChips();
    filterCards(true);
}

function restoreNoticeListStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const rawTab = params.get('tab') || params.get('category') || 'all';
    const mappedTab = LEGACY_CATEGORY_REDIRECTS[rawTab] || rawTab;
    const category = categoryFromTabValue(mappedTab);
    selectedCategoryFilters.clear();
    if (category) selectedCategoryFilters.add(Number(category.id));
    quickNoticeFilters.urgent = params.get('urgent') === '1';
    quickNoticeFilters.reward = params.get('reward') === '1' || rawTab === 'survey';
    quickNoticeFilters.action = params.get('action') === '1' || rawTab === 'survey';
    quickNoticeFilters.past = params.get('past') === '1'
        || rawTab === 'expired'
        || params.get('archive') === 'expired';
    const search = document.getElementById('searchInput');
    if (search && params.get('q')) search.value = params.get('q').slice(0, 200);
    const requestedSort = params.get('sort');
    filterState.sort = ['마감임박순', '최신순', '조회순'].includes(requestedSort)
        ? requestedSort
        : getDefaultSortForCategory(category?.slug || 'all');
    syncQuickNoticeFilterButtons();
    const page = Number.parseInt(params.get('page'), 10);
    return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function syncNoticeListUrl(page = 1) {
    if (!document.getElementById('notice-detail-view')?.hidden) return;
    const params = new URLSearchParams(location.search);
    params.delete('category');
    params.delete('archive');
    const categoryId = [...selectedCategoryFilters][0];
    const category = activeCategories.find(item => Number(item.id) === Number(categoryId));
    category ? params.set('tab', category.slug) : params.delete('tab');
    for (const key of Object.keys(quickNoticeFilters)) {
        quickNoticeFilters[key] ? params.set(key, '1') : params.delete(key);
    }
    const search = document.getElementById('searchInput')?.value.trim() || '';
    search ? params.set('q', search) : params.delete('q');
    filterState.sort !== getDefaultSortForCategory(category?.slug || 'all')
        ? params.set('sort', filterState.sort)
        : params.delete('sort');
    Number(page) > 1 ? params.set('page', String(page)) : params.delete('page');
    const query = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

function syncNoticeSortChips() {
    document.querySelectorAll('#notice-sort-chips [data-sort]').forEach(button => {
        const active = button.dataset.sort === filterState.sort;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setNoticeSort(sort) {
    if (!['마감임박순', '최신순', '조회순'].includes(sort)) return;
    filterState.sort = sort;
    syncNoticeSortChips();
    filterCards(true);
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

    const labelMap = { 'deadline-status': '마감', 'host': '기관', 'views': '조회수' };
    let hasActive = false;

    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo = document.getElementById('filter-date-to')?.value;
    const target = document.getElementById('targetFilter')?.value || '전체';

    Object.entries(filterState).forEach(([group, val]) => {
        if (group === 'sort') return;
        if (val !== FILTER_DEFAULTS[group]) {
            hasActive = true;
            const chip = document.createElement('div');
            chip.className = 'filter-chip';
            chip.innerHTML = `<span>${labelMap[group]}: ${val}</span><button onclick="event.stopPropagation(); resetFilterGroup('${group}')">×</button>`;
            chipsArea.appendChild(chip);
        }
    });

    if (target !== '전체') {
        hasActive = true;
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.innerHTML = `<span>학번: ${escapeHtml(target)}</span><button onclick="event.stopPropagation(); resetTargetFilter()">×</button>`;
        chipsArea.appendChild(chip);
    }

    if (dateFrom || dateTo) {
        hasActive = true;
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.innerHTML = `<span>기간: ${dateFrom || '?'} ~ ${dateTo || '?'}</span><button onclick="event.stopPropagation(); clearDateRange()">×</button>`;
        chipsArea.appendChild(chip);
    }

    Object.entries(quickNoticeFilters).forEach(([key, active]) => {
        if (!active) return;
        hasActive = true;
        const names = {
            urgent: '마감임박',
            reward: '리워드 있음',
            action: '신청 필요',
            past: '지난 공지 보기'
        };
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.innerHTML = `<span>${names[key]}</span><button onclick="event.stopPropagation(); toggleQuickNoticeFilter('${key}')">×</button>`;
        chipsArea.appendChild(chip);
    });

    bar.classList.toggle('has-active', hasActive);
    const count = chipsArea.children.length;
    const svg = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h18M7 8h10M11 12h2M9 16h6"/></svg>`;
    labelEl.innerHTML = `${svg} 상세 필터${hasActive ? ` <span style="background:var(--primary);color:white;font-size:11px;padding:2px 7px;border-radius:10px;">${count}</span>` : ''}`;
}

function resetFilterGroup(group) {
    filterState[group] = FILTER_DEFAULTS[group];
    document.querySelectorAll(`[data-group="${group}"]`).forEach(b => { b.classList.toggle('active', b.dataset.val === FILTER_DEFAULTS[group]); });
    if (group === 'host') {
        const hostFilter = document.getElementById('hostFilter');
        if (hostFilter) hostFilter.value = FILTER_DEFAULTS.host;
    }
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

function resetTargetFilter() {
    const target = document.getElementById('targetFilter');
    if (target) target.value = '전체';
    filterCards();
    updateFilterChips();
}

function clearCategoryFilters() {
    selectedCategoryFilters.clear();
    archiveTabActive = false;
    buildCategoryTabs();
    filterState.sort = getDefaultSortForCategory('all');
    syncNoticeSortChips();
    filterCards();
    updateFilterChips();
}

function resetAllFilters() {
    Object.keys(filterState).forEach(g => { filterState[g] = FILTER_DEFAULTS[g]; });
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.toggle('active', b.dataset.val === FILTER_DEFAULTS[b.dataset.group]); });
    selectedCategoryFilters.clear();
    archiveTabActive = false;
    Object.keys(quickNoticeFilters).forEach(key => { quickNoticeFilters[key] = false; });
    syncQuickNoticeFilterButtons();
    buildCategoryTabs();
    filterState.sort = getDefaultSortForCategory('all');
    syncNoticeSortChips();
    const dateFrom = document.getElementById('filter-date-from');
    const dateTo = document.getElementById('filter-date-to');
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    const target = document.getElementById('targetFilter');
    if (target) target.value = '전체';
    const hostFilter = document.getElementById('hostFilter');
    if (hostFilter) hostFilter.value = FILTER_DEFAULTS.host;
    updateFilterChips();
    filterCards();
}

function hasDetailedNoticeFilters() {
    const target = document.getElementById('targetFilter')?.value || '전체';
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo = document.getElementById('filter-date-to')?.value || '';
    return target !== '전체'
        || selectedCategoryFilters.size > 0
        || Object.values(quickNoticeFilters).some(Boolean)
        || dateFrom
        || dateTo
        || Object.entries(filterState).some(([group, value]) =>
            group !== 'sort' && value !== FILTER_DEFAULTS[group]
        );
}

function clearSearchFilter() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    filterCards(true);
}

function renderNoticeEmptyState() {
    const rawSearch = document.getElementById('searchInput')?.value.trim() || '';
    if (rawSearch) {
        return `
            <div class="notice-empty-state">
                <strong>“${escapeHtml(rawSearch)}” 검색 결과가 없습니다.</strong>
                <p>검색어를 줄이거나 다른 표현으로 다시 찾아보세요.</p>
                <button class="btn btn-outline btn-small" type="button" onclick="clearSearchFilter()">검색어 지우기</button>
            </div>
        `;
    }
    if (hasDetailedNoticeFilters()) {
        return `
            <div class="notice-empty-state">
                <strong>해당하는 공지가 없습니다.</strong>
                <p>다른 카테고리나 조건으로 다시 확인해 주세요.</p>
            </div>
        `;
    }
    return `
        <div class="notice-empty-state">
            <strong>아직 등록된 공지가 없습니다.</strong>
            <p>새 공지가 검수되면 이곳에 표시됩니다.</p>
        </div>
    `;
}

function renderNoticeCards(animate = false) {
    const inputVal = document.getElementById('searchInput');
    if(!inputVal) return;

    const grid = document.getElementById('notice-grid');
    grid.innerHTML = "";

    const comparisonEnabled = getLayoutMode() === 'desktop';
    if (!comparisonEnabled && (compareWorkspaceOpen || compareBlocks.length > 0)) {
        compareBlocks = [];
        compareWorkspaceOpen = false;
        compareLayoutMode = 'stack';
        expandedCompareBlocks.clear();
    }

    // 비교 공간은 공지 그리드와 독립적으로 렌더한다. 공간에 담긴 공지는
    // 아래 일반 목록에서는 빼서 같은 공지가 두 곳에 동시에 보이지 않게 한다.
    const blockIds = comparisonEnabled
        ? compareBlocks.filter(id => notices.some(n => String(n.id) === String(id)))
        : [];
    const blockSet = new Set(blockIds);
    renderCompareSpace(blockIds);

    const filtered = notices;

    const baseNotices = filtered.filter(notice => !blockSet.has(String(notice.id)));
    baseNotices.forEach(notice => {
        const datePresentation = getNoticeDatePresentation(notice);
        const rawTitle = notice.title || "제목 없음";
        const safeTitle = escapeHtml(rawTitle);
        const hasImg = Object.hasOwn(notice, 'hasImages')
            ? notice.hasImages
            : Boolean(notice.images && notice.images.length > 0);

        // 사진이 있으면 포스터를 지연 로드한다. 없으면 포스터 자리에 제목을 크게 보여준다.
        const posterHtml = hasImg
            ? `<div class="card-poster">
                   <img class="card-img-preview" alt="" data-thumbnail-src="${escapeHtml(notice.thumbnailUrl || '/icons/default-notice-thumbnail.png')}">
               </div>`
            : `<div class="card-poster is-text"><p class="card-poster-title">${renderPosterTitle(rawTitle)}</p></div>`;

        const cardClass = [
            'card',
            datePresentation.badgeClass === 'd-day' ? 'card-urgent' : '',
            datePresentation.badgeClass === 'expired' ? 'card-expired' : '',
            notice.isArchived ? 'is-archived' : '',
            notice.isInGracePeriod ? 'is-grace-period' : ''
        ].filter(Boolean).join(' ');
        const dateTagHtml = datePresentation.badgeText
            ? `<span class="tag ${datePresentation.badgeClass}">${escapeHtml(datePresentation.badgeText)}</span>`
            : '';
        // 본문 발췌: 목록 응답은 원문을 담지 않으므로 AI 3줄 요약을 발췌로 쓴다.
        const excerpt = Array.isArray(notice.aiSummary) ? notice.aiSummary.join(' ') : '';
        // 이미지 카드만 본문 위에 제목을 다시 보여준다(텍스트 카드는 포스터가 곧 제목).
        const titleHtml = hasImg ? `<h3 class="card-title">${safeTitle}</h3>` : '';
        const surveyRewardHtml = notice.rewardNote || notice.surveyReward
            ? `<div class="survey-reward" aria-label="리워드">🎁 ${escapeHtml(notice.rewardNote || notice.surveyReward)}</div>`
            : '';

        const card = document.createElement('div');
        card.className = cardClass;
        if (animate) {
            card.classList.add('is-filter-entering');
            card.style.setProperty('--notice-enter-delay', `${Math.min(grid.childElementCount, 4) * 22}ms`);
        }
        card.dataset ||= {};
        card.dataset.noticeId = String(notice.id);
        card.onclick = () => {
            if (noticeDragInProgress || Date.now() < suppressNoticeClickUntil) return;
            openDetail(notice.id);
        };
        card.addEventListener('mouseenter', () => queueNoticeHoverPreview(notice.id, card));
        card.addEventListener('mouseleave', () => cancelNoticeHoverPreview(notice.id));
        // 노션처럼: 6점 핸들만 드래그하고, 카드는 평소처럼 눌러 상세를 연다.
        const blockControlsHtml = comparisonEnabled ? `
            <div class="card-block-controls" onclick="event.stopPropagation()">
                <button class="card-drag-handle" type="button" draggable="false"
                        aria-label="공지 들어서 화면 분할" title="끌어서 왼쪽 또는 오른쪽에 놓기">
                    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></g></svg>
                </button>
            </div>
        ` : '';
        card.innerHTML = `
            ${blockControlsHtml}
            ${posterHtml}
            <div class="card-body">
                <div class="tags">
                    ${dateTagHtml}
                    ${notice.isPinned ? '<span class="tag pinned">고정</span>' : ''}
                    <span class="tag target">${escapeHtml(formatNoticeTargetBadge(notice))}</span>
                    ${notice.host ? `<span class="tag">${escapeHtml(notice.host)}</span>` : ''}
                </div>
                ${titleHtml}
                ${surveyRewardHtml}
                <div class="card-date">${escapeHtml(datePresentation.dateLabel)}</div>
                ${excerpt ? `<p class="card-excerpt">${escapeHtml(excerpt)}</p>` : ''}
                <div class="card-meta">
                    <span class="view-count">조회 ${Number(notice.views) || 0}</span>
                </div>
            </div>
        `;
        const splitHandle = card.querySelector('.card-drag-handle');
        splitHandle?.addEventListener('pointerdown', event => onNoticeHandlePointerDown(event, notice.id));
        grid.appendChild(card);
    });

    if (Number(noticeRepository.pagination.total) === 0) {
        grid.innerHTML = renderNoticeEmptyState();
    }

    grid.querySelectorAll?.('img[data-thumbnail-src]')
        ?.forEach(image => noticeViewportLoader.observeThumbnail(image));

    if (animate && grid.childElementCount > 0) {
        void grid.offsetWidth;
        requestAnimationFrame(() => {
            grid.querySelectorAll('.card.is-filter-entering').forEach(card => {
                card.classList.remove('is-filter-entering');
                window.setTimeout(() => card.style.removeProperty('--notice-enter-delay'), 260);
            });
        });
    }

    const countEl = document.getElementById('filter-result-count');
    if (countEl) {
        const total = Number(noticeRepository.pagination.total) || 0;
        countEl.hidden = total === 0;
        countEl.innerHTML = total > 0 ? `결과 <strong>${total}</strong>건` : '';
    }
}

async function filterCards() {
    const animate = arguments[0] === true;
    const requestedPage = Number.isSafeInteger(Number(arguments[1]))
        ? Math.max(1, Number(arguments[1]))
        : 1;
    const requestVersion = ++noticeListRequestVersion;
    noticePageLoading = true;
    updateNoticePaginationUI(noticeRepository.pagination, true);
    try {
        const result = await loadNoticePage(requestedPage);
        if (requestVersion !== noticeListRequestVersion) return;
        notices = result.notices;
        buildHostButtons();
        renderNoticeCards(animate);
        syncNoticeListUrl(result.pagination.page);
    } catch (error) {
        if (requestVersion !== noticeListRequestVersion) return;
        console.error('공지 필터 적용 실패:', error);
        const grid = document.getElementById('notice-grid');
        if (grid) {
            grid.innerHTML = `
                <div class="notice-empty-state is-error">
                    <strong>공지 목록을 불러오지 못했습니다.</strong>
                    <p>잠시 후 다시 시도해주세요.</p>
                    <button class="btn btn-outline btn-small" type="button" onclick="filterCards()">다시 시도</button>
                </div>
            `;
        }
    } finally {
        if (requestVersion === noticeListRequestVersion) {
            noticePageLoading = false;
            updateNoticePaginationUI(noticeRepository.pagination, false);
        }
    }
}

function scheduleNoticeSearch() {
    if (noticeSearchTimer) clearTimeout(noticeSearchTimer);
    noticeSearchTimer = setTimeout(() => filterCards(true), 220);
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

function navDetailImage(dir, event) {
    event?.stopPropagation();
    if (detailImageArray.length <= 1) return;
    detailImageIndex = (detailImageIndex + dir + detailImageArray.length) % detailImageArray.length;
    updateDetailImage();
}

function startImageSwipe(event) {
    imageSwipeStartX = event.touches?.[0]?.clientX ?? null;
}

function endImageSwipe(event, scope) {
    if (imageSwipeStartX === null) return;
    const endX = event.changedTouches?.[0]?.clientX ?? imageSwipeStartX;
    const delta = endX - imageSwipeStartX;
    imageSwipeStartX = null;
    if (Math.abs(delta) < 44) return;
    const direction = delta < 0 ? 1 : -1;
    if (scope === 'viewer') navImage(direction);
    else navDetailImage(direction);
}

function updateDetailImage() {
    const heroImg = document.getElementById('detail-hero-img');
    const previous = document.getElementById('detail-image-prev');
    const next = document.getElementById('detail-image-next');
    const counter = document.getElementById('detail-image-counter');
    const src = detailImageArray[detailImageIndex];
    if (!heroImg || !src) return;
    heroImg.src = src;
    heroImg.onclick = () => openImageViewer(detailImageIndex);
    const hasMultiple = detailImageArray.length > 1;
    if (previous) previous.hidden = !hasMultiple;
    if (next) next.hidden = !hasMultiple;
    if (counter) {
        counter.hidden = !hasMultiple;
        counter.textContent = `${detailImageIndex + 1} / ${detailImageArray.length}`;
    }
    document.querySelectorAll('#detail-gallery .gallery-img').forEach((image, index) => {
        image.classList.toggle('active', index === detailImageIndex);
    });
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

async function imageBlobAsPng(blob) {
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            png => png ? resolve(png) : reject(new Error('이미지 변환에 실패했습니다.')),
            'image/png'
        );
    });
}

async function copyCurrentViewerImage(event) {
    event?.stopPropagation();
    const src = currentImageArray[currentImageIndex];
    const button = document.getElementById('viewer-copy-btn');
    if (!src || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        alert('이 브라우저에서는 이미지 복사를 지원하지 않습니다. 이미지에서 우클릭해 복사해주세요.');
        return;
    }

    const originalLabel = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = '복사 중…';
    }
    try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`이미지 응답 오류: ${response.status}`);
        const pngBlob = await imageBlobAsPng(await response.blob());
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob })
        ]);
        if (button) button.textContent = '복사됨';
        window.setTimeout(() => {
            if (button) button.textContent = originalLabel;
        }, 1200);
    } catch (error) {
        console.error('이미지 복사 실패:', error);
        alert('이미지를 복사하지 못했습니다. 이미지에서 우클릭해 복사하거나 다운로드를 이용해주세요.');
        if (button) button.textContent = originalLabel;
    } finally {
        if (button) button.disabled = false;
    }
}

async function openDetail(idStr) {
    cancelNoticeHoverPreview();
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
    const datePresentation = getNoticeDatePresentation(notice);
    renderNoticeCards();

    apiRequest(`/api/notices/${currentViewId}/view`, { method: 'POST' })
        .then(result => {
            if (!result?.notice) return;
            const freshIdx = notices.findIndex(n => String(n.id) === String(result.notice.id));
            if (freshIdx !== -1) {
                notices[freshIdx].views = result.notice.views;
                if (String(currentViewId) === String(result.notice.id)) {
                    document.getElementById('detail-meta').innerHTML = `${escapeHtml(datePresentation.dateLabel)} &nbsp;|&nbsp; 조회: ${Number(result.notice.views) || 0}`;
                }
                renderNoticeCards();
            }
        })
        .catch(error => {
            console.error('조회수 반영 실패:', error);
        });

    document.getElementById('detail-tags').innerHTML = `
        ${datePresentation.badgeText
            ? `<span class="tag ${datePresentation.badgeClass}">${escapeHtml(datePresentation.badgeText)}</span>`
            : ''}
        ${notice.isPinned ? '<span class="tag pinned">고정</span>' : ''}
        <span class="tag target">${escapeHtml(formatNoticeTargetBadge(notice))}</span>
        ${notice.host ? `<span class="tag">${escapeHtml(notice.host)}</span>` : ''}
    `;
    document.getElementById('detail-title').innerText = notice.title || "";
    document.getElementById('detail-meta').innerHTML = `${escapeHtml(datePresentation.dateLabel)} &nbsp;|&nbsp; 조회: ${Number(notice.views) || 0}`;
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

    // 상세 상단 자체가 사진 넘김이 가능한 갤러리이고, 아래 썸네일로도 바로 이동한다.
    const hero = document.getElementById('detail-hero');
    const heroImg = document.getElementById('detail-hero-img');
    const gallery = document.getElementById('detail-gallery');
    gallery.innerHTML = '';
    if (notice.images && notice.images.length > 0) {
        detailImageArray = [...notice.images];
        detailImageIndex = 0;
        heroImg.style.cursor = 'zoom-in';
        hero.hidden = false;
        if (notice.images.length > 1) {
            notice.images.forEach((src, idx) => {
                gallery.innerHTML += `<button class="gallery-thumb" type="button" aria-label="${idx + 1}번 사진 보기"
                    onclick="detailImageIndex=${idx}; updateDetailImage()"><img src="${escapeHtml(src)}" class="gallery-img" alt=""></button>`;
            });
            gallery.style.display = 'flex';
        } else {
            gallery.style.display = 'none';
        }
        updateDetailImage();
    } else {
        detailImageArray = [];
        detailImageIndex = 0;
        hero.hidden = true;
        gallery.style.display = 'none';
    }

    showDetailView();
    detailHistoryPushed = syncUrlToNotice(currentViewId);
}

function runNoticeSurfaceTransition(update, target) {
    update();
    if (!target) return;
    target.classList.remove('surface-entering');
    requestAnimationFrame(() => target.classList.add('surface-entering'));
    window.setTimeout(() => target.classList.remove('surface-entering'), 170);
}

// 목록을 숨기고 상세 페이지를 보인다. 모달이 아니라 화면 전체가 바뀐다.
function showDetailView() {
    const board = document.getElementById('board-view');
    const detail = document.getElementById('notice-detail-view');
    if (board && !board.hidden) boardScrollPosition = window.scrollY;
    runNoticeSurfaceTransition(() => {
        if (board) board.hidden = true;
        if (detail) detail.hidden = false;
        window.scrollTo({ top: 0, behavior: 'auto' });
    }, detail);
}

function showBoardView() {
    const board = document.getElementById('board-view');
    const detail = document.getElementById('notice-detail-view');
    runNoticeSurfaceTransition(() => {
        if (detail) detail.hidden = true;
        if (board) board.hidden = false;
        currentViewId = null;
        window.scrollTo({ top: boardScrollPosition, behavior: 'auto' });
    }, board);
}

// 상세에서 목록으로 돌아온다. 주소창의 ?id= 도 지운다.
function closeDetail() {
    if (new URLSearchParams(location.search).has(NOTICE_URL_PARAM) && detailHistoryPushed) {
        history.back();
        return;
    }
    detailHistoryPushed = false;
    clearNoticeUrl();
    showBoardView();
}

// ========================================
// 🧩 문서형 공지 블록
// 블록 자체는 절대 draggable이 아니다. 왼쪽 여백의 6점 핸들만 drag source이며,
// 문서 안에서는 위/아래 삽입선으로만 순서를 바꾼다.
// ========================================

const NOTICE_SPLIT_DRAG_TYPE = 'application/x-ece-notice-split';
const COMPARE_BLOCK_DRAG_TYPE = 'application/x-ece-compare-block';
const DESKTOP_MAX_COMPARE_BLOCKS = 4;
const MOBILE_MAX_COMPARE_BLOCKS = 0;

// 비교/분할은 정밀한 포인터 조작이 가능한 데스크톱에서만 제공한다.
function maxCompareBlocks() {
    return getLayoutMode() === 'mobile'
        ? MOBILE_MAX_COMPARE_BLOCKS
        : DESKTOP_MAX_COMPARE_BLOCKS;
}

function showSplitDropOverlay() {
    const overlay = document.getElementById('split-drop-overlay');
    if (compareWorkspaceOpen && compareBlocks.length > 0) {
        if (overlay) {
            overlay.classList.remove('visible');
            overlay.hidden = true;
        }
        document.getElementById('compare-space')?.classList.add('is-notice-drop-active');
        document.getElementById('spatial-workspace')?.classList.add('is-notice-drop-active');
        return;
    }
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideSplitDropOverlay() {
    const overlay = document.getElementById('split-drop-overlay');
    overlay?.classList.remove('visible');
    overlay?.querySelectorAll('.split-drop-zone.active').forEach(zone => zone.classList.remove('active'));
    document.querySelectorAll('.compare-empty-slot.active')
        .forEach(zone => zone.classList.remove('active'));
    document.getElementById('compare-space')?.classList.remove('is-notice-drop-active');
    document.getElementById('spatial-workspace')?.classList.remove('is-notice-drop-active');
    window.setTimeout(() => {
        if (overlay && !overlay.classList.contains('visible')) overlay.hidden = true;
    }, 120);
}

function onNoticeSplitDragStart(event, id) {
    suspendNoticeHoverPreview();
    clearTimeout(noticeSplitOverlayTimer);
    noticeDragInProgress = true;
    document.body.classList.add('notice-dragging');
    activeNoticeSplitDragId = String(id);
    event.stopPropagation();
    event.dataTransfer.setData(NOTICE_SPLIT_DRAG_TYPE, activeNoticeSplitDragId);
    event.dataTransfer.setData('text/plain', activeNoticeSplitDragId);
    event.dataTransfer.effectAllowed = 'copyMove';
    const notice = notices.find(item => String(item.id) === activeNoticeSplitDragId);
    noticeSplitDragOverlay?.remove();
    noticeSplitDragOverlay = document.createElement('div');
    noticeSplitDragOverlay.className = 'notice-split-drag-overlay';
    noticeSplitDragOverlay.textContent = notice?.title || '공지';
    document.body.appendChild(noticeSplitDragOverlay);
    event.dataTransfer.setDragImage?.(noticeSplitDragOverlay, 24, 18);
    // dragstart 중 원본 카드가 움직이면 Chromium이 드래그 자체를 취소할 수 있다.
    // 네이티브 드래그가 확정된 다음 프레임에 삽입 위치를 펼친다.
    noticeSplitOverlayTimer = window.setTimeout(() => {
        if (noticeDragInProgress && activeNoticeSplitDragId) showSplitDropOverlay();
    }, 110);
}

function onNoticeSplitDragEnd() {
    clearTimeout(noticeSplitOverlayTimer);
    noticeSplitOverlayTimer = null;
    noticeDragInProgress = false;
    document.body.classList.remove('notice-dragging');
    suppressNoticeClickUntil = Date.now() + 300;
    noticeSplitDragOverlay?.remove();
    noticeSplitDragOverlay = null;
    window.setTimeout(() => {
        hideSplitDropOverlay();
        activeNoticeSplitDragId = '';
    }, 80);
}

function onNoticeHandlePointerDown(event, id) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pointerNoticeDrag = {
        id: String(id),
        pointerId: event.pointerId,
        handle: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        placement: ''
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', onNoticeHandlePointerMove, { passive: false });
    document.addEventListener('pointerup', onNoticeHandlePointerEnd, { once: true });
    document.addEventListener('pointercancel', onNoticeHandlePointerEnd, { once: true });
}

function activatePointerNoticeDrag(event) {
    if (!pointerNoticeDrag || pointerNoticeDrag.active) return;
    pointerNoticeDrag.active = true;
    suspendNoticeHoverPreview();
    noticeDragInProgress = true;
    activeNoticeSplitDragId = pointerNoticeDrag.id;
    document.body.classList.add('notice-dragging');
    const notice = notices.find(item => String(item.id) === pointerNoticeDrag.id);
    noticeSplitDragOverlay?.remove();
    noticeSplitDragOverlay = document.createElement('div');
    noticeSplitDragOverlay.className = 'notice-split-drag-overlay is-pointer-overlay';
    noticeSplitDragOverlay.textContent = notice?.title || '공지';
    document.body.appendChild(noticeSplitDragOverlay);
    showSplitDropOverlay();
    positionNoticePointerOverlay(event.clientX, event.clientY);
}

function positionNoticePointerOverlay(clientX, clientY) {
    if (!noticeSplitDragOverlay) return;
    noticeSplitDragOverlay.style.transform = `translate3d(${clientX + 16}px, ${clientY + 16}px, 0)`;
}

function onNoticeHandlePointerMove(event) {
    if (!pointerNoticeDrag || event.pointerId !== pointerNoticeDrag.pointerId) return;
    const distance = Math.hypot(
        event.clientX - pointerNoticeDrag.startX,
        event.clientY - pointerNoticeDrag.startY
    );
    if (!pointerNoticeDrag.active && distance < 6) return;
    event.preventDefault();
    activatePointerNoticeDrag(event);
    positionNoticePointerOverlay(event.clientX, event.clientY);
    document.querySelectorAll('.split-drop-zone.active, .compare-empty-slot.active')
        .forEach(zone => zone.classList.remove('active'));
    const target = document.elementFromPoint?.(event.clientX, event.clientY)
        ?.closest?.('.split-drop-zone, .compare-empty-slot');
    pointerNoticeDrag.placement = target?.dataset?.splitSide || target?.dataset?.placement || '';
    if (['left', 'right'].includes(pointerNoticeDrag.placement)) target.classList.add('active');
}

function onNoticeHandlePointerEnd(event) {
    if (!pointerNoticeDrag || event.pointerId !== pointerNoticeDrag.pointerId) return;
    const drag = pointerNoticeDrag;
    pointerNoticeDrag = null;
    document.removeEventListener('pointermove', onNoticeHandlePointerMove);
    document.removeEventListener('pointerup', onNoticeHandlePointerEnd);
    document.removeEventListener('pointercancel', onNoticeHandlePointerEnd);
    drag.handle?.releasePointerCapture?.(event.pointerId);
    if (!drag.active) return;
    event.preventDefault();
    suppressNoticeClickUntil = Date.now() + 300;
    noticeDragInProgress = false;
    document.body.classList.remove('notice-dragging');
    noticeSplitDragOverlay?.remove();
    noticeSplitDragOverlay = null;
    if (['left', 'right'].includes(drag.placement)) {
        activeNoticeSplitDragId = drag.id;
        applyPendingNoticeSplit(drag.placement);
    } else {
        hideSplitDropOverlay();
        activeNoticeSplitDragId = '';
    }
}

function onSplitDropZoneDragOver(event) {
    if (!hasDragType(event, NOTICE_SPLIT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('active');
}

function onSplitDropZoneDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
        event.currentTarget.classList.remove('active');
    }
}

function onSplitDropZoneDrop(event, side) {
    if (!hasDragType(event, NOTICE_SPLIT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    activeNoticeSplitDragId = event.dataTransfer.getData(NOTICE_SPLIT_DRAG_TYPE)
        || activeNoticeSplitDragId;
    applyPendingNoticeSplit(side);
}

function onCompareExternalNoticeDragOver(event) {
    if (!hasDragType(event, NOTICE_SPLIT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('active');
}

function onCompareExternalNoticeDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
        event.currentTarget.classList.remove('active');
    }
}

function onCompareExternalNoticeDrop(event, placement) {
    if (!hasDragType(event, NOTICE_SPLIT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    activeNoticeSplitDragId = event.dataTransfer.getData(NOTICE_SPLIT_DRAG_TYPE)
        || activeNoticeSplitDragId;
    applyPendingNoticeSplit(placement);
}

async function finishNoticeBlockAddition(id) {
    renderCompareChange();
    try {
        await getNoticeDetail(id);
        renderCompareChange();
    } catch (error) {
        console.error('분할 공지 상세 불러오기 실패:', error);
    }
}

async function applyPendingNoticeSplit(placement) {
    const id = String(activeNoticeSplitDragId || '');
    if (!id || !['left', 'right'].includes(placement)) return;
    const hadWorkspace = compareWorkspaceOpen && compareBlocks.length > 0;
    hideSplitDropOverlay();
    activeNoticeSplitDragId = '';
    if (compareBlocks.includes(id)) return;
    if (compareBlocks.length >= maxCompareBlocks()) {
        alert(`비교 블록은 최대 ${maxCompareBlocks()}개까지 묶을 수 있습니다.`);
        return;
    }
    if (!hadWorkspace) {
        // 첫 블록은 항상 왼쪽에 반고정하고, 오른쪽은 기존 공지 목록 흐름을 유지한다.
        // 어느 쪽 추가 표식에서 시작했든 결과 구조는 같아야 사용자가 길을 잃지 않는다.
        compareDockSide = 'left';
        compareLayoutMode = 'stack';
        compareBlocks.push(id);
    } else if (placement === 'left') {
        compareBlocks.unshift(id);
        compareLayoutMode = 'columns';
    } else if (placement === 'right') {
        compareBlocks.push(id);
        compareLayoutMode = 'columns';
    }
    compareWorkspaceOpen = true;
    await finishNoticeBlockAddition(id);
}

function hasDragType(event, type) {
    return Array.from(event.dataTransfer?.types || []).includes(type);
}
function clearCompareDropIndicator() {
    document.querySelectorAll('.compare-col.is-drop-before, .compare-col.is-drop-after')
        .forEach(block => block.classList.remove('is-drop-before', 'is-drop-after'));
    activeCompareDropTargetId = '';
    activeCompareDropPosition = 'after';
}

function setCompareDropIndicator(block, clientY) {
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const position = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    clearCompareDropIndicator();
    block.classList.add(position === 'before' ? 'is-drop-before' : 'is-drop-after');
    activeCompareDropTargetId = String(block.dataset.compareId || '');
    activeCompareDropPosition = position;
}

function createCompareDragOverlay(block) {
    compareDragOverlay?.remove();
    compareDragOverlay = document.createElement('div');
    compareDragOverlay.className = 'compare-drag-overlay';
    const content = block?.querySelector('.compare-col-body')?.cloneNode(true);
    if (content) compareDragOverlay.appendChild(content);
    document.body.appendChild(compareDragOverlay);
    return compareDragOverlay;
}

function onCompareBlockDragStart(event, id) {
    event.stopPropagation();
    event.dataTransfer.setData(COMPARE_BLOCK_DRAG_TYPE, String(id));
    event.dataTransfer.effectAllowed = 'move';
    const block = event.currentTarget.closest('.compare-col');
    const overlay = createCompareDragOverlay(block);
    event.dataTransfer.setDragImage?.(overlay, 28, 22);
    requestAnimationFrame(() => block?.classList.add('is-dragging'));
    document.body.classList.add('reordering-compare-block');
}

function onCompareBlockDragEnd() {
    document.body.classList.remove('reordering-compare-block');
    document.querySelector('.compare-col.is-dragging')?.classList.remove('is-dragging');
    clearCompareDropIndicator();
    document.getElementById('compare-trash-zone')?.classList.remove('active');
    compareDragOverlay?.remove();
    compareDragOverlay = null;
}

function onCompareBlockDragOver(event, targetEl) {
    if (!hasDragType(event, COMPARE_BLOCK_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setCompareDropIndicator(targetEl, event.clientY);
}

function onCompareBlockDrop(event, targetId) {
    if (!hasDragType(event, COMPARE_BLOCK_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData(COMPARE_BLOCK_DRAG_TYPE);
    const position = activeCompareDropPosition;
    clearCompareDropIndicator();
    if (!sourceId || sourceId === String(targetId)) return;
    moveCompareBlock(sourceId, targetId, compareBlocks.length === 2 ? 'swap' : position);
}

function onCompareStageDragOver(event) {
    if (!hasDragType(event, COMPARE_BLOCK_DRAG_TYPE)) return;
    event.preventDefault();
    if (event.target === event.currentTarget) {
        clearCompareDropIndicator();
        activeCompareDropPosition = 'end';
    }
}

function onCompareStageDrop(event) {
    if (!hasDragType(event, COMPARE_BLOCK_DRAG_TYPE) || event.target !== event.currentTarget) return;
    event.preventDefault();
    const sourceId = event.dataTransfer.getData(COMPARE_BLOCK_DRAG_TYPE);
    clearCompareDropIndicator();
    moveCompareBlock(sourceId, '', 'end');
}

function positionComparePointerOverlay(clientX, clientY) {
    if (!compareDragOverlay) return;
    compareDragOverlay.style.transform = `translate3d(${clientX + 18}px, ${clientY + 18}px, 0)`;
}

function onCompareHandlePointerDown(event, id) {
    event.preventDefault();
    event.stopPropagation();
    pointerDraggedCompareId = String(id);
    pointerDragHandle = event.currentTarget;
    pointerDragHandle.setPointerCapture?.(event.pointerId);
    const block = pointerDragHandle.closest('.compare-col');
    createCompareDragOverlay(block).classList.add('is-pointer-overlay');
    block?.classList.add('is-dragging');
    document.body.classList.add('reordering-compare-block');
    positionComparePointerOverlay(event.clientX, event.clientY);
    pointerDragHandle.addEventListener('pointermove', onCompareHandlePointerMove);
    pointerDragHandle.addEventListener('pointerup', onCompareHandlePointerEnd, { once: true });
    pointerDragHandle.addEventListener('pointercancel', cleanupComparePointerDrag, { once: true });
}

function onCompareHandlePointerMove(event) {
    if (!pointerDraggedCompareId) return;
    event.preventDefault();
    positionComparePointerOverlay(event.clientX, event.clientY);
    const hoveredElement = document.elementFromPoint?.(event.clientX, event.clientY);
    const trash = hoveredElement?.closest?.('#compare-trash-zone');
    const trashZone = document.getElementById('compare-trash-zone');
    trashZone?.classList.toggle('active', Boolean(trash));
    if (trash) {
        clearCompareDropIndicator();
        return;
    }
    const target = hoveredElement?.closest?.('.compare-col');
    if (target && String(target.dataset.compareId) !== pointerDraggedCompareId) {
        setCompareDropIndicator(target, event.clientY);
    } else {
        clearCompareDropIndicator();
    }
}

function onCompareHandlePointerEnd(event) {
    event.preventDefault();
    const sourceId = pointerDraggedCompareId;
    const targetId = activeCompareDropTargetId;
    const position = activeCompareDropPosition;
    const shouldRemove = document.getElementById('compare-trash-zone')?.classList.contains('active');
    cleanupComparePointerDrag();
    if (sourceId && shouldRemove) {
        removeFromCompareBlock(sourceId);
    } else if (sourceId && targetId && sourceId !== targetId) {
        moveCompareBlock(sourceId, targetId, compareBlocks.length === 2 ? 'swap' : position);
    }
}

function cleanupComparePointerDrag() {
    pointerDragHandle?.removeEventListener('pointermove', onCompareHandlePointerMove);
    pointerDragHandle?.removeEventListener('pointerup', onCompareHandlePointerEnd);
    pointerDragHandle?.removeEventListener('pointercancel', cleanupComparePointerDrag);
    pointerDraggedCompareId = '';
    pointerDragHandle = null;
    document.body.classList.remove('reordering-compare-block');
    document.getElementById('compare-trash-zone')?.classList.remove('active');
    document.querySelector('.compare-col.is-dragging')?.classList.remove('is-dragging');
    clearCompareDropIndicator();
    compareDragOverlay?.remove();
    compareDragOverlay = null;
}

function moveCompareBlock(sourceId, targetId, position = 'after') {
    const source = String(sourceId);
    const target = String(targetId);
    if (position === 'swap' && compareBlocks.length === 2) {
        compareBlocks = [...compareBlocks].reverse();
        renderCompareChange();
        return;
    }
    const withoutSource = compareBlocks.filter(id => id !== source);
    if (!withoutSource.length || !compareBlocks.includes(source)) return;
    if (position === 'end') {
        withoutSource.push(source);
        compareBlocks = withoutSource;
        renderCompareChange();
        return;
    }
    const targetIndex = withoutSource.indexOf(target);
    if (targetIndex < 0) return;
    const insertAfter = position === 'after';
    withoutSource.splice(targetIndex + (insertAfter ? 1 : 0), 0, source);
    compareBlocks = withoutSource;
    renderCompareChange();
}

function onCompareTrashDragOver(event) {
    if (!hasDragType(event, COMPARE_BLOCK_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('active');
    clearCompareDropIndicator();
}

function onCompareTrashDragLeave(event) {
    event.currentTarget.classList.remove('active');
}

function onCompareTrashDrop(event) {
    if (!hasDragType(event, COMPARE_BLOCK_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData(COMPARE_BLOCK_DRAG_TYPE);
    event.currentTarget.classList.remove('active');
    if (sourceId) removeFromCompareBlock(sourceId);
}

async function addNoticeToCompareBlock(id) {
    const normalizedId = String(id);
    if (compareBlocks.includes(normalizedId)) return;
    if (compareBlocks.length >= maxCompareBlocks()) {
        alert(`비교 블록은 최대 ${maxCompareBlocks()}개까지 묶을 수 있습니다.`);
        return;
    }

    compareWorkspaceOpen = true;
    compareBlocks.push(normalizedId);
    renderCompareChange();
    try {
        await getNoticeDetail(normalizedId);
        renderCompareChange();
    } catch (error) {
        console.error('비교 블록 상세 불러오기 실패:', error);
    }
}

// 비교 블록 갱신은 즉시 반영한다. 브라우저 View Transition은 큰 영역을 캡처해
// 드래그 직후 프레임을 떨어뜨릴 수 있으므로 사용하지 않는다.
function renderCompareChange() {
    renderNoticeCards();
}

function removeFromCompareBlock(idStr) {
    expandedCompareBlocks.delete(String(idStr));
    compareBlocks = compareBlocks.filter(x => x !== String(idStr));
    // 두 블록 중 하나를 목록으로 돌려보내도 남은 한 블록의 공간은 그대로 유지한다.
    // 마지막 블록까지 제거했을 때만 일반 공지 목록으로 완전히 복귀한다.
    if (compareBlocks.length === 0) {
        compareWorkspaceOpen = false;
        compareLayoutMode = 'stack';
    }
    renderCompareChange();
}

function clearCompareBlock() {
    compareBlocks = [];
    expandedCompareBlocks.clear();
    compareWorkspaceOpen = false;
    compareLayoutMode = 'stack';
    renderCompareChange();
}

function toggleCompareBlockExpansion(idStr) {
    const id = String(idStr);
    if (expandedCompareBlocks.has(id)) {
        expandedCompareBlocks.delete(id);
    } else {
        expandedCompareBlocks.add(id);
    }
    renderCompareSpace(compareBlocks);
}

function renderCompareSpace(blockIds = compareBlocks) {
    const workspace = document.getElementById('spatial-workspace');
    const space = document.getElementById('compare-space');
    const stage = document.getElementById('compare-space-stage');
    if (!space || !stage) return;
    if (!compareWorkspaceOpen) {
        workspace?.classList.remove('is-split');
        workspace?.removeAttribute('data-dock');
        workspace?.removeAttribute('data-blocks');
        space.hidden = true;
        stage.innerHTML = '';
        return;
    }

    workspace?.classList.add('is-split');
    if (workspace) {
        workspace.dataset.dock = compareDockSide;
        workspace.dataset.blocks = String(blockIds.length);
    }
    space.hidden = false;
    space.dataset.blocks = String(blockIds.length);
    stage.dataset.layout = compareLayoutMode;

    const blocks = blockIds.map((id, index) => {
        const notice = notices.find(n => String(n.id) === String(id));
        if (!notice) return '';
        const datePresentation = getNoticeDatePresentation(notice);
        const summary = (notice.aiSummary || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')
            || '<li class="is-empty">요약 없음</li>';
        const thumb = (notice.images && notice.images.length > 0)
            ? `<img class="compare-col-thumb" src="${escapeHtml(notice.images[0])}" alt="">`
            : '';
        const dateText = datePresentation.dateLabel;
        const safeId = escapeHtml(String(id));
        const expanded = expandedCompareBlocks.has(String(id));
        const dockClass = blockIds.length === 1
            ? (compareDockSide === 'left' ? ' is-docked-left' : ' is-docked-right')
            : '';
        return `
            <article class="compare-col notion-block${expanded ? ' is-expanded' : ''}${dockClass}"
                     data-compare-id="${safeId}" tabindex="0">
                <div class="compare-col-controls" aria-label="${index + 1}번 블록 도구">
                    <button class="compare-col-drag-handle" type="button" draggable="false"
                            aria-label="${index + 1}번 블록 순서 변경" title="끌어서 블록 순서 변경">
                        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></g></svg>
                    </button>
                </div>
                <button class="compare-col-remove" type="button" aria-label="문서에서 블록 제거"
                        title="블록 제거" onclick="removeFromCompareBlock('${safeId}')">×</button>
                <div class="compare-col-body">
                    <p class="compare-col-kicker">${escapeHtml([
                        datePresentation.badgeText,
                        notice.isPinned ? '고정' : '',
                        formatNoticeTargetBadge(notice),
                        notice.host || '기타'
                    ].filter(Boolean).join(' · '))}</p>
                    <h3 class="compare-col-title">${escapeHtml(notice.title || '')}</h3>
                    <div class="compare-col-meta">${escapeHtml(dateText)} · 조회 ${Number(notice.views) || 0}</div>
                    ${thumb}
                    <div class="compare-summary-heading">
                        <h4 class="compare-col-label">AI 3줄 요약</h4>
                    </div>
                    <ul class="compare-col-summary">${summary}</ul>
                    <h4 class="compare-col-label">공지 원문</h4>
                    <div class="compare-col-content">${linkify(notice.content || '')}</div>
                    <button class="compare-col-open" type="button" onclick="openDetail('${safeId}')">전체 공지 열기 →</button>
                </div>
                <button class="compare-col-more" type="button"
                        aria-expanded="${expanded ? 'true' : 'false'}"
                        onclick="toggleCompareBlockExpansion('${safeId}')">
                    ${expanded ? '접기' : '더보기'}
                </button>
            </article>`;
    }).join('');

    const canAddBlock = blockIds.length < maxCompareBlocks();
    const emptyOnLeft = false;
    const emptyPlacement = 'right';
    const emptySlot = canAddBlock ? `
        <button class="compare-empty-slot ${emptyOnLeft ? 'is-left' : 'is-right'}" type="button"
                data-placement="${emptyPlacement}" aria-label="빈 반쪽에 공지 블록 추가"
                ondragover="onCompareExternalNoticeDragOver(event)"
                ondragleave="onCompareExternalNoticeDragLeave(event)"
                ondrop="onCompareExternalNoticeDrop(event, '${emptyPlacement}')">
            <span aria-hidden="true">+</span>
            <strong>이쪽에 공지 놓기</strong>
        </button>` : '';

    stage.innerHTML = emptyOnLeft ? `${emptySlot}${blocks}` : `${blocks}${emptySlot}`;

    stage.querySelectorAll('.compare-col').forEach(block => {
        const id = block.dataset.compareId;
        const handle = block.querySelector('.compare-col-drag-handle');
        handle.addEventListener('pointerdown', event => onCompareHandlePointerDown(event, id));
        block.addEventListener('dragover', event => onCompareBlockDragOver(event, block));
        block.addEventListener('drop', event => onCompareBlockDrop(event, id));
    });
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
    const detail = document.getElementById('notice-detail-view');
    if (detail && !detail.hidden && detailImageArray.length > 1) {
        if (e.key === 'ArrowLeft') {
            navDetailImage(-1);
            return;
        }
        if (e.key === 'ArrowRight') {
            navDetailImage(1);
            return;
        }
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
    initializeResponsiveLayout();
    applyViewModule(getLayoutMode());
    updateBellState();
    startRailClock();

    await loadData();
    await loadCategories();
    const initialNoticePage = restoreNoticeListStateFromUrl();
    buildCategoryTabs();
    syncNoticeSortChips();
    updateFilterChips();
    renderRightRailAd();
    buildHostButtons();
    await filterCards(false, initialNoticePage);
    openNoticeFromUrl();   // 카톡 링크로 들어온 경우 해당 공지를 바로 연다
});
