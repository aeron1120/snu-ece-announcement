    // ⚠️ totalBanners 하드코딩 제거 → 항상 bannerSlides.length 참조 (refreshBannerDOM 이후에도 정확)
    const bannerTrack = document.getElementById('banner-track');
    const headerBanner = document.getElementById('header-banner');

    // slideBanner: 항상 동적 개수 참조
    function slideBanner() {
        const total = bannerSlides.length || document.getElementById('banner-track').children.length;
        if (total === 0) return;
        currentBannerIdx = (currentBannerIdx + 1) % total;
        updateBannerPosition();
    }

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

    function openModal(id) { 
        document.getElementById(id).style.display = 'flex'; 
        if(id === 'pwd-modal') document.getElementById('admin-pwd').focus();
    }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }

    window.onclick = function(event) {
        if (event.target.classList.contains('overlay')) {
            event.target.style.display = 'none';
            if(event.target.id === 'pwd-modal') pendingAuthAction = null; 
        }
    }

    document.addEventListener('keydown', function(e) {
        const viewer = document.getElementById('image-viewer-modal');
        if (viewer.style.display === 'flex') {
            if (e.key === 'ArrowLeft') navImage(-1);
            if (e.key === 'ArrowRight') navImage(1);
            if (e.key === 'Escape') closeModal('image-viewer-modal');
        }
    });

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
    localStorage.setItem('eceNotices', JSON.stringify(notices));
    filterCards(); 

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
    // 비교 버튼 상태 반영
    setTimeout(() => { if(typeof updateCompareButton === 'function') updateCompareButton(String(idStr)); }, 30);
}   

    // ========================================
    // 🖼️ 배너 모드 관리 기능
    // ========================================
    try {
        const stored = localStorage.getItem('eceBannerSlides');
        if (stored) bannerSlides = JSON.parse(stored);
    } catch(e) {}
    if (bannerSlides.length === 0) bannerSlides = JSON.parse(JSON.stringify(defaultBannerSlides));

    function saveBannerSlides() {
        try { localStorage.setItem('eceBannerSlides', JSON.stringify(bannerSlides)); } catch(e) {}
    }

    function toggleBannerModePanel() {
        const body = document.getElementById('banner-mode-body');
        const chevron = document.getElementById('banner-mode-chevron');
        const isOpen = body.classList.toggle('open');
        chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
        chevron.style.transition = 'transform 0.2s';
    }

    function verifyBannerPassword() {
        const pwd = document.getElementById('banner-mode-pwd').value;
        const errEl = document.getElementById('banner-pwd-error');
        if (pwd === bannerPassword) {
            errEl.style.display = 'none';
            bannerModeUnlocked = true;
            document.getElementById('banner-pwd-section').style.display = 'none';
            document.getElementById('banner-manage-panel').classList.add('open');
            renderBannerList();
        } else {
            errEl.style.display = 'block';
            document.getElementById('banner-mode-pwd').value = '';
            document.getElementById('banner-mode-pwd').focus();
        }
    }

    function renderBannerList() {
        const list = document.getElementById('banner-list-ui');
        const label = document.getElementById('banner-count-label');
        label.textContent = `(총 ${bannerSlides.length}개)`;
        list.innerHTML = '';
        bannerSlides.forEach((slide, idx) => {
            const item = document.createElement('div');
            item.className = 'banner-item';
            item.setAttribute('draggable', 'true');
            item.dataset.idx = idx;
            item.innerHTML = `
                <span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
                ${slide.src ? `<img class="banner-item-preview" src="${slide.src}" alt="${slide.name}">` : `<div class="banner-item-preview" style="${slide.bgStyle} border-radius:6px;"></div>`}
                <span class="banner-item-name" title="${slide.name}">${slide.name}</span>
                <div class="banner-item-btns">
                    <button class="btn btn-outline btn-small" onclick="moveBanner(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.4"' : ''} style="padding:6px 10px;">↑</button>
                    <button class="btn btn-outline btn-small" onclick="moveBanner(${idx}, 1)" ${idx === bannerSlides.length-1 ? 'disabled style="opacity:0.4"' : ''} style="padding:6px 10px;">↓</button>
                    <button class="btn btn-danger btn-small" onclick="deleteBanner(${idx})" style="padding:6px 10px; font-size:13px;">삭제</button>
                </div>
            `;
            item.addEventListener('dragstart', bannerDragStart);
            item.addEventListener('dragover', bannerDragOver);
            item.addEventListener('drop', bannerDrop);
            list.appendChild(item);
        });
    }

    let dragSrcIdx = null;
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

    // 저장된 배너 슬라이드가 있으면 초기 DOM 반영
    (function() {
        const stored = localStorage.getItem('eceBannerSlides');
        if (stored) refreshBannerDOM();
    })();

    // slideBanner는 이미 bannerSlides.length를 동적 참조하므로 override 불필요
    // 인터벌 재시작만 수행 (초기 저장 배너 반영 후)
    clearInterval(bannerInterval);
    bannerInterval = setInterval(slideBanner, 15000);

    // ========================================
    // 🔍 공지 비교 기능
    // ========================================

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
        // body padding-bottom 조정
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
            const thumbHtml = (notice.images && notice.images.length > 0)
                ? `<img src="${notice.images[0]}" style="width:100%; height:110px; object-fit:cover; border-radius:10px; margin-bottom:10px; border:1px solid var(--border); flex-shrink:0;">`
                : '';
            const colId = 'compare-col-' + id;
            const safeContent = (notice.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const contentWithLinks = safeContent.replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g, `<a href="$1" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:600;">$1</a>`);

            col.innerHTML = `
                ${thumbHtml}
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
                </div>
            `;
            grid.appendChild(col);

            // 드래그 스크롤 적용 함수
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
                // 터치 스크롤도 그냥 동작 (기본)
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

clearInterval(bannerInterval);
bannerInterval = setInterval(slideBanner, 15000);
