-- BookMindAI: hosted cover proxy fields (idempotent)

alter table public.book_covers add column if not exists cover_status text not null default 'missing';
alter table public.book_covers add column if not exists external_source_url text;

comment on column public.book_covers.cover_status is
  'missing | resolving | ready | failed — lifecycle of the hosted Supabase Storage cover';
comment on column public.book_covers.external_source_url is
  'Last external provider URL used before proxy upload (Google Books / Open Library)';

create index if not exists idx_book_covers_status on public.book_covers (cover_status);
