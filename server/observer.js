// The observer's view (a founder, investor or judge): plain language only.
//   whatChanged   approved merges and requirement changes, newest first
//   happeningNow  who is working on what right now, and what waits for review
//   nextSteps     assigned tasks that are not done, and accepted observer requests
//   currentSite   the approved (main) web files, for a live preview
// The observer can ask for a change; only an admin or the owner turns it into a task.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { requireRole, EVERYONE, MANAGERS } from '../api/_lib/permissions.js';
import { notify, managersOf, namesFor } from '../api/_lib/log.js';
import { listPeople } from '../api/_lib/team.js';
import { readAll } from '../api/_lib/files.js';
import { workSubmissions } from '../api/_lib/records.js';
import { board } from './team-overview.js';
import { logEvent } from '../api/_lib/activity.js';

const STORY_TYPES = ['review.approved', 'context.changed', 'impact.decision', 'context.created', 'seed', 'department.created'];
const WEB_FILE = /^web\/.+\.(html?|css|js|json|svg)$/i;

function plain(e, nameOf) {
  const who = e.actor_id ? nameOf(e.actor_id) : null;
  switch (e.type) {
    case 'review.approved': return { kind: 'change', text: e.summary.replace(/'s "/, ': "') };
    case 'context.changed': {
      const d = e.data ?? {};
      return { kind: 'requirement', text: `${d.title ?? 'A requirement'} was updated${who ? ` by ${who}` : ''}${d.why ? `: ${d.why}` : ''}` };
    }
    case 'impact.decision': return null; // covered by the context.changed events it produces
    case 'context.created': return { kind: 'requirement', text: e.summary };
    default: return { kind: 'project', text: e.summary };
  }
}

// GET /api/observer/feed?projectId=
export async function feed({ user, query }) {
  const me = await requireRole(user.id, query.projectId, EVERYONE);
  const projectId = query.projectId;
  const [project, people, events, commits, pending, tasks, requests, main] = await Promise.all([
    q(db.from('projects').select('name,description').eq('id', projectId).single()),
    listPeople(projectId),
    q(db.from('activity_log').select('*').eq('project_id', projectId).in('type', STORY_TYPES).order('id', { ascending: false }).limit(60)),
    q(db.from('main_commits').select('id').eq('project_id', projectId)),
    workSubmissions.list(projectId, { status: ['pending', 'merge_conflict'] }),
    q(db.from('tasks').select('title,assignee_id,status').eq('project_id', projectId).neq('status', 'done').order('created_at', { ascending: false })),
    q(db.from('observer_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false })),
    readAll(projectId, 'main'),
  ]);
  const names = await namesFor([...people.map((p) => p.id), ...tasks.map((t) => t.assignee_id)]);
  const nameOf = (id) => names[id] || people.find((p) => p.id === id)?.name || 'Someone';
  const live = (await board(projectId, people)).filter((b) => b.task?.active);
  const statusWords = { open: 'planned', in_progress: 'in progress', in_review: 'waiting for approval' };

  return {
    project,
    version: commits.length,
    whatChanged: events.map((e) => {
      const p = plain(e, nameOf);
      return p && { id: e.id, when: e.at, ...p };
    }).filter(Boolean),
    happeningNow: [
      ...live.map((b) => `${b.name} is working on: ${b.task.text}`),
      pending.length ? `${pending.length} change${pending.length > 1 ? 's are' : ' is'} waiting for a manager to approve.` : null,
    ].filter(Boolean),
    nextSteps: tasks.map((t) => `${t.title} (${nameOf(t.assignee_id)}, ${statusWords[t.status] ?? t.status})`),
    myRequests: me.role === 'observer' ? requests.filter((r) => r.observer_id === user.id) : undefined,
    currentSite: { files: Object.fromEntries(Object.entries(main).filter(([p]) => WEB_FILE.test(p))) },
  };
}

// POST /api/observer/request  { projectId, message }   (observer only)
export async function createRequest({ user, body }) {
  requireFields(body, ['projectId', 'message']);
  await requireRole(user.id, body.projectId, ['observer']);
  const message = String(body.message).trim().slice(0, 2000);
  if (message.length < 5) throw new HttpError(400, 'Describe the change in a few words');
  const request = await q(db.from('observer_requests').insert({ project_id: body.projectId, observer_id: user.id, message }).select().single());
  await notify((await managersOf(body.projectId)).map((id) => ({
    user_id: id, project_id: body.projectId, kind: 'observer_request', title: 'The observer asked for a change', body: message,
  })));
  await logEvent(body.projectId, { type: 'observer.request', actorId: user.id, summary: `The observer asked: "${message}"`, data: { requestId: request.id } });
  return { request };
}

// GET /api/observer/requests?projectId=   (observer: their own; owner/admin: all)
export async function listRequests({ user, query }) {
  const me = await requireRole(user.id, query.projectId, ['owner', 'admin', 'observer']);
  let builder = db.from('observer_requests').select('*').eq('project_id', query.projectId);
  if (me.role === 'observer') builder = builder.eq('observer_id', user.id);
  const rows = await q(builder.order('created_at', { ascending: false }));
  const names = await namesFor(rows.flatMap((r) => [r.observer_id, r.admin_id]));
  return { requests: rows.map((r) => ({ ...r, observerName: names[r.observer_id] || null, adminName: names[r.admin_id] || null })) };
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
    user_id: request.observer_id, project_id: request.project_id, kind: `request_${body.status}`,
    title: body.status === 'rejected' ? 'Your request was declined' : 'Your request is done',
    body: body.response || null,
  }]);
  return { requestId: request.id, status: body.status };
}
