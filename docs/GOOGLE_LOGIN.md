# Google 구성원·관리자 로그인 설정

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
일반 로그인은 원래 열었던 공지방 주소(`/` 또는 `/?id=...`)로, 관리자 로그인은 `/admin.html`로 돌아갑니다.
소속 확인이 필요한 계정은 `/login.html`에서 승인 상태를 확인합니다.
이 화면 주소를 Google의 리디렉션 URI 칸에 넣지 마세요.

동의 화면이 외부/테스트 상태라면 이용할 계정을 테스트 사용자에 추가해야 합니다.
전체 구성원에게 공개하려면 Google 동의 화면의 게시 상태도 확인하세요.
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

1. Supabase 사용 시 먼저 `server/sql/ece-members.sql`을 실행합니다. 파일 모드는 `server/data/members.json`을 사용합니다. 이 파일은 개인정보를 포함하므로 Git에 올리지 않으며, 운영 시 영속 디스크가 필요합니다.
2. Render에 환경 변수를 설정하고 Google 로그인이 포함된 브랜치를 API 서버에 배포합니다.
3. 같은 버전의 프런트를 Cloudflare Pages에 배포합니다 (`npm run prepare:public`, 출력 `public`).
4. 일반 구성원은 소속 확인 전 공지 API 접근이 거부되는지, `/members.html`에서 승인하면 공지 조회가 가능해지는지 확인합니다.
5. 세 관리자 계정의 편집 권한과 일반 구성원의 편집 불가, 차단 직후 API 접근 거부, 로그아웃을 확인합니다.

세션은 HttpOnly 쿠키이며 최대 8시간 유효하고, 서버 재시작 시 재로그인이 필요합니다.
현재 Pages와 Render는 서로 다른 사이트이므로 브라우저에서 API의 교차 사이트 쿠키를 허용해야 합니다.
교차 사이트 쿠키가 차단되는 환경을 지원하려면 프런트와 API에 같은 사이트의 사용자 지정 도메인을 연결해야 합니다.

구현 기준: [Google OpenID Connect 서버 흐름](https://developers.google.com/identity/openid-connect/openid-connect).

## 소속 확인 정책과 조사 결과 (2026-09-28)

- 모든 공지 API는 승인된 구성원의 세션을 요구합니다. 로그인 전에는 `/login.html`을 표시합니다. 개인정보처리방침 등 안내 문서는 공개합니다.
- OAuth 범위는 `openid email profile`입니다. Google이 서명한 학교 도메인과 검증된 이메일을 확인한 뒤 표시 이름의 `이름 / 신분 / 소속`을 분리해 표시합니다.
- Google 표준 OIDC 응답에는 공식 학과·학적 필드가 없습니다. 표시 이름은 권한 판정에 사용하지 않습니다. [지원되는 Google claims](https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload)
- Google Workspace 이름 변경 허용 여부는 학교 관리자 설정에 달려 있습니다. 서울대가 모든 계정의 표시 이름을 불변의 소속 증명으로 관리한다는 근거는 확인하지 못했습니다. [Google Workspace 프로필 편집 정책](https://knowledge.workspace.google.com/admin/users/allow-directory-users-to-change-their-profile-and-photo)
- [전기정보공학부 공식 조직도](https://ece.snu.ac.kr/about/organization)에 게재된 담당자 17명의 학교 이메일을 서버 목록에 반영했습니다. 일반 이용 권한만 부여하며, 이후 관리자가 차단하면 재로그인해도 차단을 유지합니다. 명단은 인사 이동 시 재검토해야 합니다.
- 일반 학생·대학원생·교수 및 명단에 없는 관련 교직원은 첫 로그인 시 확인 대기로 등록됩니다. 지정된 관리자 3명만 `/members.html`에서 소속을 별도로 확인하고 승인할 수 있습니다. 이 방식은 학교의 명단/SSO 연동이 제공되기 전의 기본 정책입니다.
- [서울대 공식 메일 안내](https://www.snu.ac.kr/campuslife/aid/it)에 따르면 재직 교직원·명예교수·기관계정은 두레이, 학생(재학생·졸업생)·퇴직 교직원은 Google 메일을 이용합니다. 따라서 **학교 Google 계정이 없는 교직원은 현재 로그인할 수 없습니다.** 전체 교직원 지원에는 학교 SSO 또는 검증된 학교 이메일 인증 경로가 추가로 필요합니다. 이메일 주소를 직접 입력하는 것만으로 권한을 주어서는 안 됩니다.
- 권한 회수는 각 API 요청에서 저장소의 승인 상태를 재확인하여 적용합니다. 원래 공지의 제목·본문은 푸시 페이로드에 포함하지 않고 로그인 후 확인하게 합니다. 기존 알림 구독에 비공개 내용이 전달되지 않도록 하기 위함입니다.

개인정보 삭제 요청을 받으면 본인 확인 후 `ece_members`의 해당 이메일 행(파일 모드는 해당 기록)을 삭제합니다. 연결된 기존 구성원 세션은 이후 요청에서 무효 처리됩니다. 운영자 3명의 관리자 권한은 별도 고정 목록에서 관리합니다.
