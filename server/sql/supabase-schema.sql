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
