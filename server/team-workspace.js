// Developer Workspace: task → read context → conflict check → plan → edits in
// the developer's isolated copy → review → submit. Each step runs inside its
// request (Vercel stops a function once it responds), and every step updates
// the task, writes the activity log, and notifies when needed.
import { HttpError } from '../api/_lib/errors.js';
import { devTasks, workSubmissions } from '../api/_lib/records.js';
import { logEvent, notifyMany } from '../api/_lib/activity.js';
import { getDepartment, listPeople, requireDeveloper, teamActor } from '../api/_lib/team.js';
import {
  builtOnFor, guardrailConflicts, listSections, mentions, outdatedSince, relevantSections,
} from '../api/_lib/context.js';
import {
  BASE, ensureWorkspace, isBehindMain, readAll, readOne, resetWorkspace, safePath, syncWithMain, workspaceDiff, writeEdits,
} from '../api/_lib/files.js';
import { agentMode, getTeamAgent } from '../api/_lib/team-agent/index.js';
import { db, q } from '../api/_lib/supabase-admin.js';

/** Statuses where the developer can start a fresh task. */
const FINISHED = ['submitted', 'approved', 'rejected', 'cancelled'];
const ACTIVE = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'done', 'needs_context_decision', 'sent_back'];
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
  const wanted = new Set([...fileIndex.filter((f) => department.paths.some((p) => f.startsWith(p))), ...extraFiles]);
  return {
    task: t.text, user: { id: t.userId, name: t.userName }, department, sections, fileIndex,
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
  await saveTask(t, { relevantSectionIds: sections.map((s) => s.id), builtOn, status: 'checking_conflicts' });
  await taskLog(t, 'agent.context_read', `${t.userName}'s agent read ${sections.length} relevant context sections`, {
    sections: sections.map((s) => ({ id: s.id, title: s.title, version: s.version, scope: s.scope })), builtOn,
  });

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

async function planStep(t) {
  await saveTask(t, { status: 'planning' });
  const plan = await getTeamAgent(t.projectId).plan(await agentInput(t, await sectionsOf(t)));
  say(t, 'agent', 'Here is what I understood and what I will do. Confirm or edit it.');
  await saveTask(t, { plan, status: 'awaiting_plan_approval' });
  await taskLog(t, 'agent.plan', `Agent proposed a plan for "${t.text}"`, { plan });
}

async function workStep(t, followUp) {
  await saveTask(t, { status: 'working' });
  const input = await agentInput(t, await sectionsOf(t), t.plan?.files ?? []);
  const result = await getTeamAgent(t.projectId).edit({ ...input, plan: t.plan, followUp, previousSummary: t.summary });
  const edits = result.edits.flatMap((e) => { try { return [{ path: safePath(e.path), content: e.content }]; } catch { return []; } });
  await writeEdits(t.projectId, t.userId, edits);
  const { files } = await workspaceDiff(t.projectId, t.userId);
  say(t, 'agent', followUp ? `Done: ${result.summary}` : `Finished. ${result.summary}`);
  await saveTask(t, { status: 'done', summary: result.summary, whyDraft: followUp && t.whyDraft ? t.whyDraft : result.why, changedFiles: files });
  await taskLog(t, 'agent.edits', `Agent changed ${edits.length} file(s) in ${t.userName}'s workspace`, {
    files: edits.map((e) => e.path), summary: result.summary, followUp: followUp ?? null,
  });
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
  const text = String(ctx.body.text ?? '').trim();
  if (!text) throw new HttpError(400, 'Describe the task first');
  const prev = await currentTask(projectId, actor.id);
  if (prev && !FINISHED.includes(prev.status) && prev.status !== 'failed') throw new HttpError(409, 'Finish, submit or cancel your current task first');
  await ensureWorkspace(projectId, actor.id);
  if (!prev || prev.status !== 'sent_back') await resetWorkspace(projectId, actor.id);
  const t = {
    id: devTasks.newId(), projectId, userId: actor.id, userName: actor.name, department: actor.department, text,
    status: 'reading_context', relevantSectionIds: [], conflicts: [], plan: null, summary: '', whyDraft: '', changedFiles: [],
    contextAlert: null, builtOn: null, messages: [], submissionId: null, reviewNote: null, resumeStatus: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  say(t, 'developer', text);
  await devTasks.put(t);
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
    title, summary: t.summary, why, diff, files, builtOn: t.builtOn, status: 'pending',
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
  const dept = await getDepartment(projectId, t.department);
  await notifyMany(projectId, [dept.managerId], {
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
  const busy = ['reading_context', 'checking_conflicts', 'planning', 'working'].includes(t.status);
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
  const department = await getDepartment(projectId, actor.department);
  const t = await activeTask(projectId, actor.id);
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

// GET /api/team/workspace/bundle?projectId[&workspace=main]  (all web files, for the live preview)
export async function bundle(ctx) {
  const { projectId, workspace } = await whoseFiles(ctx);
  const all = await readAll(projectId, workspace);
  return { files: Object.fromEntries(Object.entries(all).filter(([p]) => p.startsWith('web/'))) };
}

// GET /api/team/workspace/diff?projectId
export async function diff(ctx) {
  const { projectId, actor } = await whoseFiles(ctx);
  const d = await workspaceDiff(projectId, actor.id);
  return { ...d, behindMain: await isBehindMain(projectId, actor.id) };
}

export { listPeople };
