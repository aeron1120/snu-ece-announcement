# ECE Notice Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ECE 학부 공지를 자동 수집해 관리자 검수 후 게시하고, 대상별 Web Push를 발송하며, 반복 키워드를 관리자 승인형 카테고리 후보로 전환하는 종단 간 기능을 구축한다.

**Architecture:** Cloudflare Cron Worker는 30분마다 보호된 Render API를 호출하고, Express의 크롤러 서비스가 ECE 게시판을 파싱해 Supabase의 검수 대기 공지로 저장한다. 관리자가 게시를 승인하면 알림 outbox가 생성되어 Web Push 구독자에게 발송되고, 게시 공지의 키워드 집계가 카테고리 후보를 만든다. 로컬 개발에서는 동일 인터페이스의 JSON 저장소를 사용한다.

**Tech Stack:** Node.js 20+, Express 4, Supabase JS 2, Cheerio, web-push, Gemini API, Node test runner, Cloudflare Pages/Workers, PWA Service Worker

## Global Constraints

- ECE 수집 대상은 `학부`, `학부&대학원` 공지로 제한한다.
- 크롤링 공지는 항상 `pending_review`로 저장하며 관리자 승인 전 공개하거나 알림을 보내지 않는다.
- 평시 크롤링은 첫 3페이지, 상세 최대 20건, 요청 간격 1초, 요청 타임아웃 10초로 제한한다.
- 초기 백필은 최근 90일 또는 최대 100건 중 먼저 도달하는 범위로 제한한다.
- Cloudflare Cron은 30분마다 실행하고 UTC 기준임을 운영 문서에 명시한다.
- 카테고리 후보는 최근 60일 서로 다른 게시 공지 5건 이상, 평균 신뢰도 0.75 이상일 때 생성한다.
- 공지-구독 조합당 Web Push는 최대 한 번 발송한다.
- 첨부파일은 원본 URL만 저장하고 재호스팅하지 않는다.
- 운영 환경에서 Supabase, 관리자 토큰, 크롤링 비밀, VAPID 키가 없으면 관련 기능을 비활성화한 채 성공한 것처럼 동작하지 않는다.
- 소스 파일은 루트 `index.html`, `css/`, `js/`에서 수정하고 `public/`은 빌드 스크립트로 생성한다.

---

## File Structure

### Existing files to modify

- `package.json`: 테스트, 빌드, 크롤러 의존성과 스크립트
- `server/server.js`: 새 라우터 연결, 공개 목록 상태 필터, 페이지네이션, 게시 이벤트 연결
- `server/sql/supabase-schema.sql`: 공지 확장 및 자동화 테이블/RLS
- `index.html`: 검수함, 알림 설정, 카테고리 후보 관리 UI
- `css/style.css`: 새 관리자/알림 UI
- `js/app.js`: 페이지네이션, 카테고리 필터, 검수·구독 동작
- `README.md`: 로컬·Cloudflare·Render·Supabase 운영 절차

### New server files

- `server/config/runtime-config.js`: 자동화 환경변수 검증과 상수
- `server/storage/automation-store.js`: Supabase/JSON 공통 저장 인터페이스
- `server/services/ece-parser.js`: 목록·상세 HTML 순수 파서
- `server/services/ece-crawler.js`: 요청 제한, 중복 판정, 실행 기록
- `server/services/notice-analyzer.js`: Gemini 구조화 분석과 검증
- `server/services/category-recommender.js`: 키워드 정규화·집계·후보 생성
- `server/services/push-service.js`: 구독 판정, outbox, Web Push 발송
- `server/routes/automation-routes.js`: 공개·관리자·내부 API
- `server/data/automation.json`: 로컬 실행 시 생성되며 Git에서 제외되는 폴백 데이터

### New frontend/deployment files

- `manifest.webmanifest`: PWA 메타데이터
- `service-worker.js`: Push 표시와 딥링크 처리
- `icons/app-icon.svg`: PWA와 알림 공용 아이콘
- `icons/badge-icon.svg`: 단색 알림 배지
- `_headers`: Cloudflare Pages 보안 헤더
- `scripts/prepare-public.mjs`: Windows/Linux 공통 정적 산출물 생성
- `cloudflare/crawl-worker.js`: Cron에서 Render 내부 API 호출
- `cloudflare/wrangler.jsonc`: 30분 Cron과 Worker 환경 설정

### New tests

- `tests/ece-parser.test.js`
- `tests/ece-crawler.test.js`
- `tests/notice-analyzer.test.js`
- `tests/category-recommender.test.js`
- `tests/push-service.test.js`
- `tests/automation-store.test.js`
- `tests/automation-api.test.js`
- `tests/public-build.test.js`
- `tests/fixtures/ece-academics-list.html`
- `tests/fixtures/ece-academics-detail.html`

