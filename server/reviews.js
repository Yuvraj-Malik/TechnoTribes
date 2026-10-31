// Merge requests: worker submits -> bucketed -> admin decides -> Moderator records.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, asArray, displayName } from '../api/_lib/http.js';
import { requireRole, ENGINEERS, MANAGERS } from '../api/_lib/permissions.js';
import { commitChange } from '../api/_lib/moderator.js';
import { propagateChange, releaseIntents } from '../api/_lib/coordination.js';
import { loadEdges, downstream, addDependencies, intersect } from '../api/_lib/dependency-graph.js';
import { rebucket } from '../api/_lib/reviews.js';
import { notify, managersOf, observerOf, addHistory, namesFor } from '../api/_lib/log.js';
import { fileKey, humanizeKey } from '../api/_lib/paths.js';

// A new request replaces the same person's out-of-date requests on those files,
// so they stop showing as needing a re-run.
async function closeReplaced(projectId, userId, mergeRequest) {
  const old = await q(db.from('merge_requests').select('id,targets')
    .eq('project_id', projectId).eq('submitted_by', userId).in('status', ['stale', 'conflict']));
  const replaced = old.filter((m) => intersect(m.targets, mergeRequest.targets).length).map((m) => m.id);
  if (!replaced.length) return;
  await q(db.from('merge_requests').update({
    status: 'rejected', decision_note: 'Replaced by a newer request', decided_at: new Date().toISOString(),
  }).in('id', replaced));
}

// POST /api/reviews/submit  { projectId, proposalIds: [], note? }   (engineers, own proposals)
// Lists every change, with its reason and the version it was based on.
export async function submit({ user, body }) {
  requireFields(body, ['projectId', 'proposalIds']);
  await requireRole(user.id, body.projectId, ENGINEERS);
  const ids = asArray(body.proposalIds);
  if (!ids.length) throw new HttpError(400, 'Choose at least one proposal to submit');

  const proposals = await q(db.from('proposals').select('*').in('id', ids).eq('project_id', body.projectId));
  if (proposals.length !== ids.length) throw new HttpError(404, 'Some proposals were not found');
  for (const p of proposals) {
    if (p.user_id !== user.id) throw new HttpError(403, 'You can only submit your own work');
    if (p.status === 'stale') throw new HttpError(409, `"${p.summary}" is out of date. Re-run your Builder first`, { proposalId: p.id });
    if (!['draft', 'reviewed'].includes(p.status)) throw new HttpError(409, `"${p.summary}" was already ${p.status}`);
  }

  const changeList = proposals.flatMap((p) => p.changes.map((c) => ({
    proposalId: p.id, path: c.path, action: c.action, summary: p.summary, reason: p.reason, basedOnVersion: p.base_version,
  })));
  const mr = await q(db.from('merge_requests').insert({
    project_id: body.projectId,
    submitted_by: user.id,
    proposal_ids: ids,
    change_list: changeList,
    targets: [...new Set(proposals.flatMap((p) => p.targets))],
    depends_on: [...new Set(proposals.flatMap((p) => p.depends_on))],
    note: body.note || null,
    base_version: Math.min(...proposals.map((p) => p.base_version)),
  }).select().single());

  await q(db.from('proposals').update({ status: 'submitted' }).in('id', ids));
  const taskIds = [...new Set(proposals.map((p) => p.task_id).filter(Boolean))];
  if (taskIds.length) await q(db.from('tasks').update({ status: 'in_review' }).in('id', taskIds));
  await closeReplaced(body.projectId, user.id, mr);
  await rebucket(body.projectId);
  await notify((await managersOf(body.projectId)).filter((id) => id !== user.id).map((id) => ({
    user_id: id, project_id: body.projectId, kind: 'merge_request',
    title: `${displayName(user)} asked you to review ${changeList.length} change(s)`,
    body: proposals.map((p) => p.summary).join(' • '),
  })));
  await addHistory(body.projectId, user.id, 'merge_requested', { mergeRequestId: mr.id, proposals: ids });
  return { mergeRequest: mr };
}

// POST /api/reviews/bucket  { projectId }   (owner/admin) -> regroup the pending queue
export async function bucket({ user, body }) {
  requireFields(body, ['projectId']);
  await requireRole(user.id, body.projectId, MANAGERS);
  return { buckets: await rebucket(body.projectId) };
}

