-- =====================================================================
-- ONE-PASTE SETUP: everything in supabase/migrations, in order.
-- Use this if you are not using the Supabase CLI: Supabase dashboard ->
-- SQL Editor -> New query -> paste this whole file -> Run. Run it ONCE on
-- a fresh project. Generated from 001_init.sql + 002_rls.sql.
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

-- Project ID: a short code the owner shares. Members enter it to open the project.
alter table public.projects add column if not exists project_code text;

-- Give existing projects a code.
update public.projects
set project_code = 'PRJ-' || upper(substr(md5(random()::text || id::text), 1, 8))
where project_code is null;

alter table public.projects alter column project_code set not null;
alter table public.projects add constraint projects_project_code_key unique (project_code);

-- ===== 004: team workspace (departments, versioned context, per-developer copies, activity log) =====
-- =====================================================================
-- Teams + versioned context (Developer Workspace / Manager Review).
-- Project -> Departments -> Developers. Managers = admin role, developers =
-- worker role, each member belongs to one department.
-- =====================================================================

-- Demo people (created by POST /api/demo/setup) can be "acted as" by the owner.
alter table public.profiles add column if not exists is_demo boolean not null default false;

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  slug        text not null,                -- also the context scope name
  name        text not null,
  manager_id  uuid references public.profiles(id),
  color       text not null default '#1b7f4a',
  paths       text[] not null default '{}', -- where this department's agents work
  position    integer not null default 0,
  unique (project_id, slug)
);

alter table public.project_members add column if not exists department text;     -- departments.slug
alter table public.project_members add column if not exists context_seen_at timestamptz;

-- Context sections. scope = 'central' or a department slug.
create table public.context_sections (
  project_id  uuid not null references public.projects(id) on delete cascade,
  id          text not null,                -- stable key, e.g. 'c-payment-method'
  scope       text not null,
  title       text not null,
  content     text not null,
  version     integer not null default 1,
  owner_id    uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  why         text not null default '',
  tags        jsonb not null default '[]'::jsonb,
  guardrails  jsonb not null default '[]'::jsonb,
  position    integer not null default 0,
  primary key (project_id, id)
);

create table public.context_section_versions (
  project_id  uuid not null references public.projects(id) on delete cascade,
  section_id  text not null,
  scope       text not null,
  title       text not null,
  version     integer not null,
  content     text not null,
  why         text not null default '',
  changed_by  uuid references public.profiles(id),
  changed_at  timestamptz not null default now(),
  primary key (project_id, section_id, version)
);

create table public.scope_versions (
  project_id  uuid not null references public.projects(id) on delete cascade,
  scope       text not null,
  version     integer not null default 1,
  primary key (project_id, scope)
);

-- Project files. workspace = 'main' or a developer's user id.
-- 'base:<user id>' holds the main snapshot a developer's copy started from (for 3-way merges).
create table public.project_files (
  project_id  uuid not null references public.projects(id) on delete cascade,
  workspace   text not null,
  path        text not null,
  content     text not null,
  updated_at  timestamptz not null default now(),
  primary key (project_id, workspace, path)
);

