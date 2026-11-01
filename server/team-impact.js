// After a manager approves a submission: the agent proposes a context update,
// the system decides who is affected (department-only vs cross-department),
// the manager confirms, and only then is the context changed and people told.
import { HttpError } from '../api/_lib/errors.js';
import { contextProposals, workSubmissions } from '../api/_lib/records.js';
import { logEvent, notifyMany } from '../api/_lib/activity.js';
import { getDepartment, listDepartments, listPeople, requireManagerOf, teamActor } from '../api/_lib/team.js';
import { changeSection, listSections, mentions, scopeLabel } from '../api/_lib/context.js';
import { getTeamAgent } from '../api/_lib/team-agent/index.js';
import { activeTask, raiseContextAlert } from './team-workspace.js';

const label = (s) => `${scopeLabel(s.scope)} › ${s.title}`;
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function withObsoleteGuardrails(s, terms, summary) {
  const existing = s.guardrails.filter((g) => !terms.includes(g.phrase));
  return [...existing, ...terms.map((t) => ({ phrase: t, note: summary, obsoleteSince: s.version + 1 }))];
}

// ---------------------------------------------------------------- proposal
export async function buildProposal(sub) {
  const { projectId } = sub;
  const department = await getDepartment(projectId, sub.department);
  const agent = getTeamAgent(projectId);
  const all = await listSections(projectId);
  const proposal = await agent.proposeContextUpdate({
    title: sub.title, summary: sub.summary, why: sub.why, diff: sub.diff, department,
    departmentSections: all.filter((s) => s.scope === department.id), centralSections: all.filter((s) => s.scope === 'central'),
  });
  const terms = proposal.obsoleteTerms.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const changes = [];

  for (const c of proposal.changes) {
    const s = all.find((x) => x.id === c.sectionId);
    if (!s || s.scope !== department.id) continue;
    changes.push({
      sectionId: s.id, scope: s.scope, title: s.title, oldContent: s.content, newContent: c.newContent, why: c.why,
      guardrails: terms.length ? withObsoleteGuardrails(s, terms, proposal.summary) : s.guardrails,
      level: 'own', reason: 'Proposed by the agent from the approved change.', include: true,
    });
  }

  // Any other section on the same topic that still states something this change makes untrue.
  // (".card" the CSS class is not a payment card, hence the topic check.)
  if (terms.length) {
    const touched = new Set(changes.map((c) => c.sectionId));
    const topic = new Set([...terms, ...changes.flatMap((c) => all.find((s) => s.id === c.sectionId).tags)].filter((t) => t !== '*'));
    const affected = all.filter((s) => !touched.has(s.id) && s.tags.some((t) => topic.has(t)) && mentions(s.content, terms).length > 0);
    const rewrites = affected.length ? await agent.rewriteAffected({ changeSummary: proposal.summary, obsoleteTerms: terms, sections: affected }) : [];
    for (const s of affected) {
      const rw = rewrites.find((r) => r.sectionId === s.id);
      if (!rw) continue;
      changes.push({
        sectionId: s.id, scope: s.scope, title: s.title, oldContent: s.content, newContent: rw.newContent,
        why: rw.why || proposal.summary, guardrails: withObsoleteGuardrails(s, terms, proposal.summary),
        level: s.scope === 'central' ? 'central' : s.scope === department.id ? 'own' : 'other',
        reason: `It still says “${mentions(s.content, terms).join('”, “')}”, which this change makes outdated.`,
        include: true,
      });
    }
  }

  const p = {
    id: contextProposals.newId(), projectId, submissionId: sub.id, department: department.id, status: 'pending',
    summary: proposal.summary, changes, impact: await analyseImpact(projectId, changes, department.id, sub.userId, terms),
    createdAt: new Date().toISOString(), appliedAt: null,
  };
  await contextProposals.put(p);
  await logEvent(projectId, {
    type: 'context.proposal', department: department.id, submissionId: sub.id,
    summary: `Agent proposed ${changes.length} context update(s) after "${sub.title}" was approved (${p.impact.scope === 'cross_department' ? 'cross-department' : 'department only'})`,
    data: { proposalId: p.id, summary: p.summary, obsoleteTerms: terms, changes: changes.map((c) => ({ sectionId: c.sectionId, level: c.level, reason: c.reason })) },
  });
  return p;
}

