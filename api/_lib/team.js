// Departments and who is acting. Managers are `admin` members with a
// department; developers are `worker` members with a department.
// Demo mode: the project owner may act as a demo person (profiles.is_demo) by
// sending the `x-act-as` header. Real people can never be impersonated.
import { db, q } from './supabase-admin.js';
import { HttpError } from './errors.js';
import { getMembership } from './permissions.js';
import { displayName } from './http.js';

export async function listDepartments(projectId) {
  const rows = await q(db.from('departments').select('*').eq('project_id', projectId).order('position'));
  return rows.map((d) => ({ id: d.slug, name: d.name, managerId: d.manager_id, color: d.color, paths: d.paths }));
}

/**
 * Every project has at least one department ("General"), so every admin and
 * worker always has a workspace. Returns the slug new members should join.
 */
export async function ensureDefaultDepartment(projectId) {
  const rows = await q(db.from('departments').select('slug,position').eq('project_id', projectId).order('position'));
  if (rows.some((d) => d.slug === 'general')) return 'general';
  if (rows.length) return rows[0].slug;
  await q(db.from('departments').upsert(
    { project_id: projectId, slug: 'general', name: 'General', color: '#1b7f4a', paths: [], position: 0 },
    { onConflict: 'project_id,slug', ignoreDuplicates: true },
  ));
  await q(db.from('scope_versions').upsert({ project_id: projectId, scope: 'general', version: 1 }, { onConflict: 'project_id,scope', ignoreDuplicates: true }));
  return 'general';
}

/** Puts an admin/worker who has no department into the default one (and makes an admin its manager if it has none). */
export async function placeInDepartment(projectId, userId, role) {
  if (role !== 'admin' && role !== 'worker') return null;
  const slug = await ensureDefaultDepartment(projectId);
  await q(db.from('project_members').update({ department: slug }).eq('project_id', projectId).eq('user_id', userId).is('department', null));
  if (role === 'admin') {
    await q(db.from('departments').update({ manager_id: userId }).eq('project_id', projectId).eq('slug', slug).is('manager_id', null));
  }
  return slug;
}

export async function getDepartment(projectId, slug) {
  return (await listDepartments(projectId)).find((d) => d.id === slug);
}

/** Everyone in the project, with name, role and department. */
export async function listPeople(projectId) {
  const rows = await q(db.from('project_members')
    .select('user_id,role,department,status,context_seen_at,profiles(display_name,email,is_demo)')
    .eq('project_id', projectId).eq('status', 'active'));
  return rows.map((r) => ({
    id: r.user_id, name: r.profiles?.display_name || r.profiles?.email || 'Someone', role: r.role,
    department: r.department, isDemo: !!r.profiles?.is_demo, contextSeenAt: r.context_seen_at,
    isManager: r.role === 'admin' && !!r.department, isDeveloper: r.role === 'worker' && !!r.department,
  }));
}

/**
 * The person this request acts as. Returns { id, name, role, department,
 * isManager, isDeveloper, realUserId, actingAs }.
 */
export async function teamActor({ user, req, projectId }) {
  if (!projectId) throw new HttpError(400, 'projectId is required');
  const me = await getMembership(user.id, projectId);
  if (!me) throw new HttpError(403, 'You are not a member of this project');
  if ((me.role === 'admin' || me.role === 'worker') && !me.department) {
    me.department = await placeInDepartment(projectId, me.user_id, me.role);
  }
  const actAs = req?.headers?.['x-act-as'];
  let member = me;
  let name = displayName(user);
  if (actAs && actAs !== user.id) {
    if (me.role !== 'owner') throw new HttpError(403, 'Only the project owner can use demo mode');
    const target = await getMembership(actAs, projectId);
    const profile = (await q(db.from('profiles').select('display_name,is_demo').eq('id', actAs)))[0];
    if (!target || !profile?.is_demo) throw new HttpError(403, 'You can only act as demo people');
    member = target;
    name = profile.display_name;
  } else {
    const profile = (await q(db.from('profiles').select('display_name,email').eq('id', user.id)))[0];
    name = profile?.display_name || profile?.email || name;
  }
  return {
    id: member.user_id, name, role: member.role, department: member.department ?? null,
    isManager: (member.role === 'admin' && !!member.department) || member.role === 'owner',
    isDeveloper: member.role === 'worker' && !!member.department,
    realUserId: user.id, actingAs: member.user_id !== user.id,
  };
}

export function requireDeveloper(actor) {
  if (!actor.isDeveloper) throw new HttpError(403, 'Only developers (workers in a department) have an agent workspace');
}

export function requireManagerOf(actor, department) {
  const ok = (actor.role === 'admin' && actor.department === department) || actor.role === 'owner';
  if (!ok) throw new HttpError(403, `Only the ${department} manager can do this`);
}
