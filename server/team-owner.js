// The owner's tools: messages to admins, job titles, and the Code page.
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { listPeople, teamActor } from '../api/_lib/team.js';
import { listSections, outdatedSince } from '../api/_lib/context.js';
import { readAll } from '../api/_lib/files.js';
import { devTasks, workSubmissions } from '../api/_lib/records.js';
import { notify } from '../api/_lib/log.js';
import { resolveRecipients } from '../api/_lib/messages.js';
import { buildBranches, buildLog, buildPeople, fileEdges } from '../api/_lib/code.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;

async function ownerActor(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  if (actor.role !== 'owner') throw new HttpError(403, 'Only the project owner can do this');
  return { actor, projectId };
}

// POST /api/team/messages/send { projectId, to: 'all' | userId, text }   (owner)
export async function sendMessage(ctx) {
  requireFields(ctx.body, ['projectId', 'to', 'text']);
  const { actor, projectId } = await ownerActor(ctx);
  const text = String(ctx.body.text).trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'Write a message first');
  const admins = (await listPeople(projectId)).filter((p) => p.role === 'admin').map((p) => p.id);
  const recipients = resolveRecipients(ctx.body.to, admins);
  const message = (await q(db.from('messages').insert({
    project_id: projectId, sender_id: actor.id, recipient_ids: recipients, to_all: ctx.body.to === 'all', text,
  }).select()))[0];
  await notify(recipients.map((id) => ({
    user_id: id, project_id: projectId, kind: 'owner_message', title: `Message from ${actor.name}`, body: text,
  })));
  return { message };
}

// GET /api/team/messages?projectId   (owner: everything sent; admin: what was sent to them)
export async function listMessages(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  if (actor.role !== 'owner' && actor.role !== 'admin') throw new HttpError(403, 'Only the owner and admins have messages');
  const [rows, people] = await Promise.all([
    q(db.from('messages').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(200)),
    listPeople(projectId),
  ]);
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? 'Someone';
  return {
    messages: rows.filter((m) => actor.role === 'owner' || m.recipient_ids.includes(actor.id)).map((m) => ({
      id: m.id, text: m.text, toAll: m.to_all, senderId: m.sender_id, senderName: nameOf(m.sender_id),
      recipientNames: m.recipient_ids.map(nameOf), at: m.created_at,
    })),
  };
}

// POST /api/team/members/designation { projectId, userId, designation }   (owner; empty clears it)
export async function setDesignation(ctx) {
  requireFields(ctx.body, ['projectId', 'userId']);
  const { projectId } = await ownerActor(ctx);
  const member = (await listPeople(projectId)).find((p) => p.id === ctx.body.userId);
  if (!member) throw new HttpError(404, 'Active member not found');
  const designation = String(ctx.body.designation ?? '').trim().slice(0, 60) || null;
  await q(db.from('project_members').update({ designation }).eq('project_id', projectId).eq('user_id', member.id));
  return { designation };
}

// GET /api/team/code?projectId   (branches, files, dependencies and everyone's progress)
export async function code(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  if (actor.role === 'observer') throw new HttpError(403, 'The code view is for the team');
  const [people, files, commits, tasks, submissions, assignments, sections] = await Promise.all([
    listPeople(projectId),
    readAll(projectId, 'main'),
    q(db.from('main_commits').select('*').eq('project_id', projectId)),
    devTasks.list(projectId, {}, 300),
    workSubmissions.list(projectId, {}, 300),
    q(db.from('tasks').select('id,title,status,assignee_id').eq('project_id', projectId).order('created_at', { ascending: false })),
    listSections(projectId),
  ]);
  const checked = await Promise.all(tasks.map(async (t) => ({
    ...t, outdated: t.builtOn && t.status !== 'approved' ? (await outdatedSince(projectId, t.builtOn, sections)).length > 0 : false,
  })));
  const log = buildLog(commits, people);
  const branches = buildBranches({ tasks: checked, submissions, log });
  return {
    version: log[0]?.version ?? 0,
    log,
    files: Object.keys(files).sort(),
    edges: fileEdges(files),
    branches,
    people: buildPeople({ people, assignments, submissions, branches }),
  };
}