// ---------------------------------------------------------------- impact decision
export async function analyseImpact(projectId, changes, sourceDept, authorId, terms) {
  const included = changes.filter((c) => c.include);
  const changedIds = new Set(included.map((c) => c.sectionId));
  const central = included.filter((c) => c.level === 'central');
  const other = included.filter((c) => c.level === 'other');
  const crossDept = central.length > 0 || other.length > 0;
  const [people, departments, pending] = await Promise.all([
    listPeople(projectId), listDepartments(projectId), workSubmissions.list(projectId, { status: 'pending' }),
  ]);
  const deptName = (id) => departments.find((d) => d.id === id)?.name ?? id;

  const reasons = [
    ...central.map((c) => `${label(c)} is shared by every department and ${lower(c.reason)}`),
    ...other.map((c) => `${label(c)} belongs to another department and ${lower(c.reason)}`),
  ];

  const notify = new Map();
  const unaffected = [];
  const affectedDepts = new Set(other.map((c) => c.scope));
  const workHits = {};
  const developers = people.filter((u) => u.isDeveloper);
  const actives = Object.fromEntries(await Promise.all(developers.map(async (u) => [u.id, await activeTask(projectId, u.id)])));

  for (const u of developers) {
    const t = actives[u.id];
    const deps = t ? t.relevantSectionIds.filter((id) => changedIds.has(id)) : [];
    if (t && deps.length) {
      const names = deps.map((id) => included.find((c) => c.sectionId === id).title);
      notify.set(u.id, { userId: u.id, affectsActiveWork: true, reason: `Active task “${t.text}” depends on ${names.join(', ')}.` });
      if (u.department !== sourceDept) affectedDepts.add(u.department);
      (workHits[u.department] ??= []).push(`${u.name}'s active task is affected`);
    }
    for (const s of pending.filter((x) => x.userId === u.id && Object.keys(x.builtOn.sections).some((id) => changedIds.has(id)))) {
      if (!notify.has(u.id)) notify.set(u.id, { userId: u.id, affectsActiveWork: false, reason: `Pending submission “${s.title}” was built on the old context and will show as Outdated.` });
      if (u.department !== sourceDept) affectedDepts.add(u.department);
      (workHits[u.department] ??= []).push(`${u.name}'s pending submission “${s.title}” becomes Outdated`);
    }
  }

  if (crossDept) {
    // Cross-department: managers and developers of every affected department are told.
    for (const d of affectedDepts) {
      for (const u of people.filter((x) => x.department === d && (x.isDeveloper || x.isManager))) {
        if (notify.has(u.id)) continue;
        notify.set(u.id, { userId: u.id, affectsActiveWork: false, reason: u.isManager ? `Manages ${deptName(d)}, whose context changes.` : `Informed: ${deptName(d)} context changes.` });
        const t = actives[u.id];
        if (t) unaffected.push({ userId: u.id, reason: `Current task “${t.text}” does not use any changed section, so it keeps going undisturbed.` });
      }
    }
    for (const u of developers.filter((x) => x.department !== sourceDept && !affectedDepts.has(x.department))) {
      const t = actives[u.id];
      if (t) unaffected.push({ userId: u.id, reason: `Current task “${t.text}” does not use any changed section.` });
    }
  } else {
    for (const u of developers.filter((x) => x.department === sourceDept && !notify.has(x.id))) {
      const t = actives[u.id];
      if (t) unaffected.push({ userId: u.id, reason: `Current task “${t.text}” does not use the changed section.` });
    }
  }
  if (authorId && notify.get(authorId)?.affectsActiveWork === false) notify.delete(authorId);

  if (!crossDept) {
    reasons.push(terms.length
      ? `No central section or other department's context mentions “${terms.join('”, “')}”, so this stays inside ${deptName(sourceDept)}.`
      : `This change adds to ${deptName(sourceDept)}'s own context and makes nothing else untrue, so no other department needs to change.`);
  }
  const alerts = [...notify.values()].filter((n) => n.affectsActiveWork).length;
  reasons.push(alerts
    ? `${alerts} developer(s) have active work that depends on a changed section and will be asked how to proceed.`
    : 'No one has active work that depends on the changed sections.');

  const deptNotes = {};
  for (const d of new Set([...affectedDepts, ...included.filter((c) => c.level !== 'central').map((c) => c.scope)])) {
    if (d === sourceDept && crossDept) continue;
    const viaCentral = central.length ? [`Central ${central.map((c) => c.title).join(', ')} changed`] : [];
    deptNotes[d] = [...viaCentral, ...included.filter((c) => c.scope === d).map((c) => `${c.title} updated`), ...(workHits[d] ?? [])].join('. ') + '.';
  }

  return {
    scope: crossDept ? 'cross_department' : 'department', reasons,
    affectedDepartments: [...affectedDepts].filter((d) => d !== sourceDept), obsoleteTerms: terms,
    notify: [...notify.values()], unaffected, deptNotes,
  };
}

function mergeEdits(p, edited) {
  if (!Array.isArray(edited)) return p.changes;
  return p.changes.map((c) => {
    const e = edited.find((x) => x.sectionId === c.sectionId);
    return e ? { ...c, newContent: String(e.newContent ?? c.newContent), include: !!e.include } : c;
  });
}

