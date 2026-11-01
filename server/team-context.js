// Editing the shared context directly (the owner's brief and requirements, or a
// manager's department notes). Uses the same impact analysis as the
// after-merge flow: preview who is affected, then save; developers whose active
// work depends on a changed section get the mid-task "context changed" alert.
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { listDepartments, listPeople, teamActor } from '../api/_lib/team.js';
import { changeSection, insertSection, listSections, scopeLabel } from '../api/_lib/context.js';
import { notifyMany, logEvent } from '../api/_lib/activity.js';
import { analyseImpact } from './team-impact.js';
import { raiseContextAlert } from './team-workspace.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;

/** Owner: any section. Manager (admin): their own department's sections. */
function canEdit(actor, scope) {
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && actor.department === scope;
}

async function editor(ctx, scope) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  if (!canEdit(actor, scope)) {
    throw new HttpError(403, scope === 'central'
      ? 'Only the project owner can change the central context'
      : 'Only the owner or this department\'s manager can change its context');
  }
  return { actor, projectId };
}

// Turns edits into the change list analyseImpact understands.
async function changesFor(projectId, edits, sourceScope) {
  const all = await listSections(projectId);
  return edits.map((e) => {
    const s = all.find((x) => x.id === e.sectionId);
    if (!s) throw new HttpError(404, `Unknown context section ${e.sectionId}`);
    const content = String(e.content ?? '').trim();
    if (!content) throw new HttpError(400, `"${s.title}" cannot be empty`);
    return {
      sectionId: s.id, scope: s.scope, title: s.title, oldContent: s.content, newContent: content,
      why: String(e.why ?? '').trim(), guardrails: s.guardrails, include: content !== s.content,
      level: s.scope === 'central' ? 'central' : s.scope === sourceScope ? 'own' : 'other',
      reason: 'Edited directly.',
    };
  });
}

function validEdits(body) {
  if (!Array.isArray(body.edits) || !body.edits.length) throw new HttpError(400, 'edits must be a non-empty list');
  return body.edits;
}

// POST /api/team/context/preview { projectId, scope, edits: [{ sectionId, content, why }] }
// Who would be affected, before anything is saved.
export async function preview(ctx) {
  requireFields(ctx.body, ['scope']);
  const { projectId } = await editor(ctx, ctx.body.scope);
  const changes = await changesFor(projectId, validEdits(ctx.body), ctx.body.scope);
  const impact = await analyseImpact(projectId, changes, ctx.body.scope, null, []);
  const people = await listPeople(projectId);
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? 'Someone';
  return {
    changed: changes.filter((c) => c.include).map((c) => ({ sectionId: c.sectionId, title: c.title, scope: c.scope })),
    impact: {
      ...impact,
      notify: impact.notify.map((n) => ({ ...n, name: nameOf(n.userId) })),
      unaffected: impact.unaffected.map((n) => ({ ...n, name: nameOf(n.userId) })),
    },
  };
}

// POST /api/team/context/save { projectId, scope, edits: [{ sectionId, content, why }] }
export async function save(ctx) {
  requireFields(ctx.body, ['scope']);
  const { actor, projectId } = await editor(ctx, ctx.body.scope);
  const changes = (await changesFor(projectId, validEdits(ctx.body), ctx.body.scope)).filter((c) => c.include);
  if (!changes.length) return { saved: 0 };
  for (const c of changes) if (!c.why) throw new HttpError(400, `Say why "${c.title}" changed, so the team and agents understand it`);

  const impact = await analyseImpact(projectId, changes, ctx.body.scope, actor.id, []);
  const bumpedScopes = new Set();
  const applied = [];
  for (const c of [...changes.filter((x) => x.level === 'central'), ...changes.filter((x) => x.level !== 'central')]) {
    const r = await changeSection(projectId, { sectionId: c.sectionId, content: c.newContent, why: c.why, by: actor.id, bumpedScopes });
    applied.push({ sectionId: c.sectionId, title: c.title, scope: c.scope, fromVersion: r.fromVersion, toVersion: r.toVersion, why: c.why });
  }
  const summary = applied.map((a) => `${scopeLabel(a.scope)} › ${a.title}: ${a.why}`).join('; ');
  await logEvent(projectId, {
    type: 'impact.decision', actorId: actor.id, department: ctx.body.scope === 'central' ? null : ctx.body.scope,
    summary: `${actor.name} changed the ${ctx.body.scope === 'central' ? 'central' : scopeLabel(ctx.body.scope)} context: ${summary}`,
    data: { ...impact, direct: true, applied },
  });

  for (const n of impact.notify.filter((x) => x.affectsActiveWork)) {
    await raiseContextAlert(projectId, n.userId, applied, summary, []);
  }
  const rest = impact.notify.filter((x) => !x.affectsActiveWork).map((x) => x.userId);
  // Everyone whose department reads this context hears about it, even with no active work.
  const people = await listPeople(projectId);
  const readers = people.filter((p) => (p.isDeveloper || p.isManager) && p.id !== actor.id
    && (ctx.body.scope === 'central' || p.department === ctx.body.scope)).map((p) => p.id);
  const alerted = new Set(impact.notify.filter((x) => x.affectsActiveWork).map((x) => x.userId));
  await notifyMany(projectId, [...new Set([...rest, ...readers])].filter((id) => !alerted.has(id)), {
    kind: 'context_change', title: `${actor.name} updated the ${ctx.body.scope === 'central' ? 'project brief / central' : scopeLabel(ctx.body.scope)} context`,
    body: applied.map((a) => `${a.title} v${a.fromVersion} → v${a.toVersion}: ${a.why}`).join('\n'),
  }, { actorId: actor.id });
  return { saved: applied.length, applied, impact };
}

// POST /api/team/context/create { projectId, scope, title, content, tags?: [] }
export async function create(ctx) {
  requireFields(ctx.body, ['scope', 'title', 'content']);
  const { actor, projectId } = await editor(ctx, ctx.body.scope);
  const scope = ctx.body.scope;
  if (scope !== 'central' && !(await listDepartments(projectId)).some((d) => d.id === scope)) throw new HttpError(400, 'Unknown department');
  const title = String(ctx.body.title).trim().slice(0, 120);
  const content = String(ctx.body.content).trim();
  if (title.length < 2 || !content) throw new HttpError(400, 'Give the section a title and some content');
  const tags = (Array.isArray(ctx.body.tags) ? ctx.body.tags : String(ctx.body.tags ?? '').split(','))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const existing = await listSections(projectId);
  const id = `${scope === 'central' ? 'c' : scope.slice(0, 3)}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Date.now().toString(36).slice(-4)}`;
  await insertSection(projectId, {
    id, scope, title, content, why: 'New section', ownerId: actor.id,
    tags: tags.length ? tags : ['*'], guardrails: [],
  }, existing.length);
  await q(db.from('scope_versions').upsert({ project_id: projectId, scope, version: 1 }, { onConflict: 'project_id,scope', ignoreDuplicates: true }));
  await logEvent(projectId, {
    type: 'context.created', actorId: actor.id, department: scope === 'central' ? null : scope,
    summary: `${actor.name} added "${title}" to the ${scope === 'central' ? 'central' : scopeLabel(scope)} context`, data: { sectionId: id },
  });
  return { sectionId: id };
}
