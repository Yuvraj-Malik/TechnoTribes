// The change router. Agents (and people) never edit shared context: they
// create a suggestion, and plain code decides from FACTS about the change
// (what it touches, whose area it is in, which rules it hits, what it was
// based on) where it goes. Never from the suggester's opinion of it.
//
//   blocked          outside the suggester's area                  (logged)
//   sent_back        based on context that has since changed       (agent re-checks)
//   path 4           touches central: department manager first
//                    (workaround or escalate), then the founder
//   path 3 conflict  breaks a department rule        -> department manager
//   path 2 plan      changes the department plan     -> department manager
//   path 1 applied   progress only, in its own department, no rule hit,
//                    within the direct-apply budget  -> applied + logged
//   large_change     too many direct changes (split guard) -> department manager
//
// When in doubt, a human decides. Conflicts are never fixed silently.
import { HttpError } from './errors.js';
import { devTasks, suggestions } from './records.js';
import { ownerOf } from './log.js';
import { logEvent, notifyMany } from './activity.js';
import { addItem, changeSection, guardrailConflicts, isProgress, KIND_LABEL, listSections, scopeLabel } from './context.js';
import { listDepartments } from './team.js';
import { agentMode, getTeamAgent } from './team-agent/index.js';

// Split guard: per task, and per agent over a recent window.
export const LIMITS = { notesPerTask: 3, filesPerTask: 5, notesPerWindow: 3, windowHours: 24 };

const OPEN = ['pending_manager', 'pending_founder'];
const nowIso = () => new Date().toISOString();

const levelOf = (scope) => (scope === 'central' ? 'central' : 'department');

/** Who decides a suggestion: 'manager' (of `department`) or 'founder'. */
export const deciderOf = (s) => (s.status === 'pending_founder' ? 'founder' : 'manager');

// ---------------------------------------------------------------- reviewer
let reviewerOverride = null;
/** Tests can swap in their own reviewer: fn({ change, scope, planItems, recent }) → { flags, confident }. */
export function setReviewer(fn) { reviewerOverride = fn; }

/**
 * The reviewer agent looks at changes that would otherwise apply without a
 * person. It advises only: its flags send the change to a person; it can never
 * clear a flag the rules raised. If it fails or is unsure, a person decides.
 */
async function review(projectId, actor, s, sections) {
  const planItems = sections.filter((x) => !isProgress(x.kind) && !x.archived && (x.scope === 'central' || x.scope === actor.department));
  const since = new Date(Date.now() - LIMITS.windowHours * 3600_000).toISOString();
  const recent = (await suggestions.list(projectId, { status: 'applied', suggested_by: actor.id }, 50))
    .filter((x) => x.createdAt > since).flatMap((x) => x.changes);
  const reviewer = reviewerOverride ?? ((input) => getTeamAgent(projectId).review(input));
  try {
    const results = await Promise.all(s.changes.map((change) => reviewer({ change, scope: s.scope, planItems, recent })));
    const flags = results.flatMap((r) => r.flags ?? []).map((f) => {
      const item = sections.find((x) => x.id === f.itemId);
      return { sectionId: f.itemId, sectionTitle: item?.title ?? f.itemId, scope: item?.scope ?? s.scope, explanation: f.explanation, rule: 'reviewer' };
    });
    return { mode: reviewerOverride ? 'test' : agentMode(), flags, confident: results.every((r) => r.confident !== false), error: null };
  } catch (err) {
    return { mode: agentMode(), flags: [], confident: false, error: err.message };
  }
}

// ---------------------------------------------------------------- facts
/** Does the change text break a rule (guardrail) of the central or department plan? */
function ruleHits(change, sections, department) {
  const text = `${change.title ?? ''} ${change.content ?? ''}`;
  // A change is not judged against the old version of the item it replaces.
  const rules = sections.filter((s) => !isProgress(s.kind) && !s.archived && s.id !== change.itemId
    && (s.scope === 'central' || s.scope === department));
  return guardrailConflicts(text, rules).map((c) => ({ ...c, rule: 'guardrail' }));
}

