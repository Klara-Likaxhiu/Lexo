-- Lexo: book_covers cache table (idempotent)
-- Safe to run multiple times in Supabase SQL Editor or via CLI.
-- Caches resolved cover URLs keyed by ISBN when available, else normalized title|author.

-- ── Create table ──────────────────────────────────────────────────────────────

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

-- ── Upgrade legacy schema (cache_key / cover_source) ────────────────────────

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'book_covers'
      and column_name = 'cache_key'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'book_covers'
      and column_name = 'book_id'
  ) then
    alter table public.book_covers rename column cache_key to book_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'book_covers'
      and column_name = 'cover_source'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'book_covers'
      and column_name = 'source'
  ) then
    alter table public.book_covers rename column cover_source to source;
  end if;
end $$;

-- Ensure required columns exist on older partial installs
alter table public.book_covers add column if not exists book_id text;
alter table public.book_covers add column if not exists isbn text;
alter table public.book_covers add column if not exists title text;
alter table public.book_covers add column if not exists author text;
alter table public.book_covers add column if not exists cover_url text;
alter table public.book_covers add column if not exists source text not null default 'Unknown';
alter table public.book_covers add column if not exists created_at timestamptz not null default now();
alter table public.book_covers add column if not exists updated_at timestamptz not null default now();

-- Drop legacy optional columns no longer used
alter table public.book_covers drop column if exists google_id;
alter table public.book_covers drop column if exists open_library_key;

-- Promote book_id to primary key when upgrading from legacy uuid id table
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'book_covers'
      and column_name = 'id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'book_covers'
      and column_name = 'book_id'
  ) then
    alter table public.book_covers drop constraint if exists book_covers_pkey;
    alter table public.book_covers alter column book_id set not null;
    alter table public.book_covers add primary key (book_id);
    alter table public.book_covers drop column if exists id;
  end if;
end $$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

create unique index if not exists idx_book_covers_book_id on public.book_covers (book_id);
create index if not exists idx_book_covers_isbn on public.book_covers (isbn);
create index if not exists idx_book_covers_title_author on public.book_covers (title, author);

-- ── Row level security ────────────────────────────────────────────────────────

alter table public.book_covers enable row level security;

drop policy if exists "Book covers readable by everyone" on public.book_covers;
create policy "Book covers readable by everyone"
  on public.book_covers for select
  using (true);
