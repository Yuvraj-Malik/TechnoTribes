// The observer's view (a founder, investor or judge): plain language only.
//   roadmap       every piece of work: done / happening now / coming up, with what changed and why
//   people        who is doing what, and what each person does next
//   update        the last day in plain sentences
//   line, map     how the work fits together, with no file paths or branch names
//   about         what the project is, from its central context and Markdown files
//   changes       approved product changes and requirement changes, each with what and why
//   myRequests    the observer's own requests and where each one stands
//   currentSite   the approved (main) web files, for a live preview
// The observer can ask for a change; only an admin or the owner turns it into a task.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { requireRole, EVERYONE, MANAGERS } from '../api/_lib/permissions.js';
import { notify, managersOf, namesFor } from '../api/_lib/log.js';
import { listDepartments, listPeople } from '../api/_lib/team.js';
import { readAll } from '../api/_lib/files.js';
import { listSections } from '../api/_lib/context.js';
import { devTasks, workSubmissions } from '../api/_lib/records.js';
import { messageTitle, plainText, summarize } from '../api/_lib/observer-summary.js';
import { logEvent } from '../api/_lib/activity.js';

const WEB_FILE = /^web\/.+\.(html?|css|js|json|svg)$/i;

// GET /api/observer/feed?projectId=
// Everything in plain words. Each piece of work carries what changed and why, taken
// from the developer's submission (written by their agent, approved by a manager).
export async function feed({ user, query }) {
  const me = await requireRole(user.id, query.projectId, EVERYONE);
  const projectId = query.projectId;
  const [project, people, departments, sections, events, commits, subs, devs, tasks, requests, main] = await Promise.all([
    q(db.from('projects').select('name,description').eq('id', projectId).single()),
    listPeople(projectId),
    listDepartments(projectId),
    listSections(projectId),
    q(db.from('activity_log').select('*').eq('project_id', projectId).in('type', ['context.changed', 'context.created']).order('id', { ascending: false }).limit(40)),
    q(db.from('main_commits').select('id,author_id,message,created_at').eq('project_id', projectId).order('created_at', { ascending: false })),
    workSubmissions.list(projectId, {}, 300),
    devTasks.list(projectId, {}, 300),
    q(db.from('tasks').select('*').eq('project_id', projectId).order('created_at', { ascending: true })),
    q(db.from('observer_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false })),
    readAll(projectId, 'main'),
  ]);
  const names = await namesFor([...people.map((p) => p.id), ...tasks.map((t) => t.assignee_id), ...commits.map((c) => c.author_id)]);
  const nameOf = (id) => names[id] || people.find((p) => p.id === id)?.name || 'Someone';
  const progress = summarize({ tasks, devs, submissions: subs, commits, people, departments, requests, events, files: main, sections, description: project.description, viewerId: user.id, nameOf });

  // Approved changes, newest first: what changed + why (from the submission), or the merge message.
  const approved = subs.filter((s) => s.status === 'approved');
  const changes = [
    ...approved.map((s) => ({
      id: `s-${s.id}`, kind: 'product', title: s.title, what: plainText(s.summary) || s.title, why: plainText(s.why),
      who: s.userName || nameOf(s.userId), when: s.reviewedAt || s.createdAt,
    })),
    ...commits.filter((c) => !approved.some((s) => c.message.includes(s.title))).map((c) => ({
      id: `c-${c.id}`, kind: 'product', title: messageTitle(c.message), what: messageTitle(c.message), why: null,
      who: nameOf(c.author_id), when: c.created_at,
    })),
    ...events.map((e) => ({
      id: `e-${e.id}`, kind: 'requirement',
      title: e.data?.title ? `${e.data.title} updated` : e.summary.replace('the central context', "the team's rules"),
      what: e.data?.title ? `The team and its AI agents now follow a new version of "${e.data.title}".` : null,
      why: e.data?.why || null, who: e.actor_id ? nameOf(e.actor_id) : 'The team', when: e.at,
    })),
  ].sort((x, y) => String(y.when).localeCompare(String(x.when)));

  return {
    project,
    version: commits.length,
    counts: progress.counts,
    roadmap: progress.work,
    people: progress.people,
    update: progress.update,
    line: progress.line,
    map: progress.map,
    about: progress.about,
    changes,
    myRequests: requests.filter((r) => r.observer_id === user.id).map((r) => {
      const t = tasks.find((x) => x.id === r.task_id);
      return { ...r, taskStatus: t?.status ?? null, assignee: t ? nameOf(t.assignee_id) : null };
    }),
    isObserver: me.role === 'observer',
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
