// Projects, codes, membership and the project brief.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, displayName } from '../api/_lib/http.js';
import { requireRole, OWNER, MANAGERS, INSIDERS, EVERYONE } from '../api/_lib/permissions.js';
import { makeCode } from '../api/_lib/codes.js';
import { notify, managersOf, ownerOf, namesFor } from '../api/_lib/log.js';
import { ensureDefaultDepartment, placeInDepartment } from '../api/_lib/team.js';
import { insertSection } from '../api/_lib/context.js';
import { logEvent } from '../api/_lib/activity.js';

const BRIEF_LABELS = { product: 'Product', audience: 'Audience', tone: 'Tone', goal: 'Goal' };
const briefText = (brief) => Object.entries(brief || {})
  .filter(([, v]) => String(v ?? '').trim())
  .map(([k, v]) => `${BRIEF_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1)}: ${String(v).trim()}`)
  .join('\n');

// POST /api/projects/create  { name, description?, brief?: {product, audience, tone, goal}, repo? }
// The creator becomes the owner. Every project starts with a "General" department
// and a Central "Project brief" context section that the agents read.
export async function create({ user, body }) {
  requireFields(body, ['name']);
  const project = await q(db.from('projects').insert({
    name: String(body.name).slice(0, 120),
    description: body.description || null,
    owner_id: user.id,
    observer_code: makeCode('OBS'),
    project_code: makeCode('PRJ'),
    repo_owner: body.repo?.owner || null,
    repo_name: body.repo?.name || null,
    default_branch: body.repo?.branch || 'main',
  }).select().single());
  await q(db.from('project_members').insert({ project_id: project.id, user_id: user.id, role: 'owner', status: 'active' }));
  await ensureDefaultDepartment(project.id);
  const content = briefText(body.brief) || `${project.name}${project.description ? `: ${project.description}` : ''}`;
  await insertSection(project.id, {
    id: 'c-brief', scope: 'central', title: 'Project brief', content, why: 'Set when the project was created',
    ownerId: user.id, tags: ['*'], guardrails: [],
  }, 0);
  await q(db.from('scope_versions').upsert({ project_id: project.id, scope: 'central', version: 1 }, { onConflict: 'project_id,scope', ignoreDuplicates: true }));
  await logEvent(project.id, { type: 'seed', actorId: user.id, summary: `${displayName(user)} created the project ${project.name}` });
  return { project, observerCode: project.observer_code, projectCode: project.project_code };
}

// GET /api/projects/get?projectId=
export async function get({ user, query }) {
  const me = await requireRole(user.id, query.projectId, EVERYONE);
  const project = await q(db.from('projects').select('*').eq('id', query.projectId).single());
  if (me.role !== 'owner') {
    delete project.observer_code;
    delete project.project_code;
  }
  return { project, role: me.role };
}

// POST /api/projects/observer-code  { projectId }   (owner) -> new code, old one stops working
export async function regenerateObserverCode({ user, body }) {
  await requireRole(user.id, body.projectId, OWNER);
  const code = makeCode('OBS');
  await q(db.from('projects').update({ observer_code: code }).eq('id', body.projectId));
  return { observerCode: code };
}

// POST /api/projects/admin-code  { projectId, expiresInDays? }   (owner)
export async function createAdminCode({ user, body }) {
  await requireRole(user.id, body.projectId, OWNER);
  const days = Math.min(Math.max(Number(body.expiresInDays) || 7, 1), 30);
  const row = await q(db.from('admin_codes').insert({
    project_id: body.projectId,
    code: makeCode('ADM'),
    created_by: user.id,
    expires_at: new Date(Date.now() + days * 86400000).toISOString(),
  }).select().single());
  return { code: row.code, expiresAt: row.expires_at };
}

