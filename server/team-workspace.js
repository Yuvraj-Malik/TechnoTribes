// Developer Workspace: task → read context → conflict check → plan → edits in
// the developer's isolated copy → review → submit. Each step runs inside its
// request (Vercel stops a function once it responds), and every step updates
// the task, writes the activity log, and notifies when needed.
import { HttpError } from '../api/_lib/errors.js';
import { devTasks, suggestions, workSubmissions } from '../api/_lib/records.js';
import { logEvent, notifyMany, toEvent } from '../api/_lib/activity.js';
import { getDepartment, listDepartments, listPeople, requireDeveloper, teamActor, workDepartment } from '../api/_lib/team.js';
import {
  builtOnFor, getScopeVersions, guardrailConflicts, listSections, mentions, outdatedSince, relevantSections,
} from '../api/_lib/context.js';
import {
  BASE, diffMaps, ensureWorkspace, isBehindMain, readAll, readOne, resetWorkspace, safePath, syncWithMain, workspaceDiff, writeEdits,
} from '../api/_lib/files.js';
import { agentMode, getTeamAgent } from '../api/_lib/team-agent/index.js';
import { critique } from '../api/_lib/team-agent/critic.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { getAssignment, syncAssignment } from '../api/_lib/assignments.js';
import { createSuggestion } from '../api/_lib/suggestions.js';
import { createRequest } from './team-requests.js';
import { search as searchPast } from '../api/_lib/search.js';
import { ownerOf } from '../api/_lib/log.js';

/** Statuses where the developer can start a fresh task. */
const FINISHED = ['submitted', 'approved', 'rejected', 'cancelled'];
const ACTIVE = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'reviewing', 'done', 'needs_context_decision', 'needs_action_approval', 'sent_back'];
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- helpers
export async function currentTask(projectId, userId) {
  return (await devTasks.list(projectId, { user_id: userId }, 1))[0];
}

export async function activeTask(projectId, userId) {
  const t = await currentTask(projectId, userId);
  return t && ACTIVE.includes(t.status) ? t : undefined;
}

async function mustGet(taskId, actor) {
  const t = await devTasks.get(taskId);
  if (!t) throw new HttpError(404, 'Task not found');
  if (t.userId !== actor.id) throw new HttpError(403, 'This is not your task');
  return t;
}

const say = (t, from, text) => { t.messages.push({ from, text, at: nowIso() }); };

/**
 * Saves a task. A context alert may have arrived (another request) while the
 * agent was working: keep it, and stop at the decision instead of carrying on.
 */
export async function saveTask(t, patch = {}) {
  Object.assign(t, patch, { updatedAt: nowIso() });
  const stored = await devTasks.get(t.id);
  if (stored?.contextAlert && !stored.contextAlert.resolution && stored.contextAlert.id !== t.contextAlert?.id) {
    t.contextAlert = stored.contextAlert;
    const seen = new Set(t.messages.map((m) => `${m.at}|${m.text}`));
    t.messages = [...t.messages, ...stored.messages.filter((m) => !seen.has(`${m.at}|${m.text}`))].sort((a, b) => a.at.localeCompare(b.at));
  }
  if (t.contextAlert && !t.contextAlert.resolution && (t.status === 'done' || t.status === 'awaiting_plan_approval')) {
    t.resumeStatus = t.status;
    t.status = 'needs_context_decision';
  }
  await devTasks.put(t);
  return t;
}

const taskLog = (t, type, summary, data = {}) => logEvent(t.projectId, {
  type, summary, actorId: type.startsWith('agent.') ? null : t.userId, department: t.department, taskId: t.id,
  data: { agentOf: t.userId, ...data },
});

async function sectionsOf(t) {
  const all = await listSections(t.projectId);
  return all.filter((s) => t.relevantSectionIds.includes(s.id));
}

async function agentInput(t, sections, extraFiles = []) {
  const department = await getDepartment(t.projectId, t.department);
  const files = await readAll(t.projectId, t.userId);
  const fileIndex = Object.keys(files).sort();
  // Departments with path filters see their area; otherwise the agent sees every file (capped).
  const inArea = department.paths?.length ? fileIndex.filter((f) => department.paths.some((p) => f.startsWith(p))) : fileIndex;
  let budget = 120000;
  const area = inArea.filter((f) => (budget -= files[f].length) >= 0);
  const wanted = new Set([...area, ...extraFiles]);
  return {
    task: t.text, user: { id: t.userId, name: t.userName }, department, sections, fileIndex, memory: t.memory ?? [],
    files: [...wanted].filter((p) => p in files).map((path) => ({ path, content: files[path] })),
  };
}

function dedupe(cs) {
  const seen = new Set();
  return cs.filter((c) => { const k = `${c.sectionId}:${c.explanation}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Runs an agent step; on failure marks the task failed with a plain message. */
async function step(t, fn) {
  try {
    await fn();
  } catch (err) {
    console.error('[team agent]', err);
    say(t, 'system', `The agent hit a problem: ${err.message}`);
    await saveTask(t, { status: 'failed' });
    await taskLog(t, 'agent.error', `Agent error on "${t.text}": ${err.message}`);
  }
  return t;
}

// ---------------------------------------------------------------- pipeline
async function intake(t) {
  const all = await listSections(t.projectId);
  const sections = relevantSections(all, t.text, t.department);
  const builtOn = await builtOnFor(t.projectId, sections.map((s) => s.id));
  say(t, 'agent', `I read ${sections.length} context sections that relate to this task: ${sections.map((s) => `${s.title} v${s.version}`).join(', ')}.`);
  await saveTask(t, { relevantSectionIds: sections.map((s) => s.id), builtOn, seenScopes: builtOn.scopes, acknowledged: {}, status: 'checking_conflicts' });
  await taskLog(t, 'agent.context_read', `${t.userName}'s agent read ${sections.length} relevant context sections`, {
    sections: sections.map((s) => ({ id: s.id, title: s.title, version: s.version, scope: s.scope })), builtOn,
  });

  // Past notes, decisions and rejected suggestions about the same thing, so the agent does not repeat a mistake.
  const memory = (await searchPast(t.projectId, t.text, { department: t.department, limit: 3 })).results;
  t.memory = memory.map((m) => ({ type: m.type, title: m.title, text: m.text }));
  if (memory.length) say(t, 'agent', `I also checked past notes: ${memory.map((m) => `“${m.title}” (${m.type})`).join('; ')}.`);
  const input = await agentInput(t, sections);
  const conflicts = dedupe([...guardrailConflicts(t.text, sections), ...(await getTeamAgent(t.projectId).checkConflicts(input))]);
  if (conflicts.length) {
    say(t, 'agent', `Before I start: ${conflicts.length === 1 ? 'this request conflicts' : `${conflicts.length} things conflict`} with the project context.`);
    await saveTask(t, { conflicts, status: 'needs_conflict_decision' });
    await taskLog(t, 'agent.conflict_warning', `Agent warned ${t.userName} before starting: ${conflicts.map((c) => c.sectionTitle).join(', ')}`, { conflicts, request: t.text });
    return;
  }
  say(t, 'agent', 'No conflicts with the current context.');
  await saveTask(t, { conflicts: [] });
  await planStep(t);
}

