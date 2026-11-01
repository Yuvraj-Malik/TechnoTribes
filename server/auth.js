// Who am I, and which projects am I part of?
import { db, q } from '../api/_lib/supabase-admin.js';

// GET /api/auth/me
export async function me({ user }) {
  const [profile, memberships] = await Promise.all([
    q(db.from('profiles').select('*').eq('id', user.id)),
    q(db.from('project_members')
      .select('project_id,role,status,created_at,projects(name,description,project_code,observer_code,created_at)')
      .eq('user_id', user.id)),
  ]);
  const ids = memberships.map((m) => m.project_id);
  const members = ids.length
    ? await q(db.from('project_members').select('project_id,role').in('project_id', ids).eq('status', 'active'))
    : [];
  return {
    user: profile[0] || { id: user.id, email: user.email },
    projects: memberships.map((m) => ({
      projectId: m.project_id,
      role: m.role,
      status: m.status,
      name: m.projects?.name,
      description: m.projects?.description,
      members: members.filter((x) => x.project_id === m.project_id && x.role !== 'observer').length,
      joinedAt: m.created_at,
      // Only the owner sees the codes they hand out.
      projectCode: m.role === 'owner' ? m.projects?.project_code : undefined,
      observerCode: m.role === 'owner' ? m.projects?.observer_code : undefined,
    })),
  };
}
