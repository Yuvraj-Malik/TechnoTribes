// Safety net: revert (context and code), search by meaning, the drift check,
// and the human approval of irreversible agent actions.
// Nothing is ever overwritten or deleted: a revert is a new version (context)
// or an "undo merge" submission (code), routed like any other change.
import { HttpError } from '../api/_lib/errors.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { devTasks, suggestions, workSubmissions } from '../api/_lib/records.js';
import { logEvent, notifyMany } from '../api/_lib/activity.js';
import { listDepartments, listPeople, teamActor } from '../api/_lib/team.js';
import { guardrailConflicts, listSections, listVersions, mentions, scopeLabel } from '../api/_lib/context.js';
import { createSuggestion } from '../api/_lib/suggestions.js';
import { diffMaps, readAll } from '../api/_lib/files.js';
import { search as searchIndex } from '../api/_lib/search.js';
import { ownerOf } from '../api/_lib/log.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;
const ACTIVE = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'done', 'needs_context_decision', 'needs_action_approval', 'sent_back'];

async function actorFor(ctx) {
  const projectId = projectIdOf(ctx);
  return { projectId, actor: await teamActor({ user: ctx.user, req: ctx.req, projectId }) };
}

/** Who may revert: the person who approves changes to that scope. */
function canRevert(actor, scope) {
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && actor.department === scope;
}

// ---------------------------------------------------------------- context revert
/** Everything built on versions after `toVersion` of this item. */
async function contextDependents(projectId, item, toVersion) {
  const later = (await listVersions(projectId, { sectionId: item.id })).filter((v) => v.version > toVersion);
  const tasks = (await devTasks.list(projectId, {}, 500)).filter((t) => {
    const v = t.builtOn?.sections?.[item.id];
    return v && v > toVersion && ACTIVE.concat(['submitted']).includes(t.status);
  }).map((t) => ({ taskId: t.id, userName: t.userName, text: t.text, status: t.status, builtOnVersion: t.builtOn.sections[item.id] }));
  const subs = (await workSubmissions.list(projectId, { status: 'pending' }, 300))
    .filter((s) => (s.builtOn?.sections?.[item.id] ?? 0) > toVersion)
    .map((s) => ({ submissionId: s.id, title: s.title, userName: s.userName }));
  const checkpoints = (await listSections(projectId, 'central')).filter((s) => s.kind === 'checkpoint'
    && (s.meta?.links ?? []).some((l) => l.id === item.id)).map((s) => ({ id: s.id, title: s.title }));
  return {
    laterVersions: later.map((v) => ({ version: v.version, why: v.why, changedBy: v.changedBy, changedAt: v.changedAt })),
    tasks, submissions: subs, checkpoints,
    count: tasks.length + subs.length + checkpoints.length,
  };
}

async function itemAndTarget(projectId, itemId, toVersion) {
  const item = (await listSections(projectId, undefined, { includeArchived: true })).find((s) => s.id === itemId);
  if (!item) throw new HttpError(404, 'Context item not found');
  const target = (await listVersions(projectId, { sectionId: itemId })).find((v) => v.version === Number(toVersion));
  if (!target) throw new HttpError(404, 'That version does not exist');
  if (target.version >= item.version) throw new HttpError(400, 'Pick an earlier version');
  return { item, target };
}

// GET /api/team/revert/preview?projectId&itemId&toVersion
export async function revertPreview(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const { item, target } = await itemAndTarget(projectId, ctx.query.itemId, ctx.query.toVersion);
  return {
    item: { id: item.id, title: item.title, scope: item.scope, kind: item.kind, version: item.version, content: item.content, archived: item.archived },
    target: { version: target.version, content: target.content, why: target.why },
    dependents: await contextDependents(projectId, item, target.version),
    canRevert: canRevert(actor, item.scope),
  };
}

// POST /api/team/revert/context { projectId, itemId, toVersion, reason }
// Writes the old content back as a NEW version, through the change router.
export async function revertContext(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const { item, target } = await itemAndTarget(projectId, ctx.body.itemId, ctx.body.toVersion);
  if (!canRevert(actor, item.scope)) throw new HttpError(403, item.scope === 'central' ? 'Only the founder reverts central context' : 'Only this department\'s manager reverts its context');
  const reason = String(ctx.body.reason ?? '').trim();
  if (!reason) throw new HttpError(400, 'Say why you are reverting');
  const dependents = await contextDependents(projectId, item, target.version);
  const s = await createSuggestion(projectId, actor, {
    scope: item.scope, label: 'revert', why: `Revert to v${target.version}: ${reason}`, source: 'person',
    changes: [{ op: 'update', itemId: item.id, content: target.content, archived: false }],
  });
  await logEvent(projectId, {
    type: 'context.reverted', actorId: actor.id, department: item.scope === 'central' ? null : item.scope,
    level: item.scope === 'central' ? 'central' : 'department', itemId: item.id, suggestionId: s.id,
    title: `Reverted: ${item.title} back to v${target.version}`, plain: `${actor.name} reverted "${item.title}" to how it was in v${target.version}: ${reason}`,
    summary: `${actor.name} reverted ${scopeLabel(item.scope)} › ${item.title} (v${item.version} → content of v${target.version}): ${reason}`,
    data: { itemId: item.id, fromVersion: item.version, toVersion: target.version, reason, dependents, status: s.status },
  });
  return { suggestion: { id: s.id, status: s.status, reasons: s.reasons }, dependents };
}

