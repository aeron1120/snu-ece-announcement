// ========================================
// SNU ECE 공지방 — admin.js
// 관리자 페이지(admin.html) 전용. 공개 화면(index.html)에는 로드되지 않으므로
// 학생이 보는 번들에 관리자 UI가 섞이지 않는다.
// core.js의 apiRequest / escapeHtml / 토큰 헤더 헬퍼를 그대로 빌려 쓴다.
// ========================================

// gemini-2.5-flash 는 신규 키에서 막혀 있어 상시 최신 별칭을 쓴다.
const GEMINI_MODEL = "gemini-flash-latest";

let reviewNotices = [];
let selectedReviewNoticeId = null;
let reviewMutationInFlight = false;
let categoryCandidates = [];
let editingNoticeId = null;
let pendingEditNoticeId = null;
// 클립보드에서 붙여넣은 이미지들(base64 data URL). 파일 첨부와 함께 저장된다.
let pastedImages = [];
const MAX_NOTICE_IMAGES = 20;
// AI 분석이 만든 3줄 요약. 저장 때 재분석 없이 그대로 쓴다.
let composeAiSummary = [];

// 제목 양식에서 쓰는 유형 목록. 편집할 때 기존 제목을 되돌려 읽는 데에도 쓴다.
const TITLE_KINDS = ['모집', '안내', '신청', '접수', '공지', '행사', '변경 안내', '결과 발표', '기간 연장'];

// ========================================
// 🔐 인증 게이트
// ========================================

async function submitAdminGate() {
    const input = document.getElementById('admin-gate-password');
    const error = document.getElementById('admin-gate-error');
    const password = input.value;
    error.textContent = '';

    if (!password) {
        error.textContent = '비밀번호를 입력해주세요.';
        input.focus();
        return;
    }

    try {
        await apiRequest('/api/admin/verify', {
            method: 'POST',
            headers: getNoticeAdminHeaders(password)
        });
    } catch (requestError) {
        error.textContent = `인증 실패: ${requestError.message}`;
        input.focus();
        return;
    }

    noticeAdminAuthToken = password;
    sessionStorage.setItem('eceNoticeAdminToken', noticeAdminAuthToken);
    sessionStorage.setItem('eceAdminToken', noticeAdminAuthToken);
    input.value = '';
    await enterAdminWorkspace();
}

async function enterAdminWorkspace() {
    document.getElementById('admin-gate').hidden = true;
    document.getElementById('admin-workspace').hidden = false;
    document.getElementById('admin-logout').hidden = false;

    await loadCategories();
    await loadReviewNotices();
    loadAdminFeedback();   // 탭 배지에 피드백 수를 채운다(백그라운드)

    // 공개 화면의 "관리자 페이지에서 수정" 링크로 들어온 경우 바로 편집 폼을 연다.
    if (pendingEditNoticeId) {
        const target = pendingEditNoticeId;
        pendingEditNoticeId = null;
        selectAdminTab('notices');
        await loadAdminNoticeList();
        await editAdminNotice(target);
    }
}

function logoutAdmin() {
    noticeAdminAuthToken = '';
    superAdminAuthToken = '';
    bannerManageAuthToken = '';
    sessionStorage.removeItem('eceNoticeAdminToken');
    sessionStorage.removeItem('eceAdminToken');
    sessionStorage.removeItem('eceSuperAdminToken');
    sessionStorage.removeItem('eceBannerManageToken');
    location.href = './admin.html';
}

// ========================================
// 🗂 탭
// ========================================

function selectAdminTab(name) {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === name);
    });
    document.querySelectorAll('.admin-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${name}`);
    });

    if (name === 'notices') loadAdminNoticeList();
    if (name === 'category') loadCategoryCandidates();
    if (name === 'feedback') loadAdminFeedback();
    if (name === 'banner' && bannerManageAuthToken) unlockBannerPanel();
    if (name === 'settings' && superAdminAuthToken) unlockSettingsPanel();
}

// ========================================
// ✍️ 제목 양식 빌더
// 자유 입력을 없애고 [주관] 핵심내용 유형 형태로 제목을 통일한다.
// ========================================

function getSelectedTitleHost() {
    const select = document.getElementById('title-host');
    if (select.value !== '__custom__') return select.value;
    return document.getElementById('title-host-custom').value.trim();
}

function isTitleManual() {
    return document.getElementById('title-manual').checked;
}

// 조합 규칙은 한 곳에만 둔다. 미리보기와 저장이 어긋나지 않도록.
function composeNoticeTitle() {
    if (isTitleManual()) {
        return document.getElementById('post-title-manual').value.trim();
    }
    const host = getSelectedTitleHost();
    let subject = document.getElementById('title-subject').value.trim();
    const kind = document.getElementById('title-kind').value;
    if (!subject) return '';
    // 핵심 내용이 이미 유형 단어로 끝나면(예: "공연진 모집") 유형을 또 붙이지 않는다.
    // → "공연진 모집 모집" 같은 중복 방지.
    const needsKind = kind && !subject.endsWith(kind);
    return `${host ? `[${host}] ` : ''}${subject}${needsKind ? ` ${kind}` : ''}`.trim();
}

