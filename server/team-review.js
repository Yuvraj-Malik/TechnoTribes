// Manager Review: queue, detail, approve (merge into main) / reject / send back,
// and the department overview.
import { HttpError } from '../api/_lib/errors.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { contextProposals, devTasks, workSubmissions } from '../api/_lib/records.js';
import { logEvent, notifyMany, toEvent } from '../api/_lib/activity.js';
import { listPeople, requireManagerOf, teamActor } from '../api/_lib/team.js';
import { getScopeVersions, guardrailConflicts, listSections, outdatedSince } from '../api/_lib/context.js';
import { readAll, threeWay, writeAll } from '../api/_lib/files.js';
import { buildProposal } from './team-impact.js';
import { syncAssignment } from '../api/_lib/assignments.js';

const nowIso = () => new Date().toISOString();

async function enrich(s, sections) {
  const open = s.status === 'pending' || s.status === 'merge_conflict';
  const task = await devTasks.get(s.taskId);
  const outdated = open ? await outdatedSince(s.projectId, s.builtOn, sections) : [];
  const used = sections.filter((x) => x.id in s.builtOn.sections);
  const conflicts = open && task ? guardrailConflicts(`${task.text} ${s.title} ${s.summary}`, used) : [];
  const proposal = (await contextProposals.list(s.projectId, { submission_id: s.id }, 1))[0] ?? null;
  return { ...s, outdated, conflicts, proposalId: proposal?.id ?? null, proposalStatus: proposal?.status ?? null };
}

async function managerActor(ctx, department) {
  const projectId = ctx.body?.projectId ?? ctx.query?.projectId;
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  requireManagerOf(actor, department ?? actor.department);
  return { actor, projectId };
}

// GET /api/team/review/queue?projectId[&department]
export async function queue(ctx) {
  const dept = ctx.query.department;
  const { actor, projectId } = await managerActor(ctx, dept);
  const department = dept ?? actor.department;
  const sections = await listSections(projectId);
  const order = { pending: 0, merge_conflict: 0, sent_back: 1, approved: 2, rejected: 2 };
  const items = await Promise.all((await workSubmissions.list(projectId, { department })).map((s) => enrich(s, sections)));
  return {
    items: items
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt))
      .map(({ diff: _diff, base: _base, changes: _changes, ...rest }) => rest),
  };
}

// GET /api/team/review/detail?projectId&submissionId
export async function detail(ctx) {
  const s = await workSubmissions.get(ctx.query.submissionId);
  if (!s) throw new HttpError(404, 'Submission not found');
  await managerActor({ ...ctx, query: { ...ctx.query, projectId: s.projectId } }, s.department);
  const sections = await listSections(s.projectId);
  const used = Object.entries(s.builtOn.sections).map(([sid, v]) => {
    const sec = sections.find((x) => x.id === sid);
    return { sectionId: sid, title: sec?.title ?? sid, scope: sec?.scope ?? '?', builtOnVersion: v, currentVersion: sec?.version ?? v };
  });
  const { base: _base, changes: _changes, ...sub } = await enrich(s, sections);
  return {
    submission: sub, task: await devTasks.get(s.taskId), used, currentScopes: await getScopeVersions(s.projectId),
    proposal: (await contextProposals.list(s.projectId, { submission_id: s.id }, 1))[0] ?? null,
  };
}

async function updateTask(s, patch, message) {
  const t = await devTasks.get(s.taskId);
  if (!t || t.submissionId !== s.id) return;
  if (message) t.messages.push({ from: 'manager', text: message, at: nowIso() });
  await devTasks.put({ ...t, ...patch, updatedAt: nowIso() });
  // The assigned task (if any) follows: approved -> done, sent back / rejected -> in progress.
  if (patch.status === 'approved' || patch.status === 'sent_back' || patch.status === 'rejected') {
    await syncAssignment(t, patch.status);
  }
}

/** Merges exactly what was submitted into main (3-way, file by file). */
async function mergeIntoMain(s, managerId, message) {
  const main = await readAll(s.projectId, 'main');
  const keep = (m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null));
  const merged = threeWay(keep(s.base), keep(s.changes), main);
  if (!merged.ok) return { ok: false, conflictedFiles: merged.conflicted };
  await writeAll(s.projectId, 'main', merged.files);
  const commit = (await q(db.from('main_commits').insert({ project_id: s.projectId, author_id: managerId, message, files: s.files }).select('id')))[0];
  return { ok: true, mergedId: commit.id };
}

