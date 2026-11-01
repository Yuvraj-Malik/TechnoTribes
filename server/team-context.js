// Editing the shared context directly (the owner's brief and requirements, or a
// manager's department notes). Uses the same impact analysis as the
// after-merge flow: preview who is affected, then save; developers whose active
// work depends on a changed section get the mid-task "context changed" alert.
import { HttpError } from '../api/_lib/errors.js';
import { requireFields } from '../api/_lib/http.js';
import { listDepartments, listPeople, teamActor } from '../api/_lib/team.js';
import { KIND_LABEL, listSections } from '../api/_lib/context.js';
import { analyseImpact } from './team-impact.js';
import { routeEdits } from './team-suggestions.js';

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
// Every edit is a suggestion: the founder's own central edits and a manager's own
// department edits apply at once (and are logged); anything touching central
// that someone else makes goes to the founder.
export async function save(ctx) {
  requireFields(ctx.body, ['scope']);
  const { actor, projectId } = await editor(ctx, ctx.body.scope);
  const changes = (await changesFor(projectId, validEdits(ctx.body), ctx.body.scope)).filter((c) => c.include);
  if (!changes.length) return { saved: 0, suggestions: [] };
  for (const c of changes) if (!c.why) throw new HttpError(400, `Say why "${c.title}" changed, so the team and agents understand it`);
  const routed = await routeEdits(projectId, actor, changes.map((c) => ({ op: 'update', itemId: c.sectionId, content: c.newContent, why: c.why })));
  const saved = routed.filter((r) => r.status === 'approved' || r.status === 'applied').reduce((n, r) => n + r.applied.length, 0);
  return { saved, suggestions: routed.map(({ id, status, label, reasons }) => ({ id, status, label, reasons })) };
}

// POST /api/team/context/create { projectId, scope, title, content, kind?, tags?: [] }
export async function create(ctx) {
  requireFields(ctx.body, ['scope', 'title', 'content']);
  const { actor, projectId } = await editor(ctx, ctx.body.scope);
  const scope = ctx.body.scope;
  if (scope !== 'central' && !(await listDepartments(projectId)).some((d) => d.id === scope)) throw new HttpError(400, 'Unknown department');
  const title = String(ctx.body.title).trim().slice(0, 120);
  const content = String(ctx.body.content).trim();
  if (title.length < 2 || !content) throw new HttpError(400, 'Give the section a title and some content');
  const kind = KIND_LABEL[ctx.body.kind] ? ctx.body.kind : 'note';
  const tags = (Array.isArray(ctx.body.tags) ? ctx.body.tags : String(ctx.body.tags ?? '').split(','))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const [r] = await routeEdits(projectId, actor, [{ op: 'add', scope, kind, title, content, tags: tags.length ? tags : ['*'], why: 'New section' }]);
  return { sectionId: r.applied[0]?.itemId ?? null, suggestion: { id: r.id, status: r.status, label: r.label, reasons: r.reasons } };
}
