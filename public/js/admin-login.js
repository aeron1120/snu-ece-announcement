const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginPassword = document.getElementById('admin-login-password');
const adminLoginError = document.getElementById('admin-login-error');

function getAdminWorkspaceUrl() {
    const edit = new URLSearchParams(location.search).get('edit');
    return edit
        ? `/admin/workspace?edit=${encodeURIComponent(edit)}`
        : '/admin/workspace';
}

adminLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const password = adminLoginPassword.value;
    const button = adminLoginForm.querySelector('button[type="submit"]');
    adminLoginError.textContent = '';
    if (!password) {
        adminLoginError.textContent = '비밀번호를 입력해주세요.';
        adminLoginPassword.focus();
        return;
    }

    button.disabled = true;
    try {
        const response = await fetch('/api/admin/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
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
