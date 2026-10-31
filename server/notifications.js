// Notifications for every role. The frontend can also subscribe to the
// notifications table with Supabase Realtime for live updates.
import { db, q } from '../api/_lib/supabase-admin.js';
import { asArray } from '../api/_lib/http.js';

// GET /api/notifications/list?projectId=&unread=true
export async function list({ user, query }) {
  let builder = db.from('notifications').select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(100);
  if (query.projectId) builder = builder.eq('project_id', query.projectId);
  if (query.unread === 'true') builder = builder.eq('read', false);
  return { notifications: await q(builder) };
}

// POST /api/notifications/read  { ids: [] }  or  { all: true }
export async function markRead({ user, body }) {
  let builder = db.from('notifications').update({ read: true }).eq('user_id', user.id);
  if (!body.all) builder = builder.in('id', asArray(body.ids));
  const rows = await q(builder.select('id'));
  return { updated: rows.length };
}