function refreshTitlePreview() {
    const title = composeNoticeTitle();
    const preview = document.getElementById('title-preview');
    const hidden = document.getElementById('post-title');

    hidden.value = title;
    preview.textContent = title || '핵심 내용을 입력하면 제목이 만들어집니다.';
    preview.classList.toggle('is-empty', !title);
}

function onTitleHostChange() {
    const select = document.getElementById('title-host');
    const custom = document.getElementById('title-host-custom');
    custom.hidden = select.value !== '__custom__';
    if (!custom.hidden) custom.focus();
    refreshTitlePreview();
}

function onTitleManualToggle() {
    const manual = isTitleManual();
    const manualInput = document.getElementById('post-title-manual');
    manualInput.hidden = !manual;

    // 직접 수정으로 넘어갈 때는 지금까지 만들어진 제목을 그대로 물려준다.
    if (manual && !manualInput.value) manualInput.value = document.getElementById('post-title').value;
    if (manual) manualInput.focus();
    refreshTitlePreview();
}

// 기존 제목을 양식으로 되돌려 읽는다. 규칙에 맞지 않으면 직접 수정 모드로 연다.
function applyTitleToBuilder(rawTitle) {
    const title = String(rawTitle || '').trim();
    const hostSelect = document.getElementById('title-host');
    const hostCustom = document.getElementById('title-host-custom');
    const subject = document.getElementById('title-subject');
    const kindSelect = document.getElementById('title-kind');
    const manualCheck = document.getElementById('title-manual');
    const manualInput = document.getElementById('post-title-manual');

    const match = title.match(/^\[([^\]]+)\]\s*(.+)$/);
    const kind = match ? TITLE_KINDS.find(item => match[2].endsWith(` ${item}`)) : null;

    if (match && kind) {
        const host = match[1].trim();
        const knownHost = Array.from(hostSelect.options).some(option => option.value === host);
        hostSelect.value = knownHost ? host : '__custom__';
        hostCustom.hidden = knownHost;
        hostCustom.value = knownHost ? '' : host;
        subject.value = match[2].slice(0, match[2].length - kind.length - 1).trim();
        kindSelect.value = kind;
        manualCheck.checked = false;
        manualInput.hidden = true;
        manualInput.value = '';
    } else {
        manualCheck.checked = true;
        manualInput.hidden = false;
        manualInput.value = title;
    }

    refreshTitlePreview();
}

function resetComposeForm() {
    editingNoticeId = null;
    pastedImages = [];
    composeAiSummary = [];
    renderPastePreview();
    const analyzeStatus = document.getElementById('analyze-status');
    if (analyzeStatus) analyzeStatus.textContent = '';
    document.getElementById('title-host').value = '학생회';
    document.getElementById('title-host-custom').value = '';
    document.getElementById('title-host-custom').hidden = true;
    document.getElementById('title-subject').value = '';
    document.getElementById('title-kind').value = '모집';
    document.getElementById('title-manual').checked = false;
    document.getElementById('post-title-manual').value = '';
    document.getElementById('post-title-manual').hidden = true;
    document.getElementById('post-target').value = '전체';
    document.getElementById('post-deadline').value = '';
    document.getElementById('post-content').value = '';
    document.getElementById('post-images').value = '';
    document.getElementById('panel-compose-title').textContent = '새 공지 등록';
    document.getElementById('submit-btn-text').textContent = '공지 업로드';
    document.getElementById('compose-cancel').hidden = true;
    refreshTitlePreview();
}

// ========================================
// 📋 이미지 붙여넣기 (Ctrl+V)
// ========================================

function renderPastePreview() {
    const preview = document.getElementById('paste-preview');
    if (!preview) return;
    preview.innerHTML = pastedImages.map((src, idx) => `
        <div class="paste-thumb">
            <img src="${escapeHtml(src)}" alt="붙여넣은 이미지 ${idx + 1}">
            <button type="button" class="paste-remove" aria-label="이미지 제거"
                    onclick="removePastedImage(${idx})">×</button>
        </div>
    `).join('');
}

function removePastedImage(idx) {
    pastedImages.splice(idx, 1);
    renderPastePreview();
}

// 클립보드에 이미지가 있으면 base64로 담는다. 여러 장이면 모두 받는다.
async function handleImagePaste(event) {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type && item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    // 텍스트가 아니라 이미지 붙여넣기이므로 기본 동작(본문에 파일명 삽입 등)을 막는다.
    event.preventDefault();

    for (const item of imageItems) {
        if (pastedImages.length >= MAX_NOTICE_IMAGES) {
            alert(`이미지는 최대 ${MAX_NOTICE_IMAGES}장까지 첨부할 수 있습니다.`);
            break;
        }
        const file = item.getAsFile();
        if (!file) continue;
        try {
            pastedImages.push(await getBase64(file));
        } catch (error) {
            console.error('붙여넣은 이미지 처리 실패:', error);
        }
    }
    renderPastePreview();

    const zone = document.getElementById('paste-dropzone');
    if (zone) {
        zone.classList.add('is-active');
        setTimeout(() => zone.classList.remove('is-active'), 600);
    }
}

