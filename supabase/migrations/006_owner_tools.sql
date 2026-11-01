-- =====================================================================
-- 006: the owner's tools: job titles, and messages to admins.
-- =====================================================================

-- designation: the person's job title, such as "Frontend engineer".
alter table public.project_members add column if not exists designation text;

-- Messages from the owner to one admin, or to all of them.
create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  sender_id      uuid not null references public.profiles(id),
  recipient_ids  uuid[] not null,
  to_all         boolean not null default false,
  text           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists messages_project_idx on public.messages (project_id, created_at desc);

alter table public.messages enable row level security;

create policy "read your messages" on public.messages
  for select using (sender_id = auth.uid() or auth.uid() = any (recipient_ids));
