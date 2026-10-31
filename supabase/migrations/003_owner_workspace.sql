-- =====================================================================
-- Owner workspace: teams, designations, owner agents and messages.
-- Runs automatically after 002_rls.sql.
-- =====================================================================

-- team: the name of the team an admin leads (admins only).
-- lead_id: the admin a worker reports to (workers only).
-- designation: the person's job title, such as "Frontend engineer".
alter table public.project_members
  add column team text,
  add column lead_id uuid references public.profiles(id) on delete set null,
  add column designation text;

-- Owners now get a Builder and a Critic too. New projects create them in the
-- API; this gives them to the owners of projects that already exist.
insert into public.agents (project_id, user_id, kind)
select m.project_id, m.user_id, k.kind
from public.project_members m
cross join (values ('builder'), ('critic')) as k(kind)
where m.role = 'owner'
on conflict (project_id, user_id, kind) do nothing;

-- Messages from the owner to one admin, or to all of them.
create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  sender_id      uuid not null references public.profiles(id),
  recipient_ids  uuid[] not null,
  to_all         boolean not null default false,
  text           text not null,
  created_at     timestamptz not null default now()
);
create index on public.messages (project_id, created_at desc);

alter table public.messages enable row level security;

create policy "read your messages" on public.messages
  for select using (sender_id = auth.uid() or auth.uid() = any (recipient_ids));

alter publication supabase_realtime add table public.messages;
