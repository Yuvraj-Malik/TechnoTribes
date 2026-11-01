-- Project ID: a short code the owner shares. Members enter it to open the project.
alter table public.projects add column if not exists project_code text;

-- Give existing projects a code.
update public.projects
set project_code = 'PRJ-' || upper(substr(md5(random()::text || id::text), 1, 8))
where project_code is null;

alter table public.projects alter column project_code set not null;
alter table public.projects add constraint projects_project_code_key unique (project_code);