// GET /api/reviews/queue?projectId=   (owner/admin) -> buckets in priority order, with details
export async function queue({ user, query }) {
  await requireRole(user.id, query.projectId, MANAGERS);
  const [buckets, mrs] = await Promise.all([
    q(db.from('review_buckets').select('*').eq('project_id', query.projectId).eq('status', 'open')
      .order('priority', { ascending: true, nullsFirst: false })),
    q(db.from('merge_requests').select('*').eq('project_id', query.projectId)
      .in('status', ['pending', 'conflict', 'stale']).order('created_at')),
  ]);
  const proposalIds = mrs.flatMap((m) => m.proposal_ids);
  const [proposals, reviews] = proposalIds.length
    ? await Promise.all([
      q(db.from('proposals').select('*').in('id', proposalIds)),
      q(db.from('critic_reviews').select('*').in('proposal_id', proposalIds)),
    ])
    : [[], []];
  const names = await namesFor(mrs.map((m) => m.submitted_by));
  const expand = (m) => ({
    ...m,
    submittedByName: names[m.submitted_by],
    proposals: proposals.filter((p) => m.proposal_ids.includes(p.id)),
    criticReviews: reviews.filter((r) => m.proposal_ids.includes(r.proposal_id)),
  });
  return {
    buckets: buckets.map((b) => ({ ...b, mergeRequests: mrs.filter((m) => m.bucket_id === b.id && m.status === 'pending').map(expand) })),
    needsAttention: mrs.filter((m) => m.status !== 'pending').map(expand), // conflicts and stale items
  };
}

// Has anything this request depends on changed since it was based on?
async function findConflict(projectId, mr, edges) {
  const later = await q(db.from('moderator_log').select('version,summary,targets')
    .eq('project_id', projectId).gt('version', mr.base_version).order('version'));
  if (!later.length) return null;
  const changed = later.flatMap((l) => l.targets || []);
  const affected = new Set([...changed, ...(await downstream(projectId, changed, edges))]);
  const clash = [...new Set([...mr.targets, ...mr.depends_on])].filter((k) => affected.has(k));
  if (!clash.length) return null;
  return {
    areas: clash.map(humanizeKey),
    since: later.filter((l) => (l.targets || []).some((k) => affected.has(k))).map((l) => ({ version: l.version, summary: l.summary })),
  };
}

// POST /api/reviews/decide   (owner/admin)
// { projectId, decisions: [{ mergeRequestId, decision: 'approve'|'reject'|'redirect', note? }] }
// Decisions run in order, so approving two clashing requests from one bucket
// approves the first and turns the second into a conflict.
export async function decide({ user, body }) {
  requireFields(body, ['projectId', 'decisions']);
  const projectId = body.projectId;
  await requireRole(user.id, projectId, MANAGERS);
  if (!Array.isArray(body.decisions) || !body.decisions.length) throw new HttpError(400, 'decisions must be a non-empty array');

  const results = [];
  for (const d of body.decisions) {
    try {
      results.push(await decideOne(user, projectId, d));
    } catch (err) {
      results.push({ mergeRequestId: d.mergeRequestId, ok: false, error: err.message, status: err.status || 500 });
    }
  }
  await rebucket(projectId);
  return { results };
}

