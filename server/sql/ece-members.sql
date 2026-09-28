-- Apply with the Supabase SQL editor before deploying member login.
create table if not exists public.ece_members (
    email text primary key check (email ~ '^[^@]+@snu[.]ac[.]kr$'),
    subject text not null unique,
    profile jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    reviewed_by text,
    reviewed_at timestamptz
);
alter table public.ece_members enable row level security;
revoke all on public.ece_members from anon, authenticated;
grant all on public.ece_members to service_role;
