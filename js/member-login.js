(() => {
    const api = (window.API_BASE_URL || '').replace(/\/$/, '');
    const params = new URLSearchParams(location.search);
    const candidate = params.get('next') || '/';
    const next = /^\/(?:index\.html|banner-inquiry(?:\.html)?)?(?:[?#]|$)/.test(candidate) ? candidate : '/';
    const message = document.getElementById('login-message');
    const google = document.getElementById('google-login');
    const actions = document.getElementById('member-actions');
    const profile = document.getElementById('member-profile');
    const errors = {
        not_allowed: '서울대학교에서 관리하는 @snu.ac.kr Google 계정으로 로그인해주세요.',
        cancelled: '로그인이 취소되었습니다. 다시 시도할 수 있습니다.',
        failed: '로그인을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.'
    };
    google.addEventListener('click', () => {
        location.assign(`${api}/api/auth/google?purpose=member&next=${encodeURIComponent(next)}`);
    });
    async function check() {
        try {
            const response = await fetch(`${api}/api/member/session`, { credentials: 'include', cache: 'no-store' });
            if (response.status === 401) {
                message.textContent = errors[params.get('error')] || '학교 계정으로 로그인하고 공지방에 입장하세요.';
                return;
            }
            if (!response.ok) throw new Error();
            const session = await response.json();
            if (session.status === 'approved' && !params.has('error')) { location.replace(next); return; }
            message.textContent = session.status === 'approved' ? (errors[params.get('error')] || '이미 로그인되어 있습니다. 승인 상태 새로고침을 눌러 공지방에 입장하세요.') : session.status === 'denied'
                ? '이 계정의 이용이 승인되지 않았습니다. 학부 관련 구성원이라면 공지방 관리자에게 소속 확인을 요청해주세요.'
                : '로그인되었습니다. 관리자가 전기정보공학부 소속을 확인하면 공지방을 이용할 수 있습니다.';
            profile.replaceChildren();
            for (const [label, value] of [['이메일', session.email], ['이름', session.profile?.name],
                ['계정에 표시된 신분', session.profile?.status], ['계정에 표시된 소속', session.profile?.department]]) {
                if (!value) continue;
                const dt = document.createElement('dt'); dt.textContent = label;
                const dd = document.createElement('dd'); dd.textContent = value;
                profile.append(dt, dd);
            }
            profile.hidden = false; actions.hidden = false;
            google.textContent = '다른 Google 계정 사용';
        } catch { message.textContent = '서버에 연결하지 못했습니다. 잠시 후 새로고침해주세요.'; }
    }
    document.getElementById('check-approval').addEventListener('click', () => { params.delete('error'); check(); });
    document.getElementById('member-logout').addEventListener('click', async () => {
        try {
            const results = await Promise.all(['/api/member/session', '/api/admin/session'].map(path =>
                fetch(api + path, { method: 'DELETE', credentials: 'include' })));
            if (results.some(result => !result.ok)) throw new Error();
            location.replace('/login.html');
        } catch { message.textContent = '로그아웃하지 못했습니다. 다시 시도해주세요.'; }
    });
    check();
})();