/**
 * Agents are aware of each other: other developers' active tasks that plan to
 * change (or already changed) the same files as this one.
 */
export async function peerOverlap(t) {
  const mine = new Set([...(t.plan?.files ?? []), ...(t.changedFiles ?? [])]);
  if (!mine.size) return [];
  const live = ACTIVE.filter((x) => x !== 'sent_back');
  const others = (await devTasks.list(t.projectId, { status: live }, 300)).filter((o) => o.userId !== t.userId);
  const seen = new Set();
  const out = [];
  for (const o of others) {
    if (seen.has(o.userId)) continue;
    seen.add(o.userId);
    const theirs = new Set([...(o.plan?.files ?? []), ...(o.changedFiles ?? [])]);
    const files = [...mine].filter((f) => theirs.has(f));
    if (files.length) out.push({ userId: o.userId, name: o.userName, department: o.department, taskId: o.id, task: o.text, files, status: o.status });
  }
  return out;
}

/**
 * File claims: when a plan is confirmed, the agent claims the files it will
 * change. Until that work is submitted, approved or cancelled, no other agent
 * may write them (first come, first served). Returns path -> holder.
 */
async function claimHolders(t) {
  const live = ACTIVE.filter((x) => x !== 'sent_back');
  const others = (await devTasks.list(t.projectId, { status: live }, 300)).filter((o) => o.userId !== t.userId && o.claims?.length);
  const held = new Map();
  for (const o of others) for (const f of o.claims) if (!held.has(f)) held.set(f, { userId: o.userId, name: o.userName, task: o.text, taskId: o.id });
  return held;
}

async function warnAboutPeers(t) {
  const peers = await peerOverlap(t);
  t.peers = peers;
  if (!peers.length) return;
  const list = peers.map((p) => `${p.name}'s agent is also changing ${p.files.join(', ')} for "${p.task}"`).join('; ');
  say(t, 'agent', `Heads up: ${list}. Talk to them before submitting, or your changes may clash at merge.`);
  await taskLog(t, 'agent.overlap_warning', `${t.userName}'s agent found overlapping work: ${list}`, { peers });
  await notifyMany(t.projectId, peers.map((p) => p.userId), {
    kind: 'overlap', title: `${t.userName}'s agent plans to change the same files`,
    body: `"${t.text}" touches ${[...new Set(peers.flatMap((p) => p.files))].join(', ')}, which your current task also changes.`,
  }, { actorId: t.userId, department: t.department, taskId: t.id });
}

/**
 * Before each agent step: did context the task uses change since the agent read
 * it? One cheap query when nothing changed (scope versions); otherwise only the
 * changed items are looked at. Changes the task depends on pause it with the
 * "context changed" card; other changes are just noted in the activity.
 * Returns true when the step must stop.
 */
async function contextMoved(t) {
  if (!t.builtOn) return false;
  const scopes = await getScopeVersions(t.projectId);
  const seen = t.seenScopes ?? t.builtOn.scopes ?? {};
  if (Object.entries(scopes).every(([k, v]) => (seen[k] ?? v) === v)) return false;
  const sections = await listSections(t.projectId);
  const ack = t.acknowledged ?? {};
  const changes = sections.flatMap((s) => {
    const base = Math.max(t.builtOn.sections?.[s.id] ?? 0, ack[s.id] ?? 0);
    return t.relevantSectionIds.includes(s.id) && base && s.version > base
      ? [{ sectionId: s.id, title: s.title, scope: s.scope, fromVersion: base, toVersion: s.version, why: s.why }]
      : [];
  });
  const moved = Object.keys(scopes).filter((k) => (seen[k] ?? scopes[k]) !== scopes[k]);
  t.seenScopes = scopes;
  if (!changes.length) {
    say(t, 'agent', `Picked up the latest context (${moved.map((k) => `${k === 'central' ? 'Central' : k} v${scopes[k]}`).join(', ')}). Nothing this task uses changed.`);
    await saveTask(t);
    return false;
  }
  await saveTask(t);
  const summary = changes.map((c) => `${c.title} changed (v${c.fromVersion} → v${c.toVersion}): ${c.why}`).join(' ');
  await raiseContextAlert(t.projectId, t.userId, changes, summary, []);
  Object.assign(t, await devTasks.get(t.id));
  return t.status === 'needs_context_decision';
}

/** A department's agents may only change files under its paths (no paths = the whole project). */
export const inArea = (department, path) => !department?.paths?.length || department.paths.some((p) => path.startsWith(p));

async function planStep(t) {
  if (await contextMoved(t)) return;
  await saveTask(t, { status: 'planning' });
  const plan = await getTeamAgent(t.projectId).plan(await agentInput(t, await sectionsOf(t)));
  // Say up front which planned files the agent will not be allowed to change.
  const department = await getDepartment(t.projectId, t.department);
  plan.outsideArea = (plan.files ?? []).filter((f) => !inArea(department, f));
  say(t, 'agent', 'Here is what I understood and what I will do. Confirm or edit it.');
  t.plan = plan;
  await warnAboutPeers(t);
  await saveTask(t, { plan, peers: t.peers ?? [], status: 'awaiting_plan_approval' });
  await taskLog(t, 'agent.plan', `Agent proposed a plan for "${t.text}"`, { plan });
}

