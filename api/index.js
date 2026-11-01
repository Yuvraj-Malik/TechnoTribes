// Single entry point for every /api/* request.
// vercel.json rewrites /api/<route> -> /api/index?route=<route>, so the whole
// backend is ONE Vercel function (the free Hobby plan allows only 12).
// To add an endpoint: write the handler in server/, then add one line below.
import { getUser, readBody } from './_lib/http.js';

import * as auth from '../server/auth.js';
import * as projects from '../server/projects.js';
import * as tasks from '../server/tasks.js';
import * as observer from '../server/observer.js';
import * as notifications from '../server/notifications.js';
import * as github from '../server/github.js';
import * as team from '../server/team.js';
import * as teamWork from '../server/team-workspace.js';
import * as teamReview from '../server/team-review.js';
import * as teamImpact from '../server/team-impact.js';
import * as teamContext from '../server/team-context.js';
import * as teamOverview from '../server/team-overview.js';

export const routes = {
  'GET health': async () => ({ ok: true, time: new Date().toISOString() }),

  // Auth
  'GET auth/me': auth.me,

  // Projects, codes, members, brief
  'POST projects/create': projects.create,
  'GET projects/get': projects.get,
  'POST projects/observer-code': projects.regenerateObserverCode,
  'POST projects/admin-code': projects.createAdminCode,
  'POST projects/join': projects.join,
  'POST projects/admins/approve': projects.approveAdmin,
  'POST projects/join-request': projects.requestToJoin,
  'POST projects/join-request/respond': projects.respondJoinRequest,
  'POST projects/join-request/cancel': projects.cancelJoinRequest,
  'GET projects/discover': projects.discover,
  'POST projects/enter': projects.enter,
  'GET projects/my-requests': projects.myRequests,
  'POST projects/members/add': projects.addWorker,
  'GET projects/members': projects.members,
  'POST projects/update': projects.update,
  'POST projects/project-code': projects.regenerateProjectCode,
  'POST projects/members/remove': projects.removeMember,

  // Tasks
  'GET tasks/list': tasks.list,
  'POST tasks/assign': tasks.assign,
  'POST tasks/status': tasks.setStatus,
  'POST tasks/delete': tasks.remove,

  // Observer
  'GET observer/feed': observer.feed,
  'POST observer/request': observer.createRequest,
  'GET observer/requests': observer.listRequests,
  'POST observer/request/respond': observer.respond,

  // Notifications
  'GET notifications/list': notifications.list,
  'POST notifications/read': notifications.markRead,

  // GitHub (optional)
  'GET github/tree': github.tree,
  'GET github/file': github.file,
  'POST github/import': github.importRepo,
  'POST github/branch': github.branch,
  'POST github/pull-request': github.pullRequest,

  // Team workspace: departments, versioned context, developer agents, manager review
  'GET team/bootstrap': team.bootstrap,
  'GET team/context': team.context,
  'POST team/context/seen': team.contextSeen,
  'GET team/context/history': team.contextHistory,
  'GET team/log': team.log,
  'GET team/log/export': team.logExport,
  'GET team/commits': team.commits,
  'GET team/notifications': team.notifications,
  'POST team/notifications/read': team.notificationsRead,
  'POST team/members/department': team.setMemberDepartment,
  'POST team/demo/setup': team.demoSetup,
  'GET team/overview': teamOverview.overview,
  'GET team/my/submissions': teamOverview.mySubmissions,
  'GET team/my/assignments': teamOverview.myAssignments,
  'POST team/departments/create': teamOverview.createDepartment,
  'POST team/departments/update': teamOverview.updateDepartment,
  'POST team/departments/delete': teamOverview.deleteDepartment,
  'POST team/members/role': teamOverview.setRole,
  'POST team/context/preview': teamContext.preview,
  'POST team/context/save': teamContext.save,
  'POST team/context/create': teamContext.create,

  'GET team/task/current': teamWork.current,
  'POST team/task/start': teamWork.start,
  'POST team/task/conflict-decision': teamWork.conflictDecision,
  'POST team/task/plan-decision': teamWork.planDecision,
  'POST team/task/follow-up': teamWork.followUp,
  'POST team/task/retry': teamWork.retry,
  'POST team/task/cancel': teamWork.cancel,
  'POST team/task/submit': teamWork.submit,
  'POST team/task/context-decision': teamWork.contextDecision,
  'POST team/task/rework': teamWork.rework,
  'POST team/agent/restart': teamWork.restartAgent,
  'GET team/workspace/files': teamWork.files,
  'GET team/workspace/file': teamWork.file,
  'GET team/workspace/bundle': teamWork.bundle,
  'GET team/workspace/diff': teamWork.diff,

  'GET team/review/queue': teamReview.queue,
  'GET team/review/detail': teamReview.detail,
  'POST team/review/decide': teamReview.decide,
  'GET team/review/overview': teamReview.overview,
  'POST team/proposals/preview': teamImpact.preview,
  'POST team/proposals/confirm': teamImpact.confirm,
  'POST team/proposals/discard': teamImpact.discard,
};

const PUBLIC = new Set(['GET health']);

// Which endpoint was asked for. Works however the request arrives:
//   Vercel, original URL kept:  /api/team/task/start
//   Vercel, rewritten URL:      /api/index?route=team/task/start
//   Local dev (vite.config.js): /team/task/start with ?route=... set
export function routeOf(req) {
  const { pathname } = new URL(req.url || '/', 'http://localhost');
  if (pathname.startsWith('/api/') && !/^\/api\/index(\.js)?\/?$/.test(pathname)) {
    return decodeURIComponent(pathname.slice(5)).replace(/^\/+|\/+$/g, '');
  }
  const q = req.query?.route;
  return (Array.isArray(q) ? q.join('/') : String(q || '')).replace(/^\/+|\/+$/g, '');
}

export default async function handler(req, res) {
  const route = routeOf(req);
  const key = `${req.method} ${route}`;
  const fn = routes[key];

  if (!fn) {
    const known = Object.keys(routes).some((k) => k.split(' ')[1] === route);
    return res.status(known ? 405 : 404).json({ error: known ? `Use a different method for /api/${route}` : `No endpoint /api/${route}` });
  }

  try {
    const user = PUBLIC.has(key) ? null : await getUser(req);
    const body = req.method === 'GET' ? {} : readBody(req);
    const result = await fn({ req, user, body, query: req.query });
    return res.status(200).json(result ?? {});
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[api] ${key}`, err);
    return res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong' : err.message, details: err.details });
  }
}
