// Project overview (every role), the live "who is working on what" board,
// a worker's own submissions, and departments / roles (owner).
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { requireRole, OWNER } from '../api/_lib/permissions.js';
import { listDepartments, listPeople, teamActor, ensureDefaultDepartment } from '../api/_lib/team.js';
import { getScopeVersions, listSections, outdatedSince } from '../api/_lib/context.js';
import { devTasks, workSubmissions } from '../api/_lib/records.js';
import { logEvent, toEvent } from '../api/_lib/activity.js';
import { notify } from '../api/_lib/log.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;
const ACTIVE = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'done', 'needs_context_decision', 'needs_action_approval', 'sent_back', 'failed'];

/** Latest task of every developer (the live board). Plain words for the status. */
const STATUS_WORDS = {
  reading_context: 'Agent is reading the context', checking_conflicts: 'Agent is checking for conflicts',
  needs_conflict_decision: 'Waiting for a decision about a conflict', planning: 'Agent is planning',
  awaiting_plan_approval: 'Waiting to approve the plan', working: 'Agent is making changes',
  done: 'Changes ready to review and submit', needs_context_decision: 'Context changed: deciding how to continue',
  sent_back: 'Sent back by the manager: reworking', failed: 'Agent hit a problem', submitted: 'Submitted for review',
  approved: 'Approved and merged', rejected: 'Rejected', cancelled: 'Cancelled',
};

export async function board(projectId, people) {
  const developers = people.filter((p) => p.isDeveloper);
  const sections = await listSections(projectId);
  return Promise.all(developers.map(async (u) => {
    const t = (await devTasks.list(projectId, { user_id: u.id }, 1))[0] ?? null;
    const active = t && ACTIVE.includes(t.status);
    return {
      userId: u.id, name: u.name, department: u.department,
      task: t && {
        id: t.id, text: t.text, status: t.status, statusWords: STATUS_WORDS[t.status] ?? t.status, active,
        files: [...new Set([...(t.plan?.files ?? []), ...(t.changedFiles ?? [])])],
        peers: (t.peers ?? []).map((p) => ({ name: p.name, files: p.files })),
        outdated: active && t.builtOn ? (await outdatedSince(projectId, t.builtOn, sections)).length > 0 : false,
        updatedAt: t.updatedAt,
      },
    };
  }));
}

