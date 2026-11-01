// Assigned tasks (from an admin or the owner) follow the workspace task that carries them out:
//   started in the workspace -> in_progress, submitted -> in_review,
//   approved -> done, sent back / rejected -> in_progress.
// When an assignment came from an observer request, the observer hears about it.
import { db, q } from './supabase-admin.js';
import { notify } from './log.js';
import { logEvent } from './activity.js';

const STATUS_FOR = {
  started: 'in_progress',
  submitted: 'in_review',
  approved: 'done',
  sent_back: 'in_progress',
  rejected: 'in_progress',
  cancelled: 'open',
};

export async function getAssignment(id) {
  if (!id) return null;
  return (await q(db.from('tasks').select('*').eq('id', id)))[0] ?? null;
}

/** devTask: the workspace task (has assignmentId). event: started|submitted|approved|sent_back|rejected|cancelled */
export async function syncAssignment(devTask, event) {
  const a = await getAssignment(devTask?.assignmentId);
  if (!a) return;
  const status = STATUS_FOR[event];
  if (!status || a.status === status) return;
  const patch = { status };
  if (event === 'started') patch.dev_task_id = devTask.id;
  if (event === 'cancelled') patch.dev_task_id = null;
  await q(db.from('tasks').update(patch).eq('id', a.id));
  await logEvent(a.project_id, {
    type: 'assignment.status', actorId: devTask.userId, department: a.department, taskId: devTask.id,
    summary: `Assigned task "${a.title}" is now ${status.replace('_', ' ')}`, data: { assignmentId: a.id, status },
  });
  // A request from another department: post what changed back to whoever asked.
  if (event === 'approved' && a.source === 'request') {
    const result = devTask.summary || `"${a.title}" is done.`;
    await q(db.from('tasks').update({ result }).eq('id', a.id));
    await logEvent(a.project_id, {
      type: 'request.done', actorId: devTask.userId, department: a.from_department, level: 'department', taskId: a.from_task_id ?? null,
      title: `Request done: ${a.title}`, plain: `${devTask.userName} did it: ${result}`,
      summary: `"${a.title}" (requested by ${a.from_department}) is done and merged: ${result}`,
      links: [{ type: 'task', id: a.id }], data: { requestId: a.id, result },
    });
    await notify([{ user_id: a.requested_by, project_id: a.project_id, kind: 'request_done', title: `Done: ${a.title}`, body: result }]);
    if (a.from_task_id) {
      const waiting = (await q(db.from('dev_tasks').select('*').eq('id', a.from_task_id)))[0];
      if (waiting) {
        const data = waiting.data;
        data.messages = [...(data.messages ?? []), { from: 'system', text: `Your request "${a.title}" is done: ${result}`, at: new Date().toISOString() }];
        await q(db.from('dev_tasks').update({ data }).eq('id', waiting.id));
      }
    }
  }
  if (event === 'approved' && a.observer_request_id) {
    const request = (await q(db.from('observer_requests').select('observer_id').eq('id', a.observer_request_id)))[0];
    await q(db.from('observer_requests').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', a.observer_request_id));
    await notify([{
      user_id: request?.observer_id ?? null, project_id: a.project_id, kind: 'request_done',
      title: 'Your request is done', body: `"${a.title}" was approved and is now part of the project.`,
    }]);
  }
}
