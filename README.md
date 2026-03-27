# SNU ECE 공지방

Cloudflare Pages에 프론트를 올리고, 별도 백엔드 API + Supabase DB에 공지를 저장해서 모든 사용자가 같은 공지 데이터를 보도록 구성한 버전입니다.

## 핵심 동작
- 공지 목록 조회: `GET /api/notices`
- 공지 추가: `POST /api/notices`
- 공지 수정: `PUT /api/notices/:id`
- 공지 삭제(소프트 삭제): `DELETE /api/notices/:id`
- 조회수 증가: `POST /api/notices/:id/view`
- 관리자 인증 확인: `POST /api/admin/verify`
- AI 요약: `POST /api/summary`

공지 데이터는 기본적으로 Supabase 테이블에 저장됩니다. (환경 변수가 없으면 로컬 파일 모드로 폴백)

## 폴더 구조
- `index.html`: 메인 HTML
- `css/style.css`: 스타일
- `js/config.js`: 프론트 API 서버 주소 설정
- `js/app.js`: 전체 프론트 로직
- `server/server.js`: API 서버
- `server/sql/supabase-schema.sql`: Supabase 스키마/함수 생성 SQL
- `server/data/notices.json`: 로컬 폴백 저장 파일
- `public/`: Cloudflare Pages 배포용 정적 산출물

## 로컬 실행
1. `npm install`
2. `.env` 파일 생성 후 아래 값 설정
3. `npm start`
4. 브라우저에서 `http://localhost:3000` 접속

### `.env` 예시
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key
# Cloudflare Pages 도메인 허용 (예: https://your-site.pages.dev)
FRONTEND_ORIGIN=

# 관리자 인증 토큰 (공지 추가/수정/삭제 시 필요)
ADMIN_TOKEN=your_admin_token

# Supabase (영구 저장)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_NOTICES_TABLE=notices
SUPABASE_SETTINGS_TABLE=app_settings
```

## Cloudflare Pages + 백엔드 배포 방법

### 1) Supabase 준비
1. Supabase 프로젝트 생성
2. SQL Editor에서 `server/sql/supabase-schema.sql` 실행
3. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 확보

### 2) 백엔드 배포
Render/Railway/Fly.io 같은 Node 배포 플랫폼에 `server/server.js`를 실행하도록 배포하세요.

필수 환경 변수:
- `GEMINI_API_KEY`
- `FRONTEND_ORIGIN=https://<your-pages-domain>`
- `ADMIN_TOKEN=<운영자만 아는 문자열>`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_NOTICES_TABLE=notices`
- `SUPABASE_SETTINGS_TABLE=app_settings`

Render 무료 플랜이 슬립되어도 DB는 Supabase에 있으므로 공지 데이터는 유지됩니다.

### 3) 프론트 설정
`js/config.js`에서 API 주소를 설정하세요.

```js
window.API_BASE_URL = 'https://<your-backend-domain>';
```

같은 도메인에서 프론트/백엔드를 함께 서빙하면 빈 문자열(`''`) 유지하면 됩니다.

### 4) `public` 생성
```bash
npm run prepare:public
```

### 5) Cloudflare Pages 배포
- Build command: 없음
- Build output directory: `public`
- 루트에 `public`이 올라가도록 연결

배포 후에는 Cloudflare Pages URL에서 공지 추가/수정/삭제가 백엔드에 저장되고, 다른 사용자도 동일 데이터가 보입니다.

## 운영 체크 포인트
- 공지 생성/수정/삭제는 `x-admin-token` 헤더가 있어야 동작합니다.
- 삭제는 소프트 삭제로 처리되어, 목록에서 사라지지만 DB 원본은 남습니다.
- 브라우저/기기가 달라도 API와 DB가 같으면 같은 공지 목록을 보게 됩니다.
- 관리자 정보/관리자 비밀번호/배너 비밀번호 변경도 중앙 설정(`app_settings`)에 저장되어 다른 기기에도 동일 반영됩니다.