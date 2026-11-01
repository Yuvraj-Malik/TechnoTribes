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
