// API 서버 주소.
// - 로컬 개발(localhost): 같은 서버가 프론트를 함께 서빙하므로 빈 문자열(동일 출처)을 쓴다.
// - 그 외(배포): 아래 운영 도메인으로 요청을 보낸다.
// 다른 주소로 붙고 싶으면 이 스크립트보다 먼저 window.API_BASE_URL을 지정하면 된다.
(function () {
    const PRODUCTION_API = 'https://snu-ece-announcement.onrender.com';
    const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

    // 이미 지정돼 있으면 존중한다. (빈 문자열도 유효한 지정으로 본다)
    if (typeof window.API_BASE_URL === 'string') return;

    const isLocalServer =
        location.protocol.startsWith('http') && LOCAL_HOSTS.includes(location.hostname);

    window.API_BASE_URL = isLocalServer ? '' : PRODUCTION_API;
})();
