# Google 관리자 로그인 설정

`featurejaewon`은 비밀번호/헤더 토큰 로그인을 제거하고 Google OAuth 서버 흐름을 사용합니다.
다음 세 Google Workspace 계정만 전체 관리자 권한(`master`)을 받습니다.

- aeron1120@snu.ac.kr
- legojmon@snu.ac.kr
- minjunchoi@snu.ac.kr

서버는 Google ID 토큰의 서명·발급자·대상 클라이언트·만료 시각을 검증하고,
nonce, 이메일 검증 여부, 학교 도메인(`hd=snu.ac.kr`), 정확한 이메일 허용 목록을 확인합니다.
state와 HttpOnly 쿠키로 로그인 요청을 브라우저에 묶고 PKCE를 사용합니다.

## Google Cloud Console

OAuth 클라이언트 유형은 **웹 애플리케이션**입니다.

| 입력란 | 운영 | 로컬 개발 |
| --- | --- | --- |
| 승인된 JavaScript 원본 | `https://snu-ece-announcement.pages.dev` | `http://localhost:3000` |
| 승인된 리디렉션 URI | `https://snu-ece-announcement.onrender.com/api/auth/google/callback` | `http://localhost:3000/api/auth/google/callback` |

이 구현은 서버 리디렉션 방식이므로 JavaScript 원본은 필수가 아닙니다. 등록하려면 위 값을 사용하세요.
리디렉션 URI는 경로까지 정확히 일치해야 합니다.
로그인 완료 후 돌아가는 화면은 `https://snu-ece-announcement.pages.dev/admin.html`입니다.
이 화면 주소를 Google의 리디렉션 URI 칸에 넣지 마세요.

동의 화면이 외부/테스트 상태라면 위 세 이메일을 테스트 사용자에 추가합니다.
클라이언트 ID와 보안 비밀은 Render 환경 변수에만 넣습니다. 저장소나 프런트 JavaScript에 넣지 않습니다.

## Render 환경 변수

```dotenv
GOOGLE_CLIENT_ID=<발급받은 클라이언트 ID>
GOOGLE_CLIENT_SECRET=<발급받은 클라이언트 보안 비밀>
GOOGLE_REDIRECT_URI=https://snu-ece-announcement.onrender.com/api/auth/google/callback
FRONTEND_ORIGIN=https://snu-ece-announcement.pages.dev
PUBLIC_SITE_URL=https://snu-ece-announcement.pages.dev
NODE_ENV=production
```

로컬에서는 `.env`에 `NODE_ENV=development`, `FRONTEND_ORIGIN=http://localhost:3000`,
`PUBLIC_SITE_URL=http://localhost:3000`, `GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback`을 설정합니다.
`npm ci`, `npm run prepare:public`, `npm start` 실행 후 `/admin-login.html`을 엽니다.

기존 `ADMIN_TOKEN`, `SUPER_ADMIN_TOKEN`, `NOTICE_ADMIN_TOKEN`, `BANNER_ADMIN_PASSWORD`는 더 이상 인증에 사용하지 않습니다.
DB의 과거 해시 열은 기존 스키마와의 호환을 위해 보존하지만 로그인에 사용하지 않습니다.
자동 수집용 `CRAWL_TRIGGER_SECRET`은 그대로 사용합니다.

## 배포 및 확인

1. Render에 환경 변수를 설정하고 Google 로그인이 포함된 브랜치를 API 서버에 배포합니다.
2. 같은 버전의 프런트를 Cloudflare Pages에 배포합니다 (`npm run prepare:public`, 출력 `public`).
3. 세 허용 계정으로 로그인하고, 다른 계정은 거절되는지 확인합니다.
4. 공지 편집·배너 관리·설정 저장·로그아웃을 확인합니다.

세션은 HttpOnly 쿠키이며 최대 8시간 유효하고, 서버 재시작 시 재로그인이 필요합니다.
현재 Pages와 Render는 서로 다른 사이트이므로 브라우저에서 API의 교차 사이트 쿠키를 허용해야 합니다.
교차 사이트 쿠키가 차단되는 환경을 지원하려면 프런트와 API에 같은 사이트의 사용자 지정 도메인을 연결해야 합니다.

구현 기준: [Google OpenID Connect 서버 흐름](https://developers.google.com/identity/openid-connect/openid-connect).
