# SNU ECE 공지방

Cloudflare Pages에 프론트를 올리고, 별도 백엔드 API에 공지를 저장해서 모든 사용자가 같은 공지 데이터를 보도록 구성한 버전입니다.

## 핵심 동작
- 공지 목록 조회: `GET /api/notices`
- 공지 추가: `POST /api/notices`
- 공지 수정: `PUT /api/notices/:id`
- 공지 삭제: `DELETE /api/notices/:id`
- 조회수 증가: `POST /api/notices/:id/view`
- AI 요약: `POST /api/summary`

공지 데이터는 `server/data/notices.json`에 저장됩니다.

## 폴더 구조
- `index.html`: 메인 HTML
- `css/style.css`: 스타일
- `js/config.js`: 프론트 API 서버 주소 설정
- `js/app.js`: 전체 프론트 로직
- `server/server.js`: API 서버
- `server/data/notices.json`: 공지 영속 저장 파일
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
```

## Cloudflare Pages + 백엔드 배포 방법

### 1) 백엔드 배포
Render/Railway/Fly.io 같은 Node 배포 플랫폼에 `server/server.js`를 실행하도록 배포하세요.

필수 환경 변수:
- `GEMINI_API_KEY`
- `FRONTEND_ORIGIN=https://<your-pages-domain>`

주의:
- 백엔드 인스턴스 파일 시스템이 휘발성일 수 있습니다. 재시작 후 데이터 유지가 필요하면 볼륨 스토리지 또는 외부 DB(D1, Supabase, PlanetScale 등)를 연결하세요.

### 2) 프론트 설정
`js/config.js`에서 API 주소를 설정하세요.

```js
window.API_BASE_URL = 'https://<your-backend-domain>';
```

같은 도메인에서 프론트/백엔드를 함께 서빙하면 빈 문자열(`''`) 유지하면 됩니다.

### 3) `public` 생성
```bash
npm run prepare:public
```

### 4) Cloudflare Pages 배포
- Build command: 없음
- Build output directory: `public`
- 루트에 `public`이 올라가도록 연결

배포 후에는 Cloudflare Pages URL에서 공지 추가/수정/삭제가 백엔드에 저장되고, 다른 사용자도 동일 데이터가 보입니다.