async function workStep(t, followUp) {
  if (await contextMoved(t)) return;
  await saveTask(t, { status: 'working' });
  const input = await agentInput(t, await sectionsOf(t), t.plan?.files ?? []);
  const agent = getTeamAgent(t.projectId);
  const result = await agent.edit({ ...input, plan: t.plan, followUp, previousSummary: t.summary });
  t.builderModel = agent.lastModel ?? null;
  const all = result.edits.flatMap((e) => { try { return [{ path: safePath(e.path), content: e.content }]; } catch { return []; } });
  // Blocked, not just discouraged: files outside the department's area are never written.
  const inMyArea = all.filter((e) => inArea(input.department, e.path));
  const blocked = all.filter((e) => !inArea(input.department, e.path)).map((e) => e.path);
  // Files another agent has claimed are not written either.
  const held = await claimHolders(t);
  const edits = inMyArea.filter((e) => !held.has(e.path));
  const clashes = inMyArea.filter((e) => held.has(e.path)).map((e) => e.path);
  if (clashes.length) {
    const who = [...new Set(clashes.map((f) => held.get(f).name))].join(', ');
    say(t, 'system', `Not written: ${clashes.join(', ')} ${clashes.length === 1 ? 'is' : 'are'} claimed by ${who}'s agent. Wait for that work, change the plan, or ask your manager.`);
    t.blocked = [...(t.blocked ?? []), { files: clashes, at: new Date().toISOString(), heldBy: clashes.map((f) => held.get(f)) }];
    await logEvent(t.projectId, {
      type: 'permission.blocked', actorId: t.userId, department: t.department, level: 'department', taskId: t.id,
      title: `Blocked: ${t.userName}'s agent tried to change files another agent is working on`,
      plain: `${t.userName}'s agent tried to change ${clashes.join(', ')}, which ${who}'s agent is working on. Nothing was written.`,
      summary: `${t.userName}'s agent was blocked from ${clashes.join(', ')} (claimed by ${who})`,
      data: { agentOf: t.userId, files: clashes, reason: 'claimed', heldBy: clashes.map((f) => held.get(f)) },
    });
  }
  t.claims = [...new Set([...(t.claims ?? []), ...edits.map((e) => e.path)])];
  if (blocked.length) {
    const owner = (await listDepartments(t.projectId)).find((d) => d.id !== t.department && blocked.every((p) => inArea(d, p)));
    const hint = owner ? ` Send ${owner.name} a request instead.` : '';
    say(t, 'system', `Blocked: your agent tried to change ${blocked.join(', ')}, which is outside ${input.department.name}'s area.${hint}`);
    t.blocked = [...(t.blocked ?? []), { files: blocked, at: new Date().toISOString(), owner: owner?.id ?? null }];
    await logEvent(t.projectId, {
      type: 'permission.blocked', actorId: t.userId, department: t.department, level: 'department', taskId: t.id,
      title: `Blocked: ${t.userName}'s agent tried to change another area`,
      plain: `${t.userName}'s agent tried to change ${blocked.join(', ')}, which belongs to ${owner?.name ?? 'another department'}. Nothing was written.`,
      summary: `${t.userName}'s agent was blocked from changing ${blocked.join(', ')} (outside ${input.department.name})`,
      data: { agentOf: t.userId, files: blocked, ownerDepartment: owner?.id ?? null },
    });
  }
  // Irreversible actions (deleting files or data, deploying, messaging real users)
  // are never done on the agent's own: show what would happen and ask first.
  const current = await readAll(t.projectId, t.userId);
  const risky = irreversible(edits, current);
  if (risky.length) {
    const preview = diffMaps(Object.fromEntries(edits.map((e) => [e.path, current[e.path]]).filter(([, v]) => v !== undefined)),
      Object.fromEntries(edits.filter((e) => e.content !== null).map((e) => [e.path, e.content])));
    t.pendingAction = { edits, result, followUp: followUp ?? null, reasons: risky, diff: preview.diff, at: new Date().toISOString() };
    say(t, 'agent', `Before I do this, I need your OK: ${risky.map((r) => r.what).join('; ')}. Nothing has been written yet.`);
    await saveTask(t, { status: 'needs_action_approval' });
    await taskLog(t, 'agent.asks_permission', `${t.userName}'s agent asked before an irreversible action: ${risky.map((r) => r.what).join('; ')}`, { reasons: risky });
    return;
  }
  await finishWork(t, edits, result, followUp);
}

/** Writes the agent's edits and records the result (shared by the normal path and an approved irreversible action). */
async function finishWork(t, edits, result, followUp) {
  await writeEdits(t.projectId, t.userId, edits);
  const { diff: diffText, files } = await workspaceDiff(t.projectId, t.userId);
  t.summaryDraft = await draftSummary(t, { ...result, why: followUp && t.whyDraft ? t.whyDraft : result.why }, files, diffText);
  say(t, 'agent', followUp ? `Done: ${result.summary}` : `Finished. ${result.summary}`);
  await saveTask(t, { status: 'reviewing', builderModel: t.builderModel ?? null, summary: result.summary, whyDraft: followUp && t.whyDraft ? t.whyDraft : result.why, changedFiles: files, critique: null, pendingAction: null });
  await taskLog(t, 'agent.edits', `Agent changed ${edits.length} file(s) in ${t.userName}'s workspace`, {
    files: edits.map((e) => e.path), summary: result.summary, followUp: followUp ?? null, model: t.builderModel,
  });
  await criticStep(t, files);
}

/** The Critic agent reviews the Builder's change before the developer submits it. */
async function criticStep(t, changedFiles) {
  const [before, after, sections, project] = await Promise.all([
    readAll(t.projectId, BASE(t.userId)), readAll(t.projectId, t.userId), sectionsOf(t),
    q(db.from('projects').select('name,description').eq('id', t.projectId).single()).catch(() => null),
  ]);
  const review = await critique({ project, task: t.text, plan: t.plan, sections, before, after, changedFiles });
  const n = review.findings.length;
  say(t, 'critic', review.verdict === 'looks_good'
    ? `Looks good. ${review.summary}`
    : `${n} thing${n > 1 ? 's' : ''} to check. ${review.summary}`);
  await saveTask(t, { status: 'done', critique: review });
  await taskLog(t, 'agent.critique', `Critic reviewed ${t.userName}'s change: ${review.verdict.replace('_', ' ')}${n ? ` (${n} finding${n > 1 ? 's' : ''})` : ''}`, {
    verdict: review.verdict, findings: review.findings, mode: review.mode,
  });
}

const DATA_LOSS = /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/i;
const MESSAGING = /\b(sendEmail|sendSms|sendMail|nodemailer|twilio|sendgrid|mailgun|resend\.emails)\b/;

/** Which edits would do something that cannot be undone (from facts, not the agent's opinion). */
export function irreversible(edits, current) {
  const out = [];
  for (const e of edits) {
    const before = current[e.path] ?? '';
    const after = e.content ?? '';
    if (e.content === null || (before && !after.trim())) out.push({ path: e.path, kind: 'delete_file', what: `delete ${e.path}` });
    else if (DATA_LOSS.test(after) && !DATA_LOSS.test(before)) out.push({ path: e.path, kind: 'delete_data', what: `delete data (${after.match(DATA_LOSS)[0].toLowerCase()}) in ${e.path}` });
    else if (/(^|\/)(deploy|\.github\/workflows)|vercel\.json$/i.test(e.path)) out.push({ path: e.path, kind: 'deploy', what: `change deployment (${e.path})` });
    else if (MESSAGING.test(after) && !MESSAGING.test(before)) out.push({ path: e.path, kind: 'message_users', what: `message real users (${e.path})` });
  }
  return out;
}

