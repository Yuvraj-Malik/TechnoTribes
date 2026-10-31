// The observer's world: plain language only, all from the Moderator's data.
// The observer can ask for changes, but only an admin turns them into tasks.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { requireRole, EVERYONE, MANAGERS } from '../api/_lib/permissions.js';
import { getState } from '../api/_lib/moderator.js';
import { activeIntents } from '../api/_lib/coordination.js';
import { notify, managersOf, observerOf, namesFor } from '../api/_lib/log.js';

// GET /api/observer/feed?projectId=
// { whatChanged, happeningNow, nextSteps, currentSite, goals }
export async function feed({ user, query }) {
  const me = await requireRole(user.id, query.projectId, EVERYONE);
  const projectId = query.projectId;
  const [project, state, log, intents, pending, tasks, requests] = await Promise.all([
    q(db.from('projects').select('name,description').eq('id', projectId).single()),
    getState(projectId),
    q(db.from('moderator_log').select('version,observer_summary,summary,approved_by,created_at')
      .eq('project_id', projectId).order('version', { ascending: false }).limit(30)),
    activeIntents(projectId),
    q(db.from('merge_requests').select('id').eq('project_id', projectId).eq('status', 'pending')),
    q(db.from('tasks').select('title,assignee_id,status').eq('project_id', projectId).in('status', ['open', 'in_progress', 'in_review'])),
    q(db.from('observer_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false })),
  ]);
  const names = await namesFor([
    ...log.map((l) => l.approved_by), ...intents.map((i) => i.user_id), ...tasks.map((t) => t.assignee_id),
  ]);

  const statusWords = { open: 'planned', in_progress: 'in progress', in_review: 'waiting for approval' };
  return {
    project,
    version: state.current_version,
    goals: state.brief,
    whatChanged: log.map((l) => ({
      version: l.version, when: l.created_at,
      text: l.observer_summary || l.summary,
      approvedBy: names[l.approved_by] || null,
    })),
    happeningNow: [
      ...intents.map((i) => `${names[i.user_id] || 'Someone'} is working on: ${i.goal}`),
      pending.length ? `${pending.length} change${pending.length > 1 ? 's are' : ' is'} waiting for an admin to approve.` : null,
    ].filter(Boolean),
    nextSteps: tasks.map((t) => `${t.title} (${names[t.assignee_id] || 'unassigned'}, ${statusWords[t.status]})`),
    myRequests: me.role === 'observer' ? requests : undefined,
    currentSite: { files: state.files }, // the frontend renders this as a live preview
  };
}

// POST /api/observer/request  { projectId, message }   (observer only)
export async function createRequest({ user, body }) {
  requireFields(body, ['projectId', 'message']);
  await requireRole(user.id, body.projectId, ['observer']);
  const request = await q(db.from('observer_requests').insert({
    project_id: body.projectId, observer_id: user.id, message: String(body.message).slice(0, 2000),
  }).select().single());
  await notify((await managersOf(body.projectId)).map((id) => ({
    user_id: id, project_id: body.projectId, kind: 'observer_request',
    title: 'The observer asked for a change', body: request.message,
  })));
  return { request };
}

// GET /api/observer/requests?projectId=   (observer: their own; owner/admin: all)
export async function listRequests({ user, query }) {
  await requireRole(user.id, query.projectId, ['owner', 'admin', 'observer']);
  return {
    requests: await q(db.from('observer_requests').select('*').eq('project_id', query.projectId)
      .order('created_at', { ascending: false })),
  };
}

// POST /api/observer/request/respond  { requestId, status: 'rejected'|'done', response? }   (owner/admin)
// To ACCEPT a request, assign it as a task: POST /api/tasks/assign with observerRequestId.
export async function respond({ user, body }) {
  requireFields(body, ['requestId', 'status']);
  if (!['rejected', 'done'].includes(body.status)) {
    throw new HttpError(400, 'Use rejected or done here. To accept, assign it as a task with /api/tasks/assign');
  }
  const request = (await q(db.from('observer_requests').select('*').eq('id', body.requestId)))[0];
  if (!request) throw new HttpError(404, 'Request not found');
  await requireRole(user.id, request.project_id, MANAGERS);
  await q(db.from('observer_requests').update({
    status: body.status, admin_id: user.id, response: body.response || null, updated_at: new Date().toISOString(),
  }).eq('id', request.id));
  await notify([{
    user_id: await observerOf(request.project_id), project_id: request.project_id, kind: `request_${body.status}`,
    title: body.status === 'rejected' ? 'Your request was declined' : 'Your request is done',
    body: body.response || null,
  }]);
  return { requestId: request.id, status: body.status };
}
