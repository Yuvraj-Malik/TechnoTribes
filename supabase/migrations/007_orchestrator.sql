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