// POST /api/projects/join  { code }
//   OBS-...  -> anyone with it can observe the project. Not in it yet: joins as an observer.
//               Already a member (worker, admin, owner): keeps their role and opens the observer view.
//   ADM-...  -> becomes an admin, pending the owner's approval
export async function join({ user, body }) {
  requireFields(body, ['code']);
  const code = String(body.code).trim().toUpperCase();

  if (code.startsWith('OBS-')) {
    const project = (await q(db.from('projects').select('id,name').eq('observer_code', code)))[0];
    if (!project) throw new HttpError(404, 'Observer code not found');
    const members = await q(db.from('project_members').select('*').eq('project_id', project.id));
    const mine = members.find((m) => m.user_id === user.id);
    if (mine) return { projectId: project.id, projectName: project.name, role: mine.role, status: mine.status, observing: true };
    await q(db.from('project_members').insert({ project_id: project.id, user_id: user.id, role: 'observer', status: 'active' }));
    return { projectId: project.id, projectName: project.name, role: 'observer', status: 'active' };
  }

  if (code.startsWith('ADM-')) {
    const row = (await q(db.from('admin_codes').select('*').eq('code', code)))[0];
    if (!row || row.used_by || new Date(row.expires_at) < new Date()) {
      throw new HttpError(404, 'This admin code is invalid, already used or expired');
    }
    const existing = await q(db.from('project_members').select('id').eq('project_id', row.project_id).eq('user_id', user.id));
    if (existing.length) throw new HttpError(409, 'You are already part of this project');
    const claimed = await q(db.from('admin_codes').update({ used_by: user.id, used_at: new Date().toISOString() })
      .eq('id', row.id).is('used_by', null).select('id'));
    if (!claimed.length) throw new HttpError(409, 'This admin code was just used by someone else');
    await q(db.from('project_members').insert({ project_id: row.project_id, user_id: user.id, role: 'admin', status: 'pending' }));
    await notify([{
      user_id: await ownerOf(row.project_id), project_id: row.project_id, kind: 'admin_pending',
      title: 'New admin waiting for approval', body: `${displayName(user)} used an admin code and needs your approval.`,
    }]);
    return { projectId: row.project_id, role: 'admin', status: 'pending' };
  }

  throw new HttpError(400, 'Codes start with OBS- (observer) or ADM- (admin)');
}

// POST /api/projects/admins/approve  { projectId, userId, approve: true|false }   (owner)
export async function approveAdmin({ user, body }) {
  requireFields(body, ['projectId', 'userId']);
  await requireRole(user.id, body.projectId, OWNER);
  const member = (await q(db.from('project_members').select('*')
    .eq('project_id', body.projectId).eq('user_id', body.userId).eq('role', 'admin')))[0];
  if (!member) throw new HttpError(404, 'No admin request from this person');

  if (body.approve === false) {
    await q(db.from('project_members').delete().eq('id', member.id));
    await notify([{ user_id: body.userId, project_id: body.projectId, kind: 'admin_rejected', title: 'Admin request declined' }]);
    return { approved: false };
  }
  await q(db.from('project_members').update({ status: 'active' }).eq('id', member.id));
  await placeInDepartment(body.projectId, body.userId, 'admin');
  await notify([{ user_id: body.userId, project_id: body.projectId, kind: 'admin_approved', title: 'You are now an admin on this project' }]);
  return { approved: true };
}

// POST /api/projects/join-request  { projectId, message? }   (anyone signed in)
export async function requestToJoin({ user, body }) {
  requireFields(body, ['projectId']);
  const existing = await q(db.from('project_members').select('id').eq('project_id', body.projectId).eq('user_id', user.id));
  if (existing.length) throw new HttpError(409, 'You are already part of this project');
  const request = await q(db.from('join_requests').insert({
    project_id: body.projectId, user_id: user.id, message: body.message || null,
  }).select().single());
  await notify((await managersOf(body.projectId)).map((id) => ({
    user_id: id, project_id: body.projectId, kind: 'join_request',
    title: 'Someone wants to join as a worker', body: `${displayName(user)}: ${body.message || 'no message'}`,
  })));
  return { request };
}