/** Items whose version moved on since the suggestion was based on them. */
function staleItems(basedOn, sections) {
  return Object.entries(basedOn ?? {}).flatMap(([id, v]) => {
    const s = sections.find((x) => x.id === id);
    return s && s.version > v ? [{ itemId: id, title: s.title, basedOn: v, current: s.version }] : [];
  });
}

async function directApplied(projectId, where) {
  return (await suggestions.list(projectId, { status: 'applied', ...where }, 500));
}

/**
 * Decides the route of a suggestion from facts. Pure apart from reading
 * context and earlier suggestions. Returns { status, label, reasons, ruleHits, stale }.
 */
export async function route(projectId, actor, s) {
  const sections = await listSections(projectId, undefined, { includeArchived: true });
  const reasons = [];

  // 1. Area: only your own department's context. Central only as a suggestion to the founder.
  const ownArea = s.scope === 'central' || s.scope === actor.department || actor.role === 'owner';
  if (!ownArea) {
    return { status: 'blocked', label: null, reasons: [`${scopeLabel(s.scope)} context belongs to another department. Send that department a request instead.`], ruleHits: [], stale: [] };
  }
  for (const c of s.changes) {
    const item = c.itemId ? sections.find((x) => x.id === c.itemId) : null;
    if (c.itemId && !item) return { status: 'blocked', label: null, reasons: [`Unknown context item ${c.itemId}.`], ruleHits: [], stale: [] };
    if (item && item.scope !== s.scope && s.scope !== 'central') {
      return { status: 'blocked', label: null, reasons: [`"${item.title}" is in ${scopeLabel(item.scope)} context, not ${scopeLabel(s.scope)}.`], ruleHits: [], stale: [] };
    }
  }

  // 2. Stale: built on information that has changed since.
  const stale = staleItems(s.basedOn, sections);
  if (stale.length) {
    return {
      status: 'sent_back', label: s.label ?? null, ruleHits: [], stale,
      reasons: stale.map((x) => `"${x.title}" changed (v${x.basedOn} → v${x.current}) after this was written. Re-check against the new version.`),
    };
  }

  // 3. Facts about each change.
  const hits = s.changes.flatMap((c) => ruleHits(c, sections, actor.department));
  const centralHits = hits.filter((h) => h.scope === 'central');
  const touchesPlan = s.changes.some((c) => {
    const item = c.itemId ? sections.find((x) => x.id === c.itemId) : null;
    return !isProgress(item?.kind ?? c.kind);
  });

  // Checkpoints: flagged by a manager, confirmed by the founder.
  if (s.label === 'checkpoint') {
    return { status: 'pending_founder', label: 'checkpoint', ruleHits: hits, stale: [], reasons: ['Checkpoints go into central progress, which only the founder confirms.'] };
  }

  // Path 4: anything touching central context, or conflicting with it.
  if (s.scope === 'central' || centralHits.length) {
    const label = centralHits.length ? 'conflict' : 'plan_change';
    reasons.push(...(s.scope === 'central' ? ['It changes the central context, which only the founder can approve.'] : []));
    reasons.push(...centralHits.map((h) => h.explanation));
    // The department manager looks first (workaround or escalate); a founder or manager suggesting goes straight up.
    const status = actor.role === 'owner' || actor.role === 'admin' ? 'pending_founder' : 'pending_manager';
    return { status, label, ruleHits: hits, stale: [], reasons, central: true };
  }

  // Path 3: conflicts with the department plan.
  if (hits.length) {
    return { status: 'pending_manager', label: 'conflict', ruleHits: hits, stale: [], reasons: hits.map((h) => h.explanation) };
  }

  // Path 2: changes the department plan.
  if (touchesPlan) {
    const titles = s.changes.map((c) => sections.find((x) => x.id === c.itemId)?.title ?? c.title).filter(Boolean);
    return { status: 'pending_manager', label: 'plan_change', ruleHits: [], stale: [], reasons: [`It changes the ${scopeLabel(s.scope)} plan (${titles.join(', ')}), which the department manager decides.`] };
  }

  // Split guard: judge the combined effect, not each piece.
  const notes = s.changes.length;
  if (notes > LIMITS.notesPerTask || (s.files?.length ?? 0) > LIMITS.filesPerTask) {
    return { status: 'pending_manager', label: 'large_change', ruleHits: [], stale: [], reasons: [`It is large (${notes} notes, ${s.files?.length ?? 0} files): more than one task may apply directly (${LIMITS.notesPerTask} notes, ${LIMITS.filesPerTask} files).`] };
  }
  if (s.taskId) {
    const sameTask = (await directApplied(projectId, { task_id: s.taskId })).reduce((n, x) => n + x.changes.length, 0);
    if (sameTask + notes > LIMITS.notesPerTask) {
      return { status: 'pending_manager', label: 'large_change', ruleHits: [], stale: [], reasons: [`This task already applied ${sameTask} change(s) directly; together they exceed ${LIMITS.notesPerTask}, so a person looks at the whole.`] };
    }
  }
  const since = new Date(Date.now() - LIMITS.windowHours * 3600_000).toISOString();
  const recent = (await directApplied(projectId, { suggested_by: actor.id, scope: s.scope }))
    .filter((x) => x.createdAt > since).reduce((n, x) => n + x.changes.length, 0);
  if (recent + notes > LIMITS.notesPerWindow) {
    return { status: 'pending_manager', label: 'large_change', ruleHits: [], stale: [], reasons: [`${actor.name} applied ${recent} change(s) to ${scopeLabel(s.scope)} in the last ${LIMITS.windowHours} hours; together with this one they exceed ${LIMITS.notesPerWindow}.`] };
  }

  // Reviewer: only for changes still heading to direct apply.
  const reviewer = await review(projectId, actor, s, sections);
  if (reviewer.flags.length) {
    const central = reviewer.flags.some((f) => f.scope === 'central');
    return {
      status: 'pending_manager', label: 'conflict', ruleHits: reviewer.flags, stale: [], reviewer, central,
      reasons: reviewer.flags.map((f) => `Reviewer: ${f.explanation}`),
    };
  }
  if (!reviewer.confident) {
    return {
      status: 'pending_manager', label: 'unchecked', ruleHits: [], stale: [], reviewer,
      reasons: [reviewer.error ? `The reviewer could not check this (${reviewer.error}), so a person decides.` : 'The reviewer was not sure, so a person decides.'],
    };
  }

  // Path 1: small, in its own department, progress only, no rule hit.
  return { status: 'applied', label: 'progress', ruleHits: [], stale: [], reviewer, reasons: ['Progress only, inside the department, no conflict with the central or department plan.'] };
}

