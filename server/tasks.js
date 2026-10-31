// Tasks: only the owner/admin assign work. Observer requests become tasks here.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, asArray } from '../api/_lib/http.js';
import { requireRole, getMembership, MANAGERS, INSIDERS, ENGINEERS, isManager } from '../api/_lib/permissions.js';
import { notify, observerOf, namesFor } from '../api/_lib/log.js';
import { normalizePath, fileKey } from '../api/_lib/paths.js';

// GET /api/tasks/list?projectId=&mine=true
export async function list({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  let builder = db.from('tasks').select('*').eq('project_id', query.projectId).order('created_at', { ascending: false });
  if (query.mine === 'true') builder = builder.eq('assignee_id', user.id);
  const tasks = await q(builder);
  const names = await namesFor(tasks.flatMap((t) => [t.assignee_id, t.assigned_by]));
  return { tasks: tasks.map((t) => ({ ...t, assignee: names[t.assignee_id], assignedBy: names[t.assigned_by] })) };
}

// POST /api/tasks/assign  { projectId, assigneeId, title, description?, targets?: [paths], observerRequestId? }
export async function assign({ user, body }) {
  requireFields(body, ['projectId', 'assigneeId', 'title']);
  await requireRole(user.id, body.projectId, MANAGERS);
  const assignee = await getMembership(body.assigneeId, body.projectId);
  if (!assignee || !ENGINEERS.includes(assignee.role)) throw new HttpError(400, 'Tasks can only be assigned to people with agents');

  let targets;
  try { targets = asArray(body.targets).map((p) => fileKey(normalizePath(p))); } catch (e) { throw new HttpError(400, e.message); }

  const task = await q(db.from('tasks').insert({
    project_id: body.projectId,
    title: String(body.title).slice(0, 200),
    description: body.description || null,
    assignee_id: body.assigneeId,
    assigned_by: user.id,
    targets,
    observer_request_id: body.observerRequestId || null,
  }).select().single());

  const notes = [{ user_id: body.assigneeId, project_id: body.projectId, kind: 'task_assigned', title: `New task: ${task.title}`, body: task.description }];
  if (body.observerRequestId) {
    await q(db.from('observer_requests').update({
      status: 'accepted', admin_id: user.id, task_id: task.id, updated_at: new Date().toISOString(),
    }).eq('id', body.observerRequestId).eq('project_id', body.projectId));
    notes.push({
      user_id: await observerOf(body.projectId), project_id: body.projectId, kind: 'request_accepted',
      title: 'Your request is being worked on', body: `It became the task "${task.title}".`,
    });
  }
  await notify(notes);
  return { task };
}

// POST /api/tasks/status  { taskId, status }   (assignee or owner/admin)
export async function setStatus({ user, body }) {
  requireFields(body, ['taskId', 'status']);
  if (!['open', 'in_progress', 'in_review', 'done'].includes(body.status)) throw new HttpError(400, 'Invalid status');
  const task = (await q(db.from('tasks').select('*').eq('id', body.taskId)))[0];
  if (!task) throw new HttpError(404, 'Task not found');
  const me = await requireRole(user.id, task.project_id, INSIDERS);
  if (task.assignee_id !== user.id && !isManager(me)) throw new HttpError(403, 'Only the assignee or an admin can update this task');
  await q(db.from('tasks').update({ status: body.status }).eq('id', task.id));
  return { taskId: task.id, status: body.status };
}