function initImagePaste() {
    const panel = document.getElementById('panel-compose');
    const zone = document.getElementById('paste-dropzone');
    if (!panel) return;
    // 공지 등록 패널 어디에서 붙여넣어도(제목·본문·전용 영역) 이미지를 받는다.
    panel.addEventListener('paste', handleImagePaste);
    zone?.addEventListener('click', () => zone.focus());
}

// ========================================
// 🤖 AI 분석 (마감일·핵심내용·유형·요약)
// 원문을 한 번 LLM에 넣어 정해진 보기 안에서 값을 채운다. 결과는 항상 수정 가능.
// ========================================

function parseAnalysisJson(text) {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return {};
    }
}

// 원문 한 번으로 마감일·핵심내용·유형·3줄요약을 함께 뽑는다(별도 요약 호출 없음).
async function runNoticeAnalysis(content) {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = `다음 공지 원문을 분석해서 JSON만 출력해. 코드블록·설명 없이 JSON 객체 하나만.
형식: {"deadline":"YYYY-MM-DD 또는 빈문자열","subject":"핵심 내용 명사구 6~20자","type":"${TITLE_KINDS.join('|')} 중 하나","summary":["요약1","요약2","요약3"]}
- 오늘 날짜는 ${today}. 마감일이 원문에 없거나 불명확하면 deadline은 빈문자열.
- type은 반드시 제시한 보기 중 하나.
- subject에는 유형 단어(${TITLE_KINDS.join(', ')})를 넣지 말고 핵심 명사구만. 예: "개강총회 참가자".
- summary는 각 줄 명사형 종결의 3줄 요약.

원문:
${content}`;

    const result = await apiRequest('/api/summary', {
        method: 'POST',
        headers: getNoticeAdminHeaders(),
        body: JSON.stringify({ prompt, model: GEMINI_MODEL })
    });
    const parsed = parseAnalysisJson(result?.text || '');
    return {
        deadline: (parsed.deadline && /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadline)) ? parsed.deadline : '',
        subject: parsed.subject ? String(parsed.subject).slice(0, 60) : '',
        type: (parsed.type && TITLE_KINDS.includes(parsed.type)) ? parsed.type : '',
        summary: Array.isArray(parsed.summary)
            ? parsed.summary.map(item => String(item).trim()).filter(Boolean).slice(0, 3)
            : []
    };
}

async function analyzeNotice() {
    const content = document.getElementById('post-content').value.trim();
    const status = document.getElementById('analyze-status');
    const button = document.getElementById('ai-analyze-btn');
    const setStatus = (text, isError = false) => {
        if (!status) return;
        status.textContent = text;
        status.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
    };

    if (content.length < 10) {
        setStatus('먼저 공지 원문을 입력해주세요.', true);
        document.getElementById('post-content').focus();
        return;
    }

    button.disabled = true;
    document.getElementById('ai-loading').style.display = 'flex';
    try {
        const parsed = await runNoticeAnalysis(content);

        if (parsed.subject) document.getElementById('title-subject').value = parsed.subject;
        if (parsed.type) document.getElementById('title-kind').value = parsed.type;
        if (parsed.deadline) document.getElementById('post-deadline').value = parsed.deadline;
        composeAiSummary = parsed.summary;

        // 분석 결과는 양식 조합으로 흐르므로 직접수정 모드를 끈다.
        document.getElementById('title-manual').checked = false;
        document.getElementById('post-title-manual').hidden = true;
        refreshTitlePreview();

        const gotSomething = parsed.subject || parsed.type || parsed.deadline;
        setStatus(gotSomething
            ? 'AI 분석 완료. 값을 확인하고 필요하면 직접 고치세요.'
            : 'AI가 값을 추출하지 못했습니다. 직접 입력해주세요.', !gotSomething);
    } catch (error) {
        // 로컬처럼 GEMINI_API_KEY가 없으면 여기로 온다. 수동 입력으로 계속 진행 가능.
        setStatus(`AI 분석을 쓸 수 없습니다(${error.message}). 아래에서 직접 입력해주세요.`, true);
    } finally {
        document.getElementById('ai-loading').style.display = 'none';
        button.disabled = false;
    }
}

// ========================================
// 💬 익명 피드백 (관리자 열람)
// ========================================

