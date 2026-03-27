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

    function renderAdminInfo() {
        document.getElementById('admin-name-display').innerText = adminInfo.name;
        document.getElementById('admin-phone-display').innerText = adminInfo.phone;
        document.getElementById('admin-kakao-display').innerText = adminInfo.kakao;
    }
    renderAdminInfo(); 

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert("전화번호가 복사되었습니다: " + text);
        }).catch(err => {
            alert("복사에 실패했습니다. 브라우저 설정을 확인해주세요.");
        });
    }

    function copyAdminPhone() { copyToClipboard(adminInfo.phone); }

    function openAddNotice() {
        pendingAuthAction = 'add';
        document.getElementById('admin-pwd').value = '';
        openModal('pwd-modal');
    }

    function triggerEditNotice() {
        if(!currentViewId) return;
        pendingAuthAction = 'edit';
        document.getElementById('admin-pwd').value = '';
        openModal('pwd-modal');
    }

    function triggerDeletePost() {
        if(!currentViewId) return;
        pendingAuthAction = 'delete';
        document.getElementById('admin-pwd').value = '';
        openModal('pwd-modal');
    }

    function triggerAdminEdit() {
        pendingAuthAction = 'admin';
        document.getElementById('admin-pwd').value = '';
        openModal('pwd-modal');
    }

    function verifyPassword() {
        const pwd = document.getElementById('admin-pwd').value;
        if (pwd === adminPassword) {
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
                notices = notices.filter(n => String(n.id) !== currentViewId);
                localStorage.setItem('eceNotices', JSON.stringify(notices));
                const saveIdx = savedPosts.findIndex(savedId => String(savedId) === currentViewId);
                if(saveIdx > -1) {
                    savedPosts.splice(saveIdx, 1);
                    localStorage.setItem('eceSaved', JSON.stringify(savedPosts));
                }
                alert("삭제되었습니다.");
                closeModal('detail-modal');
                filterCards(); 

            } else if (pendingAuthAction === 'admin') {
                document.getElementById('admin-display-area').style.display = 'none';
                document.getElementById('admin-edit-area').style.display = 'block';
                document.getElementById('edit-admin-name').value = adminInfo.name;
                document.getElementById('edit-admin-phone').value = adminInfo.phone;
                document.getElementById('edit-admin-kakao').value = adminInfo.kakao;
            }

            pendingAuthAction = null; 
        } else { 
            alert("비밀번호가 일치하지 않습니다."); 
            document.getElementById('admin-pwd').focus();
        }
    }

    function saveAdminInfo() {
        adminInfo.name = document.getElementById('edit-admin-name').value;
        adminInfo.phone = document.getElementById('edit-admin-phone').value;
        adminInfo.kakao = document.getElementById('edit-admin-kakao').value;
        localStorage.setItem('eceAdminInfo', JSON.stringify(adminInfo));
        renderAdminInfo();

        // 비밀번호 변경 처리
        const newAdminPwd = document.getElementById('edit-admin-pwd').value.trim();
        const newBannerPwd = document.getElementById('edit-banner-pwd').value.trim();
        let pwdChanged = [];
        if (newAdminPwd) { adminPassword = newAdminPwd; pwdChanged.push("관리자 비밀번호"); }
        if (newBannerPwd) { bannerPassword = newBannerPwd; pwdChanged.push("배너 모드 비밀번호"); }
        if (pwdChanged.length > 0) {
            try { localStorage.setItem('ecePasswords', JSON.stringify({ admin: adminPassword, banner: bannerPassword })); } catch(e) {}
        }
        document.getElementById('edit-admin-pwd').value = '';
        document.getElementById('edit-banner-pwd').value = '';

        cancelAdminEdit();
        const pwdMsg = pwdChanged.length > 0 ? `\n✅ ${pwdChanged.join(', ')} 변경 완료` : '';
        alert("관리자 설정이 업데이트되었습니다." + pwdMsg);
    }

    function cancelAdminEdit() {
        document.getElementById('admin-edit-area').style.display = 'none';
        document.getElementById('admin-display-area').style.display = 'block';
    }

    let notices = [];
    try {
        const storedNotices = localStorage.getItem('eceNotices');
        notices = storedNotices ? JSON.parse(storedNotices) : defaultNotices;
        if (!Array.isArray(notices)) notices = defaultNotices;
    } catch (e) { notices = defaultNotices; }

    let savedPosts = [];
    try {
        const storedSaved = localStorage.getItem('eceSaved');
        savedPosts = storedSaved ? JSON.parse(storedSaved) : [];
        if (!Array.isArray(savedPosts)) savedPosts = [];
    } catch (e) { savedPosts = []; }

    function linkify(text) {
        if(!text) return "";
        let safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return safeText.replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g, `<a href="$1" target="_blank">$1</a>`);
    }

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

        const newNoticeData = { id: editingNoticeId || Date.now(), title, host, target, deadline, content, aiSummary, images: finalImages, views: noticeIndex !== -1 ? notices[noticeIndex].views : 0 };

        if (editingNoticeId && noticeIndex !== -1) {
            notices[noticeIndex] = newNoticeData; 
        } else {
            notices.unshift(newNoticeData); 
        }
        
        try { localStorage.setItem('eceNotices', JSON.stringify(notices)); } 
        catch (e) { alert("⚠️ 디바이스 저장 공간 초과!"); }

        document.getElementById('ai-loading').style.display = 'none';
        closeModal('add-modal');
        editingNoticeId = null;
        
        if(viewMode === 'saved') toggleViewMode(); 
        else filterCards();
    }