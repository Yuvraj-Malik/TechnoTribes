// Coordination endpoints: who is working on what, and overlap checks.
// The Builder calls the same functions internally; these endpoints let the UI
// (and manual work) use them too.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, asArray } from '../api/_lib/http.js';
import { requireRole, INSIDERS, ENGINEERS, isManager } from '../api/_lib/permissions.js';
import { checkOverlap, declareIntent, releaseIntents, activeIntents, getIntent } from '../api/_lib/coordination.js';
import { getState } from '../api/_lib/moderator.js';
import { namesFor } from '../api/_lib/log.js';
import { normalizePath, fileKey, humanizeKey } from '../api/_lib/paths.js';

function toKeys(paths) {
  try { return asArray(paths).map((p) => fileKey(normalizePath(p))); } catch (e) { throw new HttpError(400, e.message); }
}

// POST /api/coordination/check  { projectId, targets: [paths] }
export async function check({ user, body }) {
  requireFields(body, ['projectId']);
  await requireRole(user.id, body.projectId, ENGINEERS);
  return checkOverlap(body.projectId, user.id, toKeys(body.targets));
}

// POST /api/coordination/declare  { projectId, goal, targets: [paths], taskId?, force? }
export async function declare({ user, body }) {
  requireFields(body, ['projectId', 'goal']);
  await requireRole(user.id, body.projectId, ENGINEERS);
  const targets = toKeys(body.targets);
  const overlap = await checkOverlap(body.projectId, user.id, targets);
  if (overlap.status === 'same_target' && !body.force) throw new HttpError(409, overlap.message, { overlap });
  const state = await getState(body.projectId);
  const intent = await declareIntent({
    projectId: body.projectId, userId: user.id, taskId: body.taskId || null,
    goal: body.goal, targets, baseVersion: state.current_version,
  });
  return { intent, overlap };
}

// POST /api/coordination/release  { intentId }   (its owner, or owner/admin)
export async function release({ user, body }) {
  requireFields(body, ['intentId']);
  const intent = await getIntent(body.intentId);
  const me = await requireRole(user.id, intent.project_id, INSIDERS);
  if (intent.user_id !== user.id && !isManager(me)) throw new HttpError(403, 'Only its owner or an admin can release this');
  await releaseIntents([intent.id]);
  return { released: true };
}

// GET /api/coordination/board?projectId=   -> live "who is working on what"
export async function board({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  const [intents, agents] = await Promise.all([
    activeIntents(query.projectId),
    q(db.from('agents').select('id,user_id,kind,status,current_activity,updated_at').eq('project_id', query.projectId)),
  ]);
  const names = await namesFor([...intents.map((i) => i.user_id), ...agents.map((a) => a.user_id)]);
  return {
    work: intents.map((i) => ({
      intentId: i.id, who: names[i.user_id], userId: i.user_id, goal: i.goal,
      targets: i.targets, areas: i.targets.map(humanizeKey), basedOnVersion: i.base_version, since: i.created_at,
    })),
    agents: agents.map((a) => ({ ...a, owner: names[a.user_id] })),
  };
}
