const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginError = document.getElementById('admin-login-error');
const adminLoginApiBase = (
    typeof window.API_BASE_URL === 'string' ? window.API_BASE_URL : ''
).trim().replace(/\/$/, '');

function buildAdminLoginUrl(path) {
    return adminLoginApiBase ? `${adminLoginApiBase}${path}` : path;
}

function getAdminWorkspaceUrl() {
    const edit = new URLSearchParams(location.search).get('edit');
    return edit ? `/admin.html?edit=${encodeURIComponent(edit)}` : '/admin.html';
}

const loginErrors = {
    cancelled: 'Google 로그인이 취소되었습니다. 다시 시도해주세요.',
    not_allowed: '관리자로 등록된 서울대학교 Google 계정만 로그인할 수 있습니다.',
    failed: 'Google 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.'
};
const errorCode = new URLSearchParams(location.search).get('error');
adminLoginError.textContent = Object.hasOwn(loginErrors, errorCode) ? loginErrors[errorCode] : '';

adminLoginForm.addEventListener('submit', event => {
    event.preventDefault();
    const url = new URL(buildAdminLoginUrl('/api/auth/google'), location.origin);
    const edit = new URLSearchParams(location.search).get('edit');
    if (edit) url.searchParams.set('edit', edit);
    location.assign(url.href);
});

// Reuse an existing session, except after an explicit failed sign-in attempt.
if (!errorCode) {
    fetch(buildAdminLoginUrl('/api/admin/session'), { credentials: 'include', cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(session => {
            if (session?.authenticated) location.replace(getAdminWorkspaceUrl());
        })
        .catch(() => {});
}
