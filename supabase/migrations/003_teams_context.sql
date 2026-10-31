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
