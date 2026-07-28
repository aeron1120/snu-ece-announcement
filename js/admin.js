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
let composeAiCategoryIds = [];
let composeSurveyReward = '';
let aiDeadlineCandidate = '';
let aiProgressTimer = null;
let aiProgressValue = 0;
let aiProgressCeiling = 0;
let aiProgressActiveStep = 'prepare';
let reviewInboxPollTimer = null;
let reviewInboxPollInFlight = false;
let adminFeedbackItems = [];
let adminFeedbackFilter = 'all';
let adminNoticePagination = { page: 0, total: 0, totalPages: 0 };
let kakaoBackfillBatchId = '';
let kakaoBackfillDrafts = [];

// 제목 양식에서 쓰는 유형 목록. 편집할 때 기존 제목을 되돌려 읽는 데에도 쓴다.
const TITLE_KINDS = ['모집', '안내', '신청', '접수', '공지', '행사', '변경 안내', '결과 발표', '기간 연장'];
const AI_PROGRESS_STEPS = ['prepare', 'analyze', 'process', 'save'];

function setAiProgress(value, status, activeStep = null, ceiling = value) {
    aiProgressValue = Math.max(aiProgressValue, Math.min(100, Math.round(value)));
    aiProgressCeiling = Math.max(aiProgressValue, Math.min(98, Math.round(ceiling)));
    if (AI_PROGRESS_STEPS.includes(activeStep)) aiProgressActiveStep = activeStep;
    const bar = document.getElementById('ai-progress-bar');
    const percent = document.getElementById('ai-progress-percent');
    const message = document.getElementById('ai-progress-status');
    if (bar) bar.value = aiProgressValue;
    if (percent) percent.textContent = `${aiProgressValue}%`;
    if (message && status) message.textContent = status;

    const activeIndex = AI_PROGRESS_STEPS.indexOf(aiProgressActiveStep);
    document.querySelectorAll('[data-ai-step]').forEach(item => {
        const index = AI_PROGRESS_STEPS.indexOf(item.dataset.aiStep);
        item.classList.toggle('done', activeIndex >= 0 && index < activeIndex);
        item.classList.toggle('active', index === activeIndex && aiProgressValue < 100);
    });
}

function beginAiProgress(status = '원문을 준비하고 있습니다.') {
    if (aiProgressTimer) clearInterval(aiProgressTimer);
    aiProgressValue = 0;
    aiProgressCeiling = 15;
    aiProgressActiveStep = 'prepare';
    const overlay = document.getElementById('ai-loading');
    overlay.classList.remove('rate-limited');
    overlay.style.display = 'flex';
    document.getElementById('ai-progress-heading').innerHTML = '<strong>Gemini AI</strong> 작업 중';
    setAiProgress(5, status, 'prepare', 15);
    aiProgressTimer = setInterval(() => {
        if (aiProgressValue < aiProgressCeiling) {
            setAiProgress(aiProgressValue + 1, null, null, aiProgressCeiling);
        }
    }, 450);
}

function updateAiProgress(value, status, activeStep, ceiling = value + 12) {
    setAiProgress(value, status, activeStep, ceiling);
}

function finishAiProgress(status = '작업이 완료되었습니다.') {
    if (aiProgressTimer) clearInterval(aiProgressTimer);
    aiProgressTimer = null;
    setAiProgress(100, status, 'save', 100);
    document.querySelectorAll('[data-ai-step]').forEach(item => {
        item.classList.remove('active');
        item.classList.add('done');
    });
}

function hideAiProgress() {
    if (aiProgressTimer) clearInterval(aiProgressTimer);
    aiProgressTimer = null;
    const overlay = document.getElementById('ai-loading');
    overlay.style.display = 'none';
    overlay.classList.remove('rate-limited');
}

function isGeminiRateLimitError(error) {
    return error?.code === 'GEMINI_RATE_LIMIT' || Number(error?.status) === 429;
}

async function showGeminiRetryCountdown(error) {
    if (aiProgressTimer) clearInterval(aiProgressTimer);
    aiProgressTimer = null;
    const overlay = document.getElementById('ai-loading');
    const heading = document.getElementById('ai-progress-heading');
    const status = document.getElementById('ai-progress-status');
    const timer = document.getElementById('ai-progress-percent');
    let remaining = Math.max(1, Math.ceil(Number(error?.retryAfterSeconds) || 60));

    overlay.classList.add('rate-limited');
    overlay.style.display = 'flex';
    heading.textContent = 'Gemini 호출 대기';
    while (remaining > 0) {
        status.textContent = `분당 호출 초과로 ${remaining}초 뒤에 다시 실행 부탁드립니다.`;
        timer.textContent = `${remaining}초`;
        await new Promise(resolve => setTimeout(resolve, 1000));
        remaining -= 1;
    }
    status.textContent = '다시 실행할 수 있습니다.';
    timer.textContent = '0초';
    await new Promise(resolve => setTimeout(resolve, 700));
}

