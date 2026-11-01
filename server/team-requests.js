// Requests between departments: short, concrete asks, never conversations.
// A request becomes a draft task in the receiving department; its manager
// assigns it to a developer (team/goals/assign) or declines it with a reason.
// When that work is approved, the result is posted back (api/_lib/assignments.js).
import { HttpError } from '../api/_lib/errors.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { namesFor, notify } from '../api/_lib/log.js';
import { logEvent } from '../api/_lib/activity.js';
import { listDepartments, teamActor } from '../api/_lib/team.js';
import { devTasks } from '../api/_lib/records.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;
export const LIMITS = { title: 120, body: 600 };

export function shapeRequest(t, names = {}) {
  const state = t.declined_reason ? 'declined' : t.result ? 'done' : t.assignee_id ? (t.status === 'in_review' ? 'in_review' : 'in_progress') : 'waiting';
  return {
    id: t.id, title: t.title, body: t.description, toDepartment: t.department, fromDepartment: t.from_department,
    requestedById: t.requested_by, requestedBy: names[t.requested_by] ?? null, fromTaskId: t.from_task_id ?? null,
    assigneeId: t.assignee_id ?? null, assignee: names[t.assignee_id] ?? null, status: t.status, state,
    result: t.result ?? null, declinedReason: t.declined_reason ?? null, createdAt: t.created_at,
  };
}

/** Creates one request (used by the endpoint and by sharing a task summary). */
export async function createRequest(projectId, actor, { toDepartment, title, body, fromTaskId }) {
  if (!actor.department) throw new HttpError(403, 'Requests come from a department');
  const departments = await listDepartments(projectId);
  const to = departments.find((d) => d.id === toDepartment);
  if (!to) throw new HttpError(400, 'Unknown department');
  if (to.id === actor.department) throw new HttpError(400, 'That is your own department: do it as a task');
  const t = String(title ?? '').trim();
  const b = String(body ?? '').trim();
  if (t.length < 3 || !b) throw new HttpError(400, 'Say what you need and why, briefly');
  if (t.length > LIMITS.title || b.length > LIMITS.body) throw new HttpError(400, `Keep it short and concrete (title ${LIMITS.title}, details ${LIMITS.body} characters)`);
  if (fromTaskId) {
    const task = await devTasks.get(fromTaskId);
    if (!task || task.userId !== actor.id) throw new HttpError(403, 'That is not your task');
  }
  const [row] = await q(db.from('tasks').insert({
    project_id: projectId, title: t, description: b, department: to.id, assignee_id: null, assigned_by: actor.id,
    status: 'open', source: 'request', from_department: actor.department, requested_by: actor.id, from_task_id: fromTaskId ?? null,
  }).select('*'));
  const from = departments.find((d) => d.id === actor.department);
  await logEvent(projectId, {
    type: 'request.created', actorId: actor.id, department: to.id, level: 'department', taskId: fromTaskId ?? null,
    title: `Request from ${from?.name}: ${t}`, plain: `${actor.name} (${from?.name}) asked ${to.name}: ${t}. ${b}`,
    summary: `${actor.name} (${from?.name}) sent ${to.name} a request: "${t}"`, links: [{ type: 'task', id: row.id }],
    data: { requestId: row.id, from: actor.department, to: to.id },
  });
  if (to.managerId) {
    await notify([{ user_id: to.managerId, project_id: projectId, kind: 'request', title: `Request from ${from?.name}: ${t}`, body: `${b}\nAssign it to a developer or decline it with a reason.` }]);
  }
  return shapeRequest(row, await namesFor([actor.id]));
}

// POST /api/team/requests/create { projectId, toDepartment, title, body, fromTaskId? }
export async function create(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  return createRequest(projectId, actor, ctx.body);
}

// GET /api/team/requests/list?projectId   → { incoming: to my department, outgoing: from my department }
export async function list(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const rows = await q(db.from('tasks').select('*').eq('project_id', projectId).eq('source', 'request').order('created_at', { ascending: false }));
  const names = await namesFor(rows.flatMap((r) => [r.requested_by, r.assignee_id]));
  const all = rows.map((r) => shapeRequest(r, names));
  if (actor.role === 'owner' && !actor.department) return { incoming: all, outgoing: all };
  return {
    incoming: all.filter((r) => r.toDepartment === actor.department),
    outgoing: all.filter((r) => r.fromDepartment === actor.department),
  };
}

// POST /api/team/requests/decline { projectId, requestId, reason }   (receiving manager)
export async function decline(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const row = (await q(db.from('tasks').select('*').eq('id', ctx.body.requestId).eq('project_id', projectId).eq('source', 'request')))[0];
  if (!row) throw new HttpError(404, 'Request not found');
  if (actor.role !== 'owner' && !(actor.role === 'admin' && actor.department === row.department)) throw new HttpError(403, 'Only the receiving department\'s manager can decline it');
  if (row.assignee_id) throw new HttpError(409, 'It is already being worked on');
  const reason = String(ctx.body.reason ?? '').trim();
  if (!reason) throw new HttpError(400, 'Say why, so they know what to do instead');
  await q(db.from('tasks').update({ declined_reason: reason, status: 'done' }).eq('id', row.id));
  await logEvent(projectId, {
    type: 'request.declined', actorId: actor.id, department: row.from_department, level: 'department',
    title: `Request declined: ${row.title}`, plain: `${actor.name} declined "${row.title}": ${reason}`,
    summary: `${actor.name} declined the request "${row.title}": ${reason}`, links: [{ type: 'task', id: row.id }],
    data: { requestId: row.id, reason },
  });
  await notify([{ user_id: row.requested_by, project_id: projectId, kind: 'request', title: `Declined: ${row.title}`, body: `${actor.name}: ${reason}` }]);
  return shapeRequest({ ...row, declined_reason: reason, status: 'done' });
}