// POST /api/team/task/action-decision { projectId, taskId, choice: approve|reject }
export async function actionDecision(ctx) {
  const { actor } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (t.status !== 'needs_action_approval' || !t.pendingAction) throw new HttpError(409, 'Nothing waiting for your OK');
  const { edits, result, followUp, reasons } = t.pendingAction;
  const approve = ctx.body.choice === 'approve';
  await taskLog(t, approve ? 'developer.action_approved' : 'developer.action_rejected',
    `${actor.name} ${approve ? 'approved' : 'did not allow'}: ${reasons.map((r) => r.what).join('; ')}`, { reasons });
  if (!approve) {
    say(t, 'developer', 'Do not do that.');
    say(t, 'agent', 'OK, nothing was written. Change the task or ask for something else.');
    return saveTask(t, { status: t.changedFiles?.length ? 'done' : 'awaiting_plan_approval', pendingAction: null });
  }
  say(t, 'developer', 'Approved.');
  return step(t, () => finishWork(t, edits, result, followUp));
}

// ---------------------------------------------------------------- end-of-task summary
/**
 * The structured summary of a finished task. The agent's words describe it;
 * the checkable facts come from reality: which files changed (the diff), which
 * are new, what was planned but not changed, and what was blocked (and so has
 * to come from another department).
 */
async function draftSummary(t, result, files, diffText) {
  const added = [...diffText.matchAll(/^diff --git a\/(\S+) b\/\S+\nnew file mode/gm)].map((m) => m[1]);
  const blockedFiles = [...new Set((t.blocked ?? []).flatMap((b) => b.files))];
  const planned = t.plan?.files ?? [];
  const departments = await listDepartments(t.projectId);
  const others = new Map();
  for (const b of t.blocked ?? []) {
    const owner = b.owner ?? departments.find((d) => d.id !== t.department && b.files.every((f) => inArea(d, f)))?.id;
    if (!owner || b.heldBy) continue;
    const step = (t.plan?.steps ?? []).find((x) => b.files.some((f) => x.includes(f)));
    others.set(owner, { department: owner, need: step ?? `Change ${b.files.join(', ')} for "${t.text}".`, files: b.files, send: true });
  }
  return {
    task: t.text,
    status: blockedFiles.length ? 'done, with parts that need another department' : 'done',
    whatChanged: result.summary,
    changed: files,
    plannedButNotChanged: planned.filter((f) => !files.includes(f) && !blockedFiles.includes(f)),
    dependsOn: added.map((f) => `${f} is new`),
    decisions: t.plan?.understanding ? [{ decision: t.plan.understanding, why: result.why }] : [],
    open: [
      ...blockedFiles.map((f) => `${f} was not changed (outside this department or claimed by another agent)`),
      ...planned.filter((f) => !files.includes(f) && !blockedFiles.includes(f)).map((f) => `${f} was planned but not changed`),
    ],
    forOtherDepartments: [...others.values()],
    checkedAt: new Date().toISOString(),
  };
}