async function loadAdminFeedback() {
    const list = document.getElementById('admin-feedback-list');
    const status = document.getElementById('feedback-admin-status');
    if (!list) return;
    list.innerHTML = '<div class="review-empty">불러오는 중입니다.</div>';
    try {
        const result = await apiRequest('/api/admin/feedback', {
            method: 'GET',
            headers: getNoticeAdminHeaders()
        });
        const items = Array.isArray(result?.feedback) ? result.feedback : [];
        const badge = document.getElementById('feedback-count');
        if (badge) {
            badge.hidden = items.length === 0;
            badge.textContent = String(items.length);
        }
        if (status) {
            status.textContent = items.length ? `받은 피드백 ${items.length}건 (작성자 정보 없음)` : '아직 받은 피드백이 없습니다.';
            status.style.color = 'var(--text-sub)';
        }
        list.innerHTML = items.length
            ? items.map(item => `
                <div class="admin-feedback-item">
                    <p class="admin-feedback-msg">${escapeHtml(item.message)}</p>
                    <div class="admin-feedback-foot">
                        <span>${escapeHtml(String(item.createdAt || '').slice(0, 16).replace('T', ' '))}</span>
                        <button class="btn btn-danger btn-small" type="button" onclick="deleteFeedback('${escapeHtml(item.id)}')">삭제</button>
                    </div>
                </div>`).join('')
            : '<div class="review-empty">아직 받은 피드백이 없습니다.</div>';
    } catch (error) {
        if (status) { status.textContent = error.message; status.style.color = 'var(--danger)'; }
        list.innerHTML = '<div class="review-empty">피드백을 불러오지 못했습니다.</div>';
    }
}

