-- Apply with the Supabase SQL editor before deploying member login.
-- Re-run on existing installations before enabling temporary public access.
begin;
create table if not exists public.ece_members (
    email text primary key,
    subject text not null unique,
    profile jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    reviewed_by text,
    reviewed_at timestamptz
);
-- The API enforces SNU-only access unless temporary public access is enabled.
-- Keep external member records after closing access; do not delete or approve them.
alter table public.ece_members drop constraint if exists ece_members_email_check;
alter table public.ece_members add constraint ece_members_email_check
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$');
alter table public.ece_members enable row level security;
revoke all on public.ece_members from anon, authenticated;
grant all on public.ece_members to service_role;
commit;