async function pendingProposal(ctx) {
  const p = await contextProposals.get(ctx.body.proposalId);
  if (!p) throw new HttpError(404, 'Proposal not found');
  if (p.status !== 'pending') throw new HttpError(409, 'This proposal was already handled');
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId: p.projectId });
  requireManagerOf(actor, p.department);
  return { p, actor };
}

// POST /api/team/proposals/preview { proposalId, changes }  (recompute impact after edits)
export async function preview(ctx) {
  const { p } = await pendingProposal(ctx);
  const changes = mergeEdits(p, ctx.body.changes);
  const sub = await workSubmissions.get(p.submissionId);
  return { ...p, changes, impact: await analyseImpact(p.projectId, changes, p.department, sub.userId, p.impact.obsoleteTerms) };
}

// POST /api/team/proposals/confirm { proposalId, changes }
export async function confirm(ctx) {
  const { p, actor } = await pendingProposal(ctx);
  const { projectId } = p;
  const sub = await workSubmissions.get(p.submissionId);
  const changes = mergeEdits(p, ctx.body.changes);
  const editedByManager = changes.some((c, i) => c.newContent !== p.changes[i].newContent || c.include !== p.changes[i].include);
  const impact = await analyseImpact(projectId, changes, p.department, sub.userId, p.impact.obsoleteTerms);
  const included = changes.filter((c) => c.include);

  await logEvent(projectId, {
    type: 'impact.decision', actorId: actor.id, department: p.department, submissionId: sub.id,
    summary: `${actor.name} confirmed a ${impact.scope === 'cross_department' ? 'cross-department' : 'department-only'} context update: ${p.summary}`,
    data: { proposalId: p.id, ...impact, editedByManager, sourceDepartment: p.department, summary: p.summary },
  });

  // Central first; then departments pick it up from the central change.
  const centralIds = included.filter((c) => c.level === 'central').map((c) => c.sectionId);
  const applied = [];
  const bumpedScopes = new Set();
  for (const c of [...included.filter((x) => x.level === 'central'), ...included.filter((x) => x.level !== 'central')]) {
    const r = await changeSection(projectId, {
      sectionId: c.sectionId, content: c.newContent, by: actor.id, guardrails: c.guardrails, bumpedScopes,
      why: c.level === 'other' ? `${c.why} (follows the Central change)` : c.why,
      cause: { submissionId: sub.id, proposalId: p.id, viaCentral: c.level === 'other' && centralIds.length ? centralIds.join(',') : undefined },
    });
    applied.push({ change: c, fromVersion: r.fromVersion, toVersion: r.toVersion });
  }
  Object.assign(p, { status: 'applied', changes, impact, appliedAt: new Date().toISOString() });
  await contextProposals.put(p);

  // Mid-task alerts for active work that depends on a changed section.
  const alertChanges = applied.map((a) => ({ sectionId: a.change.sectionId, title: a.change.title, scope: a.change.scope, fromVersion: a.fromVersion, toVersion: a.toVersion, why: a.change.why }));
  for (const n of impact.notify.filter((x) => x.affectsActiveWork)) {
    await raiseContextAlert(projectId, n.userId, alertChanges, p.summary, impact.obsoleteTerms);
  }

  // Everyone else on the list gets a plain notification.
  const changedList = applied.map((a) => `${label(a.change)} v${a.fromVersion} → v${a.toVersion}`).join('\n');
  const [people, departments] = await Promise.all([listPeople(projectId), listDepartments(projectId)]);
  const source = departments.find((d) => d.id === p.department)?.name ?? p.department;
  for (const n of impact.notify.filter((x) => !x.affectsActiveWork)) {
    const u = people.find((x) => x.id === n.userId);
    const note = u && impact.deptNotes[u.department];
    await notifyMany(projectId, [n.userId], {
      kind: 'context_change',
      title: u?.department === p.department ? `${source} context updated` : `Context change from ${source}`,
      body: `${p.summary}\n${changedList}\n${n.reason}${note && u.isManager ? `\nFor ${departments.find((d) => d.id === u.department)?.name}: ${note}` : ''}`,
    }, { actorId: actor.id, department: p.department, submissionId: sub.id });
  }
  return p;
}

// POST /api/team/proposals/discard { proposalId }
export async function discard(ctx) {
  const { p, actor } = await pendingProposal(ctx);
  p.status = 'discarded';
  await contextProposals.put(p);
  await logEvent(p.projectId, {
    type: 'context.proposal_discarded', actorId: actor.id, department: p.department, submissionId: p.submissionId,
    summary: `${actor.name} chose not to update the context after this approval`, data: { proposalId: p.id },
  });
  return p;
}