// ---------------------------------------------------------------- code revert (undo a merge)
/** Merges into main after this one that touched the same files. */
async function laterMerges(projectId, sub) {
  const commits = await q(db.from('main_commits').select('*').eq('project_id', projectId).order('created_at'));
  const mine = commits.find((c) => c.id === sub.mergeInfo?.mergedId);
  return commits.filter((c) => mine && c.created_at > mine.created_at && c.files.some((f) => sub.files.includes(f)))
    .map((c) => ({ id: c.id, message: c.message, files: c.files.filter((f) => sub.files.includes(f)), at: c.created_at }));
}

// GET /api/team/revert/merge-preview?projectId&submissionId
export async function mergeRevertPreview(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const sub = await workSubmissions.get(ctx.query.submissionId);
  if (!sub || sub.projectId !== projectId || sub.status !== 'approved') throw new HttpError(404, 'Approved submission not found');
  return { submission: { id: sub.id, title: sub.title, files: sub.files }, laterMerges: await laterMerges(projectId, sub), canRevert: canRevert(actor, sub.department) };
}

// POST /api/team/revert/merge { projectId, submissionId, reason }
// Creates an "undo merge" submission (the reverse change) for the review queue.
// Approving it merges like any change; if later work touched the same lines the
// merge stops with a conflict for a person to resolve. Never forced.
export async function revertMerge(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const sub = await workSubmissions.get(ctx.body.submissionId);
  if (!sub || sub.projectId !== projectId || sub.status !== 'approved') throw new HttpError(404, 'Approved submission not found');
  if (!canRevert(actor, sub.department)) throw new HttpError(403, 'Only this department\'s manager or the founder can undo a merge');
  const reason = String(ctx.body.reason ?? '').trim();
  if (!reason) throw new HttpError(400, 'Say why you are undoing it');
  const later = await laterMerges(projectId, sub);
  const nulls = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? null]));
  const undo = {
    id: workSubmissions.newId(), projectId, taskId: null, userId: actor.id, userName: actor.name, department: sub.department,
    title: `Undo: ${sub.title}`.slice(0, 120), summary: `Puts ${sub.files.join(', ')} back to how they were before "${sub.title}".`,
    why: reason, kind: 'undo', undoOf: sub.id,
    diff: diffMaps(Object.fromEntries(Object.entries(sub.changes).filter(([, v]) => v !== null)), Object.fromEntries(Object.entries(sub.base).filter(([, v]) => v !== null))).diff,
    files: sub.files, builtOn: sub.builtOn, status: 'pending', base: nulls(sub.changes), changes: nulls(sub.base),
    reviewNote: null, reviewedBy: null, reviewedAt: null, mergeInfo: null, laterMerges: later, createdAt: new Date().toISOString(),
  };
  await workSubmissions.put(undo);
  await logEvent(projectId, {
    type: 'merge.revert_requested', actorId: actor.id, department: sub.department, submissionId: undo.id,
    title: `Undo requested: ${sub.title}`, plain: `${actor.name} asked to undo "${sub.title}": ${reason}`,
    summary: `${actor.name} asked to undo "${sub.title}" (${later.length} later merge(s) touched the same files)`,
    data: { undoOf: sub.id, reason, laterMerges: later },
  });
  return { submission: { id: undo.id, title: undo.title, status: undo.status }, laterMerges: later };
}

// ---------------------------------------------------------------- search by meaning
// GET /api/team/search?projectId&q
export async function search(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const query = String(ctx.query.q ?? '').trim();
  if (query.length < 2) throw new HttpError(400, 'Type what you are looking for');
  return searchIndex(projectId, query, { department: actor.department, limit: Number(ctx.query.limit) || 10 });
}

// ---------------------------------------------------------------- drift check
/**
 * Looks at the whole project against the plans for slow drift that no single
 * change would reveal. Plain code: rules found in the main project's files,
 * department plans that contradict central, progress still describing what is
 * now obsolete, and workarounds piling up.
 */
