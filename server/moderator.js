// Moderator endpoints: the context packet, the permanent log, and the graph.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { asArray } from '../api/_lib/http.js';
import { requireRole, INSIDERS, ENGINEERS } from '../api/_lib/permissions.js';
import { buildContext, getState } from '../api/_lib/moderator.js';
import { loadGraph } from '../api/_lib/dependency-graph.js';
import { normalizePath, fileKey, keyToPath } from '../api/_lib/paths.js';
import { namesFor } from '../api/_lib/log.js';

// GET /api/moderator/context?projectId=&targets=src/a.jsx,src/b.jsx&taskId=
// What an agent (or a returning human) needs before starting work.
export async function context({ user, query }) {
  await requireRole(user.id, query.projectId, ENGINEERS);
  let targets;
  try { targets = asArray(query.targets).map((p) => fileKey(normalizePath(p))); } catch (e) { throw new HttpError(400, e.message); }
  const ctx = await buildContext({ projectId: query.projectId, userId: user.id, targets, taskId: query.taskId || null });
  return { ...ctx, missing: ctx.missing.map(keyToPath) };
}

// GET /api/moderator/log?projectId=&limit=50&before=<version>
export async function log({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  let builder = db.from('moderator_log')
    .select('version,kind,summary,reason,observer_summary,targets,changes,merge_request_id,submitted_by,approved_by,created_at')
    .eq('project_id', query.projectId).order('version', { ascending: false })
    .limit(Math.min(Number(query.limit) || 50, 200));
  if (query.before) builder = builder.lt('version', Number(query.before));
  const entries = await q(builder);
  const names = await namesFor(entries.flatMap((e) => [e.submitted_by, e.approved_by]));
  return {
    entries: entries.map((e) => ({ ...e, submittedByName: names[e.submitted_by], approvedByName: names[e.approved_by] })),
  };
}

// GET /api/moderator/state?projectId=   -> current approved files + brief
export async function state({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  const s = await getState(query.projectId);
  return { version: s.current_version, brief: s.brief, files: s.files, updatedAt: s.updated_at };
}

// GET /api/moderator/graph?projectId=
export async function graph({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  return loadGraph(query.projectId);
}