---

### Task 1: Cross-platform build and test foundation

**Files:**
- Modify: `package.json`
- Create: `scripts/prepare-public.mjs`
- Create: `tests/public-build.test.js`

**Interfaces:**
- Produces: `npm test`, `npm run prepare:public`
- Produces: `preparePublic({ rootDir: string }): Promise<void>`

- [ ] **Step 1: Write the failing public build test**

```js
// tests/public-build.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preparePublic } from '../scripts/prepare-public.mjs';

test('preparePublic copies canonical frontend files', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'ece-public-'));
  await mkdir(path.join(rootDir, 'css'));
  await mkdir(path.join(rootDir, 'js'));
  await writeFile(path.join(rootDir, 'index.html'), '<main>ok</main>');
  await writeFile(path.join(rootDir, 'css/style.css'), 'body{}');
  await writeFile(path.join(rootDir, 'js/app.js'), 'window.ok=true');
  await writeFile(path.join(rootDir, 'js/config.js'), 'window.API_BASE_URL=""');

  await preparePublic({ rootDir });

  assert.equal(await readFile(path.join(rootDir, 'public/index.html'), 'utf8'), '<main>ok</main>');
  assert.equal(await readFile(path.join(rootDir, 'public/js/app.js'), 'utf8'), 'window.ok=true');
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test tests/public-build.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/prepare-public.mjs`.

- [ ] **Step 3: Implement the portable build**

```js
// scripts/prepare-public.mjs
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function preparePublic({ rootDir }) {
  const output = path.join(rootDir, 'public');
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'css'), { recursive: true });
  await mkdir(path.join(output, 'js'), { recursive: true });
  await cp(path.join(rootDir, 'index.html'), path.join(output, 'index.html'));
  await cp(path.join(rootDir, 'css/style.css'), path.join(output, 'css/style.css'));
  await cp(path.join(rootDir, 'js'), path.join(output, 'js'), { recursive: true });
  for (const optional of ['manifest.webmanifest', 'service-worker.js', '_headers']) {
    await cp(path.join(rootDir, optional), path.join(output, optional)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  await cp(path.join(rootDir, 'icons'), path.join(output, 'icons'), { recursive: true }).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePublic({ rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });
}
```

Update `package.json`:

```json
{
  "scripts": {
    "start": "node server/server.js",
    "test": "node --test --test-concurrency=1",
    "prepare:public": "node scripts/prepare-public.mjs"
  }
}
```

- [ ] **Step 4: Verify tests and Windows build**

Run: `npm test`

Expected: 1 test passes.

Run: `npm run prepare:public`

Expected: exit 0 and canonical frontend hashes equal their `public/` copies.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/prepare-public.mjs tests/public-build.test.js public
git commit -m "build: add portable frontend build and test runner"
```

---

### Task 2: Runtime configuration and database schema

**Files:**
- Create: `server/config/runtime-config.js`
- Modify: `server/sql/supabase-schema.sql`
- Create: `tests/automation-store.test.js`

**Interfaces:**
- Produces: `getAutomationConfig(env): AutomationConfig`
- Produces database entities defined in the design

- [ ] **Step 1: Write configuration validation tests**

```js
// tests/automation-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutomationConfig } from '../server/config/runtime-config.js';

test('automation configuration disables protected jobs when secrets are absent', () => {
  const config = getAutomationConfig({});
  assert.equal(config.crawl.enabled, false);
  assert.equal(config.push.enabled, false);
});

