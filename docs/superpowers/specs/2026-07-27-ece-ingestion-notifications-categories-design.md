# ECE 공지 수집·맞춤 알림·카테고리 추천 설계

- 작성일: 2026-07-27
- 상태: 승인된 설계
- 대상 프로젝트: SNU ECE 공지방

## 1. 목표

서울대학교 전기·정보공학부 학사 게시판의 학부 대상 공지를 자동으로 발견하되, 관리자가 내용을 검수하고 승인한 뒤 사이트에 공개하도록 한다. 공지가 공개되면 대상 학번과 관심 카테고리가 일치하는 웹 구독자에게 알림을 보내고, 공지에서 반복적으로 발견되는 키워드는 관리자가 승인할 수 있는 새 카테고리 후보로 제안한다.

다음 전체 흐름이 연결되어 동작해야 기능 완료로 본다.

1. ECE 학부 공지 발견
2. 중복 없이 관리자 검수함에 저장
3. LLM이 요약·마감일·대상·키워드·기존 카테고리를 분석
4. 관리자가 내용을 수정하고 게시 승인
5. 공개 공지 목록에 표시
6. 조건에 맞는 웹 구독자에게 한 번만 알림
7. 누적 키워드가 기준을 만족하면 카테고리 후보 생성
8. 관리자가 후보를 승인하면 필터와 알림 설정에 반영

## 2. 범위

### 포함

- ECE 학사 게시판의 `학부`, `학부&대학원` 공지 수집
- 신규 게시물 정기 확인과 초기 제한적 백필
- 관리자 검수함과 승인·거절 흐름
- Gemini 기반 구조화 분석
- PWA 설치 기반 Web Push 알림
- 학번과 카테고리 기반 익명 기기 구독
- 키워드 누적과 관리자 승인형 카테고리 추천
- 크롤링·알림 작업 로그 및 중복 방지
- Supabase 운영 저장소와 JSON 로컬 개발 폴백

### 제외

- 서울대학교 계정 로그인 또는 재학생 신원 인증
- 네이티브 iOS/Android 앱
- ECE 이외의 외부 공지 사이트
- 첨부파일의 자체 저장 및 재배포
- LLM이 관리자 승인 없이 새 카테고리를 공개하는 기능
- 관리자 승인 없는 크롤링 공지 자동 게시

## 3. 핵심 설계 원칙

### 3.1 사람의 승인 이후에만 공개·알림

외부 HTML 구조 변경이나 LLM 오판으로 잘못된 공지가 전파되지 않도록 크롤링 공지는 항상 `pending_review` 상태로 들어간다. 알림 작업은 공지가 `published`로 전환되는 동일한 게시 처리에서만 생성한다.

### 3.2 원본 출처 보존

각 공지에 ECE 게시물 ID, 원본 URL, 원본 게시일, 마지막 수집 시각을 저장하고 사용자 화면에 출처 링크를 표시한다. 첨부파일은 원본 URL만 제공하며 다운로드 파일을 복제하지 않는다.

### 3.3 중복보다 누락을 복구하기 쉽게

`source_type + source_external_id`를 고유 키로 사용한다. 크롤링과 알림은 재시도 가능하게 만들고, 같은 입력을 여러 번 처리해도 공지나 알림이 중복 생성되지 않는 멱등성을 보장한다.

### 3.4 알림은 명시적 동의 기반

사용자가 알림 설정 화면에서 직접 활성화할 때만 브라우저 권한을 요청한다. 구독 해제와 수신 조건 변경 경로를 항상 제공한다.

### 3.5 기존 배포 구조 유지

- Cloudflare Pages: 정적 프론트엔드, manifest, service worker
- Render Express: 크롤링, 관리자 API, 공지 게시, Web Push 발송
- Supabase: 영구 데이터
- Cloudflare Worker Cron Trigger: 정기적으로 Render의 내부 크롤링 엔드포인트 호출

전체 백엔드를 Cloudflare Workers로 마이그레이션하지 않는다. Cron Worker는 스케줄링과 인증된 호출만 담당하고 크롤링 규칙과 저장 로직은 Express 서버에 둔다.

