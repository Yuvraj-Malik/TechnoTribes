// Suggestions (the only way shared context changes), approval queues, and
// checkpoints. The routing rules live in api/_lib/suggestions.js.
import { HttpError } from '../api/_lib/errors.js';
import { suggestions, devTasks } from '../api/_lib/records.js';
import { listPeople, teamActor } from '../api/_lib/team.js';
import { listSections, listVersions, scopeLabel } from '../api/_lib/context.js';
import { notifyMany } from '../api/_lib/activity.js';
import { canDecide, createSuggestion, decideSuggestion, onApplied } from '../api/_lib/suggestions.js';
import { raiseContextAlert } from './team-workspace.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;
const ACTIVE = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'done', 'needs_context_decision', 'needs_action_approval', 'sent_back'];

// After any suggestion changes the context: developers whose active task uses a
// changed item get the mid-task "context changed" card; everyone who reads that
// context (the department, or everyone for central) gets a notice.
onApplied(async ({ projectId, suggestion: s, applied, by }) => {
  const sections = await listSections(projectId, undefined, { includeArchived: true });
  const changes = await Promise.all(applied.map(async (a) => {
    const item = sections.find((x) => x.id === a.itemId);
    const version = (await listVersions(projectId, { sectionId: a.itemId })).find((v) => v.version === a.version);
    return { sectionId: a.itemId, title: item?.title ?? a.itemId, scope: item?.scope ?? s.scope, fromVersion: a.version - 1, toVersion: a.version, why: version?.why ?? s.why };
  }));
  const ids = changes.map((c) => c.sectionId);
  const summary = changes.map((c) => `${scopeLabel(c.scope)} › ${c.title}: ${s.why}`).join('; ');
  const people = await listPeople(projectId);
  const alerted = new Set();
  for (const p of people.filter((x) => x.isDeveloper && x.id !== s.suggestedBy)) {
    const tasks = await devTasks.list(projectId, { user_id: p.id }, 1);
    const t = tasks[0];
    if (t && ACTIVE.includes(t.status) && t.relevantSectionIds.some((id) => ids.includes(id))) {
      await raiseContextAlert(projectId, p.id, changes, summary, s.obsoleteTerms ?? []);
      alerted.add(p.id);
    }
  }
  // Progress notes are routine: only plan changes and checkpoints are announced.
  if (s.label === 'progress') return;
  const scopes = new Set(changes.map((c) => c.scope));
  const readers = people.filter((p) => (p.isDeveloper || p.isManager) && p.id !== by && !alerted.has(p.id)
    && (scopes.has('central') || scopes.has(p.department))).map((p) => p.id);
  await notifyMany(projectId, readers, {
    kind: 'context_change',
    title: s.label === 'checkpoint' ? `Checkpoint reached: ${changes[0]?.title}` : `${[...scopes].map(scopeLabel).join(' + ')} context updated`,
    body: changes.map((c) => `${c.title} v${c.fromVersion || 1} → v${c.toVersion}: ${c.why}`).join('\n'),
  }, { actorId: by, department: s.department, suggestionId: s.id });
});

/**
 * Routes a batch of context edits made by a person (Context page, after-merge
 * update) through the suggestion router. Groups: one suggestion per scope;
 * edits to another department's items join the central suggestion, because a
 * cross-department change is a central matter. Returns the suggestions.
 */
