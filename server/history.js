// Personal history: kept forever unless its owner deletes it.
// (Approved changes also live in the Moderator log, which can never be deleted.)
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, asArray } from '../api/_lib/http.js';
import { requireRole, INSIDERS } from '../api/_lib/permissions.js';

// GET /api/history/list?projectId=&limit=50&before=<ISO date>
export async function list({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  let builder = db.from('personal_history').select('*')
    .eq('project_id', query.projectId).eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(Math.min(Number(query.limit) || 50, 200));
  if (query.before) builder = builder.lt('created_at', query.before);
  return { entries: await q(builder) };
}

// POST /api/history/delete  { ids: [] }   (only your own entries)
export async function remove({ user, body }) {
  requireFields(body, ['ids']);
  const ids = asArray(body.ids);
  if (!ids.length) throw new HttpError(400, 'Nothing to delete');
  const deleted = await q(db.from('personal_history').delete().in('id', ids).eq('user_id', user.id).select('id'));
  return { deleted: deleted.length };
}
