-- =====================================================================
-- 009: safety net.
-- Embedding cache for search by meaning (Voyage embeddings, compared in the
-- API; one row per searchable text, refreshed when the text changes).
-- =====================================================================
create table if not exists public.search_embeddings (
  project_id  uuid not null references public.projects(id) on delete cascade,
  ref         text not null,             -- e.g. v:<item>:<version>, s:<suggestion>, l:<log id>
  text_hash   text not null,
  embedding   jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (project_id, ref)
);
alter table public.search_embeddings enable row level security;