export async function routeEdits(projectId, actor, edits, { why, submissionId, obsoleteTerms } = {}) {
  const sections = await listSections(projectId);
  const own = actor.role === 'owner' ? null : actor.department;
  const groups = new Map();
  for (const e of edits) {
    const item = sections.find((x) => x.id === e.itemId);
    if (!item && e.op !== 'add') throw new HttpError(404, `Unknown context item ${e.itemId}`);
    const scope = e.op === 'add' ? e.scope : item.scope;
    const key = actor.role === 'owner' || scope === own ? scope : 'central';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = [];
  for (const [scope, changes] of [...groups.entries()].sort(([a]) => (a === 'central' ? 1 : 0))) {
    const reasons = [...new Set(changes.map((c) => c.why).filter(Boolean))].join('; ');
    out.push(await createSuggestion(projectId, actor, {
      scope, changes, why: reasons || why, submissionId, obsoleteTerms, source: 'person',
    }));
  }
  return out;
}

async function actorFor(ctx) {
  const projectId = projectIdOf(ctx);
  return { projectId, actor: await teamActor({ user: ctx.user, req: ctx.req, projectId }) };
}

// POST /api/team/suggestions/create { projectId, scope, changes, why, basedOn?, taskId?, files? }
export async function create(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const { scope, changes, why, basedOn, taskId, files } = ctx.body;
  if (taskId) {
    const t = await devTasks.get(taskId);
    if (!t || t.userId !== actor.id) throw new HttpError(403, 'That is not your task');
  }
  return createSuggestion(projectId, actor, { scope, changes, why, basedOn, taskId, files });
}

// POST /api/team/checkpoints/flag { projectId, title, content, links: [itemIds] }   (department manager)
// A major milestone for central progress; the founder confirms it.
export async function flagCheckpoint(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  if (!(actor.role === 'admin' && actor.department) && actor.role !== 'owner') throw new HttpError(403, 'Department managers flag checkpoints');
  const { title, content } = ctx.body;
  if (!String(title ?? '').trim() || !String(content ?? '').trim()) throw new HttpError(400, 'Give the checkpoint a title and a description');
  const progress = (await listSections(projectId, actor.department)).filter((s) => s.kind === 'progress').map((s) => s.id);
  const links = (ctx.body.links ?? []).filter((id) => progress.includes(id)).map((id) => ({ type: 'item', id }));
  return createSuggestion(projectId, actor, {
    scope: 'central', label: 'checkpoint', links, why: `Checkpoint reached in ${actor.department ?? 'the project'}: ${title}`,
    changes: [{ op: 'add', kind: 'checkpoint', title: String(title).trim(), content: String(content).trim(), tags: [] }],
  });
}

// POST /api/team/suggestions/decide { projectId, suggestionId, action, reason? }
export async function decide(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  return decideSuggestion(projectId, actor, ctx.body.suggestionId, ctx.body.action, ctx.body.reason);
}

/** Adds what each changed item says now, so a decision shows old vs new. */
function withCurrent(changes, sections, scope) {
  return changes.map((c) => {
    const item = c.itemId ? sections.find((x) => x.id === c.itemId) : null;
    return { ...c, scope: item?.scope ?? c.scope ?? scope, current: item ? { content: item.content, version: item.version, kind: item.kind } : null };
  });
}

/** What depends on the items a suggestion touches: active tasks built on them, other open suggestions. */
async function dependents(projectId, s, tasks, open) {
  const ids = s.changes.map((c) => c.itemId).filter(Boolean);
  if (!ids.length) return { tasks: [], suggestions: [] };
  return {
    tasks: tasks.filter((t) => ACTIVE.includes(t.status) && t.relevantSectionIds.some((id) => ids.includes(id)))
      .map((t) => ({ taskId: t.id, userId: t.userId, userName: t.userName, text: t.text, status: t.status })),
    suggestions: open.filter((o) => o.id !== s.id && o.changes.some((c) => ids.includes(c.itemId))).map((o) => ({ id: o.id, why: o.why })),
  };
}

// GET /api/team/suggestions/queue?projectId
// Manager: their department's items (incl. central matters they look at first). Founder: central decisions.
export async function queue(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const open = await suggestions.list(projectId, { status: ['pending_manager', 'pending_founder'] }, 500);
  // The founder's queue holds central decisions and checkpoints only; department
  // matters belong to that department's manager.
  const mine = open.filter((s) => canDecide(actor, s) && (actor.role !== 'owner' || s.status === 'pending_founder'));
  const tasks = await devTasks.list(projectId, {}, 500);
  const sections = await listSections(projectId, undefined, { includeArchived: true });
  const items = await Promise.all(mine.map(async (s) => ({
    ...s, changes: withCurrent(s.changes, sections, s.scope), dependents: await dependents(projectId, s, tasks, open),
  })));
  return { items };
}

// GET /api/team/suggestions/mine?projectId[&taskId]
export async function mine(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const where = { suggested_by: actor.id };
  if (ctx.query.taskId) where.task_id = ctx.query.taskId;
  return { items: await suggestions.list(projectId, where, 200) };
}

// GET /api/team/suggestions/get?projectId&suggestionId
export async function get(ctx) {
  const { projectId, actor } = await actorFor(ctx);
  const s = await suggestions.get(ctx.query.suggestionId);
  if (!s || s.projectId !== projectId) throw new HttpError(404, 'Suggestion not found');
  if (s.suggestedBy !== actor.id && !actor.isManager) throw new HttpError(403, 'Not yours to see');
  const open = await suggestions.list(projectId, { status: ['pending_manager', 'pending_founder'] }, 500);
  const sections = await listSections(projectId, undefined, { includeArchived: true });
  return { ...s, changes: withCurrent(s.changes, sections, s.scope), dependents: await dependents(projectId, s, await devTasks.list(projectId, {}, 500), open), canDecide: canDecide(actor, s) };
}