// ---------------------------------------------------------------- applying
const appliedHooks = [];
/** Registers fn({ projectId, suggestion, applied, by }) to run after a suggestion changes the context. */
export function onApplied(fn) { appliedHooks.push(fn); }
async function runHooks(projectId, suggestion, by) {
  for (const fn of appliedHooks) await fn({ projectId, suggestion, applied: suggestion.applied, by });
}

/** Applies a suggestion's changes to the context (new versions, never overwrites). */
async function apply(projectId, s, by) {
  const cause = { suggestionId: s.id, taskId: s.taskId ?? null };
  const bumpedScopes = new Set();
  const applied = [];
  const sections = await listSections(projectId, undefined, { includeArchived: true });
  const scopeOf = (c) => (c.itemId ? sections.find((x) => x.id === c.itemId)?.scope : s.scope);
  const ordered = [...s.changes.filter((c) => scopeOf(c) === 'central'), ...s.changes.filter((c) => scopeOf(c) !== 'central')];
  for (const c of ordered) {
    if (c.op === 'add') {
      const meta = s.label === 'checkpoint' ? { flaggedBy: s.suggestedBy, department: s.department, confirmedBy: by, links: s.links ?? [] } : (c.meta ?? {});
      const r = await addItem(projectId, {
        scope: c.scope ?? s.scope, kind: c.kind, title: c.title, content: c.content, why: s.why, by, ownerId: by, tags: c.tags ?? [], guardrails: c.guardrails ?? [], meta,
      }, { cause, bumpedScopes, links: s.links ?? [] });
      applied.push({ itemId: r.id, version: 1 });
    } else {
      const r = await changeSection(projectId, {
        sectionId: c.itemId, content: c.op === 'remove' ? undefined : c.content, archived: c.op === 'remove' ? true : c.archived,
        why: c.why ?? s.why, by, cause, bumpedScopes, links: s.links ?? [], guardrails: c.guardrails,
      });
      applied.push({ itemId: c.itemId, version: r.toVersion });
    }
  }
  return applied;
}