// POST /api/projects/join-request/respond  { requestId, accept }   (owner/admin)
export async function respondJoinRequest({ user, body }) {
  requireFields(body, ['requestId']);
  const request = (await q(db.from('join_requests').select('*').eq('id', body.requestId)))[0];
  if (!request || request.status !== 'pending') throw new HttpError(404, 'Pending request not found');
  const me = await requireRole(user.id, request.project_id, MANAGERS);
  const accept = body.accept !== false;
  await q(db.from('join_requests').update({ status: accept ? 'accepted' : 'rejected', decided_by: user.id }).eq('id', request.id));
  if (accept) {
    // An admin's new worker joins the admin's department.
    await q(db.from('project_members').insert({
      project_id: request.project_id, user_id: request.user_id, role: 'worker', status: 'active',
      department: me.role === 'admin' ? me.department ?? null : body.department || null,
    }));
    await placeInDepartment(request.project_id, request.user_id, 'worker');
  }
  await notify([{
    user_id: request.user_id, project_id: request.project_id, kind: 'join_result',
    title: accept ? 'You joined the project as a worker' : 'Your request to join was declined',
  }]);
  return { accepted: accept };
}

// POST /api/projects/members/add  { projectId, email, department? }   (owner/admin) -> adds a worker directly
export async function addWorker({ user, body }) {
  requireFields(body, ['projectId', 'email']);
  const me = await requireRole(user.id, body.projectId, MANAGERS);
  const profile = (await q(db.from('profiles').select('id').eq('email', String(body.email).trim().toLowerCase())))[0];
  if (!profile) throw new HttpError(404, 'No account with that email. Ask them to sign up first');
  const existing = await q(db.from('project_members').select('id').eq('project_id', body.projectId).eq('user_id', profile.id));
  if (existing.length) throw new HttpError(409, 'This person is already part of the project');
  await q(db.from('project_members').insert({
    project_id: body.projectId, user_id: profile.id, role: 'worker', status: 'active',
    department: me.role === 'admin' ? me.department ?? null : body.department || null,
  }));
  await placeInDepartment(body.projectId, profile.id, 'worker');
  await notify([{ user_id: profile.id, project_id: body.projectId, kind: 'added', title: 'You were added to a project as a worker' }]);
  return { userId: profile.id, role: 'worker' };
}

// GET /api/projects/members?projectId=   (insiders)
// Everyone in the project with role, department and email; managers also get
// pending join requests and admins waiting for the owner's approval.
export async function members({ user, query }) {
  const me = await requireRole(user.id, query.projectId, INSIDERS);
  const manager = ['owner', 'admin'].includes(me.role);
  const [rows, departments, requests] = await Promise.all([
    q(db.from('project_members').select('user_id,role,status,department,created_at,profiles(display_name,email,is_demo)').eq('project_id', query.projectId)),
    q(db.from('departments').select('slug,name,color,manager_id').eq('project_id', query.projectId).order('position')),
    manager ? q(db.from('join_requests').select('*').eq('project_id', query.projectId).eq('status', 'pending')) : [],
  ]);
  const names = await namesFor(requests.map((r) => r.user_id));
  return {
    me: { role: me.role, department: me.department ?? null },
    departments: departments.map((d) => ({ id: d.slug, name: d.name, color: d.color, managerId: d.manager_id })),
    members: rows.map((r) => ({
      userId: r.user_id, role: r.role, status: r.status, department: r.department, joinedAt: r.created_at,
      name: r.profiles?.display_name || r.profiles?.email || 'Someone', email: manager ? r.profiles?.email ?? null : null,
      isDemo: !!r.profiles?.is_demo,
    })),
    joinRequests: requests.map((r) => ({ id: r.id, userId: r.user_id, name: names[r.user_id] || null, message: r.message, createdAt: r.created_at })),
  };
}

// POST /api/projects/update  { projectId, name?, description? }   (owner)
export async function update({ user, body }) {
  requireFields(body, ['projectId']);
  await requireRole(user.id, body.projectId, OWNER);
  const patch = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) throw new HttpError(400, 'The project name needs at least 2 characters');
    patch.name = name.slice(0, 120);
  }
  if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 1000) || null;
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
  await q(db.from('projects').update(patch).eq('id', body.projectId));
  const project = await q(db.from('projects').select('id,name,description').eq('id', body.projectId).single());
  return { project };
}

