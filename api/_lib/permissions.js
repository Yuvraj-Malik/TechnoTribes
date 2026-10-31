// Who can do what. Every endpoint calls requireRole before touching data.
import { db, q } from './supabase-admin.js';
import { HttpError } from './errors.js';

export const OWNER = ['owner'];
export const MANAGERS = ['owner', 'admin'];          // manage members, tasks, reviews
export const ENGINEERS = ['admin', 'worker'];        // have their own Builder + Critic
export const INSIDERS = ['owner', 'admin', 'worker'];
export const EVERYONE = ['owner', 'admin', 'worker', 'observer'];

export async function getMembership(userId, projectId) {
  const rows = await q(
    db.from('project_members').select('*')
      .eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').limit(1),
  );
  return rows[0] || null;
}

export async function requireRole(userId, projectId, allowed) {
  if (!projectId) throw new HttpError(400, 'projectId is required');
  const membership = await getMembership(userId, projectId);
  if (!membership || !allowed.includes(membership.role)) {
    throw new HttpError(403, `This action needs one of these roles: ${allowed.join(', ')}`);
  }
  return membership;
}

export const isManager = (membership) => MANAGERS.includes(membership?.role);
