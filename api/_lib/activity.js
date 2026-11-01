// The structured activity log (every event of the team workflow) and
// notifications that are logged once per batch.
import { db, q } from './supabase-admin.js';
import { namesFor } from './log.js';

// e: { type, summary, actorId?, department?, taskId?, submissionId?, data?,
//      level?, title?, plain?, itemId?, suggestionId?, checkpointId?, links? }
// Two levels: 'central' (no department) and 'department'. title/plain/links are
// clean fields for the non-technical project timeline built from this log.
export async function logEvent(projectId, e) {
  const department = e.department ?? null;
  const rows = await q(db.from('activity_log').insert({
    project_id: projectId, type: e.type, summary: e.summary, actor_id: e.actorId ?? null,
    department, task_id: e.taskId ?? null, submission_id: e.submissionId ?? null,
    data: e.data ?? {},
    level: e.level ?? (department ? 'department' : 'central'),
    title: e.title ?? null, plain: e.plain ?? null, item_id: e.itemId ?? null,
    suggestion_id: e.suggestionId ?? null, checkpoint_id: e.checkpointId ?? null, links: e.links ?? [],
  }).select('id'));
  return rows?.[0]?.id ?? null;
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
    level: r.level ?? (r.department ? 'department' : 'central'), title: r.title ?? null, plain: r.plain ?? null,
    itemId: r.item_id ?? null, suggestionId: r.suggestion_id ?? null, checkpointId: r.checkpoint_id ?? null, links: r.links ?? [],
  };
}
