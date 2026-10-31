// Projects, codes, membership and the project brief.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, displayName } from '../api/_lib/http.js';
import { requireRole, OWNER, MANAGERS, INSIDERS, EVERYONE } from '../api/_lib/permissions.js';
import { makeCode } from '../api/_lib/codes.js';
import { notify, managersOf, ownerOf, ensureAgents, addHistory, namesFor } from '../api/_lib/log.js';
import { commitChange, getState } from '../api/_lib/moderator.js';
import { propagateChange } from '../api/_lib/coordination.js';
import { reqKey } from '../api/_lib/paths.js';

// POST /api/projects/create  { name, description?, brief?, repo?: {owner,name,branch} }
export async function create({ user, body }) {
  requireFields(body, ['name']);
  const project = await q(db.from('projects').insert({
    name: String(body.name).slice(0, 120),
    description: body.description || null,
    owner_id: user.id,
    observer_code: makeCode('OBS'),
    repo_owner: body.repo?.owner || null,
    repo_name: body.repo?.name || null,
    default_branch: body.repo?.branch || 'main',
  }).select().single());
  await q(db.from('project_members').insert({ project_id: project.id, user_id: user.id, role: 'owner', status: 'active' }));
  await q(db.from('project_state').insert({ project_id: project.id, brief: body.brief || {}, files: {} }));
  await addHistory(project.id, user.id, 'project_created', { name: project.name });
  return { project, observerCode: project.observer_code };
}

// GET /api/projects/get?projectId=
export async function get({ user, query }) {
  const me = await requireRole(user.id, query.projectId, EVERYONE);
  const project = await q(db.from('projects').select('*').eq('id', query.projectId).single());
  if (me.role !== 'owner') delete project.observer_code;
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
//   OBS-...  -> becomes the project's observer (only one per project)
//   ADM-...  -> becomes an admin, pending the owner's approval
export async function join({ user, body }) {
  requireFields(body, ['code']);
  const code = String(body.code).trim().toUpperCase();

  if (code.startsWith('OBS-')) {
    const project = (await q(db.from('projects').select('id,name').eq('observer_code', code)))[0];
    if (!project) throw new HttpError(404, 'Observer code not found');
    const members = await q(db.from('project_members').select('*').eq('project_id', project.id));
    const mine = members.find((m) => m.user_id === user.id);
    if (mine?.role === 'observer') return { projectId: project.id, projectName: project.name, role: 'observer', status: 'active' };
    if (mine) throw new HttpError(409, 'You are already part of this project in another role');
    if (members.some((m) => m.role === 'observer')) throw new HttpError(409, 'This project already has an observer');
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
  await ensureAgents(body.projectId, body.userId);
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
  await requireRole(user.id, request.project_id, MANAGERS);
  const accept = body.accept !== false;
  await q(db.from('join_requests').update({ status: accept ? 'accepted' : 'rejected', decided_by: user.id }).eq('id', request.id));
  if (accept) {
    await q(db.from('project_members').insert({ project_id: request.project_id, user_id: request.user_id, role: 'worker', status: 'active' }));
    await ensureAgents(request.project_id, request.user_id);
  }
  await notify([{
    user_id: request.user_id, project_id: request.project_id, kind: 'join_result',
    title: accept ? 'You joined the project as a worker' : 'Your request to join was declined',
  }]);
  return { accepted: accept };
}

// POST /api/projects/members/add  { projectId, email }   (owner/admin) -> adds a worker directly
export async function addWorker({ user, body }) {
  requireFields(body, ['projectId', 'email']);
  await requireRole(user.id, body.projectId, MANAGERS);
  const profile = (await q(db.from('profiles').select('id').eq('email', String(body.email).toLowerCase())))[0];
  if (!profile) throw new HttpError(404, 'No account with that email. Ask them to sign up first');
  const existing = await q(db.from('project_members').select('id').eq('project_id', body.projectId).eq('user_id', profile.id));
  if (existing.length) throw new HttpError(409, 'This person is already part of the project');
  await q(db.from('project_members').insert({ project_id: body.projectId, user_id: profile.id, role: 'worker', status: 'active' }));
  await ensureAgents(body.projectId, profile.id);
  await notify([{ user_id: profile.id, project_id: body.projectId, kind: 'added', title: 'You were added to a project as a worker' }]);
  return { userId: profile.id, role: 'worker' };
}

// GET /api/projects/members?projectId=   (insiders)
export async function members({ user, query }) {
  const me = await requireRole(user.id, query.projectId, INSIDERS);
  const rows = await q(db.from('project_members').select('user_id,role,status,created_at').eq('project_id', query.projectId));
  const agents = await q(db.from('agents').select('id,user_id,kind,status,current_activity,updated_at').eq('project_id', query.projectId));
  const requests = ['owner', 'admin'].includes(me.role)
    ? await q(db.from('join_requests').select('*').eq('project_id', query.projectId).eq('status', 'pending'))
    : [];
  const names = await namesFor([...rows.map((r) => r.user_id), ...requests.map((r) => r.user_id)]);
  return {
    members: rows.map((r) => ({
      ...r, name: names[r.user_id] || null,
      agents: agents.filter((a) => a.user_id === r.user_id),
    })),
    joinRequests: requests.map((r) => ({ ...r, name: names[r.user_id] || null })),
  };
}

// POST /api/projects/brief/preview  { projectId, brief }   (owner/admin)
// Shows what a requirement change WOULD affect, before saving it.
export async function previewBrief({ user, body }) {
  requireFields(body, ['projectId', 'brief']);
  await requireRole(user.id, body.projectId, MANAGERS);
  const state = await getState(body.projectId);
  const changed = Object.keys(body.brief).filter(
    (k) => JSON.stringify((state.brief || {})[k]) !== JSON.stringify(body.brief[k]),
  );
  const impact = await propagateChange(
    body.projectId, changed.map(reqKey), state.current_version + 1, user.id, '', { dryRun: true },
  );
  return { changedFields: changed, impact };
}

// POST /api/projects/brief  { projectId, brief, reason? }   (owner/admin)
// Saves a requirement change as a new version and marks dependent work stale.
export async function updateBrief({ user, body }) {
  requireFields(body, ['projectId', 'brief']);
  if (typeof body.brief !== 'object' || Array.isArray(body.brief)) throw new HttpError(400, 'brief must be an object');
  await requireRole(user.id, body.projectId, MANAGERS);
  const fields = Object.keys(body.brief);
  const result = await commitChange({
    projectId: body.projectId,
    actorId: user.id,
    submittedBy: user.id,
    kind: 'brief',
    summary: `${displayName(user)} changed the project requirements: ${fields.join(', ')}`,
    reason: body.reason || '',
    briefPatch: body.brief,
  });
  if (result.unchanged) return { changed: false, version: result.version };
  const impact = await propagateChange(
    body.projectId, result.changedKeys, result.version, user.id,
    `${displayName(user)} changed the requirements (${fields.join(', ')}).`,
  );
  await addHistory(body.projectId, user.id, 'brief_changed', { fields, version: result.version });
  return { changed: true, version: result.version, observerSummary: result.observerSummary, impact };
}