## 4. 시스템 구성

### 4.1 크롤링 스케줄러

Cloudflare Cron Trigger가 30분마다 실행된다. Cron은 UTC 기준이므로 설정 파일과 운영 문서에 UTC임을 명시한다. 스케줄러는 `x-crawl-secret` 헤더와 함께 Render의 `POST /api/internal/crawl/ece-academics`를 호출한다.

내부 엔드포인트는 다음 조건을 만족해야 한다.

- `CRAWL_TRIGGER_SECRET` 미설정 시 운영 서버 기동 실패
- 헤더 토큰을 timing-safe 비교
- 실행 중인 크롤링이 있으면 새 실행을 중복 시작하지 않음
- 수동 실행 API도 동일한 작업 함수를 호출

### 4.2 ECE 크롤러

크롤러는 목록 페이지에서 `학부`, `학부&대학원` 게시물만 선별한다. 평시 실행은 첫 3페이지를 확인하고, 초기 백필은 별도 관리자 작업으로 최근 90일 또는 최대 100건 중 먼저 도달하는 범위까지만 수집한다.

각 신규 게시물에 대해 상세 페이지에서 다음을 추출한다.

- ECE 게시물 ID
- 분류
- 제목
- 본문 텍스트
- 원본 게시일
- 첨부파일 이름, URL, 크기
- 원본 상세 URL

사이트 요청 간 최소 1초 간격을 두고 식별 가능한 User-Agent를 사용한다. 타임아웃은 10초, 한 실행의 상세 페이지 최대 조회 수는 20건으로 제한한다. 목록 또는 상세 파서의 필수 선택자가 사라지면 잘못된 빈 공지를 저장하지 않고 실행을 실패 처리한다.

### 4.3 공지 분석

신규 공지를 저장한 후 Gemini에 구조화 JSON 출력을 요청한다.

```json
{
  "summary": ["첫 번째 요약", "두 번째 요약", "세 번째 요약"],
  "deadline": "2026-08-10",
  "targets": ["25학번", "26학번"],
  "keywords": ["복수전공", "교과목 중복인정"],
  "existingCategoryIds": [2],
  "confidence": 0.84
}
```

검증 규칙은 다음과 같다.

- 요약은 최대 3개
- 마감일은 ISO 날짜 또는 `null`
- 대상은 서버에 정의된 허용 값만 수용
- 키워드는 최대 10개, 각 40자 이하
- 카테고리 ID는 실제 활성 카테고리만 수용
- 신뢰도는 0과 1 사이

LLM 호출에 실패해도 공지는 검수함에 저장한다. 분석 상태를 `failed`로 표시하고 관리자가 다시 분석하거나 직접 입력할 수 있게 한다.

### 4.4 관리자 검수함

관리자는 `pending_review` 공지 목록에서 다음 값을 검토한다.

- 제목
- 본문
- 학번 대상
- 마감일
- AI 요약
- 키워드
- 기존 카테고리
- 원본 출처와 첨부파일 링크
- 알림 발송 여부

관리자 동작은 다음과 같다.

- `승인 및 알림`: 게시하고 조건에 맞는 구독자에게 발송
- `승인만`: 게시하지만 알림 작업은 만들지 않음
- `거절`: 공개하지 않고 거절 사유 저장
- `재분석`: LLM 분석 재시도

승인 시 원본 크롤링 데이터는 보존하고, 관리자가 수정한 공개 데이터를 별도 필드에 반영한다. 게시 이후 수정은 자동 재알림하지 않으며 관리자가 명시적으로 재알림을 선택해야 한다.

## 5. Web Push 알림

### 5.1 클라이언트

Cloudflare Pages에 다음 정적 파일을 추가한다.

- `manifest.webmanifest`
- `service-worker.js`
- 알림 아이콘

사용자가 `알림 받기`를 누르면 다음 순서로 처리한다.

1. 브라우저 지원 여부 확인
2. service worker 등록
3. 학번과 관심 카테고리 선택
4. 브라우저 알림 권한 요청
5. VAPID 공개 키로 PushSubscription 생성
6. 구독 객체와 수신 조건을 서버에 저장

