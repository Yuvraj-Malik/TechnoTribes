// Single entry point for every /api/* request.
// vercel.json rewrites /api/<route> -> /api/index?route=<route>, so the whole
// backend is ONE Vercel function (the free Hobby plan allows only 12).
// To add an endpoint: write the handler in server/, then add one line below.
import { getUser, readBody } from './_lib/http.js';

import * as auth from '../server/auth.js';
import * as projects from '../server/projects.js';
import * as tasks from '../server/tasks.js';
import * as builder from '../server/agents/builder.js';
import * as critic from '../server/agents/critic.js';
import * as moderator from '../server/moderator.js';
import * as coordination from '../server/coordination.js';
import * as reviews from '../server/reviews.js';
import * as observer from '../server/observer.js';
import * as history from '../server/history.js';
import * as notifications from '../server/notifications.js';
import * as messages from '../server/messages.js';
import * as github from '../server/github.js';

export const routes = {
  'GET health': async () => ({ ok: true, time: new Date().toISOString() }),

  // Auth
  'GET auth/me': auth.me,

  // Projects, codes, members, brief
  'POST projects/create': projects.create,
  'POST projects/update': projects.update,
  'GET projects/get': projects.get,
  'POST projects/observer-code': projects.regenerateObserverCode,
  'POST projects/admin-code': projects.createAdminCode,
  'POST projects/join': projects.join,
  'POST projects/admins/approve': projects.approveAdmin,
  'POST projects/join-request': projects.requestToJoin,
  'POST projects/join-request/respond': projects.respondJoinRequest,
  'POST projects/members/add': projects.addWorker,
  'POST projects/members/update': projects.updateMember,
  'GET projects/members': projects.members,
  'POST projects/brief/preview': projects.previewBrief,
  'POST projects/brief': projects.updateBrief,

  // Tasks
  'GET tasks/list': tasks.list,
  'POST tasks/assign': tasks.assign,
  'POST tasks/status': tasks.setStatus,

  // Agents
  'GET agents/proposals': builder.proposals,
  'POST agents/builder/run': builder.run,
  'POST agents/critic/review': critic.review,
  'POST agents/critic/prioritize': critic.prioritize,

  // Moderator
  'GET moderator/context': moderator.context,
  'GET moderator/log': moderator.log,
  'GET moderator/state': moderator.state,
  'GET moderator/graph': moderator.graph,

  // Coordination
  'POST coordination/check': coordination.check,
  'POST coordination/declare': coordination.declare,
  'POST coordination/release': coordination.release,
  'GET coordination/board': coordination.board,

  // Reviews
  'POST reviews/submit': reviews.submit,
  'POST reviews/bucket': reviews.bucket,
  'GET reviews/queue': reviews.queue,
  'POST reviews/decide': reviews.decide,

  // Observer
  'GET observer/feed': observer.feed,
  'POST observer/request': observer.createRequest,
  'GET observer/requests': observer.listRequests,
  'POST observer/request/respond': observer.respond,

  // Personal history
  'GET history/list': history.list,
  'POST history/delete': history.remove,

  // Notifications
  'GET notifications/list': notifications.list,
  'POST notifications/read': notifications.markRead,

  // Messages
  'POST messages/send': messages.send,
  'GET messages/list': messages.list,

  // GitHub (optional)
  'GET github/tree': github.tree,
  'GET github/file': github.file,
  'POST github/import': github.importRepo,
  'POST github/branch': github.branch,
  'POST github/pull-request': github.pullRequest,
};

const PUBLIC = new Set(['GET health']);

export default async function handler(req, res) {
  const route = String(req.query.route || '').replace(/^\/+|\/+$/g, '');
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