-- Main project history (like git commits): one row per approved merge.
create table public.main_commits (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid references public.profiles(id),
  message     text not null,
  files       text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- Workflow records keep key fields as columns and the full record in `data`.
create table public.dev_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  department  text not null,
  status      text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.work_submissions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  task_id     uuid references public.dev_tasks(id) on delete set null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  department  text not null,
  status      text not null check (status in ('pending','approved','rejected','sent_back','merge_conflict')),
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.context_proposals (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  submission_id  uuid not null references public.work_submissions(id) on delete cascade,
  department     text not null,
  status         text not null check (status in ('pending','applied','discarded')),
  data           jsonb not null,
  created_at     timestamptz not null default now()
);

-- Structured event log: every task, plan, warning, choice, review, context change.
create table public.activity_log (
  id             bigint generated always as identity primary key,
  project_id     uuid not null references public.projects(id) on delete cascade,
  at             timestamptz not null default now(),
  type           text not null,
  actor_id       uuid references public.profiles(id),
  department     text,
  task_id        uuid,
  submission_id  uuid,
  summary        text not null,
  data           jsonb not null default '{}'::jsonb
);

create index on public.dev_tasks (project_id, user_id, created_at desc);
create index on public.work_submissions (project_id, department, created_at desc);
create index on public.context_proposals (submission_id);
create index on public.activity_log (project_id, id desc);
create index on public.context_section_versions (project_id, changed_at desc);

-- ---------------------------------------------------------------------
-- RLS: writes go through /api (service key). Members may read.
-- ---------------------------------------------------------------------
alter table public.departments              enable row level security;
alter table public.context_sections         enable row level security;
alter table public.context_section_versions enable row level security;
alter table public.scope_versions           enable row level security;
alter table public.project_files            enable row level security;
alter table public.main_commits             enable row level security;
alter table public.dev_tasks                enable row level security;
alter table public.work_submissions         enable row level security;
alter table public.context_proposals        enable row level security;
alter table public.activity_log             enable row level security;

create policy "insiders read departments" on public.departments
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read context" on public.context_sections
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read context history" on public.context_section_versions
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read scope versions" on public.scope_versions
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "insiders read activity" on public.activity_log
  for select using (public.has_role(project_id, array['owner','admin','worker']));
create policy "own dev tasks" on public.dev_tasks
  for select using (user_id = auth.uid() or public.has_role(project_id, array['owner','admin']));
create policy "read work submissions" on public.work_submissions
  for select using (user_id = auth.uid() or public.has_role(project_id, array['owner','admin']));

alter publication supabase_realtime add table
  public.context_sections, public.dev_tasks, public.work_submissions, public.activity_log;


-- ============================================================
-- 005_unify.sql
-- ============================================================
-- =====================================================================
-- 005: one data model.
-- The team workspace (departments, versioned context, project files,
-- developer copies, submissions, activity log) is the single source of truth.
-- This moves what the first engine stored into it, gives every project a
-- default "General" department, links assigned tasks to workspace tasks, and
-- removes the duplicate tables.
-- =====================================================================

-- 1. Every project has at least one department, and every admin/worker is in one.
insert into public.departments (project_id, slug, name, color, paths, position)
select p.id, 'general', 'General', '#1b7f4a', '{}', 0
from public.projects p
where not exists (select 1 from public.departments d where d.project_id = p.id);

update public.project_members m
set department = coalesce(
  (select d.slug from public.departments d where d.project_id = m.project_id and d.slug = 'general'),
  (select d.slug from public.departments d where d.project_id = m.project_id order by d.position limit 1))
where m.role in ('admin', 'worker') and m.department is null;

-- Departments without a manager get the first admin in them.
update public.departments d
set manager_id = (select m.user_id from public.project_members m
                  where m.project_id = d.project_id and m.department = d.slug and m.role = 'admin' and m.status = 'active'
                  order by m.created_at limit 1)
where d.manager_id is null;

-- 2. The old project brief becomes a Central context section ("Project brief").
insert into public.context_sections (project_id, id, scope, title, content, version, owner_id, updated_by, why, tags, guardrails, position)
select s.project_id, 'c-brief', 'central', 'Project brief',
       (select string_agg(initcap(replace(key, '_', ' ')) || ': ' || value, E'\n' order by key) from jsonb_each_text(s.brief)),
       1, p.owner_id, p.owner_id, 'Moved from the project brief', '["*"]'::jsonb, '[]'::jsonb, 0
from public.project_state s
join public.projects p on p.id = s.project_id
where s.brief <> '{}'::jsonb
  and not exists (select 1 from public.context_sections c where c.project_id = s.project_id and c.scope = 'central');

insert into public.context_section_versions (project_id, section_id, scope, title, version, content, why, changed_by)
select c.project_id, c.id, c.scope, c.title, 1, c.content, c.why, c.owner_id
from public.context_sections c
where c.id = 'c-brief'
  and not exists (select 1 from public.context_section_versions v where v.project_id = c.project_id and v.section_id = c.id);

insert into public.scope_versions (project_id, scope, version)
select distinct c.project_id, c.scope, 1 from public.context_sections c
on conflict (project_id, scope) do nothing;

-- 3. Approved files from the first engine become the main project files.
insert into public.project_files (project_id, workspace, path, content)
select s.project_id, 'main', f.key, f.value
from public.project_state s, jsonb_each_text(s.files) f
where not exists (select 1 from public.project_files x where x.project_id = s.project_id and x.workspace = 'main');

insert into public.main_commits (project_id, author_id, message, files)
select s.project_id, p.owner_id, 'Imported approved files', array(select jsonb_object_keys(s.files))
from public.project_state s
join public.projects p on p.id = s.project_id
where s.files <> '{}'::jsonb
  and not exists (select 1 from public.main_commits c where c.project_id = s.project_id);

-- 4. Assigned tasks (by an admin) link to the workspace task that carries them out.
alter table public.tasks add column if not exists department text;
alter table public.tasks add column if not exists dev_task_id uuid references public.dev_tasks(id) on delete set null;
update public.tasks t set department = m.department
from public.project_members m
where m.project_id = t.project_id and m.user_id = t.assignee_id and t.department is null;

-- 5. Remove the duplicate engine.
drop table if exists public.personal_history cascade;
drop table if exists public.critic_reviews cascade;
drop table if exists public.merge_requests cascade;
drop table if exists public.review_buckets cascade;
drop table if exists public.proposals cascade;
drop table if exists public.intents cascade;
drop table if exists public.agents cascade;
drop table if exists public.dependency_edges cascade;
drop table if exists public.dependency_nodes cascade;
drop table if exists public.moderator_log cascade;
drop table if exists public.project_state cascade;
drop function if exists public.forbid_log_mutation() cascade;

-- 6. Realtime for the tables the new pages listen to.
do $$
begin
  begin alter publication supabase_realtime add table public.activity_log; exception when others then null; end;
  begin alter publication supabase_realtime add table public.dev_tasks; exception when others then null; end;
  begin alter publication supabase_realtime add table public.work_submissions; exception when others then null; end;
end $$;

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
=======
-- 006: coordination layer (same as supabase/migrations/006_coordination.sql)
-- =====================================================================
-- =====================================================================
-- 006: coordination layer.
-- Context items get a kind: plan (goal, must-do, must-not, decision,
-- definition of done) or progress (progress note, checkpoint). Agents never
-- edit context: they create suggestions, which are routed (applied directly,
-- department manager, founder, blocked, sent back). The activity log gets two
-- levels (central / department) and clean fields for a later visual timeline.
-- =====================================================================

-- 1. Context items: kind + extra data (checkpoint links, the reason of a decision, ...).
alter table public.context_sections add column if not exists kind text not null default 'note'
  check (kind in ('goal', 'must_do', 'must_not', 'decision', 'done', 'progress', 'checkpoint', 'note'));
alter table public.context_sections add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.context_section_versions add column if not exists kind text not null default 'note';
alter table public.context_section_versions add column if not exists meta jsonb not null default '{}'::jsonb;
-- A version can be "removed" without deleting anything (removal is a new version).
alter table public.context_sections add column if not exists archived boolean not null default false;
alter table public.context_section_versions add column if not exists archived boolean not null default false;

-- 2. Suggestions: the only way an agent (or a person) changes shared context.
create table if not exists public.context_suggestions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  department    text,                 -- the suggester's department
  scope         text not null,        -- 'central' or a department slug it would change
  status        text not null check (status in (
                  'applied',            -- path 1: small, in line, applied directly
                  'pending_manager',    -- paths 2/3: department manager decides
                  'pending_founder',    -- path 4: founder decides (incl. checkpoints)
                  'approved', 'rejected',
                  'workaround',         -- manager resolved a central conflict inside the department
                  'sent_back',          -- built on changed information: agent re-checks
                  'blocked',            -- outside the suggester's area
                  'withdrawn', 'reverted')),
  label         text,                 -- 'progress' | 'plan_change' | 'conflict' | 'checkpoint' | 'revert' | 'large_change'
  suggested_by  uuid references public.profiles(id),
  task_id       uuid references public.dev_tasks(id) on delete set null,
  data          jsonb not null,       -- the change, rule hits, reviewer flags, versions it was based on, decision, reason
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists context_suggestions_queue on public.context_suggestions (project_id, status, created_at desc);
create index if not exists context_suggestions_task on public.context_suggestions (task_id);

-- 3. Two-level log with fields for the (later) visual project timeline.
alter table public.activity_log add column if not exists level text not null default 'department'
  check (level in ('central', 'department'));
alter table public.activity_log add column if not exists title text;           -- short headline
alter table public.activity_log add column if not exists plain text;           -- plain-language summary for non-technical readers
alter table public.activity_log add column if not exists item_id text;         -- context item it concerns
alter table public.activity_log add column if not exists suggestion_id uuid;   -- suggestion it concerns
alter table public.activity_log add column if not exists checkpoint_id text;   -- central checkpoint it belongs to
alter table public.activity_log add column if not exists links jsonb not null default '[]'::jsonb; -- related entries [{type, id}]
update public.activity_log set level = 'central' where department is null and level = 'department';
create index if not exists activity_log_level on public.activity_log (project_id, level, id desc);

alter table public.context_suggestions enable row level security;
create policy "read suggestions" on public.context_suggestions
  for select using (suggested_by = auth.uid() or public.has_role(project_id, array['owner','admin']));

do $$
begin
  begin alter publication supabase_realtime add table public.context_suggestions; exception when others then null; end;
end $$;

-- =====================================================================
-- 007: orchestrator drafts (same as supabase/migrations/007_orchestrator.sql)
-- =====================================================================
-- =====================================================================
-- 007: orchestrator drafts.
-- The orchestrator agent turns a goal (from the founder or a manager) into
-- draft tasks per department. A draft has no assignee until the department
-- manager assigns it to a developer.
-- =====================================================================
alter table public.tasks alter column assignee_id drop not null;
alter table public.tasks add column if not exists source text not null default 'person'
  check (source in ('person', 'orchestrator', 'request'));
alter table public.tasks add column if not exists goal text;
alter table public.tasks add column if not exists plan_items text[] not null default '{}';
create index if not exists tasks_drafts on public.tasks (project_id, department) where assignee_id is null;

-- =====================================================================
-- 008: requests between departments (same as supabase/migrations/008_requests.sql)
-- =====================================================================
-- =====================================================================
-- 008: requests between departments.
-- When an agent needs something in another department's area, its developer
-- (or manager) sends a short request. It lands as a draft task in that
-- department; its manager assigns it (or declines with a reason); when the
-- work is approved, the result is posted back to the requester.
-- =====================================================================
alter table public.tasks add column if not exists from_department text;
alter table public.tasks add column if not exists requested_by uuid references public.profiles(id);
alter table public.tasks add column if not exists from_task_id uuid references public.dev_tasks(id) on delete set null;
alter table public.tasks add column if not exists result text;
alter table public.tasks add column if not exists declined_reason text;
create index if not exists tasks_requests on public.tasks (project_id, from_department) where source = 'request';

-- =====================================================================
-- 009: safety net (same as supabase/migrations/009_safety.sql)
-- =====================================================================
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

-- =====================================================================
-- 010: the owner's tools (same as supabase/migrations/010_owner_tools.sql): job titles, and messages to admins.
-- ==============================================================