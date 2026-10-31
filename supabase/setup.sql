-- =====================================================================
-- ONE-PASTE SETUP: everything in supabase/migrations, in order.
-- Use this if you are not using the Supabase CLI: Supabase dashboard ->
-- SQL Editor -> New query -> paste this whole file -> Run. Run it ONCE on
-- a fresh project. Generated from 001_init.sql + 002_rls.sql + 003_owner_workspace.sql.
-- =====================================================================

-- =====================================================================
-- Technotribes: initial schema
-- Run in the Supabase SQL editor (or `supabase db push`), then run
-- supabase/policies/001_rls.sql.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- Create a profile automatically when someone signs up with Supabase Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  owner_id        uuid not null references public.profiles(id),
  observer_code   text not null unique,
  repo_owner      text,
  repo_name       text,
  default_branch  text default 'main',
  created_at      timestamptz not null default now()
);

create table public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('owner','admin','worker','observer')),
  status      text not null default 'active' check (status in ('pending','active')),
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);
-- Exactly one observer per project.
create unique index one_observer_per_project
  on public.project_members(project_id) where role = 'observer';

create table public.admin_codes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null unique,
  created_by  uuid not null references public.profiles(id),
  used_by     uuid references public.profiles(id),
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create table public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  message     text,
  status      text not null default 'pending' check (status in ('pending','accepted','rejected')),
  decided_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create unique index one_pending_join_request
  on public.join_requests(project_id, user_id) where status = 'pending';

-- Each admin and worker gets one Builder and one Critic.
create table public.agents (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  kind              text not null check (kind in ('builder','critic')),
  status            text not null default 'idle' check (status in ('idle','working','blocked')),
  current_activity  text,
  updated_at        timestamptz not null default now(),
  unique (project_id, user_id, kind)
);

-- ---------------------------------------------------------------------
-- Moderator: the single approved truth
-- ---------------------------------------------------------------------
-- Current approved state of the project. `files` maps path -> content.
create table public.project_state (
  project_id       uuid primary key references public.projects(id) on delete cascade,
  current_version  integer not null default 0,
  brief            jsonb not null default '{}'::jsonb,
  files            jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

-- Permanent record of every approved change. Rows can never be edited or deleted.
create table public.moderator_log (
  id                bigint generated always as identity primary key,
  project_id        uuid not null references public.projects(id),
  version           integer not null,
  kind              text not null check (kind in ('change','brief','import')),
  merge_request_id  uuid,
  submitted_by      uuid references public.profiles(id),
  approved_by       uuid references public.profiles(id),
  summary           text not null,
  reason            text,
  observer_summary  text,
  changes           jsonb not null default '[]'::jsonb,
  targets           text[] not null default '{}',
  created_at        timestamptz not null default now(),
  unique (project_id, version)
);

create or replace function public.forbid_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'moderator_log is append-only: rows cannot be updated or deleted';
end $$;

create trigger moderator_log_no_update before update on public.moderator_log
  for each row execute function public.forbid_log_mutation();
create trigger moderator_log_no_delete before delete on public.moderator_log
  for each row execute function public.forbid_log_mutation();

-- Dependency graph. Keys look like: file:src/pages/Pricing.jsx, req:audience
-- An edge from_key -> to_key means "from_key depends on to_key".
create table public.dependency_nodes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  key         text not null,
  kind        text not null,
  label       text,
  unique (project_id, key)
);

create table public.dependency_edges (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  from_key    text not null,
  to_key      text not null,
  relation    text not null default 'depends_on',
  created_at  timestamptz not null default now(),
  unique (project_id, from_key, to_key, relation)
);

-- ---------------------------------------------------------------------
-- Observer requests and tasks
-- ---------------------------------------------------------------------
create table public.observer_requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  observer_id  uuid not null references public.profiles(id),
  message      text not null,
  status       text not null default 'pending' check (status in ('pending','accepted','rejected','done')),
  admin_id     uuid references public.profiles(id),
  response     text,
  task_id      uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  title                text not null,
  description          text,
  assignee_id          uuid not null references public.profiles(id),
  assigned_by          uuid not null references public.profiles(id),
  targets              text[] not null default '{}',
  status               text not null default 'open' check (status in ('open','in_progress','in_review','done')),
  observer_request_id  uuid references public.observer_requests(id),
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Coordination: who is working on what, right now
-- ---------------------------------------------------------------------
create table public.intents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  agent_id      uuid references public.agents(id),
  task_id       uuid references public.tasks(id),
  goal          text not null,
  targets       text[] not null default '{}',
  base_version  integer not null,
  status        text not null default 'active' check (status in ('active','released')),
  created_at    timestamptz not null default now(),
  released_at   timestamptz
);

-- ---------------------------------------------------------------------
-- Agent output, reviews and merge requests
-- ---------------------------------------------------------------------
create table public.proposals (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  user_id        uuid not null references public.profiles(id),
  agent_id       uuid references public.agents(id),
  task_id        uuid references public.tasks(id),
  intent_id      uuid references public.intents(id),
  instruction    text,
  summary        text not null,
  reason         text,
  notes_for_team text,
  changes        jsonb not null,           -- [{path, action, content}]
  targets        text[] not null default '{}',
  depends_on     text[] not null default '{}',
  base_version   integer not null,
  status         text not null default 'draft'
                 check (status in ('draft','reviewed','submitted','approved','rejected','redirected','stale')),
  stale_reason   text,
  created_at     timestamptz not null default now()
);

