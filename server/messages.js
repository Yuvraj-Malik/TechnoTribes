// Messages from the owner to one admin or to all of them.
// Each message also creates a notification, so admins see it right away.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, displayName } from '../api/_lib/http.js';
import { requireRole, OWNER, MANAGERS } from '../api/_lib/permissions.js';
import { membersWithRole, namesFor, notify } from '../api/_lib/log.js';
import { resolveRecipients } from '../api/_lib/messages.js';

// POST /api/messages/send  { projectId, to: 'all' | userId, text }   (owner)
export async function send({ user, body }) {
  requireFields(body, ['projectId', 'to', 'text']);
  await requireRole(user.id, body.projectId, OWNER);
  const text = String(body.text).trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'Write a message first');

  const recipients = resolveRecipients(body.to, await membersWithRole(body.projectId, ['admin']));
  const message = await q(db.from('messages').insert({
    project_id: body.projectId,
    sender_id: user.id,
    recipient_ids: recipients,
    to_all: body.to === 'all',
    text,
  }).select().single());

  await notify(recipients.map((id) => ({
    user_id: id, project_id: body.projectId, kind: 'owner_message',
    title: `Message from ${displayName(user)}`, body: text,
  })));
  return { message };
}

// GET /api/messages/list?projectId=   (owner: everything sent; admin: what was sent to them)
export async function list({ user, query }) {
  const me = await requireRole(user.id, query.projectId, MANAGERS);
  let builder = db.from('messages').select('*').eq('project_id', query.projectId)
    .order('created_at', { ascending: false }).limit(100);
  if (me.role === 'admin') builder = builder.contains('recipient_ids', [user.id]);
  const rows = await q(builder);
  const names = await namesFor(rows.flatMap((m) => [m.sender_id, ...m.recipient_ids]));
  return {
    messages: rows.map((m) => ({
      ...m,
      senderName: names[m.sender_id] || null,
      recipientNames: m.recipient_ids.map((id) => names[id]).filter(Boolean),
    })),
  };
}