권한이 거절되거나 지원되지 않으면 오류로 취급하지 않고 사이트 내 신규 공지 배지 사용을 안내한다.

### 5.2 구독 조건

로그인 없는 1차 버전에서는 기기별 익명 구독을 사용한다.

- 학번: 하나 선택
- 전체 공지 수신: on/off
- 관심 카테고리: 복수 선택
- 긴급 공지: on/off
- 마감 임박 알림: 1일 전, 3일 전, 사용 안 함

공지 대상에 `전체`가 포함되거나 사용자의 학번이 포함되고, 전체 공지 수신이 켜져 있거나 관심 카테고리가 하나 이상 일치할 때 신규 공지 알림 대상이 된다.

### 5.3 발송

게시 트랜잭션은 `notification_jobs`에 고유 작업을 기록한다. 백그라운드 발송기는 대상 구독을 조회해 Web Push를 전송한다.

- `(job_id, subscription_id)` 고유 제약으로 중복 발송 방지
- 404/410 응답 구독은 비활성화
- 일시적 실패는 지수 백오프로 최대 3회 재시도
- 발송 성공·실패 사유와 시각 기록
- 알림 payload에는 제목, 짧은 본문, 공지 딥링크만 포함

알림 클릭 시 `/?id=<공지 ID>`를 열거나 이미 열린 탭을 활성화한다.

### 5.4 향후 앱 확장

구독 레코드에 `channel`을 두어 현재는 `web_push`를 사용한다. 향후 앱 푸시는 `fcm` 또는 `apns` 채널을 추가하되 공지 대상 판정과 알림 작업 구조는 재사용한다.

## 6. 카테고리 추천

### 6.1 기존 카테고리

`categories` 테이블이 관리자가 승인한 카테고리의 단일 기준점이 된다. 공지와 카테고리는 `notice_categories` 다대다 관계로 연결한다. 기존 주관 기관과 대상 학번은 카테고리와 분리한다.

### 6.2 키워드 정규화

LLM이 반환한 키워드는 다음 과정을 거친다.

- 앞뒤 공백 제거
- 영문 소문자화
- 중복 공백 정리
- 지나치게 일반적인 불용어 제거
- 기존 카테고리명·별칭과 정확히 일치하면 기존 카테고리에 연결

초기 버전에서는 임베딩 검색을 도입하지 않는다. LLM이 후보의 대표 이름과 기존 카테고리 병합 가능성을 제시하되 최종 판단은 관리자가 한다.

### 6.3 후보 생성 기준

다음 조건을 모두 만족하면 `category_candidates`를 생성하거나 갱신한다.

- 최근 60일 동안 서로 다른 게시 공지 5개 이상에서 등장
- 평균 LLM 신뢰도 0.75 이상
- 활성 카테고리명 또는 별칭과 정확히 일치하지 않음
- 동일 정규화 키워드가 이미 승인·거절·보류 처리 중이지 않음

후보에는 대표 이름, 관련 키워드, 등장 횟수, 관련 공지, 최초·최근 등장일, 평균 신뢰도를 표시한다.

### 6.4 관리자 결정

- `새 카테고리 승인`: 새 카테고리 생성 후 관련 공지에 연결
- `기존 카테고리에 병합`: 후보 키워드를 기존 카테고리 별칭으로 추가
- `거절`: 같은 정규화 키워드는 다시 추천하지 않음
- `보류`: 30일 동안 재노출하지 않음

승인된 카테고리는 공지 필터와 알림 설정에 즉시 표시한다. 과거 관련 공지 연결은 후보에 기록된 공지만 대상으로 하며 별도 전체 재분류는 하지 않는다.

## 7. 데이터 모델

### 7.1 notices 확장

