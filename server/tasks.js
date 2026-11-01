// Assigned tasks. The owner assigns to anyone; an admin assigns to workers of
// their own department. Workers carry a task out in their agent workspace
// (team/task/start with assignmentId), and its status follows that work.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { requireRole, getMembership, MANAGERS, INSIDERS, isManager } from '../api/_lib/permissions.js';
import { notify, namesFor } from '../api/_lib/log.js';
import { logEvent } from '../api/_lib/activity.js';

const STATUSES = ['open', 'in_progress', 'in_review', 'done'];

function shape(t, names) {
  return {
    id: t.id, title: t.title, description: t.description, status: t.status, department: t.department,
    assigneeId: t.assignee_id, assignee: names[t.assignee_id] || null,
    assignedById: t.assigned_by, assignedBy: names[t.assigned_by] || null,
    observerRequestId: t.observer_request_id, devTaskId: t.dev_task_id, createdAt: t.created_at,
  };
}

// GET /api/tasks/list?projectId=&mine=true
//   owner: every task · admin: their department · worker: their own
export async function list({ user, query }) {
  const me = await requireRole(user.id, query.projectId, INSIDERS);
  let builder = db.from('tasks').select('*').eq('project_id', query.projectId);
  if (query.mine === 'true' || me.role === 'worker') builder = builder.eq('assignee_id', user.id);
  else if (me.role === 'admin') builder = builder.eq('department', me.department);
  const rows = await q(builder.order('created_at', { ascending: false }));
  const names = await namesFor(rows.flatMap((t) => [t.assignee_id, t.assigned_by]));
  return { tasks: rows.map((t) => shape(t, names)) };
}

// POST /api/tasks/assign  { projectId, assigneeId, title, description?, observerRequestId? }
export async function assign({ user, body }) {
  requireFields(body, ['projectId', 'assigneeId', 'title']);
  const me = await requireRole(user.id, body.projectId, MANAGERS);
  const assignee = await getMembership(body.assigneeId, body.projectId);
  if (!assignee || assignee.role !== 'worker') throw new HttpError(400, 'Tasks are assigned to workers');
  if (me.role === 'admin' && assignee.department !== me.department) {
    throw new HttpError(403, 'Admins can only assign tasks to workers in their own department');
  }
  const title = String(body.title).trim().slice(0, 200);
  if (title.length < 3) throw new HttpError(400, 'Give the task a short title');

  const task = await q(db.from('tasks').insert({
    project_id: body.projectId,
    title,
    description: body.description ? String(body.description).slice(0, 2000) : null,
    assignee_id: body.assigneeId,
    assigned_by: user.id,
    department: assignee.department,
    targets: [],
    status: 'open',
    observer_request_id: body.observerRequestId || null,
  }).select().single());

  const names = await namesFor([user.id, body.assigneeId]);
  await logEvent(body.projectId, {
    type: 'assignment.created', actorId: user.id, department: assignee.department,
    summary: `${names[user.id]} assigned "${title}" to ${names[body.assigneeId]}`, data: { assignmentId: task.id },
  });
  const notes = [{ user_id: body.assigneeId, project_id: body.projectId, kind: 'task_assigned', title: `New task: ${title}`, body: task.description }];
  if (body.observerRequestId) {
    const request = (await q(db.from('observer_requests').select('observer_id').eq('id', body.observerRequestId)))[0];
    await q(db.from('observer_requests').update({
      status: 'accepted', admin_id: user.id, task_id: task.id, updated_at: new Date().toISOString(),
    }).eq('id', body.observerRequestId).eq('project_id', body.projectId));
    notes.push({
      user_id: request?.observer_id ?? null, project_id: body.projectId, kind: 'request_accepted',
      title: 'Your request is being worked on', body: `It became the task "${title}", assigned to ${names[body.assigneeId]}.`,
    });
  }
  await notify(notes);
  return { task: shape(task, names) };
}

// POST /api/tasks/status  { taskId, status }   (assignee, the department admin, or the owner)
export async function setStatus({ user, body }) {
  requireFields(body, ['taskId', 'status']);
  if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Invalid status');
  const task = (await q(db.from('tasks').select('*').eq('id', body.taskId)))[0];
  if (!task) throw new HttpError(404, 'Task not found');
  const me = await requireRole(user.id, task.project_id, INSIDERS);
  const allowed = task.assignee_id === user.id || me.role === 'owner' || (isManager(me) && me.department === task.department);
  if (!allowed) throw new HttpError(403, 'Only the assignee or their admin can update this task');
  await q(db.from('tasks').update({ status: body.status }).eq('id', task.id));
  return { taskId: task.id, status: body.status };
}

// POST /api/tasks/delete  { taskId }   (whoever assigned it, or the owner) — only before work starts
export async function remove({ user, body }) {
  requireFields(body, ['taskId']);
  const task = (await q(db.from('tasks').select('*').eq('id', body.taskId)))[0];
  if (!task) throw new HttpError(404, 'Task not found');
  const me = await requireRole(user.id, task.project_id, MANAGERS);
  if (me.role !== 'owner' && task.assigned_by !== user.id) throw new HttpError(403, 'Only whoever assigned it, or the owner, can delete it');
  if (task.status !== 'open') throw new HttpError(409, 'Work on this task has started; it can no longer be deleted');
  await q(db.from('tasks').delete().eq('id', task.id));
  return { deleted: true };
}
