create table if not exists public.notices (
  id bigint generated always as identity primary key,
  title text not null,
  content text not null,
  target text not null default '전체',
  host text not null default '기타',
  deadline date,
  ai_summary jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  views integer not null default 0,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notices_active_created_idx on public.notices (is_deleted, created_at desc);

create table if not exists public.app_settings (
  id integer primary key,
  admin_name text not null,
  admin_phone text not null,
  admin_kakao text not null,
  banner_admin_name text not null default '학생회 대외협력국 (국장 : 이배너)',
  banner_admin_phone text not null default '010-8888-9999',
  banner_admin_kakao text not null default 'snu_ece_ads',
  banner_password text not null,
  admin_token_hash text not null,
  updated_at timestamptz not null default now()
);

alter table if exists public.app_settings add column if not exists banner_admin_name text not null default '학생회 대외협력국 (국장 : 이배너)';
alter table if exists public.app_settings add column if not exists banner_admin_phone text not null default '010-8888-9999';
alter table if exists public.app_settings add column if not exists banner_admin_kakao text not null default 'snu_ece_ads';

create table if not exists public.banner_slides (
  id bigint generated always as identity primary key,
  name text not null,
  text text not null,
  bg_style text not null,
  text_color text not null,
  src text,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  is_deleted boolean not null default false
);

create index if not exists banner_slides_active_order_idx on public.banner_slides (is_deleted, "order" asc);
create index if not exists banner_slides_expires_idx on public.banner_slides (expires_at);

alter table public.notices
  add column if not exists status text not null default 'published'
    check (status in ('pending_review', 'published', 'rejected')),
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_external_id text,
  add column if not exists source_url text,
  add column if not exists source_published_at timestamptz,
  add column if not exists last_crawled_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists targets jsonb not null default '[]'::jsonb,
  add column if not exists keywords jsonb not null default '[]'::jsonb,
  add column if not exists analysis_status text
    check (analysis_status is null or analysis_status in ('pending', 'succeeded', 'failed')),
  add column if not exists analysis_confidence numeric,
  add column if not exists crawl_metadata jsonb not null default '{}'::jsonb,
  add column if not exists raw_title text,
  add column if not exists raw_content text,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

update public.notices
set published_at = coalesce(published_at, created_at),
    targets = case
      when jsonb_array_length(targets) = 0 then jsonb_build_array(target)
      else targets
    end
where status = 'published';

create unique index if not exists notices_source_external_unique
  on public.notices (source_type, source_external_id)
  where source_external_id is not null;

create index if not exists notices_status_created_idx
  on public.notices (status, created_at desc);

create table if not exists public.crawl_runs (
  id bigint generated always as identity primary key,
  source_type text not null,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  discovered_count integer not null default 0,
  created_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.crawl_items (
  id bigint generated always as identity primary key,
  crawl_run_id bigint not null references public.crawl_runs(id) on delete cascade,
  source_external_id text not null,
  status text not null check (status in ('created', 'duplicate', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (crawl_run_id, source_external_id)
);

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_aliases (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.categories(id) on delete cascade,
  alias text not null,
  normalized_alias text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.notice_categories (
  notice_id bigint not null references public.notices(id) on delete cascade,
  category_id bigint not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (notice_id, category_id)
);

create table if not exists public.category_candidates (
  id bigint generated always as identity primary key,
  normalized_keyword text not null unique,
  display_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'merged', 'rejected', 'deferred')),
  occurrence_count integer not null,
  average_confidence numeric not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  deferred_until timestamptz,
  decided_at timestamptz,
  merged_category_id bigint references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_candidate_notices (
  candidate_id bigint not null references public.category_candidates(id) on delete cascade,
  notice_id bigint not null references public.notices(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_id, notice_id)
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
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_jobs (
  id bigint generated always as identity primary key,
  notice_id bigint not null references public.notices(id) on delete cascade,
  kind text not null default 'new_notice',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (notice_id, kind)
);

create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.notification_jobs(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'retry', 'permanent_failure')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, subscription_id)
);

create table if not exists public.automation_audit_logs (
  id bigint generated always as identity primary key,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crawl_runs_started_idx
  on public.crawl_runs (started_at desc);
create index if not exists category_candidates_status_idx
  on public.category_candidates (status, last_seen_at desc);
create index if not exists notification_jobs_due_idx
  on public.notification_jobs (status, scheduled_at);
create index if not exists notification_deliveries_due_idx
  on public.notification_deliveries (status, next_attempt_at);

alter table public.crawl_runs enable row level security;
alter table public.crawl_items enable row level security;
alter table public.categories enable row level security;
alter table public.category_aliases enable row level security;
alter table public.notice_categories enable row level security;
alter table public.category_candidates enable row level security;
alter table public.category_candidate_notices enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.automation_audit_logs enable row level security;

revoke all on public.crawl_runs from anon, authenticated;
revoke all on public.crawl_items from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.category_aliases from anon, authenticated;
revoke all on public.notice_categories from anon, authenticated;
revoke all on public.category_candidates from anon, authenticated;
revoke all on public.category_candidate_notices from anon, authenticated;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.notification_jobs from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;
revoke all on public.automation_audit_logs from anon, authenticated;

create or replace function public.publish_review_notice(
  target_notice_id bigint,
  edits jsonb default '{}'::jsonb,
  should_notify boolean default true
)
returns setof public.notices
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.notices;
  category_value jsonb;
begin
  update public.notices
  set title = coalesce(nullif(edits->>'title', ''), title),
      content = coalesce(nullif(edits->>'content', ''), content),
      target = coalesce(nullif(edits->>'target', ''), target),
      targets = case when edits ? 'targets' then edits->'targets' else targets end,
      host = coalesce(nullif(edits->>'host', ''), host),
      deadline = case
        when edits ? 'deadline' and edits->>'deadline' is not null
          then (edits->>'deadline')::date
        else deadline
      end,
      ai_summary = case when edits ? 'aiSummary' then edits->'aiSummary' else ai_summary end,
      keywords = case when edits ? 'keywords' then edits->'keywords' else keywords end,
      attachments = case when edits ? 'attachments' then edits->'attachments' else attachments end,
      analysis_confidence = case
        when edits ? 'analysisConfidence' then (edits->>'analysisConfidence')::numeric
        else analysis_confidence
      end,
      status = 'published',
      reviewed_at = now(),
      published_at = now(),
      updated_at = now()
  where id = target_notice_id
    and status = 'pending_review'
    and is_deleted = false
  returning * into updated_row;

  if updated_row is null then
    raise exception 'NOTICE_NOT_PENDING';
  end if;

  if should_notify then
    insert into public.notification_jobs (notice_id, kind, status)
    values (updated_row.id, 'new_notice', 'pending')
    on conflict (notice_id, kind) do nothing;
  end if;

  if edits ? 'categoryIds' then
    delete from public.notice_categories where notice_id = updated_row.id;
    for category_value in select * from jsonb_array_elements(edits->'categoryIds')
    loop
      insert into public.notice_categories (notice_id, category_id)
      select updated_row.id, (category_value #>> '{}')::bigint
      from public.categories
      where id = (category_value #>> '{}')::bigint
        and is_active = true
      on conflict do nothing;
    end loop;
  end if;

  insert into public.automation_audit_logs (
    action, entity_type, entity_id, metadata
  ) values (
    'notice_published',
    'notice',
    updated_row.id::text,
    jsonb_build_object('notify', should_notify)
  );

  return next updated_row;
  return;
end;
$$;

revoke all on function public.publish_review_notice(bigint, jsonb, boolean) from public;
grant execute on function public.publish_review_notice(bigint, jsonb, boolean) to service_role;

create or replace function public.increment_notice_views(target_notice_id bigint)
returns setof public.notices
language plpgsql
security definer
as $$
declare
  updated_row public.notices;
begin
  update public.notices
  set views = views + 1,
      updated_at = now()
  where id = target_notice_id
    and is_deleted = false
  returning * into updated_row;

  if updated_row is null then
    return;
  end if;

  return next updated_row;
  return;
end;
$$;