async function decideOne(user, projectId, { mergeRequestId, decision, note }) {
  if (!['approve', 'reject', 'redirect'].includes(decision)) throw new HttpError(400, 'decision must be approve, reject or redirect');
  if (decision === 'redirect' && !note) throw new HttpError(400, 'A redirect needs a note telling the worker what to do instead');
  const mr = (await q(db.from('merge_requests').select('*').eq('id', mergeRequestId).eq('project_id', projectId)))[0];
  if (!mr) throw new HttpError(404, 'Merge request not found');
  if (mr.status === 'stale') throw new HttpError(409, 'This request is out of date. The worker needs to re-run it');
  if (mr.status !== 'pending' && mr.status !== 'conflict') throw new HttpError(409, `Already ${mr.status}`);

  const proposals = await q(db.from('proposals').select('*').in('id', mr.proposal_ids));
  const decided = { decided_by: user.id, decision_note: note || null, decided_at: new Date().toISOString() };

  if (decision === 'reject' || decision === 'redirect') {
    const status = decision === 'reject' ? 'rejected' : 'redirected';
    await q(db.from('merge_requests').update({ status, ...decided }).eq('id', mr.id));
    await q(db.from('proposals').update({ status }).in('id', mr.proposal_ids));
    if (decision === 'reject') await releaseIntents(proposals.map((p) => p.intent_id));
    await notify([{
      user_id: mr.submitted_by, project_id: projectId, kind: `merge_${status}`,
      title: decision === 'reject' ? 'Your changes were rejected' : 'Your changes were sent back with instructions',
      body: note || null,
    }]);
    await addHistory(projectId, mr.submitted_by, `merge_${status}`, { mergeRequestId: mr.id, note });
    return { mergeRequestId: mr.id, ok: true, status };
  }

  // Approve: block it if something it relies on changed since it was made.
  const edges = await loadEdges(projectId);
  const clash = await findConflict(projectId, mr, edges);
  if (clash) {
    const reason = `Since this was made, these parts changed: ${clash.areas.join(', ')}.`;
    await q(db.from('merge_requests').update({ status: 'conflict', conflict_reason: reason }).eq('id', mr.id));
    await q(db.from('proposals').update({ status: 'stale', stale_reason: reason }).in('id', mr.proposal_ids));
    await releaseIntents(proposals.map((p) => p.intent_id));
    await notify([{
      user_id: mr.submitted_by, project_id: projectId, kind: 'merge_conflict',
      title: 'Your changes conflict with newer approved work', body: `${reason} Re-run your Builder on the latest version.`,
    }]);
    return { mergeRequestId: mr.id, ok: false, status: 'conflict', conflict: clash };
  }

  // Later proposals in the same request win if they touch the same file.
  const byPath = new Map();
  for (const p of proposals.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
    for (const c of p.changes) byPath.set(c.path, c);
  }
  const fileChanges = [...byPath.values()];
  const names = await namesFor([mr.submitted_by]);
  const who = names[mr.submitted_by] || 'A team member';

  const commit = await commitChange({
    projectId,
    actorId: user.id,
    submittedBy: mr.submitted_by,
    mergeRequestId: mr.id,
    kind: 'change',
    summary: proposals.map((p) => p.summary).join(' '),
    reason: proposals.map((p) => p.reason).filter(Boolean).join(' '),
    fileChanges,
  });

  const targets = fileChanges.filter((c) => c.action !== 'delete').map((c) => fileKey(c.path));
  if (targets.length && mr.depends_on.length) await addDependencies(projectId, targets, mr.depends_on);

  await q(db.from('merge_requests').update({ status: 'approved', ...decided }).eq('id', mr.id));
  await q(db.from('proposals').update({ status: 'approved' }).in('id', mr.proposal_ids));
  await releaseIntents(proposals.map((p) => p.intent_id));

  const impact = commit.unchanged ? null : await propagateChange(
    projectId, commit.changedKeys, commit.version, user.id,
    `${who}'s change to ${commit.changedKeys.map(humanizeKey).join(', ')} was approved.`,
    { excludeMergeRequestId: mr.id },
  );

  // Close tasks and observer requests this work came from.
  const taskIds = [...new Set(proposals.map((p) => p.task_id).filter(Boolean))];
  const notes = [{
    user_id: mr.submitted_by, project_id: projectId, kind: 'merge_approved',
    title: 'Your changes were approved', body: `They are now part of version ${commit.version}.`,
  }];
  if (taskIds.length) {
    await q(db.from('tasks').update({ status: 'done' }).in('id', taskIds));
    const tasks = await q(db.from('tasks').select('observer_request_id').in('id', taskIds));
    const requestIds = tasks.map((t) => t.observer_request_id).filter(Boolean);
    if (requestIds.length) {
      await q(db.from('observer_requests').update({ status: 'done', updated_at: new Date().toISOString() }).in('id', requestIds));
    }
  }
  const observer = await observerOf(projectId);
  if (observer && !commit.unchanged) {
    notes.push({
      user_id: observer, project_id: projectId, kind: 'project_update',
      title: 'New update on the website', body: commit.observerSummary,
    });
  }
  await notify(notes);
  await addHistory(projectId, mr.submitted_by, 'merge_approved', { mergeRequestId: mr.id, version: commit.version });

  return { mergeRequestId: mr.id, ok: true, status: 'approved', version: commit.version, impact };
}