function describe(s) {
  return s.changes.map((c) => {
    const what = c.op === 'add' ? `add ${KIND_LABEL[c.kind] ?? 'item'} "${c.title}"` : c.op === 'remove' ? `remove "${c.title ?? c.itemId}"` : `update "${c.title ?? c.itemId}"`;
    return what;
  }).join('; ');
}

const STATUS_WORDS = {
  applied: 'applied directly', pending_manager: 'sent to the department manager', pending_founder: 'sent to the founder',
  blocked: 'blocked', sent_back: 'sent back to re-check',
};

// ---------------------------------------------------------------- create
/**
 * Creates and routes a suggestion.
 * input: { scope, changes: [{ op: add|update|remove, itemId?, kind?, title?, content?, tags?, guardrails? }],
 *          why, basedOn?: { itemId: version }, taskId?, files?, label?, links?, source? }
 */
export async function createSuggestion(projectId, actor, input) {
  if (!input.scope) throw new HttpError(400, 'scope is required');
  if (!Array.isArray(input.changes) || !input.changes.length) throw new HttpError(400, 'A suggestion needs at least one change');
  if (!String(input.why ?? '').trim()) throw new HttpError(400, 'Say why');
  for (const c of input.changes) {
    if (!['add', 'update', 'remove'].includes(c.op)) throw new HttpError(400, 'Each change needs op: add, update or remove');
    if (c.op !== 'add' && !c.itemId) throw new HttpError(400, 'update and remove need an itemId');
    if (c.op === 'add' && (!c.kind || !c.title || !c.content)) throw new HttpError(400, 'add needs kind, title and content');
  }
  // One open suggestion per context item at a time.
  const targets = input.changes.map((c) => c.itemId).filter(Boolean);
  if (targets.length) {
    const open = await suggestions.list(projectId, { status: OPEN }, 500);
    const clash = open.find((o) => o.changes.some((c) => targets.includes(c.itemId)));
    if (clash) throw new HttpError(409, `There is already an open suggestion for this item ("${clash.why}"). Wait until it is decided.`);
  }

  const sections = await listSections(projectId, undefined, { includeArchived: true });
  const s = {
    id: suggestions.newId(), projectId, department: actor.department, scope: input.scope, label: input.label ?? null,
    suggestedBy: actor.id, suggesterName: actor.name, source: input.source ?? (actor.role === 'worker' ? 'agent' : 'person'),
    taskId: input.taskId ?? null, why: String(input.why).trim(), files: input.files ?? [], links: input.links ?? [],
    changes: input.changes.map((c) => ({ ...c, title: c.title ?? sections.find((x) => x.id === c.itemId)?.title ?? null, kind: c.kind ?? sections.find((x) => x.id === c.itemId)?.kind ?? null })),
    basedOn: input.basedOn ?? Object.fromEntries(targets.map((id) => [id, sections.find((x) => x.id === id)?.version]).filter(([, v]) => v)),
    obsoleteTerms: input.obsoleteTerms ?? [], submissionId: input.submissionId ?? null,
    createdAt: nowIso(), decidedAt: null, decision: null, managerNote: null, applied: [],
  };
  // A person who decides this scope applies their own plan changes directly (still logged).
  const r = await route(projectId, actor, s);
  const selfDecides = (r.status === 'pending_founder' && actor.role === 'owner')
    || (r.status === 'pending_manager' && actor.role === 'admin' && actor.department === s.scope);
  Object.assign(s, { status: r.status, label: s.label ?? r.label, reasons: r.reasons, ruleHits: r.ruleHits, stale: r.stale, reviewer: r.reviewer ?? null });

  if (r.status === 'applied' || selfDecides) {
    if (selfDecides) s.decision = { by: actor.id, action: 'approve', reason: 'Decided by the owner of this context.', at: nowIso() };
    s.status = selfDecides ? 'approved' : 'applied';
    s.decidedAt = nowIso();
    await suggestions.put(s);
    s.applied = await apply(projectId, s, actor.id);
  }
  await suggestions.put(s);
  if (s.applied.length) await runHooks(projectId, s, actor.id);

  const level = r.status === 'blocked' ? (actor.department ? 'department' : 'central') : levelOf(s.scope);
  await logEvent(projectId, {
    type: r.status === 'blocked' ? 'permission.blocked' : `suggestion.${s.status}`, actorId: actor.id,
    department: actor.department, level, taskId: s.taskId, suggestionId: s.id,
    title: r.status === 'blocked' ? `Blocked: ${actor.name} tried to change ${scopeLabel(s.scope)} context` : `Suggestion ${STATUS_WORDS[s.status] ?? s.status}`,
    plain: `${actor.name}${s.source === 'agent' ? "'s agent" : ''} suggested to ${describe(s)}. ${r.reasons.join(' ')}`,
    summary: `${actor.name}${s.source === 'agent' ? "'s agent" : ''} suggested (${scopeLabel(s.scope)}): ${describe(s)} → ${STATUS_WORDS[s.status] ?? s.status}`,
    data: { scope: s.scope, label: s.label, status: s.status, reasons: r.reasons, ruleHits: r.ruleHits, stale: r.stale, changes: s.changes, why: s.why },
  });
  await tellDecider(projectId, s);
  return s;
}

