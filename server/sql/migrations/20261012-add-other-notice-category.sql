-- 기존 Supabase 설치의 기타 카테고리 추가. 기존 공지와 분류 연결은 보존한다.
begin;

alter table public.notices drop constraint if exists notices_category_check;
alter table public.notices add constraint notices_category_check
  check (category is null or category in ('ACADEMIC', 'OPPORTUNITY', 'SURVEY', 'BENEFIT', 'COMMUNITY', 'OTHER'))
  not valid;
alter table public.notices validate constraint notices_category_check;

insert into public.categories (name, slug, is_active)
values ('기타', 'other', true)
on conflict (slug) do update
set name = excluded.name, is_active = true, updated_at = now();

commit;