test('automation configuration accepts complete crawl and push settings', () => {
  const config = getAutomationConfig({
    CRAWL_TRIGGER_SECRET: 'a'.repeat(32),
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:ece@example.com'
  });
  assert.equal(config.crawl.enabled, true);
  assert.equal(config.push.enabled, true);
  assert.equal(config.crawl.pages, 3);
  assert.equal(config.crawl.maxDetails, 20);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/automation-store.test.js`

Expected: FAIL because `runtime-config.js` does not exist.

- [ ] **Step 3: Implement immutable configuration**

```js
// server/config/runtime-config.js
export function getAutomationConfig(env = process.env) {
  const crawlSecret = String(env.CRAWL_TRIGGER_SECRET || '');
  const vapid = {
    publicKey: String(env.VAPID_PUBLIC_KEY || ''),
    privateKey: String(env.VAPID_PRIVATE_KEY || ''),
    subject: String(env.VAPID_SUBJECT || '')
  };
  return Object.freeze({
    crawl: Object.freeze({
      enabled: crawlSecret.length >= 32,
      secret: crawlSecret,
      baseUrl: 'https://ece.snu.ac.kr/community/academics',
      pages: 3,
      maxDetails: 20,
      requestDelayMs: 1000,
      timeoutMs: 10000
    }),
    push: Object.freeze({
      enabled: Boolean(vapid.publicKey && vapid.privateKey && vapid.subject),
      ...vapid
    }),
    categories: Object.freeze({
      windowDays: 60,
      minimumNotices: 5,
      minimumConfidence: 0.75
    })
  });
}
```

- [ ] **Step 4: Extend the Supabase schema**

Add checked constraints for notice status and analysis status, the fields from section 7.1 of the design, and these tables:

```sql
create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notice_categories (
  notice_id bigint not null references public.notices(id) on delete cascade,
  category_id bigint not null references public.categories(id) on delete cascade,
  primary key (notice_id, category_id)
);

create table if not exists public.category_candidates (
  id bigint generated always as identity primary key,
  normalized_keyword text not null unique,
  display_name text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','merged','rejected','deferred')),
  occurrence_count integer not null,
  average_confidence numeric not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  deferred_until timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  management_token_hash text not null,
  channel text not null default 'web_push',
  admission_year text,
  all_notices boolean not null default false,
  category_ids jsonb not null default '[]'::jsonb,
  urgent_enabled boolean not null default true,
  deadline_reminder_days integer,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_jobs (
  id bigint generated always as identity primary key,
  notice_id bigint not null references public.notices(id) on delete cascade,
  kind text not null default 'new_notice',
  status text not null default 'pending',
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (notice_id, kind)
);

create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.notification_jobs(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  unique (job_id, subscription_id)
);

create table if not exists public.crawl_runs (
  id bigint generated always as identity primary key,
  source_type text not null,
  status text not null check (status in ('running','succeeded','partial','failed')),
  discovered_count integer not null default 0,
  created_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

Create `category_aliases`, `category_candidate_notices`, `crawl_items`, and the remaining audit fields from design section 7.2 with foreign keys. Add unique constraints for `(source_type, source_external_id)` and `(job_id, subscription_id)`, then enable RLS on every automation table. Revoke direct `anon` and `authenticated` writes; the Express service role performs mutations.

- [ ] **Step 5: Verify schema invariants statically and run tests**

Add assertions that read `supabase-schema.sql` and verify all required table names, unique indexes, `enable row level security`, and status checks are present.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/config/runtime-config.js server/sql/supabase-schema.sql tests/automation-store.test.js
git commit -m "feat: add automation configuration and schema"
```

---

### Task 3: ECE HTML parser

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `server/services/ece-parser.js`
- Create: `tests/ece-parser.test.js`
- Create: `tests/fixtures/ece-academics-list.html`
- Create: `tests/fixtures/ece-academics-detail.html`

**Interfaces:**
- Produces: `parseAcademicsList(html, baseUrl): ExternalNoticeSummary[]`
- Produces: `parseAcademicsDetail(html, sourceUrl): ExternalNoticeDetail`

- [ ] **Step 1: Install the parser dependency**

Run: `npm install cheerio`

Expected: `cheerio` appears in dependencies and lockfile changes.

- [ ] **Step 2: Add representative sanitized fixtures**

The list fixture must include one `학부`, one `학부&대학원`, one `대학원`, a notice row, and a regular row. The detail fixture must include title, date, multiline body, and one PDF attachment using the current ECE URL pattern.

- [ ] **Step 3: Write failing parser tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAcademicsList, parseAcademicsDetail } from '../server/services/ece-parser.js';

test('list parser keeps undergraduate audiences and extracts bbsidx', async () => {
  const html = await readFile('tests/fixtures/ece-academics-list.html', 'utf8');
  const rows = parseAcademicsList(html, 'https://ece.snu.ac.kr/community/academics');
  assert.deepEqual(rows.map(row => row.audience), ['학부', '학부&대학원']);
  assert.ok(rows.every(row => /^\d+$/.test(row.externalId)));
});

test('detail parser preserves source and attachment links', async () => {
  const html = await readFile('tests/fixtures/ece-academics-detail.html', 'utf8');
  const detail = parseAcademicsDetail(html, 'https://ece.snu.ac.kr/community/academics?bbsidx=57854&md=v');
  assert.match(detail.title, /교과목 중복인정/);
  assert.match(detail.content, /학사정보시스템/);
  assert.equal(detail.attachments[0].name.endsWith('.pdf'), true);
});
```

- [ ] **Step 4: Run tests and verify failure**

Run: `node --test tests/ece-parser.test.js`

Expected: FAIL because parser exports are missing.

- [ ] **Step 5: Implement strict pure parsers**

Use the current ECE selectors observed on 2026-07-27: `table.table-rows tbody tr`, `td.title a[href*="bbsidx="]`, `h1.bbstitle`, `.infowrap .writer`, `.bbs_contents`, and `.board-filelist a`. Extract `bbsidx` with `new URL(href, baseUrl).searchParams.get('bbsidx')`. Throw `EceParseError` when a list has no board rows or a detail lacks title/body. Normalize whitespace without removing meaningful line breaks.

```js
import { load } from 'cheerio';

export class EceParseError extends Error {}

export function isUndergraduateAudience(value) {
  return value === '학부' || value === '학부&대학원';
}

function toIsoDate(value) {
  const match = String(value).match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function parseAcademicsList(html, baseUrl) {
  const $ = load(html);
  const boardRows = $('table.table-rows tbody tr');
  if (boardRows.length === 0) throw new EceParseError('ECE board rows not found');
  const rows = [];
  boardRows.each((_index, element) => {
    const cells = $(element).find('td');
    const audience = $(cells[1]).text().trim();
    if (!isUndergraduateAudience(audience)) return;
    const anchor = $(element).find('td.title a[href*="bbsidx="]').first();
    const href = anchor.attr('href');
    if (!href) return;
    const sourceUrl = new URL(href, baseUrl);
    const externalId = sourceUrl.searchParams.get('bbsidx');
    const title = anchor.text().replace(/^\[(?:학부|학부&대학원)\]\s*/, '').trim();
    const publishedDate = toIsoDate($(cells[3]).text());
    if (!externalId || !title || !publishedDate) return;
    rows.push({ externalId, audience, title, sourceUrl: sourceUrl.toString(), publishedDate });
  });
  return rows;
}

export function parseAcademicsDetail(html, sourceUrl) {
  const $ = load(html);
  const title = $('h1.bbstitle').first().text()
    .replace(/^\[(?:학부|학부&대학원)\]\s*/, '').trim();
  const contentRoot = $('.bbs_contents').first().clone();
  contentRoot.find('br').replaceWith('\n');
  contentRoot.find('p, li, tr, div').each((_index, element) => {
    $(element).append('\n');
  });
  const content = contentRoot.text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const publishedDate = toIsoDate($('.infowrap .writer').first().text());
  const resolvedSource = new URL(sourceUrl);
  const externalId = resolvedSource.searchParams.get('bbsidx');
  const attachments = $('.board-filelist a').map((_index, element) => ({
    name: $(element).text().trim(),
    url: new URL($(element).attr('href'), resolvedSource).toString()
  })).get();
  if (!externalId || !title || !content || !publishedDate) {
    throw new EceParseError('ECE detail required fields not found');
  }
  return {
    externalId, title, content, publishedDate,
    attachments, sourceUrl: resolvedSource.toString()
  };
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

```bash
git add package.json package-lock.json server/services/ece-parser.js tests/ece-parser.test.js tests/fixtures
git commit -m "feat: parse ECE undergraduate notices"
```

---

### Task 4: Automation store and crawler orchestration

**Files:**
- Create: `server/storage/automation-store.js`
- Create: `server/services/ece-crawler.js`
- Create: `tests/ece-crawler.test.js`
- Extend: `tests/automation-store.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `createAutomationStore({ supabase, useSupabase, filePath })`
- Produces store methods `beginCrawlRun`, `finishCrawlRun`, `findNoticeBySource`, `createPendingNotice`, `listReviewNotices`, `getReviewNotice`
- Produces: `createEceCrawler({ store, fetchImpl, parser, analyzer, config, wait }): { run(options): Promise<CrawlResult> }`

- [ ] **Step 1: Write store contract tests**

Use a temporary JSON path and verify:

```js
const store = createAutomationStore({ useSupabase: false, filePath });
const created = await store.createPendingNotice({
  sourceType: 'ece_academics',
  sourceExternalId: '57854',
  title: '교과목 중복인정',
  status: 'pending_review'
});
assert.equal(created.status, 'pending_review');
await assert.rejects(() => store.createPendingNotice({ ...created }), /duplicate/i);
```

- [ ] **Step 2: Write crawler behavior tests**

Inject fake `fetchImpl`, `wait`, parser outputs, analyzer, and store. Verify three pages are requested, only unknown details are fetched, detail count stops at 20, one-second waits occur between requests, and rerunning creates zero duplicates.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test tests/automation-store.test.js tests/ece-crawler.test.js`

Expected: FAIL with missing store and crawler modules.

- [ ] **Step 4: Implement the JSON/Supabase store**

The JSON backend uses one document with arrays for automation entities and writes through `<path>.tmp` followed by rename. The Supabase backend maps camelCase service objects to snake_case rows. Both backends throw an error with code `DUPLICATE_SOURCE_NOTICE` on the same source key.

Add `server/data/automation.json` and its temporary file to `.gitignore`.

- [ ] **Step 5: Implement crawler orchestration**

```js
export function createEceCrawler({ store, fetchImpl = fetch, parser, analyzer, config, wait }) {
  return {
    async run({ backfill = false } = {}) {
      const run = await store.beginCrawlRun('ece_academics');
      // Fetch configured list pages, dedupe external IDs, fetch unknown details
      // with timeout and delay, analyze, save pending notices, and finish run.
    }
  };
}
```

Use `AbortSignal.timeout(config.timeoutMs)`. Mark a run `partial` when some details fail and `failed` when the list parser fails. Never create a notice whose required title or body is empty.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

```bash
git add .gitignore server/storage/automation-store.js server/services/ece-crawler.js tests/automation-store.test.js tests/ece-crawler.test.js
git commit -m "feat: store and crawl ECE review notices"
```

---

### Task 5: Structured Gemini notice analysis

**Files:**
- Create: `server/services/notice-analyzer.js`
- Create: `tests/notice-analyzer.test.js`
- Modify: `server/services/ece-crawler.js`

**Interfaces:**
- Produces: `createNoticeAnalyzer({ apiKey, model, fetchImpl, categoryProvider })`
- Produces: `analyzeNotice({ title, content }): Promise<NoticeAnalysis>`
- Produces: `validateNoticeAnalysis(value, activeCategoryIds)`

- [ ] **Step 1: Write validation and retry tests**

Verify valid JSON is normalized, invalid target values are removed, summaries are truncated to three, keywords to ten, confidence is clamped, and one schema-invalid response triggers exactly one retry.

```js
const analysis = validateNoticeAnalysis({
  summary: ['a', 'b', 'c', 'd'],
  deadline: '2026-08-10',
  targets: ['25학번', '임의대상'],
  keywords: ['복수전공'],
  existingCategoryIds: [1, 999],
  confidence: 0.8
}, new Set([1]));
assert.deepEqual(analysis.targets, ['25학번']);
assert.deepEqual(analysis.existingCategoryIds, [1]);
assert.equal(analysis.summary.length, 3);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/notice-analyzer.test.js`

Expected: FAIL with missing analyzer module.

- [ ] **Step 3: Implement server-fixed structured analysis**

The model is fixed from server configuration and is not accepted from the browser. Build a prompt containing active category IDs/names and request JSON only. Parse fenced or plain JSON, validate it, and retry once with a correction prompt. Return `analysisStatus: 'failed'` without blocking draft creation after the second failure.

- [ ] **Step 4: Connect analyzer results to pending notices**

Persist `summary`, `deadline`, `targets`, `keywords`, `existingCategoryIds`, `analysisConfidence`, and `analysisStatus`. Preserve raw source content separately from administrator-editable content.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

```bash
git add server/services/notice-analyzer.js server/services/ece-crawler.js tests/notice-analyzer.test.js
git commit -m "feat: analyze imported notices with structured Gemini output"
```

---

### Task 6: Automation APIs and administrator review workflow

**Files:**
- Create: `server/routes/automation-routes.js`
- Modify: `server/server.js`
- Create: `tests/automation-api.test.js`

**Interfaces:**
- Consumes store, crawler, analyzer, push service
- Produces public, administrator, and internal endpoints from design section 8
- Produces: `createAutomationRouter(dependencies): express.Router`

- [ ] **Step 1: Make the server importable for HTTP tests**

Change startup to:

```js
export { app };
export async function startServer(port = PORT) {
  await ensureDefaultData();
  initializeBannerCleanupCron();
  return app.listen(port);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`Server running on http://localhost:${PORT}`));
}
```

- [ ] **Step 2: Write failing API tests**

Start `app.listen(0)` in the test and use built-in `fetch`. Verify:

- missing/incorrect `x-crawl-secret` returns 401
- incomplete crawl configuration returns 503
- admin review list requires notice admin authentication
- publish changes `pending_review` to `published`
- reject stores a reason and never creates a notification job
- public list omits `pending_review` and `rejected`
- public list supports `page`, `limit`, `category`, and returns pagination metadata

- [ ] **Step 3: Implement router dependency injection**

```js
export function createAutomationRouter({
  store, crawler, analyzer, pushService,
  requireNoticeAdmin, requireSuperAdmin,
  crawlSecret, crawlEnabled
}) {
  const router = Router();
  // Register exact routes from design section 8.
  return router;
}
```

Use `crypto.timingSafeEqual` after equal-length validation for `x-crawl-secret`. Limit public `limit` to 50 and default to 20.

- [ ] **Step 4: Implement atomic publish behavior**

`store.publishReviewNotice(id, edits, { notify })` must:

1. verify current status is `pending_review`
2. apply administrator edits
3. set `published` and `published_at`
4. connect approved categories
5. create one notification job when `notify=true`
6. return the published notice

For Supabase, add and call a SQL RPC transaction. For JSON, perform all mutations before one atomic file write.

- [ ] **Step 5: Run API and full tests**

Run: `npm test`

Expected: unauthorized, status visibility, pagination, publish, and reject tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/routes/automation-routes.js server/storage/automation-store.js server/sql/supabase-schema.sql tests/automation-api.test.js
git commit -m "feat: add imported notice review and publish APIs"
```

---

### Task 7: Administrator review UI

**Files:**
- Modify: `index.html`
- Modify: `css/style.css`
- Modify: `js/app.js`
- Modify generated: `public/`

**Interfaces:**
- Consumes admin review API
- Produces `openReviewManager`, `loadReviewNotices`, `openReviewNotice`, `publishReviewNotice`, `rejectReviewNotice`, `reanalyzeReviewNotice`

- [ ] **Step 1: Add a review manager HTML contract test**

Extend `tests/public-build.test.js` to assert canonical HTML contains:

```js
for (const id of ['review-manager-modal', 'review-notice-list', 'review-editor', 'review-pending-count']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/public-build.test.js`

Expected: FAIL because review manager IDs are absent.

- [ ] **Step 3: Add accessible review UI**

Add a super-admin entry button with pending count, a `role="dialog"` modal, list/detail split view, editable fields, source link, attachment links, analysis status, category checkboxes, and these actions:

- 승인 및 알림
- 승인만
- 재분석
- 거절

All labels use `for`, close buttons have `aria-label`, and status messages use `aria-live="polite"`.

- [ ] **Step 4: Add frontend behavior**

Use `apiRequest` and existing admin token headers. Escape server text before HTML insertion. Disable action buttons while a mutation is in flight. After publish/reject, remove the item from the review list, refresh the pending count, categories, and published notices.

- [ ] **Step 5: Verify build and keyboard flow**

Run: `npm test`

Run: `npm run prepare:public`

Expected: tests pass and source/public copies match.

Manually verify Tab reaches every review action, Escape closes the dialog, and focus returns to the opener.

- [ ] **Step 6: Commit**

```bash
git add index.html css/style.css js/app.js public tests/public-build.test.js
git commit -m "feat: add administrator notice review interface"
```

---

### Task 8: PWA and push subscription management

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `manifest.webmanifest`
- Create: `service-worker.js`
- Create: `icons/app-icon.svg`
- Create: `icons/badge-icon.svg`
- Create: `server/services/push-service.js`
- Modify: `server/routes/automation-routes.js`
- Create: `tests/push-service.test.js`
- Modify: `index.html`, `css/style.css`, `js/app.js`

**Interfaces:**
- Produces: `createPushService({ store, webPushClient, config, now })`
- Produces: `matchesSubscription(notice, subscription): boolean`
- Produces push subscription CRUD routes

- [ ] **Step 1: Install Web Push**

Run: `npm install web-push`

Expected: dependency and lockfile updated.

- [ ] **Step 2: Write target matching tests**

```js
test('matches whole-audience or matching year and category', () => {
  assert.equal(matchesSubscription(
    { targets: ['25학번'], categoryIds: [2] },
    { admissionYear: '25학번', allNotices: false, categoryIds: [2] }
  ), true);
  assert.equal(matchesSubscription(
    { targets: ['26학번'], categoryIds: [2] },
    { admissionYear: '25학번', allNotices: true, categoryIds: [] }
  ), false);
});
```

Also test unique opaque management tokens, invalid endpoint rejection, and subscription deletion.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test tests/push-service.test.js`

Expected: FAIL with missing push service.

- [ ] **Step 4: Implement push service and routes**

Configure VAPID once at startup. Store subscription endpoint, `p256dh`, `auth`, preferences, status, and a SHA-256 hash of an opaque management token. Return the raw token only at creation. Rate-limit creation, require `Content-Type: application/json`, reject an `Origin` that differs from `FRONTEND_ORIGIN`, and require the opaque management token for update/delete. These origin and token checks are the CSRF defense for anonymous subscription mutations.

- [ ] **Step 5: Add manifest and service worker**

`service-worker.js` handles:

```js
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'SNU ECE 공지', {
    body: data.body || '새 공지가 등록되었습니다.',
    icon: '/icons/app-icon.svg',
    badge: '/icons/badge-icon.svg',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

- [ ] **Step 6: Add notification preferences UI**

Add a user-triggered `알림 받기` button, browser support explanation, admission-year select, active category checkboxes, all-notices toggle, urgent toggle, deadline reminder select, save, and unsubscribe. Store only the opaque management token and subscription ID in localStorage.

- [ ] **Step 7: Verify**

Run: `npm test`

Run: `npm run prepare:public`

Expected: all tests pass and PWA files exist in `public/`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json manifest.webmanifest service-worker.js icons server/services/push-service.js server/routes/automation-routes.js tests/push-service.test.js index.html css/style.css js/app.js public
git commit -m "feat: add targeted web push subscriptions"
```

---

### Task 9: Notification outbox and delivery worker

**Files:**
- Modify: `server/services/push-service.js`
- Modify: `server/storage/automation-store.js`
- Modify: `server/server.js`
- Extend: `tests/push-service.test.js`
- Extend: `tests/automation-api.test.js`

**Interfaces:**
- Produces: `processPendingJobs({ batchSize = 50 }): Promise<DeliverySummary>`
- Consumes jobs atomically created by publish

- [ ] **Step 1: Write delivery idempotency tests**

Create one job and two matching subscriptions. Run the worker twice and assert `sendNotification` is called exactly twice total, not four times. Add 410 response test that deactivates the subscription and transient failure test that schedules retries at 1, 5, and 30 minutes.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/push-service.test.js tests/automation-api.test.js`

Expected: FAIL because delivery processing is absent.

- [ ] **Step 3: Implement delivery claims and retries**

Claim pending jobs in batches. Before sending, upsert a delivery record using the unique `(job_id, subscription_id)` constraint. Skip successful/permanent deliveries, send due transient retries, deactivate 404/410 subscriptions, and mark the job complete when no due deliveries remain.

- [ ] **Step 4: Start a short server-side poller**

Start `processPendingJobs` every 30 seconds only when push is configured. Use an in-process lock to prevent overlap and `unref()` the timer for clean test shutdown. Expose `POST /api/admin/notification-jobs/process` for authenticated manual retry.

- [ ] **Step 5: Verify**

Run: `npm test`

Expected: idempotency, permanent invalidation, transient retry, and publish integration pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/push-service.js server/storage/automation-store.js server/server.js tests/push-service.test.js tests/automation-api.test.js
git commit -m "feat: deliver notification jobs idempotently"
```

---

### Task 10: Category recommendation and administration

**Files:**
- Create: `server/services/category-recommender.js`
- Create: `tests/category-recommender.test.js`
- Modify: `server/storage/automation-store.js`
- Modify: `server/routes/automation-routes.js`
- Modify: `index.html`, `css/style.css`, `js/app.js`

**Interfaces:**
- Produces: `normalizeKeyword(value): string`
- Produces: `evaluateCategoryCandidates({ notices, categories, candidates, now, config })`
- Produces category candidate administrator endpoints

- [ ] **Step 1: Write threshold and state tests**

Verify four notices do not create a candidate, five notices in 60 days at confidence 0.75 do, older notices do not count, aliases suppress candidates, rejected candidates never return, and deferred candidates remain hidden for 30 days.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/category-recommender.test.js`

Expected: FAIL with missing recommender module.

- [ ] **Step 3: Implement deterministic candidate evaluation**

```js
export function normalizeKeyword(value) {
  return String(value || '').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
}

export function evaluateCategoryCandidates({ notices, categories, candidates, now, config }) {
  // Group distinct published notice IDs by normalized keyword inside 60 days,
  // calculate average confidence, then return candidates crossing both thresholds.
}
```

Maintain a small server-side Korean stopword set for values such as `안내`, `공지`, `신청`. Do not add embeddings.

- [ ] **Step 4: Add candidate lifecycle APIs**

Implement list, approve-new, merge-existing, reject, and defer. Approval connects only recorded supporting notices. Merge creates aliases. All mutations write an audit record.

- [ ] **Step 5: Add category manager and public filter**

Add candidate cards showing evidence count, date range, confidence, and supporting notices. Add new/merge/reject/defer controls. Load active categories into notice filters and notification preferences. Add multi-category filtering without replacing existing host and target filters.

- [ ] **Step 6: Run tests and build**

Run: `npm test`

Run: `npm run prepare:public`

Expected: threshold tests pass and source/public copies match.

- [ ] **Step 7: Commit**

```bash
git add server/services/category-recommender.js server/storage/automation-store.js server/routes/automation-routes.js tests/category-recommender.test.js index.html css/style.css js/app.js public
git commit -m "feat: recommend and manage notice categories"
```

---

### Task 11: Cloudflare Cron Worker and operational hardening

**Files:**
- Create: `cloudflare/crawl-worker.js`
- Create: `cloudflare/wrangler.jsonc`
- Create: `_headers`
- Modify: `README.md`
- Create: `.env.example`
- Modify: `server/server.js`
- Modify: `server/routes/automation-routes.js`

**Interfaces:**
- Produces Cloudflare `scheduled(controller, env, ctx)` handler
- Documents exact environment variables and deployment sequence

- [ ] **Step 1: Add Worker contract test**

Extend `tests/public-build.test.js` to import the worker with fake environment values and assert its scheduled handler sends one POST with `x-crawl-secret` to `/api/internal/crawl/ece-academics`.

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/public-build.test.js`

Expected: FAIL because Worker module is missing.

- [ ] **Step 3: Implement Worker**

```js
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(fetch(`${env.API_BASE_URL}/api/internal/crawl/ece-academics`, {
      method: 'POST',
      headers: { 'x-crawl-secret': env.CRAWL_TRIGGER_SECRET }
    }).then(response => {
      if (!response.ok) throw new Error(`crawl trigger failed: ${response.status}`);
    }));
  }
};
```

Configure `"crons": ["*/30 * * * *"]`.

- [ ] **Step 4: Add security middleware**

Run: `npm install express-rate-limit`

Expected: dependency and lockfile updated.

Disable `x-powered-by`, add request size limits specific to subscription/admin routes, and configure `express-rate-limit` for authentication, subscription creation, crawl trigger, and Gemini analysis. Add Cloudflare Pages `_headers` with `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame protection, and a CSP that permits only the configured Render API plus the existing font origins.

- [ ] **Step 5: Document deployment**

Document:

- Supabase migration execution
- Render secrets: Supabase, Gemini, admin, crawl, VAPID
- Cloudflare Pages build command `npm run prepare:public`
- Pages output `public`
- Worker `API_BASE_URL` variable and `CRAWL_TRIGGER_SECRET` secret
- UTC Cron behavior
- VAPID key generation
- staging smoke test
- rollback by disabling Cron and Push worker

- [ ] **Step 6: Verify and commit**

Run: `npm test`

Run: `npm run prepare:public`

Run: `node --check server/server.js`

Expected: all commands exit 0.

```bash
git add package.json package-lock.json cloudflare _headers README.md .env.example server/server.js server/routes/automation-routes.js tests/public-build.test.js
git commit -m "ops: add scheduled crawl deployment and hardening"
```

---

### Task 12: End-to-end acceptance and completion evidence

**Files:**
- Create: `tests/automation-e2e.test.js`
- Modify: `README.md`
- Modify only as failures require: files owned by Tasks 1-11

**Interfaces:**
- Verifies the complete flow specified in design section 13

- [ ] **Step 1: Write an isolated end-to-end test**

Use temporary JSON storage, fixture-backed crawler fetch, fake Gemini response, and fake Web Push client:

```js
test('crawl, review, publish, notify, and recommend category end to end', async () => {
  const crawl = await crawler.run();
  assert.equal(crawl.createdCount, 1);
  const pending = await store.listReviewNotices();
  assert.equal(pending[0].status, 'pending_review');

  await store.createPushSubscription(matchingSubscription);
  const published = await store.publishReviewNotice(pending[0].id, approvedEdits, { notify: true });
  assert.equal(published.status, 'published');

  const delivery = await pushService.processPendingJobs();
  assert.equal(delivery.sent, 1);

  await seedFourMoreSupportingNotices(store, published);
  const candidates = await categoryRecommender.run();
  assert.equal(candidates[0].normalizedKeyword, '교과목 중복인정');
});
```

- [ ] **Step 2: Run the test and resolve only observed integration failures**

Run: `node --test tests/automation-e2e.test.js`

Expected: PASS with one crawl, one publish, one notification, and one candidate.

- [ ] **Step 3: Run the complete verification suite**

Run: `npm test`

Expected: all tests pass with zero skipped tests.

Run: `npm run prepare:public`

Expected: exit 0.

Run: `node --check server/server.js`

Expected: exit 0.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Perform staging smoke test**

Against staging Supabase and a test push subscription:

1. trigger one fixture or live crawl
2. confirm pending notice is not public
3. approve it with notification
4. confirm public detail and source link
5. receive and click push deep link
6. rerun crawl and notification processor
7. confirm no duplicate notice or notification

Record counts and timestamps in the deployment checklist without storing endpoint secrets.

- [ ] **Step 5: Update README completion and troubleshooting sections**

Include parser failure symptoms, disabled automation reasons, expired subscription cleanup, manual crawl, manual notification retry, and category candidate evidence interpretation.

- [ ] **Step 6: Commit**

```bash
git add tests/automation-e2e.test.js README.md
git commit -m "test: verify ECE notice automation end to end"
```
