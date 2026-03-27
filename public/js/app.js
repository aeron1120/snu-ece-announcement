// ========================================
// 🌍 전역 상태 & 초기화
// ========================================

const CURRENT_DATE = new Date("2026-03-27T00:00:00");
const GEMINI_MODEL = "gemini-2.5-flash";
const API_BASE_URL = (window.API_BASE_URL || localStorage.getItem('eceApiBaseUrl') || '').trim().replace(/\/$/, '');

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

const defaultNotices = [{
    id: 1, title: "2026 만우절 사전 이벤트 'ㄴr ㅅr실 할말 있øł...'", host: "문화소통국", target: "전체", deadline: "2026-03-28",
    content: "안녕하세요, 문화소통국입니다.\n만우절 사전 이벤트를 진행합니다.\n(참여 링크: https://forms.gle/test)\n많관부!",
    aiSummary: ["만우절 맞이 익명 고백 이벤트 진행", "구글폼 링크를 통해 참여 가능", "추첨 통해 상품권 지급"], images: [], views: 124 
}];

const defaultBannerSlides = [
    { name: "스타트업 부트캠프 모집", src: null, bgStyle: "background: linear-gradient(90deg, #eff6ff, #dbeafe);", textColor: "#1e40af", text: "📢 [광고] 교내 스타트업 부트캠프 참가자 모집 (~4/7)" },
    { name: "글로벌 교환학생 설명회", src: null, bgStyle: "background: linear-gradient(90deg, #fdf4ff, #fae8ff);", textColor: "#86198f", text: "🎓 글로벌 교환학생 설명회 안내 D-5 (신청필수)" },
    { name: "AI 아이디어톤 모집", src: null, bgStyle: "background: linear-gradient(90deg, #ecfdf5, #d1fae5);", textColor: "#065f46", text: "💻 [홍보] 총학생회 주관 AI 아이디어톤 2026 모집중!" }
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

// ========================================
// 💾 localStorage 로드
// ========================================

async function loadData() {
    noticeAdminAuthToken = sessionStorage.getItem('eceNoticeAdminToken') || sessionStorage.getItem('eceAdminToken') || '';
    superAdminAuthToken = sessionStorage.getItem('eceSuperAdminToken') || '';

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
        const result = await apiRequest('/api/notices', { method: 'GET' });
        notices = Array.isArray(result?.notices) ? result.notices : defaultNotices;
    } catch (error) {
        console.error('공지 목록 불러오기 실패:', error);
        notices = defaultNotices;
        alert('공지 목록을 서버에서 불러오지 못해 기본 데이터로 표시합니다.');
    }

    try { const storedSaved = localStorage.getItem('eceSaved'); savedPosts = storedSaved ? JSON.parse(storedSaved) : []; if (!Array.isArray(savedPosts)) savedPosts = []; } catch (e) { savedPosts = []; }
    try { const stored = localStorage.getItem('eceBannerSlides'); if (stored) bannerSlides = JSON.parse(stored); } catch(e) {}
    if (bannerSlides.length === 0) bannerSlides = JSON.parse(JSON.stringify(defaultBannerSlides));

    await loadBannerSlides();
    startBannerPolling();
}

async function loadBannerSlides() {
    try {
        const result = await apiRequest('/api/banner-slides', { method: 'GET' });
        if (Array.isArray(result?.slides) && result.slides.length > 0) {
            bannerSlides = result.slides;
            refreshBannerDOM();
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

function refreshBannerDOM() {
    const bannerTrack = document.getElementById('banner-track');
    if (!bannerTrack) return;

    bannerTrack.innerHTML = '';
    bannerSlides.forEach(slide => {
        const slideEl = document.createElement('a');
        slideEl.href = '#';
        slideEl.className = 'banner-slide';
        slideEl.style.background = slide.bgStyle || '';
        slideEl.onclick = (e) => {
            if (isDragging) e.preventDefault();
        };

        const spanEl = document.createElement('span');
        spanEl.style.color = slide.textColor || '#000';
        spanEl.style.fontWeight = '700';
        spanEl.textContent = slide.text || '';

        slideEl.appendChild(spanEl);
        bannerTrack.appendChild(slideEl);
    });

    currentBannerIdx = 0;
    updateBannerPosition();
}

// ========================================
// 🎯 유틸 함수
// ========================================

function copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => { alert("전화번호가 복사되었습니다: " + text); }).catch(err => { alert("복사에 실패했습니다. 브라우저 설정을 확인해주세요."); }); }
function copyAdminPhone() { copyToClipboard(adminInfo.phone); }
function getBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result); reader.onerror = e => reject(e); }); }