async function enterAdminWorkspace() {
    const workspace = document.getElementById('admin-workspace');
    if (workspace) workspace.hidden = false;
    document.getElementById('admin-mode-exit').textContent = '관리자 모드 나가기';

    await loadCategories();
    await loadReviewNotices();
    startReviewInboxPolling();
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

async function exitAdminMode() {
    noticeAdminAuthToken = '';
    superAdminAuthToken = '';
    bannerManageAuthToken = '';
    sessionStorage.removeItem('eceNoticeAdminToken');
    sessionStorage.removeItem('eceAdminToken');
    sessionStorage.removeItem('eceSuperAdminToken');
    sessionStorage.removeItem('eceBannerManageToken');
    try {
        await fetch('/api/admin/session', { method: 'DELETE' });
    } finally {
        location.replace('./index.html');
    }
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

function setKakaoBackfillStatus(message, isError = false) {
    const status = document.getElementById('kakao-backfill-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function formatBackfillDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

function renderKakaoBackfillPreview(stats) {
    const summary = document.getElementById('kakao-backfill-summary');
    const wrap = document.getElementById('kakao-backfill-table-wrap');
    const rows = document.getElementById('kakao-backfill-rows');
    if (!summary || !wrap || !rows) return;
    const unclassifiedPercent = ((Number(stats?.unclassifiedRate) || 0) * 100).toFixed(1);
    summary.hidden = false;
    summary.innerHTML = `
        메시지 <strong>${Number(stats?.messageCount) || 0}건</strong> →
        검토 초안 <strong>${Number(stats?.draftCount) || 0}건</strong> ·
        30일 내 재공지 묶음 <strong>${Number(stats?.groupedDuplicateCount) || 0}건</strong> ·
        미분류 <strong>${Number(stats?.unclassifiedCount) || 0}건 (${unclassifiedPercent}%)</strong>
    `;
    const categoryOptions = orderedNoticeCategories().map(category =>
        `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</option>`
    ).join('');
    rows.innerHTML = kakaoBackfillDrafts.map((draft, index) => `
        <tr data-backfill-index="${index}">
            <td><input class="backfill-include" type="checkbox" checked aria-label="${escapeHtml(draft.title)} 포함"></td>
            <td>
                <span class="backfill-meta">
                    <strong>${escapeHtml(draft.sourceGroup || '미확인')}</strong>
                    <span>${escapeHtml(draft.sender || '')}</span>
                    <time>${escapeHtml(formatBackfillDateTime(draft.sourcePublishedAt))}</time>
                </span>
            </td>
            <td>
                <input class="backfill-title" type="text" maxlength="200" value="${escapeHtml(draft.title || '')}">
                <small>${escapeHtml(draft.contentPreview || '')}</small>
            </td>
            <td><input class="backfill-host" type="text" maxlength="80" value="${escapeHtml(draft.host || '')}"></td>
            <td>
                <select class="backfill-category" aria-label="분류 초안">
                    <option value="">분류 선택</option>
                    ${categoryOptions}
                </select>
            </td>
            <td>
                <span class="backfill-thread-count">재공지 ${Number(draft.reminderCount) || 0}건</span>
                <small>사진 ${Number(draft.imageAttachmentCount) || 0} · 파일 ${Number(draft.attachmentCount) || 0}</small>
            </td>
        </tr>
    `).join('');
    rows.querySelectorAll('tr').forEach((row, index) => {
        row.querySelector('.backfill-category').value = kakaoBackfillDrafts[index]?.categorySlug || '';
    });
    wrap.hidden = kakaoBackfillDrafts.length === 0;
}

async function previewKakaoBackfill() {
    const input = document.getElementById('kakao-backfill-file');
    const button = document.getElementById('kakao-backfill-preview-button');
    const file = input?.files?.[0];
    if (!file) {
        setKakaoBackfillStatus('카카오톡 대화 내보내기 .txt 파일을 선택해주세요.', true);
        return;
    }
    button.disabled = true;
    setKakaoBackfillStatus('원본 개행을 유지한 채 메시지와 재공지 묶음을 분석하고 있습니다.');
    try {
        const result = await apiRequest('/api/admin/backfill/kakao/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: await file.arrayBuffer()
        });
        kakaoBackfillBatchId = result.batchId;
        kakaoBackfillDrafts = Array.isArray(result.drafts) ? result.drafts : [];
        renderKakaoBackfillPreview(result.stats || {});
        setKakaoBackfillStatus('자동 분류는 초안입니다. 제목·발신 주체·카테고리를 확인한 뒤 검수함으로 보내세요.');
    } catch (error) {
        kakaoBackfillBatchId = '';
        kakaoBackfillDrafts = [];
        setKakaoBackfillStatus(error.message || '백필 원본을 분석하지 못했습니다.', true);
    } finally {
        button.disabled = false;
    }
}

async function importKakaoBackfill() {
    if (!kakaoBackfillBatchId) {
        setKakaoBackfillStatus('먼저 원본 파일을 분석해주세요.', true);
        return;
    }
    const button = document.getElementById('kakao-backfill-import-button');
    const edits = Array.from(document.querySelectorAll('#kakao-backfill-rows tr')).map(row => {
        const draft = kakaoBackfillDrafts[Number(row.dataset.backfillIndex)];
        return {
            sourceExternalId: draft.sourceExternalId,
            include: row.querySelector('.backfill-include').checked,
            title: row.querySelector('.backfill-title').value.trim(),
            host: row.querySelector('.backfill-host').value.trim(),
            categorySlug: row.querySelector('.backfill-category').value
        };
    });
    const missingCategory = edits.find(edit => edit.include && !edit.categorySlug);
    if (missingCategory) {
        setKakaoBackfillStatus('포함할 모든 항목의 카테고리를 선택해주세요.', true);
        return;
    }
    button.disabled = true;
    setKakaoBackfillStatus('선택 항목을 검수함에 저장하고 있습니다.');
    try {
        const result = await apiRequest('/api/admin/backfill/kakao/import', {
            method: 'POST',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify({ batchId: kakaoBackfillBatchId, edits })
        });
        kakaoBackfillBatchId = '';
        setKakaoBackfillStatus(
            `검수함 ${result.createdCount}건 저장 · 제외 ${result.skippedCount}건 · 중복 ${result.duplicateCount}건 · 실패 ${result.failedCount}건`
        );
        await loadReviewNotices();
    } catch (error) {
        setKakaoBackfillStatus(error.message || '백필 초안을 저장하지 못했습니다.', true);
    } finally {
        button.disabled = false;
    }
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
    composeAiCategoryIds = [];
    composeSurveyReward = '';
    aiDeadlineCandidate = '';
    renderAiDeadlineCandidate();
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
    document.getElementById('post-always-open').checked = false;
    document.getElementById('post-pinned').checked = false;
    toggleAlwaysOpenState();
    renderAiDeadlineCandidate();
    document.getElementById('post-content').value = '';
    document.getElementById('post-images').value = '';
    document.getElementById('panel-compose-title').textContent = '새 공지 등록';
    document.getElementById('submit-btn-text').textContent = '공지 업로드';
    document.getElementById('compose-cancel').hidden = true;
    refreshTitlePreview();
}

function renderAiDeadlineCandidate() {
    const button = document.getElementById('ai-deadline-candidate');
    if (!button) return;
    button.hidden = !aiDeadlineCandidate;
    button.textContent = aiDeadlineCandidate
        ? `AI 후보 ${aiDeadlineCandidate} 적용`
        : '';
}

function applyAiDeadlineCandidate() {
    if (!aiDeadlineCandidate) return;
    const alwaysOpen = document.getElementById('post-always-open');
    const deadline = document.getElementById('post-deadline');
    alwaysOpen.checked = false;
    deadline.value = aiDeadlineCandidate;
    toggleAlwaysOpenState();
}

function toggleAlwaysOpenState() {
    const alwaysOpen = document.getElementById('post-always-open');
    const deadline = document.getElementById('post-deadline');
    if (!alwaysOpen || !deadline) return;
    deadline.disabled = alwaysOpen.checked;
    if (alwaysOpen.checked) deadline.value = '';
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
형식: {"deadline":"YYYY-MM-DD 또는 빈문자열","subject":"포스터용 핵심 문구 10~28자","type":"${TITLE_KINDS.join('|')} 중 하나","summary":["요약1","요약2","요약3"],"categorySlugs":["application|academics|benefits-partnerships|campus|governance|survey 중 해당값"],"surveyReward":"설문 보상 또는 빈문자열"}
- 오늘 날짜는 ${today}. 마감일이 원문에 없거나 불명확하면 deadline은 빈문자열.
- type은 반드시 제시한 보기 중 하나.
- subject에는 유형 단어(${TITLE_KINDS.join(', ')})를 넣지 말고 핵심 명사구만. 예: "개강총회 참가자".
- 사진 없는 카드에서 2~3줄로 자연스럽게 나뉘도록, 긴 한 덩어리 대신 의미가 분명한 짧은 어절 묶음으로 작성.
- 격식적인 보도자료 문체보다 학생이 빠르게 읽는 자연스럽고 캐주얼한 표현을 사용.
- 물음표 반복, 깨진 문자, 불완전한 조사, 같은 단어 반복을 절대 포함하지 말 것. 원문 글자가 깨졌다면 문맥상 확실한 내용만 한국어로 복원.
- summary는 각 줄 명사형 종결의 3줄 요약.
- 신청(application): 링크·폼·메일로 직접 제출해야 하고 마감이 있을 때만.
- 학사(academics): 학점·졸업·수강에 직접 영향이 있고 대체 안내 채널이 부족할 때.
- 혜택/제휴(benefits-partnerships): 돈·물품·할인·지원이 걸렸지만 놓쳐도 학사상 불이익이 없을 때.
- 캠퍼스(campus): 특정 날짜에 출입·시설·교통·정전 등 캠퍼스 상태가 평소와 다를 때.
- 자치(governance): 일반 학부생이 아니라 대의원·학생회 집행부 등 자치기구가 주 수신 대상일 때.
- 설문조사(survey): 참가 신청이 아니라 의견·경험·만족도·연구 자료를 수집하는 설문·인터뷰·사용자 조사일 때. 단순 행사 신청폼은 제외.
- 설문 상품·기프티콘·사례비·추첨 보상이 있으면 surveyReward에 조건과 상품명을 60자 이내로 적고, 없으면 빈문자열.
- categorySlugs는 중복 선택할 수 있지만 약한 연관성으로 늘리지 말고 가능한 한 핵심 범주 하나만 선택.

원문:
${content}`;

    const result = await apiRequest('/api/summary', {
        method: 'POST',
        headers: getNoticeAdminHeaders(),
        body: JSON.stringify({ prompt, model: GEMINI_MODEL })
    });
    const parsed = parseAnalysisJson(result?.text || '');
    const allowedCategorySlugs = new Set([
        'application', 'academics', 'benefits-partnerships', 'campus', 'governance', 'survey'
    ]);
    const categorySlugs = Array.isArray(parsed.categorySlugs)
        ? Array.from(new Set(parsed.categorySlugs
            .map(value => String(value || '').trim())
            .filter(value => allowedCategorySlugs.has(value))))
        : [];
    return {
        deadline: (parsed.deadline && /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadline)) ? parsed.deadline : '',
        subject: parsed.subject ? String(parsed.subject).slice(0, 60) : '',
        type: (parsed.type && TITLE_KINDS.includes(parsed.type)) ? parsed.type : '',
        summary: Array.isArray(parsed.summary)
            ? parsed.summary.map(item => String(item).trim()).filter(Boolean).slice(0, 3)
            : [],
        surveyReward: String(parsed.surveyReward || '').trim().slice(0, 120),
        categoryIds: categorySlugs
            .map(slug => activeCategories.find(category => category.slug === slug)?.id)
            .map(Number)
            .filter(Number.isSafeInteger)
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
    beginAiProgress('공지 원문을 준비하고 있습니다.');
    try {
        updateAiProgress(18, 'Gemini가 원문을 분석하고 있습니다.', 'analyze', 76);
        const parsed = await runNoticeAnalysis(content);
        updateAiProgress(82, '분석 결과를 입력 항목에 정리하고 있습니다.', 'process', 94);

        if (parsed.subject) document.getElementById('title-subject').value = parsed.subject;
        if (parsed.type) document.getElementById('title-kind').value = parsed.type;
        aiDeadlineCandidate = parsed.deadline || '';
        renderAiDeadlineCandidate();
        composeAiSummary = parsed.summary;
        composeAiCategoryIds = parsed.categoryIds;
        composeSurveyReward = parsed.surveyReward;

        // 분석 결과는 양식 조합으로 흐르므로 직접수정 모드를 끈다.
        document.getElementById('title-manual').checked = false;
        document.getElementById('post-title-manual').hidden = true;
        refreshTitlePreview();

        const gotSomething = parsed.subject || parsed.type || parsed.deadline;
        setStatus(gotSomething
            ? 'AI 분석 완료. 값을 확인하고 필요하면 직접 고치세요.'
            : 'AI가 값을 추출하지 못했습니다. 직접 입력해주세요.', !gotSomething);
        finishAiProgress('Gemini 분석이 완료되었습니다.');
        await new Promise(resolve => setTimeout(resolve, 250));
    } catch (error) {
        if (isGeminiRateLimitError(error)) {
            setStatus('Gemini 분당 호출 한도를 초과했습니다.', true);
            await showGeminiRetryCountdown(error);
        } else {
            // 로컬처럼 GEMINI_API_KEY가 없으면 여기로 온다. 수동 입력으로 계속 진행 가능.
            setStatus(`AI 분석을 쓸 수 없습니다(${error.message}). 아래에서 직접 입력해주세요.`, true);
        }
    } finally {
        hideAiProgress();
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
        adminFeedbackItems = items.map(item => ({
            ...item,
            category: ['banner', 'summary_mismatch'].includes(item.category) ? item.category : 'general'
        }));
        const badge = document.getElementById('feedback-count');
        const generalItems = adminFeedbackItems.filter(item => item.category !== 'banner');
        if (badge) {
            badge.hidden = generalItems.length === 0;
            badge.textContent = String(generalItems.length);
        }
        if (status) {
            status.textContent = generalItems.length ? `받은 문의 ${generalItems.length}건 (작성자 정보 없음)` : '아직 받은 일반 문의가 없습니다.';
            status.style.color = 'var(--text-sub)';
        }
        renderAdminFeedback();
        renderBannerInquiryAdmin();
    } catch (error) {
        if (status) { status.textContent = error.message; status.style.color = 'var(--danger)'; }
        list.innerHTML = '<div class="review-empty">피드백을 불러오지 못했습니다.</div>';
    }
}

function setAdminFeedbackFilter(category) {
    adminFeedbackFilter = ['general', 'summary_mismatch'].includes(category) ? category : 'all';
    document.querySelectorAll('[data-feedback-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.feedbackFilter === adminFeedbackFilter);
    });
    renderAdminFeedback();
}

function renderAdminFeedback() {
    const list = document.getElementById('admin-feedback-list');
    if (!list) return;
    const feedbackOnly = adminFeedbackItems.filter(item => item.category !== 'banner');
    const visibleItems = adminFeedbackFilter === 'all'
        ? feedbackOnly
        : feedbackOnly.filter(item => item.category === adminFeedbackFilter);
    list.innerHTML = visibleItems.length
        ? visibleItems.map(item => {
            const isBanner = item.category === 'banner';
            const isSummaryMismatch = item.category === 'summary_mismatch';
            const inquiry = isBanner && item.inquiry ? item.inquiry : null;
            const contact = inquiry
                ? [inquiry.phone, inquiry.email].filter(Boolean).map(value => escapeHtml(value)).join(' · ')
                : '';
            const safeLink = inquiry?.linkUrl && /^https?:\/\//i.test(inquiry.linkUrl)
                ? escapeHtml(inquiry.linkUrl)
                : '';
            return `
                <div class="admin-feedback-item ${isBanner ? 'is-banner' : ''}${isSummaryMismatch ? ' is-summary-mismatch' : ''}">
                    <span class="feedback-kind ${isBanner ? 'banner' : (isSummaryMismatch ? 'summary' : 'general')}">${isBanner ? '배너 문의' : (isSummaryMismatch ? '요약 오류' : '일반 문의')}</span>
                    ${isSummaryMismatch ? `<p class="admin-feedback-notice"><strong>${escapeHtml(item.noticeTitle || '제목 없음')}</strong><br><span>공지 ID ${escapeHtml(item.noticeId || '')}</span></p>` : ''}
                    <p class="admin-feedback-msg">${escapeHtml(item.message)}</p>
                    ${inquiry ? `
                        <dl class="banner-inquiry-details">
                            <div><dt>신청자</dt><dd>${escapeHtml(inquiry.name)} · ${escapeHtml(inquiry.organization)}</dd></div>
                            <div><dt>연락처</dt><dd>${contact}</dd></div>
                            <div><dt>희망 기간</dt><dd>${escapeHtml(inquiry.startDate)} ~ ${escapeHtml(inquiry.endDate)}</dd></div>
                            ${safeLink ? `<div><dt>연결 링크</dt><dd><a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeLink}</a></dd></div>` : ''}
                        </dl>
                        ${item.hasImage ? `<button class="btn btn-outline btn-small" type="button"
                            onclick="openBannerInquiryImage('${escapeHtml(item.id)}')">제출 이미지 보기</button>` : ''}
                    ` : ''}
                    <div class="admin-feedback-foot">
                        <span>${escapeHtml(String(item.createdAt || '').slice(0, 16).replace('T', ' '))}</span>
                        <button class="btn btn-danger btn-small" type="button" onclick="deleteFeedback('${escapeHtml(item.id)}')">삭제</button>
                    </div>
                </div>`;
        }).join('')
        : '<div class="review-empty">이 종류의 피드백이 없습니다.</div>';
}

function renderBannerInquiryAdmin() {
    const list = document.getElementById('banner-inquiry-admin-list');
    if (!list) return;
    const inquiries = adminFeedbackItems.filter(item => item.category === 'banner');
    list.innerHTML = inquiries.length ? inquiries.map(item => {
        const inquiry = item.inquiry || {};
        const contact = [inquiry.phone, inquiry.email].filter(Boolean).join(' · ');
        const safeLink = inquiry.linkUrl && /^https?:\/\//i.test(inquiry.linkUrl)
            ? escapeHtml(inquiry.linkUrl)
            : '';
        return `
            <article class="admin-feedback-item is-banner">
                <span class="feedback-kind banner">승인 대기 문의</span>
                <p class="admin-feedback-msg"><strong>${escapeHtml(inquiry.title || '제목 없음')}</strong><br>${escapeHtml(inquiry.description || '')}</p>
                <dl class="banner-inquiry-details">
                    <div><dt>신청자</dt><dd>${escapeHtml(inquiry.name || '')} · ${escapeHtml(inquiry.organization || '')}</dd></div>
                    <div><dt>연락처</dt><dd>${escapeHtml(contact)}</dd></div>
                    <div><dt>희망 기간</dt><dd>${escapeHtml(inquiry.startDate || '')} ~ ${escapeHtml(inquiry.endDate || '')}</dd></div>
                    ${safeLink ? `<div><dt>연결 링크</dt><dd><a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeLink}</a></dd></div>` : ''}
                </dl>
                <div class="admin-feedback-foot">
                    <span>${escapeHtml(String(item.createdAt || '').slice(0, 16).replace('T', ' '))}</span>
                    <div>
                        ${item.hasImage ? `<button class="btn btn-outline btn-small" type="button" onclick="openBannerInquiryImage('${escapeHtml(item.id)}')">제출 이미지</button>` : ''}
                        ${item.bannerSlideId ? `<button class="btn btn-small" type="button" onclick="focusBannerSlide('${Number(item.bannerSlideId)}')">배너 검토</button>` : ''}
                        <button class="btn btn-danger btn-small" type="button" onclick="deleteFeedback('${escapeHtml(item.id)}')">접수 삭제</button>
                    </div>
                </div>
            </article>`;
    }).join('') : '<div class="review-empty">접수된 배너 문의가 없습니다.</div>';
}

function focusBannerSlide(id) {
    const element = document.getElementById(`banner-slide-${Number(id)}`);
    if (!element) {
        alert('연결된 배너 항목을 찾지 못했습니다. 위 목록에서 승인 대기 항목을 확인해주세요.');
        return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('is-highlighted');
    window.setTimeout(() => element.classList.remove('is-highlighted'), 1400);
}

async function openBannerInquiryImage(id) {
    const previewWindow = window.open('', '_blank');
    if (previewWindow) previewWindow.opener = null;
    try {
        const response = await fetch(buildApiUrl(`/api/admin/feedback/${encodeURIComponent(id)}/image`), {
            method: 'GET',
            headers: getNoticeAdminHeaders()
        });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || '이미지를 찾을 수 없습니다.');
        }
        const imageUrl = URL.createObjectURL(await response.blob());
        if (previewWindow) {
            previewWindow.document.title = '제출 배너 이미지';
            previewWindow.document.body.style.cssText = 'margin:0;display:grid;min-height:100vh;place-items:center;background:#111827';
            const image = previewWindow.document.createElement('img');
            image.src = imageUrl;
            image.alt = '제출된 배너 이미지';
            image.style.cssText = 'display:block;max-width:96vw;max-height:96vh;object-fit:contain';
            previewWindow.addEventListener('beforeunload', () => URL.revokeObjectURL(imageUrl), { once: true });
            previewWindow.document.body.appendChild(image);
        } else {
            URL.revokeObjectURL(imageUrl);
        }
    } catch (error) {
        previewWindow?.close();
        alert(error.message || '이미지를 열지 못했습니다.');
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
    const isAlwaysOpen = document.getElementById('post-always-open').checked;
    const isPinned = document.getElementById('post-pinned').checked;
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

    let aiSummary = [];
    let categoryIds = [];
    let surveyReward = '';
    let finalImages = [];
    let existing = null;

    if (editingNoticeId) {
        existing = notices.find(n => String(n.id) === String(editingNoticeId)) || null;
    }

    beginAiProgress('공지 저장 준비를 시작합니다.');
    try {
        // 3줄 요약은 원문 분석 때 함께 만든다. 분석을 안 눌렀고 원문이 바뀌었으면
        // 저장 직전에 한 번 분석해서 요약을 채운다(별도 요약 전용 호출은 없다).
        if (composeAiSummary.length > 0) {
            updateAiProgress(42, '앞서 만든 Gemini 분석 결과를 확인하고 있습니다.', 'analyze', 58);
            aiSummary = composeAiSummary;
            categoryIds = composeAiCategoryIds;
            surveyReward = composeSurveyReward;
        } else if (!existing || existing.content !== content) {
            updateAiProgress(18, 'Gemini가 원문을 분석하고 있습니다.', 'analyze', 68);
            try {
                const analysis = await runNoticeAnalysis(content);
                aiSummary = analysis.summary;
                categoryIds = analysis.categoryIds;
                surveyReward = analysis.surveyReward;
            } catch (error) {
                if (isGeminiRateLimitError(error)) throw error;
                console.error('저장 직전 분석 실패:', error);
                aiSummary = existing?.aiSummary || [];
                categoryIds = existing?.categoryIds || [];
                surveyReward = existing?.surveyReward || '';
            }
        } else {
            updateAiProgress(42, '기존 분석 결과를 확인하고 있습니다.', 'analyze', 58);
            aiSummary = existing.aiSummary || [];
            categoryIds = existing.categoryIds || [];
            surveyReward = existing.surveyReward || '';
        }

        updateAiProgress(68, '첨부 이미지를 정리하고 있습니다.', 'process', 82);
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

        const newNoticeData = {
            title,
            host,
            target,
            deadline,
            deadlineAt: deadline || null,
            isAlwaysOpen,
            isPinned,
            isHidden: existing?.isHidden === true,
            surveyReward,
            content,
            aiSummary,
            categoryIds,
            images: finalImages
        };
        updateAiProgress(84, '공지 내용을 서버에 저장하고 있습니다.', 'save', 94);
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
        updateAiProgress(95, '저장된 공지 목록을 새로 불러오고 있습니다.', 'save', 98);
        await loadAdminNoticeList();
        finishAiProgress(editingNoticeId ? '공지 수정이 완료되었습니다.' : '공지 등록이 완료되었습니다.');
        await new Promise(resolve => setTimeout(resolve, 250));
    } catch (error) {
        if (isGeminiRateLimitError(error)) {
            await showGeminiRetryCountdown(error);
        } else {
            alert(`공지 저장 실패: ${error.message}`);
        }
        return;
    } finally {
        hideAiProgress();
    }

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
        const result = await apiRequest('/api/admin/notices?page=1&limit=20', {
            method: 'GET',
            headers: getNoticeAdminHeaders()
        });
        notices = Array.isArray(result?.notices) ? result.notices : [];
        adminNoticePagination = result?.pagination || { page: 1, total: notices.length, totalPages: 1 };
        renderAdminNoticeList();
        setAdminNoticeStatus(`전체 ${adminNoticePagination.total}건 중 ${notices.length}건 표시`);
    } catch (error) {
        setAdminNoticeStatus(error.message, true);
    }
}

async function loadMoreAdminNotices() {
    const { page, totalPages } = adminNoticePagination;
    if (page >= totalPages) {
        setAdminNoticeStatus('마지막 공지까지 모두 불러왔습니다.');
        return;
    }
    try {
        const result = await apiRequest(`/api/admin/notices?page=${page + 1}&limit=20`, {
            method: 'GET',
            headers: getNoticeAdminHeaders()
        });
        const knownIds = new Set(notices.map(notice => String(notice.id)));
        notices.push(...(result.notices || []).filter(notice => !knownIds.has(String(notice.id))));
        adminNoticePagination = result.pagination || adminNoticePagination;
        renderAdminNoticeList();
        setAdminNoticeStatus(`전체 ${adminNoticePagination.total}건 중 ${notices.length}건 표시`);
    } catch (error) {
        setAdminNoticeStatus(error.message, true);
    }
}

function renderAdminNoticeList() {
    const list = document.getElementById('admin-notice-list');
    if (!list) return;

    const more = document.getElementById('admin-notice-more');
    if (more) {
        const { page, totalPages } = adminNoticePagination;
        more.hidden = totalPages === 0 || page >= totalPages;
    }

    if (notices.length === 0) {
        list.innerHTML = '<div class="review-empty">등록된 공지가 없습니다.</div>';
        return;
    }

    list.innerHTML = notices.map(notice => {
        const id = escapeHtml(String(notice.id));
        return `
            <div class="admin-notice-row ${String(notice.id) === String(editingNoticeId) ? 'is-editing' : ''} ${notice.isHidden ? 'is-hidden' : ''}">
                <div class="admin-notice-row-main">
                    <span class="admin-notice-row-title">${escapeHtml(notice.title || '제목 없음')}</span>
                    <span class="admin-notice-row-meta">
                        ${escapeHtml(notice.host || '기타')} · ${escapeHtml(notice.target || '전체')}
                        · 마감 ${escapeHtml(notice.deadline || '상시')} · 조회 ${Number(notice.views) || 0}
                        ${notice.isHidden ? ' · 숨김' : ''}
                    </span>
                </div>
                <div class="admin-notice-row-actions">
                    <button class="btn btn-outline btn-small" type="button" onclick="editAdminNotice('${id}')">수정</button>
                    <button class="btn btn-outline btn-small" type="button"
                            onclick="toggleAdminNoticeHidden('${id}', ${notice.isHidden ? 'false' : 'true'})">${notice.isHidden ? '공개' : '숨김'}</button>
                    <button class="btn btn-danger btn-small" type="button" onclick="deleteAdminNotice('${id}')">삭제</button>
                </div>
            </div>`;
    }).join('');
}

async function toggleAdminNoticeHidden(id, hidden) {
    try {
        const result = await apiRequest(`/api/notices/${encodeURIComponent(id)}/visibility`, {
            method: 'PATCH',
            headers: getNoticeAdminHeaders(),
            body: JSON.stringify({ hidden })
        });
        const index = notices.findIndex(notice => String(notice.id) === String(id));
        if (index >= 0) notices[index] = { ...notices[index], ...result.notice };
        renderAdminNoticeList();
        setAdminNoticeStatus(hidden
            ? '공개 목록에서 숨겼습니다. 관리자 목록에서는 계속 확인할 수 있습니다.'
            : '공개 목록에 다시 노출했습니다.');
    } catch (error) {
        alert(`공개 상태 변경 실패: ${error.message}`);
    }
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
    composeAiCategoryIds = [];
    composeSurveyReward = '';
    aiDeadlineCandidate = '';
    renderAiDeadlineCandidate();
    renderPastePreview();
    applyTitleToBuilder(notice.title);
    document.getElementById('post-target').value = notice.target || '전체';
    document.getElementById('post-deadline').value = notice.deadline || '';
    document.getElementById('post-always-open').checked = notice.isAlwaysOpen === true;
    document.getElementById('post-pinned').checked = notice.isPinned === true;
    toggleAlwaysOpenState();
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

async function loadReviewNotices({ quiet = false } = {}) {
    const list = document.getElementById('review-notice-list');
    if (!list) return;
    if (!quiet) {
        list.innerHTML = '<div class="review-empty">검수 대기 공지를 불러오는 중입니다.</div>';
        setReviewStatus('목록을 갱신하고 있습니다.');
    }
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
        if (!quiet) {
            list.innerHTML = '<div class="review-empty">검수 목록을 불러오지 못했습니다.</div>';
            setReviewStatus(error.message, true);
        }
    }
}

function startReviewInboxPolling() {
    if (reviewInboxPollTimer) clearInterval(reviewInboxPollTimer);
    reviewInboxPollTimer = setInterval(async () => {
        const reviewPanel = document.getElementById('panel-review');
        if (document.visibilityState !== 'visible' || !reviewPanel?.classList.contains('active')
            || reviewInboxPollInFlight || reviewMutationInFlight) return;
        reviewInboxPollInFlight = true;
        try {
            await loadReviewNotices({ quiet: true });
        } finally {
            reviewInboxPollInFlight = false;
        }
    }, 60_000);
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
    const isOcrEligible = String(notice.rawContent || notice.content || '').trim().length < 15;
    const indexedOcrCharacters = String(notice.ocrText || '').length;
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
                <label class="title-manual-row">
                    <input id="review-always-open" type="checkbox" ${notice.isAlwaysOpen ? 'checked' : ''}>
                    상시 공지
                </label>
                <label class="title-manual-row">
                    <input id="review-pinned" type="checkbox" ${notice.isPinned ? 'checked' : ''}>
                    상단 고정
                </label>
            </div>
            <div class="form-group">
                <label for="review-keywords">키워드 (쉼표로 구분)</label>
                <input id="review-keywords" type="text" value="${escapeHtml(keywords.join(', '))}">
            </div>
            <div class="form-group">
                <label for="review-survey-reward">설문 참여 보상</label>
                <input id="review-survey-reward" type="text" maxlength="120"
                       value="${escapeHtml(notice.surveyReward || '')}" placeholder="예: 추첨 20명 스타벅스 기프티콘">
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
        ${isOcrEligible ? `
            <div class="review-ocr-box">
                <strong>이미지 검색 텍스트</strong>
                <p>OCR 결과는 검색 인덱스에만 저장되며 공개 원문에는 표시되지 않습니다.
                   ${indexedOcrCharacters ? `현재 ${indexedOcrCharacters}자가 검색에 반영되어 있습니다.` : ''}</p>
                <input id="review-ocr-images" type="file" accept="image/png,image/jpeg,image/webp" multiple>
                <button class="btn btn-outline btn-small review-action" type="button" onclick="runReviewOcr()">이미지 OCR 실행</button>
            </div>
        ` : ''}
        <div class="review-actions">
            <button class="btn btn-outline btn-small review-action" type="button" onclick="reanalyzeReviewNotice()">AI 편집 적용</button>
            <button class="btn btn-danger btn-small review-action" type="button" onclick="rejectReviewNotice()">반려</button>
            <button class="btn btn-outline btn-small review-action" type="button" onclick="publishReviewNotice(false)">승인만</button>
            <button class="btn btn-small review-action" type="button" onclick="publishReviewNotice(true)">승인 및 알림</button>
        </div>`;
}

async function runReviewOcr() {
    if (reviewMutationInFlight || !selectedReviewNoticeId) return;
    const input = document.getElementById('review-ocr-images');
    const files = Array.from(input?.files || []).slice(0, 5);
    if (files.length === 0) {
        setReviewStatus('OCR할 이미지를 선택해주세요.', true);
        return;
    }
    if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
        setReviewStatus('OCR 이미지는 JPG, PNG, WEBP 형식이어야 합니다.', true);
        return;
    }
    setReviewMutationBusy(true);
    setReviewStatus('이미지 글자를 추출해 검색 인덱스에 저장하고 있습니다.');
    try {
        const images = await Promise.all(files.map(getBase64));
        const result = await apiRequest(
            `/api/admin/review-notices/${encodeURIComponent(selectedReviewNoticeId)}/ocr`,
            {
                method: 'POST',
                headers: getNoticeAdminHeaders(),
                body: JSON.stringify({ images })
            }
        );
        const index = reviewNotices.findIndex(item =>
            String(item.id) === String(selectedReviewNoticeId));
        if (index >= 0) reviewNotices[index] = result.notice;
        renderReviewEditor(result.notice);
        setReviewStatus(`OCR ${Number(result?.ocr?.indexedCharacters) || 0}자가 검색 인덱스에 저장되었습니다.`);
    } catch (error) {
        setReviewStatus(error.message || 'OCR 처리에 실패했습니다.', true);
    } finally {
        setReviewMutationBusy(false);
    }
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
        deadlineAt: document.getElementById('review-deadline').value || null,
        isAlwaysOpen: document.getElementById('review-always-open').checked,
        isPinned: document.getElementById('review-pinned').checked,
        targets: splitReviewValues(document.getElementById('review-targets').value),
        keywords: splitReviewValues(document.getElementById('review-keywords').value),
        surveyReward: document.getElementById('review-survey-reward').value.trim(),
        categoryIds: Array.from(
            document.querySelectorAll('input[name="review-category"]:checked')
        ).map(input => Number(input.value)),
        aiSummary: document.getElementById('review-summary').value
            .split('\n').map(item => item.trim()).filter(Boolean)
    };
}

