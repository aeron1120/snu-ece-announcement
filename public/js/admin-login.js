const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginPassword = document.getElementById('admin-login-password');
const adminLoginError = document.getElementById('admin-login-error');

// 배포에서는 이 화면과 API의 출처가 다르다. 상대 경로로 부르면 요청이
// 정적 호스트로 가서 405가 돌아온다. core.js의 buildApiUrl과 같은 규칙이다.
const adminLoginApiBase = (
    typeof window.API_BASE_URL === 'string' ? window.API_BASE_URL : ''
).trim().replace(/\/$/, '');

function buildAdminLoginUrl(path) {
    return adminLoginApiBase ? `${adminLoginApiBase}${path}` : path;
}

function getAdminWorkspaceUrl() {
    const edit = new URLSearchParams(location.search).get('edit');
    return edit
        // 서버가 라우팅하는 깔끔한 경로는 정적 호스트에 파일이 없어 공개 화면으로
        // 떨어진다. 실제 파일 이름은 양쪽 호스트에서 모두 워크스페이스로 간다.
        ? `/admin.html?edit=${encodeURIComponent(edit)}`
        : '/admin.html';
}

function getSelectedAdminRole() {
    return document.querySelector('input[name="admin-role"]:checked')?.value || '';
}

adminLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const password = adminLoginPassword.value;
    const role = getSelectedAdminRole();
    const button = adminLoginForm.querySelector('button[type="submit"]');
    adminLoginError.textContent = '';
    if (!password) {
        adminLoginError.textContent = '비밀번호를 입력해주세요.';
        adminLoginPassword.focus();
        return;
    }

    button.disabled = true;
    try {
        const response = await fetch(buildAdminLoginUrl('/api/admin/session'), {
            method: 'POST',
            // 세션 쿠키를 다른 사이트의 API에서 받아 저장하려면 필요하다.
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, role })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || '로그인에 실패했습니다.');
        adminLoginPassword.value = '';
        location.replace(getAdminWorkspaceUrl());
    } catch (error) {
        adminLoginError.textContent = error.message || '로그인에 실패했습니다.';
        adminLoginPassword.focus();
    } finally {
        button.disabled = false;
    }
});
