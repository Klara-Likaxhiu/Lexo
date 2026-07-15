-- Lexo: performance indexes (idempotent)

create index if not exists idx_user_library_user_updated
  on public.user_library (user_id, updated_at desc);

create index if not exists idx_profiles_auth_provider_subject
  on public.profiles (auth_provider, provider_subject);

create index if not exists idx_community_reviews_updated_at
  on public.community_reviews (updated_at desc);

create index if not exists idx_book_covers_status_updated
  on public.book_covers (cover_status, updated_at desc);