function renderSummary(sm) {
  const lines = [sm.whatChanged];
  if (sm.changed?.length) lines.push(`Files: ${sm.changed.join(', ')}.`);
  if (sm.dependsOn?.length) lines.push(`Others can now rely on: ${sm.dependsOn.join('; ')}.`);
  if (sm.decisions?.length) lines.push(`Decisions: ${sm.decisions.map((d) => `${d.decision}${d.why ? ` (why: ${d.why})` : ''}`).join(' ')}`);
  if (sm.open?.length) lines.push(`Still open: ${sm.open.join('; ')}.`);
  if (sm.forOtherDepartments?.length) lines.push(`Needs from other departments: ${sm.forOtherDepartments.map((o) => `${o.department}: ${o.need}`).join('; ')}`);
  return lines.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- endpoints
async function devActor(ctx) {
  const projectId = ctx.body?.projectId ?? ctx.query?.projectId;
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  requireDeveloper(actor);
  return { actor, projectId };
}

// GET /api/team/task/current?projectId
export async function current(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const task = (await currentTask(projectId, actor.id)) ?? null;
  const sub = task?.submissionId ? await workSubmissions.get(task.submissionId) : null;
  const submission = sub && { ...sub, outdated: sub.status === 'pending' ? await outdatedSince(projectId, sub.builtOn) : [] };
  const check = task && ['done', 'sent_back', 'submitted'].includes(task.status) ? await precheck(task) : null;
  return { task, submission, check };
}

// POST /api/team/task/start { projectId, text }
export async function start(ctx) {
  const { actor, projectId } = await devActor(ctx);
  let assignment = null;
  if (ctx.body.assignmentId) {
    assignment = await getAssignment(ctx.body.assignmentId);
    if (!assignment || assignment.project_id !== projectId) throw new HttpError(404, 'Assigned task not found');
    if (assignment.assignee_id !== actor.id) throw new HttpError(403, 'This task is assigned to someone else');
    if (assignment.status === 'done') throw new HttpError(409, 'This task is already done');
  }
  const text = String(ctx.body.text ?? '').trim()
    || (assignment ? `${assignment.title}${assignment.description ? `. ${assignment.description}` : ''}` : '');
  if (!text) throw new HttpError(400, 'Describe the task first');
  const prev = await currentTask(projectId, actor.id);
  // Hand edits that were not submitted yet carry over into the agent's task (nothing is lost).
  const keepEdits = prev?.manual && ['done', 'sent_back'].includes(prev.status);
  if (keepEdits) await saveTask(prev, { status: 'cancelled' });
  else if (prev && !FINISHED.includes(prev.status) && prev.status !== 'failed') throw new HttpError(409, 'Finish, submit or cancel your current task first');
  await ensureWorkspace(projectId, actor.id);
  if (!keepEdits && (!prev || prev.status !== 'sent_back')) await resetWorkspace(projectId, actor.id);
  const t = {
    id: devTasks.newId(), projectId, userId: actor.id, userName: actor.name, department: await workDepartment(projectId, actor, ctx.body.department), text,
    status: 'reading_context', relevantSectionIds: [], conflicts: [], plan: null, summary: '', whyDraft: '', changedFiles: [],
    contextAlert: null, builtOn: null, messages: [], submissionId: null, reviewNote: null, resumeStatus: null,
    assignmentId: assignment?.id ?? null, peers: [], createdAt: nowIso(), updatedAt: nowIso(),
  };
  say(t, 'developer', text);
  await devTasks.put(t);
  await syncAssignment(t, 'started');
  await taskLog(t, 'task.created', `${actor.name} gave their agent a task: "${text}"`, { text });
  return step(t, () => intake(t));
}

// POST /api/team/task/conflict-decision { projectId, taskId, choice: proceed|change|cancel, newText? }
export async function conflictDecision(ctx) {
  const { actor } = await devActor(ctx);
  const { taskId, choice, newText } = ctx.body;
  const t = await mustGet(taskId, actor);
  if (t.status !== 'needs_conflict_decision') throw new HttpError(409, 'No conflict decision pending');
  await taskLog(t, 'developer.conflict_choice', `${actor.name} chose "${{ proceed: 'Go ahead anyway', change: 'Change request', cancel: 'Cancel' }[choice]}" after the conflict warning`, {
    choice, conflicts: t.conflicts, newText: newText ?? null,
  });
  if (choice === 'cancel') return cancelTask(t, 'Cancelled after the conflict warning.');
  if (choice === 'change') {
    if (!String(newText ?? '').trim()) throw new HttpError(400, 'Write the changed request');
    say(t, 'developer', `Changed request: ${newText.trim()}`);
    await saveTask(t, { text: newText.trim(), conflicts: [], status: 'reading_context' });
    return step(t, () => intake(t));
  }
  say(t, 'developer', 'Go ahead anyway.');
  return step(t, () => planStep(t));
}

// POST /api/team/task/plan-decision { projectId, taskId, plan? }
export async function planDecision(ctx) {
  const { actor } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (t.status !== 'awaiting_plan_approval') throw new HttpError(409, 'No plan waiting for approval');
  const plan = ctx.body.plan;
  const edited = !!plan && JSON.stringify(plan) !== JSON.stringify(t.plan);
  if (edited) t.plan = plan;
  say(t, 'developer', edited ? 'Confirmed my edited plan.' : 'Plan confirmed.');
  await taskLog(t, 'developer.plan_choice', `${actor.name} ${edited ? 'edited and confirmed' : 'confirmed'} the plan`, { plan: t.plan, edited });
  // Claim the planned files in our area that nobody else holds.
  const department = await getDepartment(t.projectId, t.department);
  const held = await claimHolders(t);
  t.claims = [...new Set([...(t.claims ?? []), ...(t.plan.files ?? []).filter((f) => inArea(department, f) && !held.has(f))])];
  const taken = (t.plan.files ?? []).filter((f) => held.has(f));
  if (taken.length) {
    say(t, 'agent', `${taken.map((f) => `${f} is being changed by ${held.get(f).name}'s agent ("${held.get(f).task}")`).join('; ')}. I will not touch ${taken.length === 1 ? 'it' : 'them'}: wait for that work, change the plan, or ask your manager.`);
  }
  return step(t, () => workStep(t));
}

// POST /api/team/task/follow-up { projectId, taskId, message }
export async function followUp(ctx) {
  const { actor } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  const message = String(ctx.body.message ?? '').trim();
  if (!['done', 'sent_back'].includes(t.status)) throw new HttpError(409, 'The agent can take follow-ups once it has finished');
  if (!message) throw new HttpError(400, 'Write what to change');
  say(t, 'developer', message);
  await taskLog(t, 'developer.followup', `${actor.name} asked for more changes: "${message}"`, { message });
  return step(t, () => workStep(t, message));
}

// POST /api/team/task/critic { projectId, taskId }
// The Critic reads the finished changes and reports problems. It never edits anything.
// It also runs on its own after every build; this re-runs it (for example after hand edits).
export async function critic(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (!['done', 'sent_back'].includes(t.status)) throw new HttpError(409, 'The Critic reviews finished work');
  const { files: changedFiles } = await workspaceDiff(projectId, actor.id);
  if (!changedFiles.length) throw new HttpError(409, 'There are no changes to review');
  const back = t.status;
  await saveTask(t, { status: 'reviewing' });
  await criticStep(t, changedFiles);
  if (back === 'sent_back') await saveTask(t, { status: 'sent_back' });
  return devTasks.get(t.id);
}

// POST /api/team/task/retry { projectId, taskId }
export async function retry(ctx) {
  const { actor } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (t.status !== 'failed') throw new HttpError(409, 'Nothing to retry');
  return step(t, () => (t.plan ? workStep(t) : intake(t)));
}

async function cancelTask(t, why) {
  say(t, 'system', why);
  await saveTask(t, { status: 'cancelled' });
  await taskLog(t, 'task.cancelled', `${t.userName} cancelled "${t.text}"`, { why });
  await resetWorkspace(t.projectId, t.userId);
  await syncAssignment(t, 'cancelled');
  return t;
}

// POST /api/team/task/cancel { projectId, taskId }
export async function cancel(ctx) {
  const { actor } = await devActor(ctx);
  return cancelTask(await mustGet(ctx.body.taskId, actor), 'Cancelled by the developer.');
}

/** Checks right before submitting: the context may have changed while they worked. */
export async function precheck(t) {
  const outdated = t.builtOn ? await outdatedSince(t.projectId, t.builtOn) : [];
  const conflicts = guardrailConflicts(t.text, await sectionsOf(t));
  return { outdated, conflicts, ok: outdated.length === 0 && conflicts.length === 0 };
}

// POST /api/team/task/submit { projectId, taskId, why, force? }
export async function submit(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  const why = String(ctx.body.why ?? '').trim();
  if (!['done', 'sent_back'].includes(t.status)) throw new HttpError(409, 'Nothing ready to submit');
  if (!why) throw new HttpError(400, 'Explain why (the agent drafted one for you)');
  const check = await precheck(t);
  if (!check.ok && !ctx.body.force) {
    await taskLog(t, 'agent.precheck', `Agent stopped ${actor.name}'s submission: context changed or conflicts found`, check);
    return { submitted: false, check };
  }
  const { diff, files } = await workspaceDiff(projectId, actor.id);
  if (!files.length) throw new HttpError(409, 'There are no changes to submit');
  const [base, mine] = await Promise.all([readAll(projectId, BASE(actor.id)), readAll(projectId, actor.id)]);
  const title = t.text.length > 70 ? `${t.text.slice(0, 67)}…` : t.text.charAt(0).toUpperCase() + t.text.slice(1);
  const sub = {
    id: workSubmissions.newId(), projectId, taskId: t.id, userId: actor.id, userName: actor.name, department: t.department,
    title, summary: t.summary, why, diff, files, builtOn: t.builtOn, status: 'pending', critique: t.critique ?? null,
    // The exact change: each touched file's base and new content (null = deleted / absent).
    base: Object.fromEntries(files.map((p) => [p, base[p] ?? null])),
    changes: Object.fromEntries(files.map((p) => [p, mine[p] ?? null])),
    reviewNote: null, reviewedBy: null, reviewedAt: null, mergeInfo: null, createdAt: nowIso(),
  };
  await workSubmissions.put(sub);
  say(t, 'system', check.ok ? 'Submitted for review.' : 'Submitted anyway, with the context warnings attached.');
  await saveTask(t, { status: 'submitted', submissionId: sub.id, whyDraft: why });
  await logEvent(projectId, {
    type: 'task.submitted', actorId: actor.id, department: t.department, taskId: t.id, submissionId: sub.id,
    summary: `${actor.name} submitted "${sub.title}"${check.ok ? '' : ' despite context warnings'}`,
    data: { builtOn: sub.builtOn, files, why, forcedPastWarnings: !check.ok, check },
  });
  await syncAssignment(t, 'submitted');
  t.peers = await peerOverlap(t);
  const dept = await getDepartment(projectId, t.department);
  // A department without a manager falls back to the owner, so nothing waits unseen.
  await notifyMany(projectId, [dept?.managerId || await ownerOf(projectId)], {
    kind: 'submission', title: `New submission from ${actor.name}`,
    body: `"${sub.title}". ${check.ok ? '' : 'Built on context that has since changed.'}`.trim(),
  }, { actorId: actor.id, department: t.department, submissionId: sub.id });
  return { submitted: true, submission: sub };
}

// ---------------------------------------------------------------- context changed mid-task
/** Called after a confirmed context change, for a developer whose active work depends on it. */
export async function raiseContextAlert(projectId, userId, changes, changeSummary, obsoleteTerms) {
  const t = await currentTask(projectId, userId);
  if (!t || FINISHED.includes(t.status) || t.status === 'failed') return;
  const relevant = changes.filter((c) => t.relevantSectionIds.includes(c.sectionId));
  const hits = mentions(`${t.text} ${t.summary} ${t.plan?.understanding ?? ''}`, obsoleteTerms);
  const relation = hits.length
    ? `${changeSummary} Your task relies on “${hits.join('”, “')}”, so ${t.changedFiles.length ? 'the work so far is now outdated' : 'it needs adjusting before I continue'}.`
    : `Sections your task depends on changed: ${relevant.map((c) => c.title).join(', ')}. Check that the work still fits.`;
  const all = await listSections(projectId);
  const suggestedTask = await getTeamAgent(projectId).adjustTask({
    task: t.text, changeSummary, obsoleteTerms, sections: all.filter((s) => relevant.some((c) => c.sectionId === s.id)),
  });
  t.contextAlert = {
    id: devTasks.newId(), createdAt: nowIso(), changes: [...relevant, ...changes.filter((c) => !relevant.includes(c))],
    relation, resolution: null, suggestedTask,
  };
  say(t, 'agent', `Heads up: the context changed while I was working. ${relation}`);
  const busy = ['reading_context', 'checking_conflicts', 'planning', 'working', 'reviewing'].includes(t.status);
  if (!busy) { t.resumeStatus = t.status; t.status = 'needs_context_decision'; }
  await devTasks.put({ ...t, updatedAt: nowIso() });
  await taskLog(t, 'task.context_alert', `${t.userName}'s agent flagged a mid-task context change: ${relation}`, { alert: t.contextAlert });
  await notifyMany(projectId, [userId], { kind: 'task_alert', title: 'Context changed: your task is affected', body: relation }, { department: t.department, taskId: t.id });
}

/** Re-runs a task against the current context, on top of the latest main project. */
async function redo(t, text, message) {
  say(t, 'developer', message);
  const sync = await syncWithMain(t.projectId, t.userId);
  say(t, 'system', sync.ok
    ? 'Brought the latest main project into your workspace.'
    : `Could not bring in the latest main automatically (conflicts in ${sync.conflictedFiles.join(', ')}). Your workspace was left as it was.`);
  if (!sync.ok) await taskLog(t, 'workspace.sync_conflict', `Syncing ${t.userName}'s workspace with main hit conflicts`, { conflictedFiles: sync.conflictedFiles });
  await saveTask(t, { text, status: 'reading_context', resumeStatus: null, conflicts: [], plan: null, submissionId: null });
  return step(t, () => intake(t));
}

// POST /api/team/task/context-decision { projectId, taskId, choice: continue|adjust|cancel, newText? }
export async function contextDecision(ctx) {
  const { actor } = await devActor(ctx);
  const { taskId, choice, newText } = ctx.body;
  const t = await mustGet(taskId, actor);
  if (t.status !== 'needs_context_decision' || !t.contextAlert) throw new HttpError(409, 'No context decision pending');
  t.contextAlert.resolution = choice;
  await taskLog(t, 'developer.context_choice', `${actor.name} chose "${{ continue: 'Continue as is', adjust: 'Pause and adjust', cancel: 'Cancel' }[choice]}" after the context change`, {
    choice, alertId: t.contextAlert.id, newText: newText ?? null, oldText: t.text,
  });
  if (choice === 'cancel') return cancelTask(t, 'Cancelled after the context changed.');
  if (choice === 'continue') {
    t.acknowledged = { ...(t.acknowledged ?? {}), ...Object.fromEntries(t.contextAlert.changes.map((c) => [c.sectionId, c.toVersion])) };
    say(t, 'developer', 'Continue as is.');
    say(t, 'agent', 'OK. Your work stays built on the old context; the submission will show it as Outdated.');
    return saveTask(t, { status: t.resumeStatus ?? 'done', resumeStatus: null });
  }
  if (!String(newText ?? '').trim()) throw new HttpError(400, 'Write the adjusted task');
  return redo(t, newText.trim(), `Pause and adjust: ${newText.trim()}`);
}

// POST /api/team/task/rework { projectId, taskId, newText }
export async function rework(ctx) {
  const { actor } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  const newText = String(ctx.body.newText ?? '').trim();
  if (t.status !== 'sent_back') throw new HttpError(409, 'Only sent-back work can be reworked');
  if (!newText) throw new HttpError(400, 'Write the reworked task');
  await taskLog(t, 'developer.rework', `${actor.name} reworked a sent-back task against the current context`, { oldText: t.text, newText });
  return redo(t, newText, `Rework: ${newText}`);
}

// POST /api/team/agent/restart { projectId }
// A fresh agent has no memory: it rebuilds what it knows from the context and the log only.
export async function restartAgent(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const t = await activeTask(projectId, actor.id);
  const department = await getDepartment(projectId, await workDepartment(projectId, actor, t?.department));
  const [central, departmentSections, logRows] = await Promise.all([
    listSections(projectId, 'central'), listSections(projectId, department.id),
    q(db.from('activity_log').select('at,type,summary').eq('project_id', projectId)
      .or(`department.eq.${department.id},department.is.null`).order('id', { ascending: false }).limit(60)),
  ]);
  const points = await getTeamAgent(projectId).whatIKnow({
    user: { id: actor.id, name: actor.name }, department, central, departmentSections, recentLog: logRows, task: t ?? null,
  });
  if (t) { say(t, 'system', 'Agent restarted. It rebuilt its understanding from the context and the log.'); await saveTask(t); }
  await logEvent(projectId, {
    type: 'agent.restarted', actorId: actor.id, department: department.id, taskId: t?.id ?? null,
    summary: `${actor.name} restarted their agent; it rebuilt its context from ${central.length} central + ${departmentSections.length} ${department.name} sections and the log`,
    data: { points },
  });
  return { generatedAt: nowIso(), mode: agentMode(), points };
}

// ---------------------------------------------------------------- workspace files
async function whoseFiles(ctx) {
  const projectId = ctx.query.projectId;
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  if (ctx.query.workspace === 'main') return { projectId, workspace: 'main' };
  requireDeveloper(actor);
  await ensureWorkspace(projectId, actor.id);
  return { projectId, workspace: actor.id, actor };
}

// GET /api/team/workspace/files?projectId[&workspace=main]
export async function files(ctx) {
  const { projectId, workspace } = await whoseFiles(ctx);
  return { files: Object.keys(await readAll(projectId, workspace)).sort() };
}

// GET /api/team/workspace/file?projectId&path[&workspace=main]
export async function file(ctx) {
  const { projectId, workspace } = await whoseFiles(ctx);
  return { path: ctx.query.path, content: await readOne(projectId, workspace, ctx.query.path) };
}

// GET /api/team/workspace/bundle?projectId[&workspace=main]  (every file, for the live preview)
export async function bundle(ctx) {
  const { projectId, workspace } = await whoseFiles(ctx);
  return { files: await readAll(projectId, workspace) };
}

// ---------------------------------------------------------------- editing by hand
const MAX_FILE = 300000;
const BUSY_STATUSES = ['reading_context', 'checking_conflicts', 'planning', 'working', 'reviewing'];

/**
 * The task that holds the developer's own edits. Editing while the agent is busy is
 * refused; with no open task, a "manual edits" task is opened so the work can be
 * reviewed by the Critic and submitted like the agent's.
 */
async function editableTask(projectId, actor) {
  const t = await activeTask(projectId, actor.id);
  if (t && BUSY_STATUSES.includes(t.status)) throw new HttpError(409, 'Your agent is working in your files right now. Wait for it to finish.');
  if (t && ['done', 'sent_back', 'awaiting_plan_approval', 'needs_conflict_decision', 'needs_context_decision'].includes(t.status)) return t;
  await ensureWorkspace(projectId, actor.id);
  const all = await listSections(projectId);
  const sections = all.filter((x) => x.scope === 'central' || x.scope === actor.department);
  const m = {
    id: devTasks.newId(), projectId, userId: actor.id, userName: actor.name, department: actor.department,
    text: `Manual edits by ${actor.name}`, status: 'done', manual: true,
    relevantSectionIds: sections.map((x) => x.id), conflicts: [], plan: null, summary: '', whyDraft: '', changedFiles: [],
    contextAlert: null, builtOn: await builtOnFor(projectId, sections.map((x) => x.id)), messages: [], submissionId: null,
    reviewNote: null, resumeStatus: null, assignmentId: null, peers: [], createdAt: nowIso(), updatedAt: nowIso(),
  };
  say(m, 'system', `${actor.name} is editing files by hand.`);
  await devTasks.put(m);
  await taskLog(m, 'task.manual', `${actor.name} started editing files by hand`);
  return m;
}

async function afterManualEdit(t, projectId, actor) {
  const { files } = await workspaceDiff(projectId, actor.id);
  const summary = t.manual ? `Edited by hand: ${files.join(', ') || 'no changes'}` : t.summary;
  await saveTask(t, { changedFiles: files, summary, critique: null });
  return { changedFiles: files, taskId: t.id };
}

// POST /api/team/workspace/save { projectId, path, content | null, rename? }   (developer, own copy)
export async function save(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const path = safePath(ctx.body.path);
  const t = await editableTask(projectId, actor);
  if (ctx.body.rename) {
    const to = safePath(ctx.body.rename);
    const content = await readOne(projectId, actor.id, path);
    if (content == null) throw new HttpError(404, 'File not found');
    await writeEdits(projectId, actor.id, [{ path: to, content }, { path, content: null }]);
  } else {
    const content = ctx.body.content === null ? null : String(ctx.body.content ?? '');
    if (content != null && content.length > MAX_FILE) throw new HttpError(413, 'File is too large (max 300 KB)');
    await writeEdits(projectId, actor.id, [{ path, content }]);
  }
  return afterManualEdit(t, projectId, actor);
}

// POST /api/team/workspace/import { projectId, files: { path: content }, replace?, keep?: [paths] }
// Loads a folder from the developer's computer into their own copy.
export async function importFiles(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const incoming = ctx.body.files && typeof ctx.body.files === 'object' ? ctx.body.files : null;
  if (!incoming) throw new HttpError(400, 'files must be an object of path → content');
  const entries = Object.entries(incoming).slice(0, 500);
  const t = await editableTask(projectId, actor);
  const edits = [];
  for (const [p, c] of entries) {
    if (typeof c !== 'string' || c.length > MAX_FILE) continue;
    try { edits.push({ path: safePath(p), content: c }); } catch { /* skip unsafe paths */ }
  }
  if (ctx.body.replace) {
    const current = Object.keys(await readAll(projectId, actor.id));
    // keep: every path in the folder (it may arrive over several requests).
    const keep = new Set([...edits.map((e) => e.path), ...(Array.isArray(ctx.body.keep) ? ctx.body.keep.map(String) : [])]);
    for (const p of current) if (!keep.has(p)) edits.push({ path: p, content: null });
  }
  await writeEdits(projectId, actor.id, edits);
  await taskLog(t, 'task.import', `${actor.name} loaded ${entries.length} file(s) from their computer`);
  return { imported: edits.filter((e) => e.content != null).length, ...(await afterManualEdit(t, projectId, actor)) };
}

// POST /api/team/workspace/review { projectId, taskId }   (ask the Critic to review the current edits)
export async function review(ctx) {
  const { actor } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (!['done', 'sent_back'].includes(t.status)) throw new HttpError(409, 'Nothing ready to review');
  await saveTask(t, { status: 'reviewing' });
  await criticStep(t, t.changedFiles ?? []);
  return devTasks.get(t.id);
}

// GET /api/team/workspace/diff?projectId
export async function diff(ctx) {
  const { projectId, actor } = await whoseFiles(ctx);
  const d = await workspaceDiff(projectId, actor.id);
  return { ...d, behindMain: await isBehindMain(projectId, actor.id) };
}

export { listPeople };

// GET /api/team/workspace/status?projectId
// Everything the developer page shows around the agent: what it may change and
// what it was blocked from, its suggestions (applied / waiting / decided, with
// reasons), the conflicts it caused and how they were resolved, and a timeline.
export async function status(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const [mine, myTasks, byMe] = await Promise.all([
    suggestions.list(projectId, { suggested_by: actor.id }, 200),
    devTasks.list(projectId, { user_id: actor.id }, 50),
    q(db.from('activity_log').select('*').eq('project_id', projectId).eq('actor_id', actor.id).order('id', { ascending: false }).limit(80)),
  ]);
  // The owner has no department of their own: their area is their latest task's.
  const department = await getDepartment(projectId, actor.department ?? (await activeTask(projectId, actor.id))?.department);
  const taskIds = myTasks.map((t) => t.id);
  const aboutMyTasks = taskIds.length
    ? await q(db.from('activity_log').select('*').eq('project_id', projectId).in('task_id', taskIds).order('id', { ascending: false }).limit(120))
    : [];
  const mySuggestionIds = mine.map((s) => s.id);
  const aboutMySuggestions = mySuggestionIds.length
    ? await q(db.from('activity_log').select('*').eq('project_id', projectId).in('suggestion_id', mySuggestionIds).order('id', { ascending: false }).limit(120))
    : [];
  const seen = new Set();
  const timeline = [...byMe, ...aboutMyTasks, ...aboutMySuggestions]
    .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)) && e.type !== 'notification.sent')
    .sort((a, b) => b.id - a.id).slice(0, 60).map(toEvent);
  const brief = (s) => ({
    id: s.id, status: s.status, label: s.label, scope: s.scope, why: s.why, createdAt: s.createdAt, decidedAt: s.decidedAt,
    taskId: s.taskId, reasons: s.reasons ?? [], ruleHits: s.ruleHits ?? [], decision: s.decision, managerNote: s.managerNote ?? null,
    changes: s.changes.map((c) => ({ op: c.op, kind: c.kind, title: c.title, content: c.content })),
  });
  return {
    area: {
      department: department ? { id: department.id, name: department.name } : null,
      files: department?.paths?.length ? department.paths : ['(the whole project)'],
      context: department ? [`${department.name} progress: added directly when in line with the plan`, `${department.name} plan: suggestions, the manager decides`, 'Central context: suggestions, your manager looks first, then the founder'] : [],
    },
    blocked: timeline.filter((e) => e.type === 'permission.blocked'),
    suggestions: mine.map(brief),
    conflicts: mine.filter((s) => s.label === 'conflict').map(brief),
    timeline,
  };
}