export async function runDrift(projectId, by = null) {
  const [sections, files, departments, all] = await Promise.all([
    listSections(projectId), readAll(projectId, 'main'), listDepartments(projectId), suggestions.list(projectId, {}, 1000),
  ]);
  const plan = sections.filter((s) => s.kind !== 'progress' && s.kind !== 'checkpoint');
  const findings = [];
  // 1. The built project vs the rules (only phrases a rule forbids or made obsolete).
  for (const [path, content] of Object.entries(files)) {
    const dept = departments.find((d) => d.paths?.some((p) => path.startsWith(p)));
    const rules = plan.filter((s) => s.scope === 'central' || s.scope === dept?.id);
    for (const c of guardrailConflicts(content.replace(/[<>/=".{}();]/g, ' '), rules)) {
      if (!c.kind || c.kind === 'outdated' || rules.find((r) => r.id === c.sectionId)?.kind === 'must_not') {
        findings.push({ kind: 'built', severity: 'high', where: path, department: dept?.id ?? null, sectionId: c.sectionId, text: `${path} contains "${c.phrase}", but ${scopeLabel(c.scope)} › ${c.sectionTitle} says: ${c.note}` });
      }
    }
  }
  // 2. Department plans that contradict the central plan (central wins).
  const central = plan.filter((s) => s.scope === 'central');
  for (const s of plan.filter((x) => x.scope !== 'central')) {
    for (const c of guardrailConflicts(s.content, central)) {
      findings.push({ kind: 'plan', severity: 'high', where: `${scopeLabel(s.scope)} › ${s.title}`, department: s.scope, sectionId: c.sectionId, text: `${scopeLabel(s.scope)} › ${s.title} mentions "${c.phrase}", but Central › ${c.sectionTitle} says: ${c.note}` });
    }
  }
  // 3. Progress still describing something that is now obsolete.
  const obsolete = plan.flatMap((s) => s.guardrails.filter((g) => g.obsoleteSince).map((g) => ({ term: g.phrase, s })));
  for (const p of sections.filter((x) => x.kind === 'progress')) {
    const hit = obsolete.find((o) => mentions(p.content, [o.term]).length);
    if (hit) findings.push({ kind: 'progress', severity: 'medium', where: `${scopeLabel(p.scope)} › ${p.title}`, department: p.scope, sectionId: p.id, text: `Progress "${p.title}" still mentions "${hit.term}", which ${hit.s.title} made obsolete.` });
  }
  // 4. Workarounds piling up in one department (quiet exceptions).
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const workarounds = all.filter((s) => s.status === 'workaround' && s.createdAt > since);
  for (const d of departments) {
    const n = workarounds.filter((s) => s.department === d.id).length;
    if (n >= 3) findings.push({ kind: 'workarounds', severity: 'medium', where: d.name, department: d.id, text: `${d.name} resolved ${n} central conflicts with workarounds in two weeks. The central plan may need to change.` });
  }
  const ranAt = new Date().toISOString();
  const headline = findings.length
    ? `Drift check found ${findings.length} thing(s) where the project is moving away from the plan.`
    : 'Drift check: the project still matches the plans.';
  await logEvent(projectId, {
    type: 'drift.check', actorId: by, level: 'central', title: findings.length ? 'Drift found' : 'No drift',
    plain: findings.length ? `${headline} ${findings.slice(0, 3).map((f) => f.text).join(' ')}` : headline,
    summary: headline, data: { findings, ranAt },
  });
  if (findings.length) {
    const people = await listPeople(projectId);
    const to = [await ownerOf(projectId), ...people.filter((p) => p.isManager && findings.some((f) => f.department === p.department)).map((p) => p.id)];
    await notifyMany(projectId, to, { kind: 'drift', title: 'Drift check found something', body: findings.slice(0, 5).map((f) => f.text).join('\n') }, { actorId: by });
  }
  return { findings, headline, ranAt };
}

// POST /api/team/drift/run { projectId }   (founder or a manager)
export async function driftRun(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  if (!actor.isManager) throw new HttpError(403, 'The founder or a manager runs the drift check');
  return runDrift(projectId, actor.id);
}

// GET /api/team/drift/latest?projectId
export async function driftLatest(ctx) {
  const { projectId } = await actorFor(ctx);
  const row = (await q(db.from('activity_log').select('*').eq('project_id', projectId).eq('type', 'drift.check').order('id', { ascending: false }).limit(1)))[0];
  return { run: row ? { findings: row.data.findings, headline: row.summary, ranAt: row.data.ranAt } : null };
}

/**
 * GET /api/team/drift/cron   (Vercel Cron, daily; Authorization: Bearer $CRON_SECRET)
 * Runs the drift check for every project that has departments.
 */
export async function driftCron({ req }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req?.headers?.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Not allowed');
  const projects = [...new Set((await q(db.from('departments').select('project_id'))).map((r) => r.project_id))];
  const results = [];
  for (const id of projects) results.push({ projectId: id, findings: (await runDrift(id)).findings.length });
  return { ran: results };
}

