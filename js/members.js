(() => {
    const api = (window.API_BASE_URL || '').replace(/\/$/, '');
    const status = document.getElementById('members-status');
    const list = document.getElementById('members-list');
    const search = document.getElementById('member-search');
    const labels = { pending: '확인 대기', approved: '승인됨', denied: '이용 불가' };
    let members = [];
    function render() {
        list.replaceChildren();
        const term = search.value.trim().toLowerCase();
        for (const member of members.filter(row => `${row.email} ${row.profile?.rawName || ''}`.toLowerCase().includes(term))) {
            const article = document.createElement('article'); article.className = 'member-card';
            const title = document.createElement('h2'); title.textContent = member.email;
            const profile = document.createElement('p'); profile.textContent = member.profile?.rawName || '표시 이름 없음';
            const state = document.createElement('p'); state.textContent = labels[member.status];
            const review = document.createElement('p');
            review.textContent = member.reviewed_by ? `처리: ${member.reviewed_by} · ${new Date(member.reviewed_at).toLocaleString('ko-KR')}` : '아직 관리자 검토 기록이 없습니다.';
            const actions = document.createElement('div'); actions.className = 'member-actions';
            for (const [value, label] of [['approved', '소속 확인 후 승인'], ['denied', '접근 차단'], ['pending', '대기로 변경']]) {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
                button.disabled = member.status === value;
                button.addEventListener('click', async () => {
                    for (const action of actions.children) action.disabled = true;
                    try {
                        const response = await fetch(`${api}/api/admin/members/${encodeURIComponent(member.email)}`, {
                            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: value })
                        });
                        if (!response.ok) throw new Error();
                        await load();
                    } catch { status.textContent = '변경하지 못했습니다. 로그인 상태를 확인하고 다시 시도해주세요.'; render(); }
                });
                actions.append(button);
            }
            article.append(title, profile, state, review, actions); list.append(article);
        }
    }
    async function load() {
        try {
            const response = await fetch(`${api}/api/admin/members`, { credentials: 'include', cache: 'no-store' });
            if (response.status === 401) { location.replace('/admin-login.html'); return; }
            if (!response.ok) throw new Error();
            members = (await response.json()).members;
            members.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
            status.textContent = `${members.length}명 · 확인 대기 ${members.filter(row => row.status === 'pending').length}명 (최근 1,000명까지 표시)`;
            render();
        } catch { status.textContent = '구성원 목록을 불러오지 못했습니다. 서버의 구성원 저장소 설정을 확인해주세요.'; }
    }
    search.addEventListener('input', render);
    document.getElementById('members-reload').addEventListener('click', load);
    load();
})();