// POST /api/projects/project-code  { projectId }   (owner) -> new project ID; the old one stops working
export async function regenerateProjectCode({ user, body }) {
  await requireRole(user.id, body.projectId, OWNER);
  const code = makeCode('PRJ');
  await q(db.from('projects').update({ project_code: code }).eq('id', body.projectId));
  return { projectCode: code };
}

// POST /api/projects/members/remove  { projectId, userId }   (owner; admins: workers of their own department)
export async function removeMember({ user, body }) {
  requireFields(body, ['projectId', 'userId']);
  const me = await requireRole(user.id, body.projectId, MANAGERS);
  const target = (await q(db.from('project_members').select('*').eq('project_id', body.projectId).eq('user_id', body.userId)))[0];
  if (!target) throw new HttpError(404, 'This person is not in the project');
  if (target.role === 'owner') throw new HttpError(400, 'The owner cannot be removed');
  if (me.role === 'admin' && !(target.role === 'worker' && target.department === me.department)) {
    throw new HttpError(403, 'Admins can only remove workers of their own department');
  }
  await q(db.from('project_members').delete().eq('project_id', body.projectId).eq('user_id', body.userId));
  await q(db.from('departments').update({ manager_id: null }).eq('project_id', body.projectId).eq('manager_id', body.userId));
  await notify([{ user_id: body.userId, project_id: body.projectId, kind: 'removed', title: 'You were removed from a project' }]);
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Dashboard: browsing projects and opening one with its project ID
// ---------------------------------------------------------------------------

// GET /api/projects/discover?search=   -> projects you are NOT part of, so you can ask to join
export async function discover({ user, query }) {
  const [projects, memberships, mine, requests] = await Promise.all([
    q(db.from('projects').select('id,name,description,owner_id,created_at').order('created_at', { ascending: false }).limit(200)),
    q(db.from('project_members').select('project_id,role,status').eq('status', 'active')),
    q(db.from('project_members').select('project_id').eq('user_id', user.id)),
    q(db.from('join_requests').select('project_id,status,created_at').eq('user_id', user.id).eq('status', 'pending')),
  ]);
  const myIds = new Set(mine.map((m) => m.project_id));
  const search = String(query.search || '').trim().toLowerCase();
  const list = projects.filter((p) => !myIds.has(p.id)
    && (!search || p.name.toLowerCase().includes(search) || (p.description || '').toLowerCase().includes(search)));
  const owners = await namesFor(list.map((p) => p.owner_id));
  return {
    projects: list.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      owner: owners[p.owner_id] || null,
      members: memberships.filter((m) => m.project_id === p.id && m.role !== 'observer').length,
      createdAt: p.created_at,
      requestPending: requests.some((r) => r.project_id === p.id),
    })),
  };
}

// POST /api/projects/enter  { projectId, code }
// Opening a project requires the project ID the owner shared (e.g. PRJ-7K2QXM9P).
export async function enter({ user, body }) {
  requireFields(body, ['projectId', 'code']);
  const me = await requireRole(user.id, body.projectId, EVERYONE);
  const project = await q(db.from('projects').select('id,name,project_code').eq('id', body.projectId).single());
  if (String(body.code).trim().toUpperCase() !== project.project_code) {
    throw new HttpError(403, 'That project ID is not correct. Ask the project owner for it.');
  }
  return { project: { id: project.id, name: project.name }, role: me.role };
}

// GET /api/projects/my-requests   -> your own requests to join other projects
export async function myRequests({ user }) {
  const rows = await q(db.from('join_requests').select('id,project_id,message,status,created_at,projects(name)')
    .eq('user_id', user.id).order('created_at', { ascending: false }));
  return {
    requests: rows.map((r) => ({
      id: r.id, projectId: r.project_id, projectName: r.projects?.name || null,
      message: r.message, status: r.status, createdAt: r.created_at,
    })),
  };
}

// POST /api/projects/join-request/cancel  { requestId }
export async function cancelJoinRequest({ user, body }) {
  requireFields(body, ['requestId']);
  const rows = await q(db.from('join_requests').delete()
    .eq('id', body.requestId).eq('user_id', user.id).eq('status', 'pending').select('id'));
  if (!rows.length) throw new HttpError(404, 'Pending request not found');
  return { cancelled: true };
}