// ---------------------------------------------------------------- deciding
async function deciderIds(projectId, s) {
  const departments = await listDepartments(projectId);
  if (s.status === 'pending_founder') {
    return [await ownerOf(projectId)];
  }
  const dept = departments.find((d) => d.id === (s.scope === 'central' ? s.department : s.scope));
  return [dept?.managerId];
}

async function tellDecider(projectId, s) {
  if (!OPEN.includes(s.status)) return;
  const to = await deciderIds(projectId, s);
  await notifyMany(projectId, to, {
    kind: 'suggestion', title: `${s.status === 'pending_founder' ? 'Founder' : 'Manager'} decision needed: ${s.label?.replace('_', ' ') ?? 'suggestion'}`,
    body: `${s.suggesterName}: ${describe(s)}\nWhy: ${s.why}\n${(s.reasons ?? []).join('\n')}`,
  }, { department: s.department, taskId: s.taskId, suggestionId: s.id });
}

/** Can this person decide this suggestion now? */
export function canDecide(actor, s) {
  if (s.status === 'pending_founder') return actor.role === 'owner';
  if (s.status === 'pending_manager') {
    const dept = s.scope === 'central' ? s.department : s.scope;
    return actor.role === 'owner' || (actor.role === 'admin' && actor.department === dept);
  }
  return false;
}

/**
 * Decides a suggestion.
 *   manager: approve | reject   (department matters)
 *            workaround | escalate (central matters: a manager never approves central)
 *   founder: approve | reject
 * A reason is required for everything but approve; it goes back to the suggester.
 */
