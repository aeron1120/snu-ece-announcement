window.memberReady = (async () => {
    const next = location.pathname + location.search + location.hash;
    const login = `/login.html?next=${encodeURIComponent(next)}`;
    try {
        const response = await fetch(`${window.API_BASE_URL || ''}/api/member/session`, { credentials: 'include', cache: 'no-store' });
        const session = response.ok ? await response.json() : null;
        if (session?.authenticated && session.status === 'approved') {
            document.documentElement.setAttribute('data-member-ready', 'true');
            return true;
        }
    } catch { /* The login page provides a retry message when the API is unavailable. */ }
    location.replace(login);
    return false;
})();
// A restored browser-history snapshot must recheck access before showing notices.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.getElementById('member-signout')?.addEventListener('click', async () => {
    try {
        const results = await Promise.all(['/api/member/session', '/api/admin/session'].map(path =>
            fetch(`${window.API_BASE_URL || ''}${path}`, { method: 'DELETE', credentials: 'include' })));
        if (results.some(result => !result.ok)) throw new Error();
        document.documentElement.removeAttribute('data-member-ready');
        location.replace('/login.html');
    } catch { alert('로그아웃하지 못했습니다. 다시 시도해주세요.'); }
});