async function deleteFeedback(id) {
    if (!confirm('이 피드백을 삭제할까요?')) return;
    try {
        await apiRequest(`/api/admin/feedback/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getNoticeAdminHeaders()
        });
        await loadAdminFeedback();
    } catch (error) {
        alert(`삭제 실패: ${error.message}`);
    }
}

// ========================================
// 📝 공지 저장
// ========================================

async function generateAIAndSave() {
    refreshTitlePreview();
    const title = document.getElementById('post-title').value.trim();
    const target = document.getElementById('post-target').value;
    // 주관 기관은 제목 양식에서 고른 값을 그대로 쓴다. 따로 입력받지 않는다.
    const host = (isTitleManual() ? '' : getSelectedTitleHost()) || '기타';
    const deadline = document.getElementById('post-deadline').value;
    const content = document.getElementById('post-content').value.trim();
    const fileInput = document.getElementById('post-images');

    if (!title) {
        alert('제목 양식의 핵심 내용을 입력해주세요.');
        document.getElementById(isTitleManual() ? 'post-title-manual' : 'title-subject').focus();
        return;
    }
    if (!content) {
        alert('공지 원문은 필수입니다.');
        document.getElementById('post-content').focus();
        return;
    }

    document.getElementById('ai-loading').style.display = 'flex';

    let aiSummary = [];
    let finalImages = [];
    let existing = null;

    if (editingNoticeId) {
        existing = notices.find(n => String(n.id) === String(editingNoticeId)) || null;
    }

    // 3줄 요약은 원문 분석 때 함께 만든다. 분석을 안 눌렀고 원문이 바뀌었으면
    // 저장 직전에 한 번 분석해서 요약을 채운다(별도 요약 전용 호출은 없다).
    if (composeAiSummary.length > 0) {
        aiSummary = composeAiSummary;
    } else if (!existing || existing.content !== content) {
        try {
            aiSummary = (await runNoticeAnalysis(content)).summary;
        } catch (error) {
            console.error('저장 직전 분석 실패:', error);
            aiSummary = existing?.aiSummary || [];
        }
    } else {
        aiSummary = existing.aiSummary || [];
    }

    // 붙여넣은 이미지 → 파일 첨부 순으로 합치고 최대 20장으로 자른다.
    for (const src of pastedImages) {
        if (finalImages.length >= MAX_NOTICE_IMAGES) break;
        finalImages.push(src);
    }
    for (let i = 0; i < fileInput.files.length; i++) {
        if (finalImages.length >= MAX_NOTICE_IMAGES) break;
        finalImages.push(await getBase64(fileInput.files[i]));
    }
    // 붙여넣기도 파일 첨부도 없으면, 수정 중인 공지의 기존 사진을 그대로 유지한다.
    if (finalImages.length === 0 && existing) {
        finalImages = existing.images || [];
    }

    const newNoticeData = { title, host, target, deadline, content, aiSummary, images: finalImages };

    try {
        if (editingNoticeId) {
            await apiRequest(`/api/notices/${editingNoticeId}`, {
                method: 'PUT',
                headers: getNoticeAdminHeaders(),
                body: JSON.stringify(newNoticeData)
            });
        } else {
            await apiRequest('/api/notices', {
                method: 'POST',
                headers: getNoticeAdminHeaders(),
                body: JSON.stringify(newNoticeData)
            });
        }
        await loadNoticePage(1, { replace: true });
    } catch (error) {
        document.getElementById('ai-loading').style.display = 'none';
        alert(`공지 저장 실패: ${error.message}`);
        return;
    }

    document.getElementById('ai-loading').style.display = 'none';
    alert(editingNoticeId ? '공지가 수정되었습니다.' : '공지가 등록되었습니다.');
    resetComposeForm();
    renderAdminNoticeList();
}

// ========================================
// 📋 등록된 공지 목록 (수정 / 삭제)
// ========================================

function setAdminNoticeStatus(message, isError = false) {
    const status = document.getElementById('admin-notice-status');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
}

async function loadAdminNoticeList() {
    setAdminNoticeStatus('공지 목록을 불러오는 중입니다.');
    try {
        await loadNoticePage(1, { replace: true });
        renderAdminNoticeList();
        setAdminNoticeStatus(`전체 ${noticeRepository.pagination.total}건 중 ${notices.length}건 표시`);
    } catch (error) {
        setAdminNoticeStatus(error.message, true);
    }
}

async function loadMoreAdminNotices() {
    const { page, totalPages } = noticeRepository.pagination;
    if (page >= totalPages) {
        setAdminNoticeStatus('마지막 공지까지 모두 불러왔습니다.');
        return;
    }
    try {
        await loadNoticePage(page + 1);
        renderAdminNoticeList();
        setAdminNoticeStatus(`전체 ${noticeRepository.pagination.total}건 중 ${notices.length}건 표시`);
    } catch (error) {
        setAdminNoticeStatus(error.message, true);
    }
}

function renderAdminNoticeList() {
    const list = document.getElementById('admin-notice-list');
    if (!list) return;

    const more = document.getElementById('admin-notice-more');
    if (more) {
        const { page, totalPages } = noticeRepository.pagination;
        more.hidden = totalPages === 0 || page >= totalPages;
    }

    if (notices.length === 0) {
        list.innerHTML = '<div class="review-empty">등록된 공지가 없습니다.</div>';
        return;
    }

    list.innerHTML = notices.map(notice => {
        const id = escapeHtml(String(notice.id));
        return `
            <div class="admin-notice-row ${String(notice.id) === String(editingNoticeId) ? 'is-editing' : ''}">
                <div class="admin-notice-row-main">
                    <span class="admin-notice-row-title">${escapeHtml(notice.title || '제목 없음')}</span>
                    <span class="admin-notice-row-meta">
                        ${escapeHtml(notice.host || '기타')} · ${escapeHtml(notice.target || '전체')}
                        · 마감 ${escapeHtml(notice.deadline || '상시')} · 조회 ${Number(notice.views) || 0}
                    </span>
                </div>
                <div class="admin-notice-row-actions">
                    <button class="btn btn-outline btn-small" type="button" onclick="editAdminNotice('${id}')">수정</button>
                    <button class="btn btn-danger btn-small" type="button" onclick="deleteAdminNotice('${id}')">삭제</button>
                </div>
            </div>`;
    }).join('');
}

async function editAdminNotice(id) {
    let notice;
    try {
        notice = await getNoticeDetail(id);
    } catch (error) {
        alert(`공지를 불러오지 못했습니다: ${error.message}`);
        return;
    }

    editingNoticeId = notice.id;
    // 새 붙여넣기 이미지·분석 요약은 초기화한다. 아무것도 바꾸지 않으면 기존 값이 유지된다.
    pastedImages = [];
    composeAiSummary = [];
    renderPastePreview();
    applyTitleToBuilder(notice.title);
    document.getElementById('post-target').value = notice.target || '전체';
    document.getElementById('post-deadline').value = notice.deadline || '';
    document.getElementById('post-content').value = notice.content || '';
    document.getElementById('post-images').value = '';
    document.getElementById('panel-compose-title').textContent = '공지 수정';
    document.getElementById('submit-btn-text').textContent = '수정 업로드';
    document.getElementById('compose-cancel').hidden = false;

    selectAdminTab('compose');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteAdminNotice(id) {
    const notice = notices.find(item => String(item.id) === String(id));
    if (!confirm(`"${notice?.title || id}" 공지를 삭제할까요?\n되돌릴 수 없습니다.`)) return;

    try {
        await apiRequest(`/api/notices/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getNoticeAdminHeaders()
        });
    } catch (error) {
        alert(`삭제 실패: ${error.message}`);
        return;
    }

    if (String(editingNoticeId) === String(id)) resetComposeForm();
    await loadAdminNoticeList();
    alert('삭제되었습니다.');
}

