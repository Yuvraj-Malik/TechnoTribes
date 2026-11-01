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