function calcDDay(deadlineStr) {
    if (!deadlineStr) return { text: "상시", isUrgent: false, isD1: false };
    const dDate = new Date(deadlineStr + "T23:59:59");
    const diffDays = Math.ceil((dDate - CURRENT_DATE) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: "마감됨", isUrgent: false, isD1: false };
    if (diffDays === 0) return { text: "D-Day", isUrgent: true, isD1: false };
    if (diffDays === 1) return { text: "D-1", isUrgent: true, isD1: true };
    if (diffDays <= 3) return { text: `D-${diffDays}`, isUrgent: true, isD1: false };
    return { text: `D-${diffDays}`, isUrgent: false, isD1: false };
}

function linkify(text) {
    if(!text) return "";
    let safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return safeText.replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g, `<a href="$1" target="_blank">$1</a>`);
}

// ========================================
// 🎨 UI 함수 (모달, 배너)
// ========================================

function openModal(id) { document.getElementById(id).style.display = 'flex'; if(id === 'pwd-modal') document.getElementById('admin-pwd').focus(); }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

window.onclick = function(event) {
    if (event.target.classList.contains('overlay')) {
        event.target.style.display = 'none';
        if(event.target.id === 'pwd-modal') pendingAuthAction = null; 
    }
}

// 배너 드래그 로직
function slideBanner() {
    const total = bannerSlides.length || (document.getElementById('banner-track') ? document.getElementById('banner-track').children.length : 0);
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
    const total = bannerSlides.length || (document.getElementById('banner-track') ? document.getElementById('banner-track').children.length : 0);

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
    const pwd = document.getElementById('admin-pwd').value;
    if (!pwd) {
        alert("배너 관리자 비밀번호를 입력해주세요.");
        document.getElementById('admin-pwd').focus();
        return;
    }

    try {
        await apiRequest('/api/banner/verify', {
            method: 'POST',
            body: JSON.stringify({ password: pwd })
        });
    } catch (error) {
        alert(`배너 비밀번호 실패: ${error.message}`);
        document.getElementById('admin-pwd').focus();
        return;
    }

    closeModal('pwd-modal');
    document.getElementById('admin-pwd').value = '';
    openBannerEditPanel();
}

function openBannerEditPanel() {
    document.getElementById('banner-list-area').style.display = 'block';
    renderBannerList();
}

function closeBannerEditPanel() {
    document.getElementById('banner-list-area').style.display = 'none';
}