// ========================================
// 🧐 공지 검수함
// ========================================

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
            <li><a href="${escapeHtml(safeHttpUrl(file.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name || '첨부파일')}</a></li>
        `).join('')}</ul>`
        : '<p class="review-list-meta">첨부파일 없음</p>';
    editor.innerHTML = `
        <div class="review-source">
            <strong>출처</strong>
            <a href="${escapeHtml(safeHttpUrl(notice.sourceUrl))}" target="_blank" rel="noopener noreferrer">ECE 원문 열기</a>
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
    await loadNoticePage(1, { replace: true });
    renderAdminNoticeList();
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

// ========================================
// 🖼 배너 관리
// ========================================

async function verifyBannerPassword() {
    const input = document.getElementById('banner-mode-pwd');
    const error = document.getElementById('banner-pwd-error');
    const password = input.value;
    error.textContent = '';

    if (!password) {
        error.textContent = '배너 비밀번호를 입력해주세요.';
        input.focus();
        return;
    }

    try {
        await apiRequest('/api/banner/verify', {
            method: 'POST',
            body: JSON.stringify({ password })
        });
    } catch (requestError) {
        error.textContent = `인증 실패: ${requestError.message}`;
        input.focus();
        return;
    }

    bannerManageAuthToken = password;
    sessionStorage.setItem('eceBannerManageToken', bannerManageAuthToken);
    input.value = '';
    unlockBannerPanel();
}

async function unlockBannerPanel() {
    document.getElementById('banner-lock').hidden = true;
    document.getElementById('banner-list-area').hidden = false;
    await loadBannerSlides();
    renderBannerList();
}

function toDateTimeLocalValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function resolveUpdateExpiresAt(input) {
    const value = input?.value || '';
    const originalLocalValue = input?.dataset?.originalLocalValue || '';
    if (value === originalLocalValue) return '';
    return value ? new Date(value).toISOString() : '';
}

function renderBannerList() {
    renderBannerSection('right_rail', '오른쪽 세로 광고');
    renderLegacyBannerSection();
}

// 상단 가로 배너가 사라져 갈 곳이 없어진 슬라이드들. 관리 화면에서 아예 안 보이면
// 지울 방법이 없으므로 삭제 버튼만 붙여 따로 모아 보여준다.
function renderLegacyBannerSection() {
    const section = document.getElementById('legacy-banner-section');
    const container = document.getElementById('legacy-banner-slides-list');
    if (!section || !container) return;

    const orphans = bannerSlides.filter(slide => (slide.placement || 'header') !== 'right_rail');
    section.hidden = orphans.length === 0;
    container.innerHTML = orphans.map(slide => `
        <div class="banner-item">
            <div class="banner-item-header">
                <span class="banner-item-text">${escapeHtml(slide.text || slide.name || '이름 없는 배너')}</span>
                <div class="banner-item-actions">
                    <button class="btn btn-small btn-danger" type="button"
                            onclick="deleteBannerSlide(${Number(slide.id)})">삭제</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderBannerSection(placement, title) {
    const container = document.getElementById('right-rail-slides-list');
    if (!container) return;

    const slides = getBannerSlidesByPlacement(placement);
    container.setAttribute('aria-label', title);
    container.innerHTML = '';

    slides.forEach((slide, idx) => {
        const safeId = Number(slide.id);
        const safeText = escapeHtml(slide.text || '');
        const localExpiresAt = toDateTimeLocalValue(slide.expiresAt);
        const slideItem = document.createElement('div');
        slideItem.className = 'banner-item';
        slideItem.innerHTML = `
            <div class="banner-item-header">
                <span class="banner-item-text">${safeText}</span>
                <div class="banner-item-actions">
                    <button class="btn btn-outline btn-small" onclick="moveBanner('${placement}', ${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn btn-outline btn-small" onclick="moveBanner('${placement}', ${idx}, 1)" ${idx === slides.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="btn btn-small btn-danger" onclick="deleteBannerSlide(${safeId})">삭제</button>
                </div>
            </div>
            <div class="banner-item-form">
                <input type="text" maxlength="50" placeholder="관리용 이름" value="${escapeHtml(slide.name || '')}" class="banner-input-name-${safeId}">
                <input type="text" maxlength="100" placeholder="배너 텍스트" value="${safeText}" class="banner-input-text-${safeId}">
                <input type="color" value="${escapeHtml(slide.textColor || '#000000')}" class="banner-input-color-${safeId}">
                <input type="datetime-local" value="${localExpiresAt}" data-original-local-value="${localExpiresAt}" class="banner-input-expires-at-${safeId}">
                <textarea class="banner-input-description-${safeId}" maxlength="240" placeholder="짧은 광고 설명">${escapeHtml(slide.description || '')}</textarea>
                <input type="url" class="banner-input-link-${safeId}" value="${escapeHtml(slide.linkUrl || '')}" placeholder="https://...">
                <input type="text" class="banner-input-alt-${safeId}" maxlength="160" value="${escapeHtml(slide.altText || '')}" placeholder="이미지 대체 텍스트">
                <input type="file" accept="image/*" class="banner-input-file-${safeId}">
                <button class="btn btn-small" onclick="updateBannerSlide(${safeId})">수정</button>
            </div>
        `;
        container.appendChild(slideItem);
    });

    const addForm = document.createElement('div');
    addForm.className = 'banner-item banner-item-add';
    addForm.innerHTML = `
        <div class="banner-item-header"><span>새 ${title} 추가</span></div>
        <div class="banner-item-form">
            <input type="text" id="new-right_rail-name" maxlength="50" placeholder="관리용 이름">
            <input type="text" id="new-right_rail-text" maxlength="100" placeholder="배너 텍스트">
            <input type="color" id="new-right_rail-color" value="#000000" placeholder="텍스트 색">
            <input type="color" id="new-right_rail-bg" value="#ffffff" placeholder="배경 색">
            <textarea id="new-right_rail-description" maxlength="240" placeholder="짧은 광고 설명"></textarea>
            <input type="url" id="new-right_rail-link-url" placeholder="https://...">
            <input type="text" id="new-right_rail-alt-text" maxlength="160" placeholder="이미지 대체 텍스트">
            <input type="datetime-local" id="new-right_rail-expires-at">
            <input type="file" id="new-right_rail-image" accept="image/*">
            <button class="btn btn-small" type="button" onclick="addNewBannerSlide('${placement}')">추가</button>
        </div>
    `;
    container.appendChild(addForm);
}