- `status text not null default 'published'`
- `source_type text`
- `source_external_id text`
- `source_url text`
- `source_published_at timestamptz`
- `last_crawled_at timestamptz`
- `published_at timestamptz`
- `targets jsonb not null default '[]'`
- `keywords jsonb not null default '[]'`
- `analysis_status text`
- `analysis_confidence numeric`
- `crawl_metadata jsonb not null default '{}'`
- `reviewed_at timestamptz`
- `review_note text`

기존 수동 공지는 마이그레이션 시 `status='published'`, `source_type='manual'`로 설정한다. 기존 `target` 문자열은 호환을 위해 유지하되 새 코드는 `targets`를 우선 사용한다.

고유 인덱스:

```sql
create unique index notices_source_external_unique
on notices (source_type, source_external_id)
where source_external_id is not null;
```

### 7.2 신규 테이블

- `crawl_runs`: 시작·종료 시각, 상태, 발견·생성·실패 수, 오류
- `crawl_items`: 실행별 외부 게시물 처리 결과
- `categories`: 이름, slug, 활성 여부
- `category_aliases`: 카테고리별 별칭
- `notice_categories`: 공지-카테고리 연결
- `category_candidates`: 후보 상태와 집계
- `category_candidate_notices`: 후보 근거 공지
- `push_subscriptions`: endpoint, 암호화 키, 채널, 조건, 상태
- `notification_jobs`: 공지, 종류, 상태, 예약 시각
- `notification_deliveries`: 작업-구독별 상태와 재시도

Web Push endpoint와 암호화 키는 공개 API 응답에 포함하지 않는다. Supabase 테이블은 RLS를 활성화하고 서비스 역할을 사용하는 백엔드 외 직접 접근을 차단한다.

### 7.3 로컬 폴백

개발 편의를 위해 JSON 폴백은 유지하되 운영 환경에서 Supabase 설정이 없으면 서버 기동을 실패시킨다. 신규 데이터는 기능별 JSON 파일로 분리하고 원자적 임시 파일 교체 방식으로 저장한다.

## 8. API

### 공개·구독 API

- `GET /api/notices`: 게시된 공지 목록, 페이지네이션
- `GET /api/notices/:id`: 게시된 공지 상세
- `GET /api/categories`: 활성 카테고리
- `GET /api/push/vapid-public-key`
- `POST /api/push/subscriptions`
- `PUT /api/push/subscriptions/:id/preferences`
- `DELETE /api/push/subscriptions/:id`

구독 변경 API에는 CSRF 방어를 적용하고 endpoint 자체를 식별자로 URL에 노출하지 않는다. 서버가 발급한 불투명 관리 토큰으로 해당 기기 구독만 변경하게 한다.

### 관리자 API

- `GET /api/admin/review-notices`
- `GET /api/admin/review-notices/:id`
- `POST /api/admin/review-notices/:id/reanalyze`
- `POST /api/admin/review-notices/:id/publish`
- `POST /api/admin/review-notices/:id/reject`
- `GET /api/admin/category-candidates`
- `POST /api/admin/category-candidates/:id/approve`
- `POST /api/admin/category-candidates/:id/merge`
- `POST /api/admin/category-candidates/:id/reject`
- `POST /api/admin/category-candidates/:id/defer`
- `GET /api/admin/crawl-runs`
- `POST /api/admin/crawl/ece-academics`

### 내부 API

- `POST /api/internal/crawl/ece-academics`

모든 관리자·내부 API는 rate limit, 요청 크기 제한, 감사 로그를 적용한다.

## 9. 오류 처리와 관측성

### 크롤링

- 네트워크 오류는 실행 실패로 기록하고 다음 주기에 재시도
- 일부 상세 페이지만 실패하면 나머지를 처리하고 부분 실패 기록
- 필수 파싱 값이 없으면 해당 항목을 저장하지 않음
- 연속 3회 전체 실패 시 관리자 화면에 경고 표시

### LLM

- JSON 스키마 검증 실패 시 한 번 재요청
- 재실패 시 분석 실패 상태로 검수함에 유지
- 입력 길이와 응답 토큰 제한
- 모델명은 서버 설정으로 고정

### 알림

- 공개와 알림 발송 실패를 분리
- 알림 실패가 공지 게시를 롤백하지 않음
- 재시도 가능 오류와 영구 오류 구분
- 만료 구독 자동 비활성화