// POST /api/team/task/share { projectId, taskId, summary }
// The developer reviewed and edited the summary; it goes to the department
// progress through the change router. Files are re-checked against the diff,
// and "needs from other departments" marked send become requests.
export async function share(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (!['done', 'submitted', 'approved', 'sent_back'].includes(t.status)) throw new HttpError(409, 'Share when the agent has finished');
  if (t.shared?.suggestionId) throw new HttpError(409, 'Already shared');
  const edited = ctx.body.summary ?? t.summaryDraft;
  if (!String(edited?.whatChanged ?? '').trim()) throw new HttpError(400, 'Say what changed');
  const { files } = await workspaceDiff(projectId, actor.id);
  const facts = t.summaryDraft ?? {};
  // Checkable facts are never taken from the edit: files come from the diff.
  const summary = { ...edited, changed: files, plannedButNotChanged: facts.plannedButNotChanged ?? [], checkedAt: new Date().toISOString() };
  // The owner has no department of their own, so they share from the task's.
  const sharer = { ...actor, department: t.department };
  const suggestion = await createSuggestion(projectId, sharer, {
    scope: t.department, taskId: t.id, files, basedOn: t.builtOn?.sections, why: `Finished: ${t.text}`, source: 'agent',
    changes: [{ op: 'add', kind: 'progress', title: t.text.slice(0, 120), content: renderSummary(summary) }],
  });
  const requests = [];
  for (const o of (summary.forOtherDepartments ?? []).filter((x) => x.send)) {
    requests.push(await createRequest(projectId, sharer, { toDepartment: o.department, title: String(o.need).slice(0, 120), body: `For "${t.text}": ${o.need}${o.files?.length ? ` (files: ${o.files.join(', ')})` : ''}`.slice(0, 600), fromTaskId: t.id }));
  }
  t.shared = { suggestionId: suggestion.id, summary, requests: requests.map((r) => r.id), at: new Date().toISOString() };
  await saveTask(t);
  return { suggestion: { id: suggestion.id, status: suggestion.status, label: suggestion.label, reasons: suggestion.reasons }, requests, summary };
}

// POST /api/team/task/undo-edits { projectId, taskId }
// A developer can undo their own agent's work that has not been shared or
// submitted yet: the changed files go back to how they were in their copy's base.
export async function undoEdits(ctx) {
  const { actor, projectId } = await devActor(ctx);
  const t = await mustGet(ctx.body.taskId, actor);
  if (t.shared || ['submitted', 'approved'].includes(t.status)) throw new HttpError(409, 'Already shared or submitted: ask your manager to revert it');
  const { files } = await workspaceDiff(projectId, actor.id);
  if (!files.length) throw new HttpError(409, 'Nothing to undo');
  const base = await readAll(projectId, BASE(actor.id));
  await writeEdits(projectId, actor.id, files.map((f) => ({ path: f, content: base[f] ?? null })));
  say(t, 'developer', `Undid my agent's changes to ${files.join(', ')}.`);
  await saveTask(t, { changedFiles: [], summaryDraft: null, claims: [], status: t.plan ? 'awaiting_plan_approval' : t.status });
  await taskLog(t, 'developer.undo_edits', `${actor.name} undid their agent's unshared changes to ${files.join(', ')}`, { files });
  return t;
}