// GET /api/team/overview?projectId   (everyone inside the project)
export async function overview(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const [project, departments, people, scopes, pending, commits, events, assignments] = await Promise.all([
    q(db.from('projects').select('id,name,description,project_code,observer_code,created_at').eq('id', projectId).single()),
    listDepartments(projectId),
    listPeople(projectId),
    getScopeVersions(projectId),
    workSubmissions.list(projectId, { status: ['pending', 'merge_conflict'] }),
    q(db.from('main_commits').select('id,author_id,message,files,created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(200)),
    q(db.from('activity_log').select('*').eq('project_id', projectId).order('id', { ascending: false }).limit(12)),
    q(db.from('tasks').select('id,status,assignee_id,department').eq('project_id', projectId)),
  ]);
  if (actor.role !== 'owner' || actor.actingAs) { delete project.project_code; delete project.observer_code; }
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? 'Someone';
  const live = await board(projectId, people);
  const mineDept = (d) => actor.role === 'owner' || d === actor.department;
  return {
    project,
    me: actor,
    departments: departments.map((d) => ({
      ...d, managerName: d.managerId ? nameOf(d.managerId) : null,
      members: people.filter((p) => p.department === d.id).length,
      contextVersion: scopes[d.id] ?? 1,
    })),
    centralVersion: scopes.central ?? 1,
    stats: {
      members: people.filter((p) => p.role !== 'observer').length,
      activeWork: live.filter((b) => b.task?.active).length,
      pendingReviews: pending.filter((s) => mineDept(s.department)).length,
      merges: commits.length,
      openTasks: assignments.filter((a) => a.status !== 'done' && (actor.role === 'owner' || (actor.role === 'admin' ? a.department === actor.department : a.assignee_id === actor.id))).length,
    },
    board: live,
    latestCommit: commits[0] ? { message: commits[0].message, by: nameOf(commits[0].author_id), at: commits[0].created_at } : null,
    recent: events.map(toEvent),
  };
}

// GET /api/team/my/submissions?projectId   (a developer's own submissions, newest first)
export async function mySubmissions(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const sections = await listSections(projectId);
  const subs = await workSubmissions.list(projectId, { user_id: actor.id }, 100);
  return {
    submissions: await Promise.all(subs.map(async ({ base: _b, changes: _c, ...s }) => ({
      ...s, outdated: s.status === 'pending' ? await outdatedSince(projectId, s.builtOn, sections) : [],
    }))),
  };
}

// ---------------------------------------------------------------- departments (owner)
const slugOf = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const COLORS = ['#7c3aed', '#0f766e', '#b45309', '#be185d', '#1d4ed8', '#4d7c0f'];

// POST /api/team/departments/create { projectId, name, color? }
export async function createDepartment({ user, body }) {
  requireFields(body, ['projectId', 'name']);
  await requireRole(user.id, body.projectId, OWNER);
  const name = String(body.name).trim().slice(0, 40);
  const slug = slugOf(name);
  if (!slug || slug === 'central') throw new HttpError(400, 'Choose another department name');
  const existing = await listDepartments(body.projectId);
  if (existing.some((d) => d.id === slug)) throw new HttpError(409, 'A department with this name already exists');
  await q(db.from('departments').insert({
    project_id: body.projectId, slug, name, color: body.color || COLORS[existing.length % COLORS.length], paths: [], position: existing.length,
  }));
  await q(db.from('scope_versions').upsert({ project_id: body.projectId, scope: slug, version: 1 }, { onConflict: 'project_id,scope', ignoreDuplicates: true }));
  await logEvent(body.projectId, { type: 'department.created', actorId: user.id, department: slug, summary: `Department ${name} created` });
  return { department: { id: slug, name } };
}

// POST /api/team/departments/update { projectId, departmentId, name?, color?, managerId? }
export async function updateDepartment({ user, body }) {
  requireFields(body, ['projectId', 'departmentId']);
  await requireRole(user.id, body.projectId, OWNER);
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 40);
  if (body.color !== undefined) patch.color = String(body.color).slice(0, 9);
  if (body.managerId !== undefined) {
    if (body.managerId) {
      const m = (await q(db.from('project_members').select('role,department').eq('project_id', body.projectId).eq('user_id', body.managerId)))[0];
      if (!m || m.role !== 'admin') throw new HttpError(400, 'The manager must be an admin');
      await q(db.from('project_members').update({ department: body.departmentId }).eq('project_id', body.projectId).eq('user_id', body.managerId));
    }
    patch.manager_id = body.managerId || null;
  }
  await q(db.from('departments').update(patch).eq('project_id', body.projectId).eq('slug', body.departmentId));
  return { ok: true };
}

// POST /api/team/departments/delete { projectId, departmentId }   (only when nobody is in it)
export async function deleteDepartment({ user, body }) {
  requireFields(body, ['projectId', 'departmentId']);
  await requireRole(user.id, body.projectId, OWNER);
  const all = await listDepartments(body.projectId);
  if (all.length <= 1) throw new HttpError(400, 'A project needs at least one department');
  const people = await listPeople(body.projectId);
  if (people.some((p) => p.department === body.departmentId)) throw new HttpError(409, 'Move everyone out of this department first');
  await q(db.from('departments').delete().eq('project_id', body.projectId).eq('slug', body.departmentId));
  return { deleted: true };
}

// POST /api/team/members/role { projectId, userId, role: admin|worker, department? }   (owner)
export async function setRole({ user, body }) {
  requireFields(body, ['projectId', 'userId', 'role']);
  await requireRole(user.id, body.projectId, OWNER);
  if (!['admin', 'worker'].includes(body.role)) throw new HttpError(400, 'Role must be admin or worker');
  const target = (await q(db.from('project_members').select('*').eq('project_id', body.projectId).eq('user_id', body.userId)))[0];
  if (!target || target.status !== 'active') throw new HttpError(404, 'Active member not found');
  if (target.role === 'owner' || target.role === 'observer') throw new HttpError(400, 'The owner and the observer keep their roles');
  const departments = await listDepartments(body.projectId);
  const department = body.department || target.department || await ensureDefaultDepartment(body.projectId);
  if (!departments.some((d) => d.id === department)) throw new HttpError(400, 'Unknown department');
  await q(db.from('project_members').update({ role: body.role, department }).eq('project_id', body.projectId).eq('user_id', body.userId));
  // Stepping down as admin frees the department; becoming admin of a department without a manager takes it.
  if (body.role === 'worker') await q(db.from('departments').update({ manager_id: null }).eq('project_id', body.projectId).eq('manager_id', body.userId));
  if (body.role === 'admin') await q(db.from('departments').update({ manager_id: body.userId }).eq('project_id', body.projectId).eq('slug', department).is('manager_id', null));
  const deptName = departments.find((d) => d.id === department)?.name ?? department;
  await notify([{ user_id: body.userId, project_id: body.projectId, kind: 'role_changed', title: `You are now ${body.role === 'admin' ? 'an admin' : 'a worker'} in ${deptName}` }]);
  await logEvent(body.projectId, { type: 'member.role', actorId: user.id, department, summary: `Role changed: ${body.role} in ${deptName}`, data: { userId: body.userId } });
  return { ok: true };
}

// GET /api/team/my/assignments?projectId   (tasks assigned to the acting developer; works in demo mode)
export async function myAssignments(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const rows = await q(db.from('tasks').select('*').eq('project_id', projectId).eq('assignee_id', actor.id).order('created_at', { ascending: false }));
  const people = await listPeople(projectId);
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? null;
  return {
    tasks: rows.map((t) => ({
      id: t.id, title: t.title, description: t.description, status: t.status, department: t.department,
      assignedBy: nameOf(t.assigned_by), observerRequestId: t.observer_request_id, devTaskId: t.dev_task_id, createdAt: t.created_at,
    })),
  };
}