### 운영 지표

- 마지막 크롤링 성공 시각
- 신규 발견·중복·실패 수
- 검수 대기 공지 수
- 알림 대상·성공·실패·만료 수
- 카테고리 후보 수

## 10. 보안과 개인정보

- VAPID 비공개 키, Supabase service role key, Gemini 키, 크롤링 호출 비밀은 서버 환경 변수로만 관리
- 기본 관리자 비밀번호 폴백 제거
- 관리자 인증 시도 rate limit
- 배너 비밀번호도 해시 저장
- push endpoint와 암호화 키는 비밀 데이터로 취급
- 구독에는 이름, 전화번호, 학번 전체 등 직접 식별정보를 저장하지 않음
- 개인정보 처리방침에 알림 구독 목적, 저장 항목, 삭제 방법 명시
- ECE 사이트의 이용정책과 robots 지침을 배포 전 확인하고, 필요하면 학부 운영자에게 수집 허가 확인

## 11. 테스트 전략

### 단위 테스트

- ECE 목록·상세 HTML fixture 파싱
- 학부/학부&대학원 선별
- 외부 ID 추출과 중복 판정
- LLM 결과 스키마 검증
- 알림 대상 학번·카테고리 판정
- 카테고리 후보 임계값과 승인 상태

### 통합 테스트

- 크롤링 → 검수함 저장
- 관리자 승인 → 공개 공지 및 알림 작업 원자적 생성
- 동일 공지 재크롤링 시 중복 없음
- 동일 알림 작업 재실행 시 중복 발송 없음
- 만료 PushSubscription 비활성화
- 카테고리 승인 후 필터·알림 설정 반영

### 브라우저 테스트

- 알림 지원 여부에 따른 UI
- 권한 승인·거절 흐름
- service worker 알림 클릭 딥링크
- 검수함 수정·승인·거절
- 모바일 필터와 카테고리 선택

### 운영 전 점검

- staging Supabase에서 실제 ECE 신규 공지 한 건 수집
- 테스트 구독 기기로 승인 알림 수신
- 동일 작업 재실행 후 중복 없음 확인
- 크롤러 파서 실패 fixture로 잘못된 공지가 생성되지 않음 확인

## 12. 구현 순서

1. 테스트 기반과 서버 모듈 경계 정리
2. 스키마 마이그레이션과 페이지네이션
3. ECE 파서·크롤링 실행·검수함 API
4. 관리자 검수 UI
5. 구조화 LLM 분석
6. PWA·Web Push 구독
7. 알림 작업·발송·재시도
8. 키워드 집계·카테고리 후보
9. 관리자 카테고리 결정 UI
10. Cloudflare Cron Worker와 운영 설정
11. 종단 간 검증과 배포 문서

각 단계는 앞 단계의 테스트가 통과한 뒤 진행한다. 알림은 크롤러가 아닌 공지 게시 이벤트에 연결하여 수동 공지에도 동일하게 적용한다.

## 13. 완료 조건

- ECE `학부`, `학부&대학원` 신규 공지를 30분 이내 발견
- 외부 게시물 한 건당 검수 공지 최대 한 건
- 관리자 승인 전 공개·알림 없음
- 승인 후 공개 목록과 상세 딥링크 정상 동작
- 학번·카테고리 조건이 일치하는 구독에만 알림
- 공지-구독 조합당 알림 최대 한 번
- 알림 클릭 시 해당 공지 열림
- 최근 60일 5건·평균 신뢰도 0.75 기준으로 후보 생성
- 관리자 승인 전 새 카테고리가 공개되지 않음
- 승인된 카테고리가 필터와 알림 설정에 반영
- 크롤링·LLM·알림 실패가 기록되고 안전하게 재시도됨
- 자동 테스트와 staging 종단 간 시나리오 통과

## 14. 참고 자료

- ECE 학사 게시판: https://ece.snu.ac.kr/community/academics
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- MDN Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- MDN Web Push 모범 사례: https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Best_Practices
