// Personal history, notifications, member lookups and agent bookkeeping.
import { db, q } from './supabase-admin.js';

export async function addHistory(projectId, userId, kind, payload = {}) {
  await q(db.from('personal_history').insert({ project_id: projectId, user_id: userId, kind, payload }));
}

// rows: [{ user_id, project_id, kind, title, body }]
export async function notify(rows) {
  const clean = rows.filter((r) => r && r.user_id);
  if (clean.length) await q(db.from('notifications').insert(clean));
}

export async function membersWithRole(projectId, roles) {
  const rows = await q(
    db.from('project_members').select('user_id,role')
      .eq('project_id', projectId).eq('status', 'active').in('role', roles),
  );
  return rows.map((r) => r.user_id);
}

export const managersOf = (projectId) => membersWithRole(projectId, ['owner', 'admin']);
export const observerOf = async (projectId) => (await membersWithRole(projectId, ['observer']))[0] || null;
export const ownerOf = async (projectId) => (await membersWithRole(projectId, ['owner']))[0] || null;

// { userId: displayName }
export async function namesFor(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await q(db.from('profiles').select('id,display_name,email').in('id', ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.display_name || r.email]));
}

// Every admin and worker gets one Builder and one Critic.