async function refreshPublishedNotices() {
    await loadAdminNoticeList();
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
        if (result.deadlineCandidate && !result.notice.deadline) {
            document.getElementById('review-deadline').value = result.deadlineCandidate;
        }
        renderReviewNoticeList();
        setReviewStatus('AI가 제목·본문 문단·요약·카테고리·설문 보상을 편집했습니다. 저장 전 내용을 확인해주세요.');
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
    await Promise.all([loadBannerSlides(true), loadAdminFeedback()]);
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
    renderBannerSection('right_rail', '오른쪽 학내 홍보');
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
    const maxBanners = 5;
    const isAtLimit = slides.length >= maxBanners;
    const limitStatus = document.getElementById('banner-limit-status');
    if (limitStatus) {
        limitStatus.textContent = `${slides.length} / ${maxBanners}`;
        limitStatus.classList.toggle('is-full', isAtLimit);
    }
    container.setAttribute('aria-label', title);
    container.innerHTML = '';

    slides.forEach((slide, idx) => {
        const safeId = Number(slide.id);
        const safeText = escapeHtml(slide.text || '');
        const localExpiresAt = toDateTimeLocalValue(slide.expiresAt);
        const localStartsAt = toDateTimeLocalValue(slide.startsAt);
        const safeImage = slide.src ? escapeHtml(slide.src) : '';
        const slideItem = document.createElement('div');
        slideItem.className = 'banner-item';
        slideItem.id = `banner-slide-${safeId}`;
        slideItem.innerHTML = `
            <div class="banner-item-header">
                <div>
                    <span class="banner-order-chip">${idx + 1}</span>
                    <span class="banner-item-text">${escapeHtml(slide.name || slide.text || '이름 없는 배너')}</span>
                </div>
                <div class="banner-item-actions">
                    <button class="btn btn-outline btn-small" type="button" aria-label="위로 이동" onclick="moveBanner('${placement}', ${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn btn-outline btn-small" type="button" aria-label="아래로 이동" onclick="moveBanner('${placement}', ${idx}, 1)" ${idx === slides.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
            </div>
            <div class="banner-editor-layout">
                <div class="banner-visual-column">
                    <div class="banner-image-preview ${safeImage ? '' : 'is-empty'}" id="banner-preview-${safeId}">
                        ${safeImage
                            ? `<img src="${safeImage}" alt="">`
                            : '<span>이미지 미등록<br><small>권장 4:5 세로형</small></span>'}
                    </div>
                    <label class="banner-upload-button">
                        사진 교체
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                               class="banner-input-file-${safeId}"
                               onchange="previewBannerUpload(this, 'banner-preview-${safeId}')">
                    </label>
                    ${safeImage ? `
                        <label class="banner-remove-image">
                            <input type="checkbox" class="banner-input-remove-${safeId}"> 기존 사진 제거
                        </label>
                    ` : ''}
                </div>
                <div class="banner-item-form">
                    <label class="banner-field">
                        <span>홍보 유형</span>
                        <select class="banner-input-type-${safeId}">
                            <option value="club" ${slide.type === 'club' ? 'selected' : ''}>동아리</option>
                            <option value="project" ${slide.type === 'project' ? 'selected' : ''}>프로젝트</option>
                            <option value="council" ${slide.type === 'council' ? 'selected' : ''}>학생회</option>
                        </select>
                    </label>
                    <label class="banner-field">
                        <span>승인 상태</span>
                        <select class="banner-input-status-${safeId}">
                            <option value="pending" ${slide.status === 'pending' ? 'selected' : ''}>승인 대기</option>
                            <option value="approved" ${slide.status === 'approved' ? 'selected' : ''}>승인</option>
                            <option value="rejected" ${slide.status === 'rejected' ? 'selected' : ''}>반려</option>
                        </select>
                    </label>
                    <label class="banner-field">
                        <span>관리용 이름</span>
                        <input type="text" maxlength="50" placeholder="예: 8월 학생회 행사" value="${escapeHtml(slide.name || '')}" class="banner-input-name-${safeId}">
                    </label>
                    <label class="banner-field">
                        <span>홍보 주체</span>
                        <input type="text" maxlength="80" placeholder="예: SNU ECE 학생회" value="${escapeHtml(slide.owner || '')}" class="banner-input-owner-${safeId}">
                    </label>
                    <label class="banner-field banner-field-wide">
                        <span>공개 제목</span>
                        <input type="text" maxlength="100" placeholder="학내 홍보 제목" value="${safeText}" class="banner-input-text-${safeId}">
                    </label>
                    <label class="banner-field banner-field-wide">
                        <span>짧은 설명</span>
                        <textarea class="banner-input-description-${safeId}" maxlength="240" placeholder="홍보의 핵심 내용을 한두 문장으로 적어주세요.">${escapeHtml(slide.description || '')}</textarea>
                    </label>
                    <label class="banner-field banner-field-wide">
                        <span>클릭 시 연결 링크</span>
                        <input type="url" class="banner-input-link-${safeId}" value="${escapeHtml(slide.linkUrl || '')}" placeholder="https://example.com/apply">
                    </label>
                    <label class="banner-field">
                        <span>이미지 대체 텍스트</span>
                        <input type="text" class="banner-input-alt-${safeId}" maxlength="160" value="${escapeHtml(slide.altText || '')}" placeholder="이미지 내용을 설명">
                    </label>
                    <label class="banner-field">
                        <span>노출 시작</span>
                        <input type="datetime-local" value="${localStartsAt}" data-original-local-value="${localStartsAt}" class="banner-input-starts-at-${safeId}">
                    </label>
                    <label class="banner-field">
                        <span>노출 종료</span>
                        <input type="datetime-local" value="${localExpiresAt}" data-original-local-value="${localExpiresAt}" class="banner-input-expires-at-${safeId}">
                    </label>
                    <input type="hidden" value="${escapeHtml(slide.textColor || '#000000')}" class="banner-input-color-${safeId}">
                    <div class="banner-form-actions banner-field-wide">
                        <button class="btn btn-small" type="button" onclick="updateBannerSlide(${safeId})">변경사항 저장</button>
                        <button class="btn btn-small btn-danger" type="button" onclick="deleteBannerSlide(${safeId})">홍보 삭제</button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(slideItem);
    });

    const addForm = document.createElement('div');
    addForm.className = 'banner-item banner-item-add';
    addForm.innerHTML = `
        <div class="banner-item-header">
            <div>
                <span class="banner-item-text">새 학내 홍보 추가하기</span>
                <small>${isAtLimit ? '최대 5개가 등록되어 있습니다. 기존 항목을 삭제하면 추가할 수 있습니다.' : '승인 상태와 노출 기간이 모두 맞을 때만 공개됩니다.'}</small>
            </div>
        </div>
        <div class="banner-editor-layout ${isAtLimit ? 'is-disabled' : ''}">
            <div class="banner-visual-column">
                <div class="banner-image-preview is-empty" id="new-banner-preview">
                    <span>사진 미리보기<br><small>권장 800×1000px</small></span>
                </div>
                <label class="banner-upload-button ${isAtLimit ? 'is-disabled' : ''}">
                    사진 업로드
                    <input type="file" id="new-right_rail-image"
                           accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                           onchange="previewBannerUpload(this, 'new-banner-preview')" ${isAtLimit ? 'disabled' : ''}>
                </label>
            </div>
            <div class="banner-item-form">
                <label class="banner-field">
                    <span>홍보 유형</span>
                    <select id="new-right_rail-type" ${isAtLimit ? 'disabled' : ''}>
                        <option value="club">동아리</option>
                        <option value="project">프로젝트</option>
                        <option value="council">학생회</option>
                    </select>
                </label>
                <label class="banner-field">
                    <span>승인 상태</span>
                    <select id="new-right_rail-status" ${isAtLimit ? 'disabled' : ''}>
                        <option value="approved">승인</option>
                        <option value="pending">승인 대기</option>
                        <option value="rejected">반려</option>
                    </select>
                </label>
                <label class="banner-field">
                    <span>관리용 이름</span>
                    <input type="text" id="new-right_rail-name" maxlength="50" placeholder="관리자만 구분하는 이름" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <label class="banner-field">
                    <span>홍보 주체</span>
                    <input type="text" id="new-right_rail-owner" maxlength="80" placeholder="예: SNU ECE 학생회" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <label class="banner-field banner-field-wide">
                    <span>공개 제목</span>
                    <input type="text" id="new-right_rail-text" maxlength="100" placeholder="학내 홍보 제목" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <label class="banner-field banner-field-wide">
                    <span>짧은 설명</span>
                    <textarea id="new-right_rail-description" maxlength="240" placeholder="홍보의 핵심 내용을 한두 문장으로 적어주세요." ${isAtLimit ? 'disabled' : ''}></textarea>
                </label>
                <label class="banner-field banner-field-wide">
                    <span>클릭 시 연결 링크</span>
                    <input type="url" id="new-right_rail-link-url" placeholder="https://example.com/apply" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <label class="banner-field">
                    <span>이미지 대체 텍스트</span>
                    <input type="text" id="new-right_rail-alt-text" maxlength="160" placeholder="이미지 내용을 설명" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <label class="banner-field">
                    <span>노출 시작</span>
                    <input type="datetime-local" id="new-right_rail-starts-at" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <label class="banner-field">
                    <span>노출 종료</span>
                    <input type="datetime-local" id="new-right_rail-expires-at" ${isAtLimit ? 'disabled' : ''}>
                </label>
                <input type="hidden" id="new-right_rail-color" value="#000000">
                <input type="hidden" id="new-right_rail-bg" value="#ffffff">
                <div class="banner-form-actions banner-field-wide">
                    <button class="btn btn-small" type="button" onclick="addNewBannerSlide('${placement}')" ${isAtLimit ? 'disabled' : ''}>학내 홍보 등록하기</button>
                </div>
            </div>
        </div>
    `;
    container.appendChild(addForm);
}

function previewBannerUpload(input, previewId) {
    const file = input?.files?.[0];
    const preview = document.getElementById(previewId);
    if (!file || !preview) return;
    const reader = new FileReader();
    reader.onload = () => {
        preview.classList.remove('is-empty');
        preview.innerHTML = `<img src="${escapeHtml(reader.result)}" alt="선택한 배너 이미지 미리보기">`;
    };
    reader.readAsDataURL(file);
}

function validateBannerImageFile(file) {
    if (!file) return true;
    if (!String(file.type || '').startsWith('image/')) {
        alert('배너에는 이미지 파일만 업로드할 수 있습니다.');
        return false;
    }
    if (file.size > 6 * 1024 * 1024) {
        alert('배너 이미지는 6MB 이하로 업로드해주세요.');
        return false;
    }
    return true;
}

async function addNewBannerSlide(placement) {
    if (getBannerSlidesByPlacement(placement).length >= 5) {
        alert('오른쪽 배너는 최대 5개까지 등록할 수 있습니다.');
        return;
    }
    const text = (document.getElementById(`new-${placement}-text`)?.value || '').trim();
    const name = (document.getElementById(`new-${placement}-name`)?.value || '').trim();
    const textColor = document.getElementById(`new-${placement}-color`)?.value || '#000000';
    const bgColor = document.getElementById(`new-${placement}-bg`)?.value || '#ffffff';
    const description = (document.getElementById(`new-${placement}-description`)?.value || '').trim();
    const linkUrl = (document.getElementById(`new-${placement}-link-url`)?.value || '').trim();
    const altText = (document.getElementById(`new-${placement}-alt-text`)?.value || '').trim();
    const expiresAt = document.getElementById(`new-${placement}-expires-at`)?.value || '';
    const startsAt = document.getElementById(`new-${placement}-starts-at`)?.value || '';
    const type = document.getElementById(`new-${placement}-type`)?.value || 'council';
    const owner = (document.getElementById(`new-${placement}-owner`)?.value || '').trim();
    const status = document.getElementById(`new-${placement}-status`)?.value || 'pending';
    const imageInput = document.getElementById(`new-${placement}-image`);
    const imageFile = imageInput?.files?.[0] || null;
    if (!validateBannerImageFile(imageFile)) return;

    if (!owner) {
        alert('홍보 주체를 입력해주세요.');
        return;
    }
    if (!text && !imageFile) {
        alert('홍보 제목 또는 이미지를 입력해주세요.');
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
                type,
                owner,
                status,
                startsAt: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : ''
            })
        });

        bannerSlides.push(result.slide);
        renderBannerList();
        alert(status === 'approved' ? '학내 홍보가 공개 목록에 추가되었습니다.' : '학내 홍보가 저장되었습니다.');
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
    const startsInput = document.querySelector(`.banner-input-starts-at-${slideId}`);
    const startsAt = resolveUpdateExpiresAt(startsInput);
    const type = document.querySelector(`.banner-input-type-${slideId}`)?.value || prevSlide.type || 'council';
    const owner = (document.querySelector(`.banner-input-owner-${slideId}`)?.value || '').trim();
    const status = document.querySelector(`.banner-input-status-${slideId}`)?.value || prevSlide.status || 'pending';
    const imageInput = document.querySelector(`.banner-input-file-${slideId}`);
    const imageFile = imageInput?.files?.[0] || null;
    if (!validateBannerImageFile(imageFile)) return;
    const imageSrc = imageFile ? await getBase64(imageFile) : null;
    const removeExistingImage = Boolean(document.querySelector(`.banner-input-remove-${slideId}`)?.checked);

    if (!owner) {
        alert('홍보 주체를 입력해주세요.');
        return;
    }
    if (!newText && !imageSrc && (!prevSlide.src || removeExistingImage)) {
        alert('홍보 제목 또는 이미지를 입력해주세요.');
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
                src: imageSrc || (removeExistingImage ? null : (prevSlide.src || null)),
                order: Number(prevSlide.order) || 0,
                placement: prevSlide.placement || 'header',
                description: descriptionInput ? descriptionInput.value.trim() : (prevSlide.description || ''),
                linkUrl: linkInput ? linkInput.value.trim() : (prevSlide.linkUrl || ''),
                altText: altInput ? altInput.value.trim() : (prevSlide.altText || ''),
                type,
                owner,
                status,
                startsAt,
                expiresAt
            })
        });

        const idx = bannerSlides.findIndex(slide => Number(slide.id) === Number(slideId));
        if (idx !== -1) bannerSlides[idx] = result.slide;
        renderBannerList();
        alert('학내 홍보가 수정되었습니다.');
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

    if (!confirm('이 학내 홍보를 삭제하시겠습니까?')) return;

    try {
        await apiRequest(`/api/banner-slides/${slideId}`, {
            method: 'DELETE',
            headers: getBannerManageHeaders()
        });

        bannerSlides = bannerSlides.filter(s => Number(s.id) !== Number(slideId));
        renderBannerList();
        alert('학내 홍보가 삭제되었습니다.');
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
    noticeAdminAuthToken = '';
    superAdminAuthToken = '';
    bannerManageAuthToken = '';
    sessionStorage.removeItem('eceNoticeAdminToken');
    sessionStorage.removeItem('eceAdminToken');
    sessionStorage.removeItem('eceSuperAdminToken');
    sessionStorage.removeItem('eceBannerManageToken');

    pendingEditNoticeId = new URLSearchParams(location.search).get('edit');

    try {
        await apiRequest('/api/admin/session', { method: 'GET' });
    } catch {
        const next = pendingEditNoticeId ? `?edit=${encodeURIComponent(pendingEditNoticeId)}` : '';
        location.replace(`/admin${next}`);
        return;
    }

    resetComposeForm();
    initImagePaste();

    try {
        const settings = await apiRequest('/api/settings', { method: 'GET' });
        if (settings?.adminInfo) adminInfo = { ...adminInfo, ...settings.adminInfo };
        if (settings?.bannerInfo) bannerAdminInfo = { ...bannerAdminInfo, ...settings.bannerInfo };
    } catch (error) {
        console.error('관리자 설정 불러오기 실패:', error);
    }

    await enterAdminWorkspace();
});