export async function decideSuggestion(projectId, actor, id, action, reason = '') {
  const s = await suggestions.get(id);
  if (!s || s.projectId !== projectId) throw new HttpError(404, 'Suggestion not found');
  if (!canDecide(actor, s)) throw new HttpError(403, s.status === 'pending_founder' ? 'Only the founder decides this' : 'Only this department\'s manager decides this');
  const note = String(reason ?? '').trim();
  const central = s.scope === 'central' || (s.ruleHits ?? []).some((h) => h.scope === 'central');
  const atManager = s.status === 'pending_manager';

  const allowed = atManager && central ? ['workaround', 'escalate', 'reject'] : ['approve', 'reject'];
  if (!allowed.includes(action)) throw new HttpError(400, `Allowed here: ${allowed.join(', ')}`);
  if (action !== 'approve' && !note) throw new HttpError(400, 'Give a reason; the agent gets it so it does not repeat the mistake');

  if (action === 'escalate') {
    Object.assign(s, { status: 'pending_founder', managerNote: note, escalatedBy: actor.id, escalatedAt: nowIso() });
    await suggestions.put(s);
    await logEvent(projectId, {
      type: 'suggestion.escalated', actorId: actor.id, department: s.department, level: 'central', taskId: s.taskId, suggestionId: s.id,
      title: 'Escalated to the founder', plain: `${actor.name} says the central context has to change: ${note}`,
      summary: `${actor.name} escalated "${describe(s)}" to the founder: ${note}`, data: { note },
    });
    await tellDecider(projectId, s);
    return s;
  }

  // Re-check freshness right before applying.
  if (action === 'approve') {
    const stale = staleItems(s.basedOn, await listSections(projectId));
    if (stale.length) {
      Object.assign(s, { status: 'sent_back', stale, reasons: stale.map((x) => `"${x.title}" changed (v${x.basedOn} → v${x.current}) before this was approved. Re-check against the new version.`), decidedAt: nowIso() });
      await suggestions.put(s);
      await logEvent(projectId, {
        type: 'suggestion.sent_back', actorId: actor.id, department: s.department, level: levelOf(s.scope), taskId: s.taskId, suggestionId: s.id,
        title: 'Sent back: based on changed information', plain: s.reasons.join(' '), summary: `"${describe(s)}" was based on changed context and went back to re-check`, data: { stale },
      });
      await tellSuggester(projectId, s, 'Sent back to re-check', s.reasons.join(' '));
      return s;
    }
  }

  const status = { approve: 'approved', reject: 'rejected', workaround: 'workaround' }[action];
  Object.assign(s, { status, decision: { by: actor.id, byName: actor.name, action, reason: note || null, at: nowIso() }, decidedAt: nowIso() });
  await suggestions.put(s);
  if (action === 'approve') s.applied = await apply(projectId, s, actor.id);
  await suggestions.put(s);
  if (s.applied?.length) await runHooks(projectId, s, actor.id);

  const word = { approve: 'approved', reject: 'rejected', workaround: 'resolved with a workaround' }[action];
  await logEvent(projectId, {
    type: s.label === 'checkpoint' && action === 'approve' ? 'checkpoint.confirmed' : `suggestion.${status}`, actorId: actor.id,
    department: s.department, level: levelOf(s.scope === 'central' || central ? 'central' : s.scope), taskId: s.taskId, suggestionId: s.id,
    itemId: s.applied[0]?.itemId ?? null, checkpointId: s.label === 'checkpoint' && action === 'approve' ? s.applied[0]?.itemId : null,
    links: s.links ?? [],
    title: s.label === 'checkpoint' && action === 'approve' ? `Checkpoint: ${s.changes[0].title}` : `Suggestion ${word}`,
    plain: s.label === 'checkpoint' && action === 'approve' ? s.changes[0].content : `${actor.name} ${word} "${describe(s)}"${note ? `: ${note}` : '.'}`,
    summary: `${actor.name} ${word} ${s.suggesterName}'s suggestion: ${describe(s)}${note ? ` (${note})` : ''}`,
    data: { action, reason: note || null, label: s.label, scope: s.scope, applied: s.applied },
  });
  await tellSuggester(projectId, s, `Your suggestion was ${word}`, note || describe(s));
  return s;
}

/** The suggester (and their agent, through the task) always gets the decision and reason. */
async function tellSuggester(projectId, s, title, body) {
  await notifyMany(projectId, [s.suggestedBy], { kind: 'suggestion', title, body }, { department: s.department, taskId: s.taskId, suggestionId: s.id });
  if (!s.taskId) return;
  const t = await devTasks.get(s.taskId);
  if (!t) return;
  t.messages.push({ from: 'system', text: `${title}: ${body}`, at: nowIso() });
  // Kept on the task so the agent sees the reason on its next step and does not repeat it.
  t.feedback = [...(t.feedback ?? []), { suggestionId: s.id, status: s.status, reason: body, at: nowIso() }];
  await devTasks.put({ ...t, updatedAt: nowIso() });
}
