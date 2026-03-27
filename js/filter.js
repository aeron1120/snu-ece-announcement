    // 각 그룹별 현재 선택값 (기본: 전체 / 최신순)
    const filterState = {
        'deadline-status': '전체',
        'host': '전체',
        'has-image': '전체',
        'saved': '전체',
        'views': '전체',
        'sort': '최신순',
    };

    let filterPanelOpen = false;

    function toggleFilterPanel() {
        filterPanelOpen = !filterPanelOpen;
        document.getElementById('filter-panel').classList.toggle('open', filterPanelOpen);
        document.getElementById('filter-chevron').style.transform = filterPanelOpen ? 'rotate(180deg)' : '';
        if (filterPanelOpen) buildHostButtons();
    }

    // 주관기관 버튼 동적 생성 (현재 notices 기반)
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
        // 같은 그룹 버튼 전부 비활성화
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
        document.querySelectorAll(`[data-group="${group}"]`).forEach(b => {
            b.classList.toggle('active', b.dataset.val === defaults[group]);
        });
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
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === defaults[b.dataset.group]);
        });
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

        // 고급 필터 값 읽기
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

            // --- 기존 로직 완전 유지 ---
            if (viewMode === 'saved' && !isSaved) return;
            if (targetFilter !== "전체" && notice.target !== "전체" && notice.target !== targetFilter) return;

            const safeTitle = notice.title || "";
            const safeContent = notice.content || "";
            const searchTarget = (safeTitle + " " + safeContent).toLowerCase();
            const isMatch = keywords.length === 0 || keywords.every(kw => searchTarget.includes(kw));
            if (!isMatch) return;

            // --- 고급 필터 추가 조건 ---
            const dDay = calcDDay(notice.deadline);

            // 마감 상태
            if (fDeadlineStatus !== '전체') {
                if (fDeadlineStatus === '진행중' && dDay.text === '마감됨') return;
                if (fDeadlineStatus === '마감임박') {
                    const d = notice.deadline ? Math.ceil((new Date(notice.deadline + 'T23:59:59') - CURRENT_DATE) / 86400000) : 999;
                    if (d < 0 || d > 3) return;
                }
                if (fDeadlineStatus === '상시' && notice.deadline) return;
                if (fDeadlineStatus === '마감됨' && dDay.text !== '마감됨') return;
            }

            // 주관 기관
            if (fHost !== '전체' && (notice.host || '기타') !== fHost) return;

            // 이미지
            const hasImg = notice.images && notice.images.length > 0;
            if (fHasImage === '있음' && !hasImg) return;
            if (fHasImage === '없음' && hasImg) return;

            // 찜
            if (fSaved === '찜한것만' && !isSaved) return;

            // 조회수
            const views = notice.views || 0;
            if (fViews === '100이상' && views < 100) return;
            if (fViews === '50이상' && views < 50) return;
            if (fViews === '10미만' && views >= 10) return;

            // 마감일 범위
            if (dateFrom && notice.deadline && notice.deadline < dateFrom) return;
            if (dateTo && notice.deadline && notice.deadline > dateTo) return;
            if (dateFrom && !notice.deadline) return; // 날짜 범위 지정 시 상시 공지 제외 (from 있을 때)

            filtered.push(notice);
        });

        // 정렬
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
        // 최신순은 notices 배열 원래 순서 (notices.unshift로 추가되므로 유지)

        // 카드 렌더링
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

        // 결과 수 표시
        const countEl = document.getElementById('filter-result-count');
        if (countEl) countEl.innerHTML = `결과 <strong>${filtered.length}</strong>건 / 전체 ${notices.length}건`;
    }