async function addNewBannerSlide(placement) {
    const text = (document.getElementById(`new-${placement}-text`)?.value || '').trim();
    const name = (document.getElementById(`new-${placement}-name`)?.value || '').trim();
    const textColor = document.getElementById(`new-${placement}-color`)?.value || '#000000';
    const bgColor = document.getElementById(`new-${placement}-bg`)?.value || '#ffffff';
    const description = (document.getElementById(`new-${placement}-description`)?.value || '').trim();
    const linkUrl = (document.getElementById(`new-${placement}-link-url`)?.value || '').trim();
    const altText = (document.getElementById(`new-${placement}-alt-text`)?.value || '').trim();
    const expiresAt = document.getElementById(`new-${placement}-expires-at`)?.value || '';
    const imageInput = document.getElementById(`new-${placement}-image`);
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
                name: name || normalizedText.substring(0, 50),
                text: normalizedText,
                bgStyle: `background: ${bgColor};`,
                textColor,
                src: imageSrc,
                order: getBannerSlidesByPlacement(placement).length,
                placement,
                description,
                linkUrl,
                altText,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : ''
            })
        });

        bannerSlides.push(result.slide);
        renderBannerList();
        alert('배너가 추가되었습니다!');
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

    const prevSlide = bannerSlides.find(slide => Number(slide.id) === Number(slideId));
    if (!prevSlide) return;

    const newText = (document.querySelector(`.banner-input-text-${slideId}`)?.value || '').trim();
    const newName = (document.querySelector(`.banner-input-name-${slideId}`)?.value || '').trim();
    const newColor = document.querySelector(`.banner-input-color-${slideId}`)?.value || prevSlide.textColor || '#000000';
    const descriptionInput = document.querySelector(`.banner-input-description-${slideId}`);
    const linkInput = document.querySelector(`.banner-input-link-${slideId}`);
    const altInput = document.querySelector(`.banner-input-alt-${slideId}`);
    const expiresInput = document.querySelector(`.banner-input-expires-at-${slideId}`);
    const expiresAt = resolveUpdateExpiresAt(expiresInput);
    const imageInput = document.querySelector(`.banner-input-file-${slideId}`);
    const imageFile = imageInput?.files?.[0] || null;
    const imageSrc = imageFile ? await getBase64(imageFile) : null;

    if (!newText && !imageSrc && !prevSlide.src) {
        alert('배너 텍스트 또는 이미지를 입력해주세요.');
        return;
    }

    try {
        const result = await apiRequest(`/api/banner-slides/${slideId}`, {
            method: 'PUT',
            headers: getBannerManageHeaders(),
            body: JSON.stringify({
                name: (newName || prevSlide.name || newText || '이미지 배너').substring(0, 50),
                text: newText || prevSlide.text || '이미지 배너',
                textColor: newColor,
                bgStyle: prevSlide.bgStyle || 'background: #ffffff;',
                src: imageSrc || prevSlide.src || null,
                order: Number(prevSlide.order) || 0,
                placement: prevSlide.placement || 'header',
                description: descriptionInput ? descriptionInput.value.trim() : (prevSlide.description || ''),
                linkUrl: linkInput ? linkInput.value.trim() : (prevSlide.linkUrl || ''),
                altText: altInput ? altInput.value.trim() : (prevSlide.altText || ''),
                expiresAt
            })
        });

        const idx = bannerSlides.findIndex(slide => Number(slide.id) === Number(slideId));
        if (idx !== -1) bannerSlides[idx] = result.slide;
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

        bannerSlides = bannerSlides.filter(s => Number(s.id) !== Number(slideId));
        renderBannerList();
        alert('배너가 삭제되었습니다!');
    } catch (error) {
        alert(`배너 삭제 실패: ${error.message}`);
    }
}

async function moveBanner(placement, idx, dir) {
    const slides = getBannerSlidesByPlacement(placement);
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= slides.length) return;

    const reordered = [...slides];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(nextIdx, 0, moved);
    const items = reordered
        .filter(slide => Number.isFinite(Number(slide.id)))
        .map((slide, order) => ({ id: Number(slide.id), order }));

    if (items.length === 0) return;

    try {
        const result = await apiRequest('/api/banner-slides/reorder', {
            method: 'PUT',
            headers: getBannerManageHeaders(),
            body: JSON.stringify({ items })
        });

        if (Array.isArray(result?.slides)) {
            bannerSlides = result.slides;
        } else {
            const nextById = new Map(reordered.map((slide, order) => [Number(slide.id), { ...slide, order }]));
            bannerSlides = bannerSlides.map(slide => nextById.get(Number(slide.id)) || slide);
        }
        renderBannerList();
    } catch (error) {
        alert(`배너 순서 변경 실패: ${error.message}`);
    }
}

