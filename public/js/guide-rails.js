(() => {
    const left = document.getElementById('guide-left-rail');
    const right = document.getElementById('guide-right-rail');
    if (!left || !right) return;
    left.innerHTML = `<a class="guide-brand" href="./index.html"><img src="./icons/snu-emblem.png" alt="서울대학교"><strong>SNU ECE<br>공지방</strong></a><nav><span>관련 페이지</span><a href="./service-guide.html">서비스 안내</a><a href="./operator.html">운영 주체 안내</a><a href="./guide.html">사용 설명서</a><a href="./faq.html">자주 묻는 질문</a></nav><nav><span>문의</span><a href="./index.html#contact-modal">일반 문의하기</a><a href="./banner-inquiry.html">홍보 신청하기</a></nav>`;
    right.innerHTML = `<a class="guide-join" href="./banner-inquiry.html">JOIN<br>US</a><div class="guide-banner-loading">홍보 배너를 불러오는 중입니다.</div>`;
    fetch('/api/banner-slides').then(response => response.ok ? response.json() : Promise.reject()).then(data => {
        const slide = (data.slides || [])[0];
        if (!slide) throw new Error('empty');
        const href = /^https?:\/\//.test(slide.linkUrl || '') ? slide.linkUrl : './banner-inquiry.html';
        right.innerHTML = `<a class="guide-join" href="./banner-inquiry.html">JOIN<br>US</a><a class="guide-live-banner" href="${href}" ${href.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}><img src="${slide.src}" alt="${slide.altText || slide.text || '교내 홍보 배너'}"><span>${slide.text || '교내 홍보'}</span></a>`;
    }).catch(() => { right.innerHTML = `<a class="guide-join" href="./banner-inquiry.html">JOIN<br>US</a><a class="guide-banner-fallback" href="./banner-inquiry.html">교내 행사·모집<br><strong>홍보 신청</strong></a>`; });
})();
