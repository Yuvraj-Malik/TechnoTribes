// The structured activity log (every event of the team workflow) and
// notifications that are logged once per batch.
import { db, q } from './supabase-admin.js';
import { namesFor } from './log.js';

// e: { type, summary, actorId?, department?, taskId?, submissionId?, data? }
export async function logEvent(projectId, e) {
  await q(db.from('activity_log').insert({
    project_id: projectId, type: e.type, summary: e.summary, actor_id: e.actorId ?? null,
    department: e.department ?? null, task_id: e.taskId ?? null, submission_id: e.submissionId ?? null,
    data: e.data ?? {},
  }));
}

/** Sends the same notification to several people and logs it once. */
export async function notifyMany(projectId, userIds, n, meta = {}) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await q(db.from('notifications').insert(ids.map((user_id) => ({ user_id, project_id: projectId, kind: n.kind, title: n.title, body: n.body }))));
  const names = await namesFor(ids);
  await logEvent(projectId, {
    type: 'notification.sent', summary: `Notified ${ids.map((id) => names[id] || 'someone').join(', ')}: ${n.title}`,
    ...meta, data: { recipients: ids, ...n },
  });
}

export function toEvent(r) {
  return {
    id: r.id, at: r.at, type: r.type, actorId: r.actor_id, department: r.department, taskId: r.task_id,
    submissionId: r.submission_id, summary: r.summary, data: r.data,
  };
}
