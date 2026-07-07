-- BookMindAI Supabase schema (idempotent)
-- Safe to re-run in Supabase SQL Editor (Dashboard → SQL → New query).
-- Creates tables, indexes, enables RLS, and recreates policies without duplicate errors.

-- ── profiles ──────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  email text not null,
  auth_provider text not null default 'local',
  provider_subject text,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles (email);
create index if not exists idx_profiles_username on public.profiles (username);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
create policy "Profiles are readable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are insertable by owner" on public.profiles;
create policy "Profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Profiles are deletable by owner" on public.profiles;
create policy "Profiles are deletable by owner"
  on public.profiles for delete
  using (auth.uid() = id);

-- ── user_settings ───────────────────────────────────────────────────────────

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users read own settings" on public.user_settings;
create policy "Users read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own settings" on public.user_settings;
create policy "Users insert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own settings" on public.user_settings;
create policy "Users update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own settings" on public.user_settings;
create policy "Users delete own settings"
  on public.user_settings for delete
  using (auth.uid() = user_id);

-- ── reader_profiles ─────────────────────────────────────────────────────────

create table if not exists public.reader_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  quiz_answers text,
  books_read text,
  reading_level text,
  profile_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reader_profiles enable row level security;

drop policy if exists "Users read own reader profile" on public.reader_profiles;
create policy "Users read own reader profile"
  on public.reader_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own reader profile" on public.reader_profiles;
create policy "Users insert own reader profile"
  on public.reader_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own reader profile" on public.reader_profiles;
create policy "Users update own reader profile"
  on public.reader_profiles for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own reader profile" on public.reader_profiles;
create policy "Users delete own reader profile"
  on public.reader_profiles for delete
  using (auth.uid() = user_id);

-- ── community_reviews ───────────────────────────────────────────────────────

create table if not exists public.community_reviews (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null default 'Reader',
  book_title text not null,
  author text default '',
  genre text default '',
  cover_url text,
  rating integer not null default 0 check (rating >= 0 and rating <= 5),
  review_title text default '',
  review_text text default '',
  recommend text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_reviews_book on public.community_reviews (book_title);
create index if not exists idx_community_reviews_user on public.community_reviews (user_id);

alter table public.community_reviews enable row level security;

drop policy if exists "Anyone can read community reviews" on public.community_reviews;
create policy "Anyone can read community reviews"
  on public.community_reviews for select
  using (true);

drop policy if exists "Users insert own reviews" on public.community_reviews;
create policy "Users insert own reviews"
  on public.community_reviews for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own reviews" on public.community_reviews;
create policy "Users update own reviews"
  on public.community_reviews for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own reviews" on public.community_reviews;
create policy "Users delete own reviews"
  on public.community_reviews for delete
  using (auth.uid() = user_id);

-- ── reading_goals ─────────────────────────────────────────────────────────────

create table if not exists public.reading_goals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  goals jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reading_goals enable row level security;

drop policy if exists "Users read own reading goals" on public.reading_goals;
create policy "Users read own reading goals"
  on public.reading_goals for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own reading goals" on public.reading_goals;
create policy "Users insert own reading goals"
  on public.reading_goals for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own reading goals" on public.reading_goals;
create policy "Users update own reading goals"
  on public.reading_goals for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own reading goals" on public.reading_goals;
create policy "Users delete own reading goals"
  on public.reading_goals for delete
  using (auth.uid() = user_id);

-- ── user_library ────────────────────────────────────────────────────────────

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
  current_page integer not null default 0,
  total_pages integer,
  started_at timestamptz,
  finished_at timestamptz,
  last_opened_at timestamptz,
  favorite boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  date_added timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);

-- Upgrade existing databases created before progress columns existed
alter table public.user_library add column if not exists current_page integer not null default 0;
alter table public.user_library add column if not exists total_pages integer;
alter table public.user_library add column if not exists started_at timestamptz;
alter table public.user_library add column if not exists finished_at timestamptz;
alter table public.user_library add column if not exists last_opened_at timestamptz;

alter table public.user_library drop constraint if exists user_library_current_page_check;
alter table public.user_library
  add constraint user_library_current_page_check check (current_page >= 0);

alter table public.user_library drop constraint if exists user_library_total_pages_check;
alter table public.user_library
  add constraint user_library_total_pages_check check (total_pages is null or total_pages > 0);

create index if not exists idx_user_library_user_id on public.user_library (user_id);
create index if not exists idx_user_library_status on public.user_library (user_id, status);
create index if not exists idx_user_library_book_id on public.user_library (user_id, book_id);

alter table public.user_library enable row level security;

drop policy if exists "Users read own library" on public.user_library;
create policy "Users read own library"
  on public.user_library for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own library" on public.user_library;
create policy "Users insert own library"
  on public.user_library for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own library" on public.user_library;
create policy "Users update own library"
  on public.user_library for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own library" on public.user_library;
create policy "Users delete own library"
  on public.user_library for delete
  using (auth.uid() = user_id);

-- ── book_covers (global cover URL cache) ─────────────────────────────────────
-- book_id: ISBN when available (isbn:978…), else normalized title|author
-- See also: supabase/migrations/20250707_book_covers.sql

create table if not exists public.book_covers (
  book_id text primary key,
  isbn text,
  title text not null,
  author text,
  cover_url text not null,
  source text not null default 'Unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_book_covers_isbn on public.book_covers (isbn);
create index if not exists idx_book_covers_title_author on public.book_covers (title, author);

alter table public.book_covers enable row level security;

drop policy if exists "Book covers readable by everyone" on public.book_covers;
create policy "Book covers readable by everyone"
  on public.book_covers for select
  using (true);
