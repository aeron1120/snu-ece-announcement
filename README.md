# SNU ECE 공지방 분리 버전

## 구조
- `index.html` : 화면 구조
- `css/style.css` : 전체 스타일
- `data/notices.js` : 기본 공지/배너 데이터
- `js/app.js` : 전역 상태 + 초기 실행
- `js/ui.js` : 모달, 상세보기, 배너, 비교 UI
- `js/api.js` : AI 요약 API 호출
- `js/notices.js` : 공지 CRUD, 관리자 인증, 저장
- `js/filter.js` : 검색/필터링
- `server/server.js` : Gemini 프록시 서버

## 실행
1. `.env.example`을 복사해서 `.env` 생성
2. `GEMINI_API_KEY` 입력
3. `npm install express dotenv`
4. `node server/server.js`
5. 브라우저에서 `http://localhost:3000`