create table public.critic_reviews (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  verdict      text not null check (verdict in ('approve','revise','reject')),
  score        integer check (score between 0 and 100),
  summary      text,
  issues       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create table public.review_buckets (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  label            text not null,
  kind             text not null check (kind in ('single','same_target')),
  targets          text[] not null default '{}',
  priority         integer,
  priority_reason  text,
  recommendation   text,
  status           text not null default 'open' check (status in ('open','closed')),
  created_at       timestamptz not null default now()
);

create table public.merge_requests (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  submitted_by     uuid not null references public.profiles(id),
  proposal_ids     uuid[] not null,
  change_list      jsonb not null,          -- [{path, action, summary, reason}]
  targets          text[] not null default '{}',
  depends_on       text[] not null default '{}',
  note             text,
  base_version     integer not null,
  bucket_id        uuid references public.review_buckets(id) on delete set null,
  priority         integer,
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected','redirected','conflict','stale')),
  conflict_reason  text,
  decided_by       uuid references public.profiles(id),
  decision_note    text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Personal history and notifications
-- ---------------------------------------------------------------------
-- Each person's own log. Only its owner can delete entries.
create table public.personal_history (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index on public.project_members (user_id);
create index on public.intents (project_id, status);
create index on public.proposals (project_id, status);
create index on public.proposals (user_id);
create index on public.merge_requests (project_id, status);
create index on public.moderator_log (project_id, version);
create index on public.dependency_edges (project_id, to_key);
create index on public.dependency_edges (project_id, from_key);
create index on public.personal_history (project_id, user_id, created_at desc);
create index on public.notifications (user_id, read, created_at desc);
create index on public.tasks (project_id, status);

-- =====================================================================
-- Row-level security. Runs automatically after 001_init.sql.
--
-- All WRITES go through our /api endpoints, which use the service key and
-- check roles in code. These policies only control what the browser can
-- READ directly with the anon key (mainly for Supabase Realtime).
-- The observer reads everything through /api/observer/feed, so the observer
-- gets no direct table access to code, proposals or the raw log.
-- =====================================================================

create or replace function public.has_role(p_project uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid()
      and status = 'active' and role = any (p_roles)
  );
$$;

alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_members   enable row level security;
alter table public.admin_codes       enable row level security;
alter table public.join_requests     enable row level security;
alter table public.agents            enable row level security;
alter table public.project_state     enable row level security;
alter table public.moderator_log     enable row level security;
alter table public.dependency_nodes  enable row level security;
alter table public.dependency_edges  enable row level security;
alter table public.observer_requests enable row level security;
alter table public.tasks             enable row level security;
alter table public.intents           enable row level security;
alter table public.proposals         enable row level security;
alter table public.critic_reviews    enable row level security;
alter table public.review_buckets    enable row level security;
alter table public.merge_requests    enable row level security;
alter table public.personal_history  enable row level security;
alter table public.notifications     enable row level security;

-- Display names are visible to signed-in users.
create policy "read profiles" on public.profiles
  for select to authenticated using (true);

create policy "members read project" on public.projects
  for select using (public.has_role(id, array['owner','admin','worker','observer']));

create policy "members read membership" on public.project_members
  for select using (public.has_role(project_id, array['owner','admin','worker']) or user_id = auth.uid());

create policy "owner reads admin codes" on public.admin_codes
  for select using (public.has_role(project_id, array['owner']));

create policy "read join requests" on public.join_requests
  for select using (user_id = auth.uid() or public.has_role(project_id, array['owner','admin']));

-- Insiders = owner, admin, worker.
create policy "insiders read agents" on public.agents
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read state" on public.project_state
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read log" on public.moderator_log
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read graph nodes" on public.dependency_nodes
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read graph edges" on public.dependency_edges
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read tasks" on public.tasks
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read intents" on public.intents
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read buckets" on public.review_buckets
  for select using (public.has_role(project_id, array['owner','admin','worker']));

create policy "read observer requests" on public.observer_requests
  for select using (observer_id = auth.uid() or public.has_role(project_id, array['owner','admin']));

-- Workers only see their own drafts. Managers see work once it is submitted.
create policy "read proposals" on public.proposals
  for select using (user_id = auth.uid()
    or (status <> 'draft' and public.has_role(project_id, array['owner','admin'])));

create policy "read critic reviews" on public.critic_reviews
  for select using (user_id = auth.uid() or public.has_role(project_id, array['owner','admin']));

create policy "read merge requests" on public.merge_requests
  for select using (submitted_by = auth.uid() or public.has_role(project_id, array['owner','admin']));

create policy "own history" on public.personal_history
  for select using (user_id = auth.uid());

create policy "own notifications" on public.notifications
  for select using (user_id = auth.uid());

-- Realtime: the frontend subscribes to these tables.
alter publication supabase_realtime add table
  public.notifications, public.intents, public.agents, public.merge_requests,
  public.review_buckets, public.moderator_log, public.observer_requests,
  public.proposals, public.tasks, public.project_state;

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