// POST /api/team/review/decide { projectId, submissionId, action: approve|reject|send_back, note? }
export async function decide(ctx) {
  const s = await workSubmissions.get(ctx.body.submissionId);
  if (!s) throw new HttpError(404, 'Submission not found');
  const { actor: m } = await managerActor({ ...ctx, body: { ...ctx.body, projectId: s.projectId } }, s.department);
  if (s.status !== 'pending' && s.status !== 'merge_conflict') throw new HttpError(409, 'Already reviewed');
  const action = ctx.body.action;
  const note = String(ctx.body.note ?? '').trim();
  const outdated = await outdatedSince(s.projectId, s.builtOn);
  const base = { actorId: m.id, department: s.department, taskId: s.taskId, submissionId: s.id };

  if (action === 'reject' || action === 'send_back') {
    if (!note) throw new HttpError(400, action === 'reject' ? 'A note is required to reject' : 'Instructions are required to send back');
    const status = action === 'reject' ? 'rejected' : 'sent_back';
    Object.assign(s, { status, reviewNote: note, reviewedBy: m.id, reviewedAt: nowIso() });
    await workSubmissions.put(s);
    await updateTask(s, { status, reviewNote: note }, `${m.name}: ${note}`);
    await logEvent(s.projectId, {
      ...base, type: action === 'reject' ? 'review.rejected' : 'review.sent_back',
      summary: `${m.name} ${action === 'reject' ? 'rejected' : 'sent back'} ${s.userName}'s "${s.title}"${outdated.length ? ' (it was outdated)' : ''}: ${note}`,
      data: { note, outdated },
    });
    await notifyMany(s.projectId, [s.userId], { kind: 'review', title: action === 'reject' ? `Rejected: ${s.title}` : `Sent back: ${s.title}`, body: `${m.name}: ${note}` }, base);
    return { submission: s, proposal: null };
  }
  if (action !== 'approve') throw new HttpError(400, 'action must be approve, reject or send_back');

  // Never resolve conflicts silently: if main changed the same files, stop and show it.
  const merge = await mergeIntoMain(s, m.id, `Merge "${s.title}" by ${s.userName} (approved by ${m.name})`);
  if (!merge.ok) {
    Object.assign(s, { status: 'merge_conflict', mergeInfo: { conflictedFiles: merge.conflictedFiles, message: 'Main changed the same files since this was built.' } });
    await workSubmissions.put(s);
    await logEvent(s.projectId, {
      ...base, type: 'merge.conflict', summary: `Merging "${s.title}" into main hit conflicts in ${merge.conflictedFiles.join(', ')}. Nothing was merged; ${m.name} must decide.`,
      data: { conflictedFiles: merge.conflictedFiles },
    });
    return { submission: s, proposal: null };
  }
  Object.assign(s, { status: 'approved', reviewNote: note || null, reviewedBy: m.id, reviewedAt: nowIso(), mergeInfo: { mergedId: merge.mergedId } });
  await workSubmissions.put(s);
  await updateTask(s, { status: 'approved', reviewNote: note || null }, note ? `${m.name}: ${note}` : undefined);
  await logEvent(s.projectId, {
    ...base, type: 'review.approved',
    summary: `${m.name} approved ${s.userName}'s "${s.title}"${outdated.length ? ' even though it was built on older context' : ''}`,
    data: { note: note || null, outdated, builtOn: s.builtOn },
  });
  await logEvent(s.projectId, { ...base, type: 'merge.done', summary: `"${s.title}" merged into the main project`, data: { files: s.files, commitId: merge.mergedId } });
  await notifyMany(s.projectId, [s.userId], { kind: 'review', title: `Approved: ${s.title}`, body: `${m.name} approved and merged it into the main project.` }, base);
  return { submission: s, proposal: await buildProposal(s) };
}

// GET /api/team/review/overview?projectId[&department]  (who is doing what + incoming central changes)
export async function overview(ctx) {
  const dept = ctx.query.department;
  const { actor, projectId } = await managerActor(ctx, dept);
  const department = dept ?? actor.department;
  const people = (await listPeople(projectId)).filter((u) => u.department === department && u.isDeveloper);
  const developers = await Promise.all(people.map(async (u) => {
    const t = (await devTasks.list(projectId, { user_id: u.id }, 1))[0] ?? null;
    return {
      userId: u.id,
      task: t && { id: t.id, text: t.text, status: t.status, updatedAt: t.updatedAt, outdated: t.builtOn ? (await outdatedSince(projectId, t.builtOn)).length > 0 : false },
    };
  }));
  const impacts = await q(db.from('activity_log').select('*').eq('project_id', projectId).eq('type', 'impact.decision')
    .neq('department', department).order('id', { ascending: false }).limit(20));
  const incoming = impacts.map(toEvent).filter((e) => e.data.affectedDepartments?.includes(department));
  return { department, developers, incoming };
}
