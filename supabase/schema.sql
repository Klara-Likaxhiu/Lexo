-- BookMindAI Supabase schema
-- Run in Supabase SQL Editor (Dashboard → SQL → New query)

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  email text not null,
  auth_provider text not null default 'local',
  provider_subject text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are readable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id);

-- User library (source of truth for My Library)
create table if not exists public.user_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id text not null,
  title text not null,
  author text,
  genre text,
  cover_url text,
  description text,
  status text not null check (status in ('want', 'reading', 'read', 'not_interested')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  current_page integer not null default 0 check (current_page >= 0),
  total_pages integer check (total_pages is null or total_pages > 0),
  started_at timestamptz,
  finished_at timestamptz,
  last_opened_at timestamptz,
  favorite boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  date_added timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);

create index if not exists idx_user_library_user_id on public.user_library (user_id);
create index if not exists idx_user_library_status on public.user_library (user_id, status);

alter table public.user_library enable row level security;

create policy "Users read own library"
  on public.user_library for select
  using (auth.uid() = user_id);

create policy "Users insert own library"
  on public.user_library for insert
  with check (auth.uid() = user_id);

create policy "Users update own library"
  on public.user_library for update
  using (auth.uid() = user_id);

create policy "Users delete own library"
  on public.user_library for delete
  using (auth.uid() = user_id);

-- Migration for existing projects (safe to re-run)
alter table public.user_library add column if not exists current_page integer not null default 0;
alter table public.user_library add column if not exists total_pages integer;
alter table public.user_library add column if not exists started_at timestamptz;
alter table public.user_library add column if not exists finished_at timestamptz;
alter table public.user_library add column if not exists last_opened_at timestamptz;

alter table public.user_library drop constraint if exists user_library_current_page_check;
alter table public.user_library add constraint user_library_current_page_check check (current_page >= 0);
alter table public.user_library drop constraint if exists user_library_total_pages_check;
alter table public.user_library add constraint user_library_total_pages_check check (total_pages is null or total_pages > 0);
