-- BookMindAI: manual cover overrides + lookup failure tracking (idempotent)
-- Adds admin-set manual_cover_url and negative-cache timestamp for auto lookups.

alter table public.book_covers alter column cover_url drop not null;

alter table public.book_covers add column if not exists manual_cover_url text;
alter table public.book_covers add column if not exists lookup_failed_at timestamptz;

comment on column public.book_covers.cover_url is
  'Auto-resolved cover URL (Google Books, Open Library, ISBN, or provided).';
comment on column public.book_covers.manual_cover_url is
  'Admin override used when automatic sources cannot find a cover.';
comment on column public.book_covers.lookup_failed_at is
  'When automatic lookup last failed; suppresses repeated external API calls for a TTL.';
