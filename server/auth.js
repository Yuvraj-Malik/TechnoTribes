// Who am I, and which projects am I part of?
import { db, q } from '../api/_lib/supabase-admin.js';

// GET /api/auth/me
export async function me({ user }) {
  const [profile, memberships] = await Promise.all([
    q(db.from('profiles').select('*').eq('id', user.id)),
    q(db.from('project_members').select('project_id,role,status,projects(name,description)').eq('user_id', user.id)),
  ]);
  return {
    user: profile[0] || { id: user.id, email: user.email },
    projects: memberships.map((m) => ({
      projectId: m.project_id, role: m.role, status: m.status,
      name: m.projects?.name, description: m.projects?.description,
    })),
  };
}