function renderBannerList() {
    const container = document.getElementById('banner-slides-list');
    if (!container) return;

    container.innerHTML = '';

    bannerSlides.forEach((slide, idx) => {
        const slideItem = document.createElement('div');
        slideItem.className = 'banner-item';
        slideItem.innerHTML = `
            <div class="banner-item-header">
                <span class="banner-item-text">${slide.text || ''}</span>
                <button class="btn btn-small btn-danger" onclick="deleteBannerSlide(${slide.id})">삭제</button>
            </div>
            <div class="banner-item-form">
                <input type="text" placeholder="배너 텍스트" value="${slide.text || ''}" class="banner-input-text-${slide.id}">
                <input type="color" placeholder="텍스트 색" value="${slide.textColor || '#000000'}" class="banner-input-color-${slide.id}">
                <button class="btn btn-small" onclick="updateBannerSlide(${slide.id})">수정</button>
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
            <button class="btn btn-small" onclick="addNewBannerSlide()">추가</button>
        </div>
    `;
    container.appendChild(addForm);
}

async function addNewBannerSlide() {
    const text = (document.getElementById('new-banner-text').value || '').trim();
    const textColor = document.getElementById('new-banner-color').value || '#000000';
    const bgColor = document.getElementById('new-banner-bg').value || '#ffffff';

    if (!text) {
        alert('배너 텍스트를 입력해주세요.');
        return;
    }

    try {
        const result = await apiRequest('/api/banner-slides', {
            method: 'POST',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify({
                name: text.substring(0, 50),
                text: text,
                bgStyle: `background: ${bgColor};`,
                textColor: textColor,
                order: bannerSlides.length
            })
        });

        bannerSlides.push(result.slide);
        refreshBannerDOM();
        renderBannerList();
        document.getElementById('new-banner-text').value = '';
        alert('배너가 추가되었습니다! (7일 동안 유지됩니다)');
    } catch (error) {
        alert(`배너 추가 실패: ${error.message}`);
    }
}

async function updateBannerSlide(slideId) {
    const newText = document.querySelector(`.banner-input-text-${slideId}`).value.trim();
    const newColor = document.querySelector(`.banner-input-color-${slideId}`).value;

    if (!newText) {
        alert('배너 텍스트를 입력해주세요.');
        return;
    }

    try {
        const result = await apiRequest(`/api/banner-slides/${slideId}`, {
            method: 'PUT',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify({
                name: newText.substring(0, 50),
                text: newText,
                textColor: newColor
            })
        });

        const idx = bannerSlides.findIndex(s => s.id === slideId);
        if (idx !== -1) {
            bannerSlides[idx] = result.slide;
        }
        refreshBannerDOM();
        renderBannerList();
        alert('배너가 수정되었습니다!');
    } catch (error) {
        alert(`배너 수정 실패: ${error.message}`);
    }
}

async function deleteBannerSlide(slideId) {
    if (!confirm('이 배너를 삭제하시겠습니까?')) return;

    try {
        await apiRequest(`/api/banner-slides/${slideId}`, {
            method: 'DELETE',
            headers: getNoticeAdminHeaders()
        });

        bannerSlides = bannerSlides.filter(s => s.id !== slideId);
        refreshBannerDOM();
        renderBannerList();
        alert('배너가 삭제되었습니다!');
    } catch (error) {
        alert(`배너 삭제 실패: ${error.message}`);
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
            headers: { 'Content-Type': 'application/json' },
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
        container.innerHTML += `<button class="filter-btn ${current === h ? 'active' : ''}" data-group="host" data-val="${h}" onclick="toggleFilterBtn(this)">${h}</button>`;
    });
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

function resetAllFilters() {
    const defaults = { 'deadline-status': '전체', 'host': '전체', 'has-image': '전체', 'saved': '전체', 'views': '전체', 'sort': '최신순' };
    Object.keys(filterState).forEach(g => { filterState[g] = defaults[g]; });
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.toggle('active', b.dataset.val === defaults[b.dataset.group]); });
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

        if (fDeadlineStatus !== '전체') {
            if (fDeadlineStatus === '진행중' && dDay.text === '마감됨') return;
            if (fDeadlineStatus === '마감임박') {
                const d = notice.deadline ? Math.ceil((new Date(notice.deadline + 'T23:59:59') - CURRENT_DATE) / 86400000) : 999;
                if (d < 0 || d > 3) return;
            }
            if (fDeadlineStatus === '상시' && notice.deadline) return;
            if (fDeadlineStatus === '마감됨' && dDay.text !== '마감됨') return;
        }

        if (fHost !== '전체' && (notice.host || '기타') !== fHost) return;

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
            const da = a.deadline ? new Date(a.deadline + 'T23:59:59') - CURRENT_DATE : Infinity;
            const db = b.deadline ? new Date(b.deadline + 'T23:59:59') - CURRENT_DATE : Infinity;
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
        const safeTitle = notice.title || "";
        let imgHtml = (notice.images && notice.images.length > 0) ? `<img src="${notice.images[0]}" class="card-img-preview" style="display:block;">` : '';
        const cardClass = dDay.isD1 ? "card d1-card" : "card";
        const starClass = isSaved ? 'star-icon active' : 'star-icon';
        const starChar = isSaved ? '★' : '☆';

        const card = document.createElement('div');
        card.className = cardClass;
        card.onclick = () => openDetail(notice.id);
        card.innerHTML = `
            <div class="${starClass}" onclick="toggleSave(event, '${notice.id}')">${starChar}</div>
            <div class="tags">
                <span class="tag ${dDay.isUrgent ? 'd-day' : ''}">${dDay.text}</span>
                <span class="tag target">${notice.target || '전체'}</span>
                <span class="tag">${notice.host || ''}</span>
            </div>
            <h3>${safeTitle}</h3>
            <p><strong>마감일</strong> ${notice.deadline ? notice.deadline : '상시'}</p>
            ${imgHtml}
            <div class="view-count">👀 조회 ${notice.views || 0}</div>
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
                    document.getElementById('detail-meta').innerHTML = `마감일: ${notice.deadline ? notice.deadline : '상시'} &nbsp;|&nbsp; 조회: ${result.notice.views}`;
                }
                filterCards();
            }
        })
        .catch(error => {
            console.error('조회수 반영 실패:', error);
        });

    const dDay = calcDDay(notice.deadline);
    document.getElementById('detail-tags').innerHTML = `
        <span class="tag ${dDay.isUrgent ? 'd-day' : ''}">${dDay.text}</span>
        <span class="tag target">${notice.target || '전체'}</span>
        <span class="tag">${notice.host || ''}</span>
    `;
    document.getElementById('detail-title').innerText = notice.title || "";
    document.getElementById('detail-meta').innerHTML = `마감일: ${notice.deadline ? notice.deadline : '상시'} &nbsp;|&nbsp; 조회: ${notice.views}`;
    document.getElementById('detail-summary').innerHTML = (notice.aiSummary || []).map(item => `<li>${item}</li>`).join('');
    document.getElementById('detail-content').innerHTML = linkify(notice.content || "");
    
    const gallery = document.getElementById('detail-gallery');
    gallery.innerHTML = '';
    if (notice.images && notice.images.length > 0) {
        notice.images.forEach((src, idx) => {
            gallery.innerHTML += `<img src="${src}" class="gallery-img" onclick="openImageViewer(${idx})">`;
        });
        gallery.style.display = 'flex';
    } else { gallery.style.display = 'none'; }
    
    openModal('detail-modal');
    setTimeout(() => { if(typeof updateCompareButton === 'function') updateCompareButton(String(idStr)); }, 30);
}

// 배너 관리
function saveBannerSlides() { try { localStorage.setItem('eceBannerSlides', JSON.stringify(bannerSlides)); } catch(e) {} }

function toggleBannerModePanel() {
    const body = document.getElementById('banner-mode-body');
    const header = body.parentElement.querySelector('.banner-mode-header');
    const chevron = header.querySelector('svg');
    const isOpen = body.classList.toggle('show');
    if (isOpen) {
        header.classList.add('collapsed');
    } else {
        header.classList.remove('collapsed');
    }
}

async function verifyBannerPassword() {
    const pwd = document.getElementById('banner-mode-pwd').value;
    const errEl = document.getElementById('banner-pwd-error');

    try {
        await apiRequest('/api/banner/verify', {
            method: 'POST',
            body: JSON.stringify({ password: pwd })
        });

        errEl.style.display = 'none';
        bannerModeUnlocked = true;
        document.getElementById('banner-pwd-section').style.display = 'none';
        document.getElementById('banner-list-area').style.display = 'block';
        renderBannerList();
    } catch {
        errEl.style.display = 'block';
        document.getElementById('banner-mode-pwd').value = '';
        document.getElementById('banner-mode-pwd').focus();
    }
}

function renderBannerList() {
    const container = document.getElementById('banner-slides-list');
    if (!container) return;

    container.innerHTML = '';

    bannerSlides.forEach(slide => {
        const safeId = Number(slide.id);
        const slideItem = document.createElement('div');
        slideItem.className = 'banner-item';
        slideItem.innerHTML = `
            <div class="banner-item-header">
                <span class="banner-item-text">${slide.text || ''}</span>
                <button class="btn btn-small btn-danger" onclick="deleteBannerSlide(${safeId})">삭제</button>
            </div>
            <div class="banner-item-form">
                <input type="text" placeholder="배너 텍스트" value="${slide.text || ''}" class="banner-input-text-${safeId}">
                <input type="color" value="${slide.textColor || '#000000'}" class="banner-input-color-${safeId}">
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
            <input type="color" id="new-banner-color" value="#000000">
            <input type="color" id="new-banner-bg" value="#ffffff">
            <button class="btn btn-small" onclick="addNewBannerSlide()">추가</button>
        </div>
    `;
    container.appendChild(addForm);
}

function bannerDragStart(e) { dragSrcIdx = parseInt(e.currentTarget.dataset.idx); e.dataTransfer.effectAllowed = 'move'; }
function bannerDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function bannerDrop(e) {
    e.preventDefault();
    const targetIdx = parseInt(e.currentTarget.dataset.idx);
    if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
    const moved = bannerSlides.splice(dragSrcIdx, 1)[0];
    bannerSlides.splice(targetIdx, 0, moved);
    saveBannerSlides();
    refreshBannerDOM();
    renderBannerList();
    dragSrcIdx = null;
}

function moveBanner(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= bannerSlides.length) return;
    [bannerSlides[idx], bannerSlides[newIdx]] = [bannerSlides[newIdx], bannerSlides[idx]];
    saveBannerSlides();
    refreshBannerDOM();
    renderBannerList();
}

function deleteBanner(idx) {
    if (bannerSlides.length <= 1) { alert("배너는 최소 1개 이상 유지해야 합니다."); return; }
    if (!confirm(`"${bannerSlides[idx].name}" 배너를 삭제하시겠습니까?`)) return;
    bannerSlides.splice(idx, 1);
    saveBannerSlides();
    refreshBannerDOM();
    renderBannerList();
}

async function addBannerImage() {
    const nameInput = document.getElementById('new-banner-name');
    const fileInput = document.getElementById('new-banner-file');
    const name = nameInput.value.trim();
    if (!name) { alert("사진 이름을 입력하세요."); nameInput.focus(); return; }
    if (!fileInput.files || fileInput.files.length === 0) { alert("이미지 파일을 선택하세요."); return; }
    const src = await getBase64(fileInput.files[0]);
    bannerSlides.push({ name, src, bgStyle: '', textColor: '', text: '' });
    saveBannerSlides();
    refreshBannerDOM();
    renderBannerList();
    nameInput.value = '';
    fileInput.value = '';
    alert(`"${name}" 배너가 추가되었습니다!`);
}

function refreshBannerDOM() {
    const track = document.getElementById('banner-track');
    if (!track) return;
    track.innerHTML = '';
    bannerSlides.forEach(slide => {
        const a = document.createElement('a');
        a.href = '#';
        a.className = 'banner-slide';
        a.setAttribute('onclick', "if(isDragging) event.preventDefault();");
        if (slide.src) {
            a.style.cssText = 'padding: 0;';
            a.innerHTML = `<img src="${slide.src}" style="width:100%; height:100%; object-fit:cover; border-radius:12px; display:block;" alt="${slide.name}">`;
        } else {
            a.style.cssText = slide.bgStyle;
            a.innerHTML = `<span style="color:${slide.textColor}; font-weight:700;">${slide.text}</span>`;
        }
        track.appendChild(a);
    });
    currentBannerIdx = 0;
    updateBannerPosition();
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
        slot.innerHTML = `<span title="${notice.title}">${notice.title}</span><button class="remove-btn" onclick="toggleCompare('${id}')">×</button>`;
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

        const summaryHtml = (notice.aiSummary || []).map(item => `<li>${item}</li>`).join('') || '<li style="color:var(--text-sub)">요약 없음</li>';
        const thumbHtml = (notice.images && notice.images.length > 0) ? `<img src="${notice.images[0]}" style="width:100%; height:110px; object-fit:cover; border-radius:10px; margin-bottom:10px; border:1px solid var(--border); flex-shrink:0;">` : '';
        const colId = 'compare-col-' + id;
        const safeContent = (notice.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const contentWithLinks = safeContent.replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g, `<a href="$1" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:600;">$1</a>`);

        col.innerHTML = `${thumbHtml}
            <div class="tags" style="margin-bottom:6px; flex-wrap:wrap; padding-right:0;">
                <span class="tag ${dDay.isUrgent ? 'd-day' : ''}">${dDay.text}</span>
                <span class="tag target">${notice.target || '전체'}</span>
                <span class="tag">${notice.host || ''}</span>
            </div>
            <h3>${notice.title || ''}</h3>
            <div class="compare-meta">📅 마감: ${notice.deadline || '상시'} &nbsp;|&nbsp; 👀 조회 ${notice.views || 0}</div>
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
    renderAdminInfo();
    renderBannerAdminInfo();
    refreshBannerDOM();
    buildHostButtons();
    filterCards();
    updateCompareBar();
    
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