// ========================================
// 🏷 카테고리 추천
// ========================================

function setCategoryManagerStatus(message, isError = false) {
    const element = document.getElementById('category-manager-status');
    if (!element) return;
    element.textContent = message || '';
    element.style.color = isError ? 'var(--danger)' : 'var(--text-sub)';
}

async function loadCategoryCandidates() {
    const list = document.getElementById('category-candidate-list');
    if (!list) return;
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

// ========================================
// ⚙️ 관리자 설정 (절대 관리자 전용)
// ========================================

async function verifySuperAdminPassword() {
    const input = document.getElementById('super-admin-pwd');
    const error = document.getElementById('super-admin-error');
    const password = input.value;
    error.textContent = '';

    if (!password) {
        error.textContent = '절대 관리자 비밀번호를 입력해주세요.';
        input.focus();
        return;
    }

    try {
        await apiRequest('/api/super-admin/verify', {
            method: 'POST',
            headers: getSuperAdminHeaders(password)
        });
    } catch (requestError) {
        error.textContent = `인증 실패: ${requestError.message}`;
        input.focus();
        return;
    }

    superAdminAuthToken = password;
    sessionStorage.setItem('eceSuperAdminToken', superAdminAuthToken);
    input.value = '';
    unlockSettingsPanel();
}

function unlockSettingsPanel() {
    document.getElementById('settings-lock').hidden = true;
    document.getElementById('settings-area').hidden = false;
    document.getElementById('edit-admin-name').value = adminInfo.name;
    document.getElementById('edit-admin-phone').value = adminInfo.phone;
    document.getElementById('edit-admin-kakao').value = adminInfo.kakao;
    document.getElementById('edit-banner-admin-name').value = bannerAdminInfo.name;
    document.getElementById('edit-banner-admin-phone').value = bannerAdminInfo.phone;
    document.getElementById('edit-banner-admin-kakao').value = bannerAdminInfo.kakao;
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
            bannerAdminInfo = {
                name: result?.bannerInfo?.name || nextBannerInfo.name || bannerAdminInfo.name,
                phone: result?.bannerInfo?.phone || nextBannerInfo.phone || bannerAdminInfo.phone,
                kakao: result?.bannerInfo?.kakao || nextBannerInfo.kakao || bannerAdminInfo.kakao
            };

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
                    pwdChanged.push('공지 관리자 비밀번호');
                }
                if (newBannerPwd) pwdChanged.push('배너 비밀번호');
            }

            document.getElementById('edit-admin-pwd').value = '';
            document.getElementById('edit-banner-pwd').value = '';
            const pwdMsg = pwdChanged.length > 0 ? `\n✅ ${pwdChanged.join(', ')} 변경 완료` : '';
            alert('관리자 설정이 업데이트되었습니다.' + pwdMsg);
        })
        .catch(error => {
            alert(`관리자 설정 업데이트 실패: ${error.message}`);
        });
}

// ========================================
// 🚀 초기화
// ========================================

document.addEventListener('DOMContentLoaded', async function () {
    // core.js가 공개 화면에서만 loadData()를 돌리므로 여기서 직접 채운다.
    noticeAdminAuthToken = sessionStorage.getItem('eceNoticeAdminToken') || sessionStorage.getItem('eceAdminToken') || '';
    superAdminAuthToken = sessionStorage.getItem('eceSuperAdminToken') || '';
    bannerManageAuthToken = sessionStorage.getItem('eceBannerManageToken') || '';

    pendingEditNoticeId = new URLSearchParams(location.search).get('edit');
    resetComposeForm();
    initImagePaste();

    try {
        const settings = await apiRequest('/api/settings', { method: 'GET' });
        if (settings?.adminInfo) adminInfo = { ...adminInfo, ...settings.adminInfo };
        if (settings?.bannerInfo) bannerAdminInfo = { ...bannerAdminInfo, ...settings.bannerInfo };
    } catch (error) {
        console.error('관리자 설정 불러오기 실패:', error);
    }

    if (noticeAdminAuthToken) {
        // 세션에 남아 있는 토큰이 아직 유효한지 확인한 뒤에만 통과시킨다.
        try {
            await apiRequest('/api/admin/verify', {
                method: 'POST',
                headers: getNoticeAdminHeaders()
            });
            await enterAdminWorkspace();
            return;
        } catch {
            noticeAdminAuthToken = '';
            sessionStorage.removeItem('eceNoticeAdminToken');
            sessionStorage.removeItem('eceAdminToken');
        }
    }

    document.getElementById('admin-gate-password').focus();
});
