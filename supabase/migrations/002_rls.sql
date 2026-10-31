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
