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
