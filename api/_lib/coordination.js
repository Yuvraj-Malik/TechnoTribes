// Agent-to-agent awareness: intents, overlap checks, and change propagation.
import { db, q } from './supabase-admin.js';
import { HttpError } from './errors.js';
import { loadEdges, downstream, upstream, intersect } from './dependency-graph.js';
import { humanizeKey } from './paths.js';
import { namesFor, notify } from './log.js';

export async function activeIntents(projectId) {
  return q(db.from('intents').select('id,user_id,agent_id,task_id,goal,targets,base_version,created_at')
    .eq('project_id', projectId).eq('status', 'active'));
}

// Compare a planned piece of work against everyone else's active work.
//   same_target: someone is already changing the same file(s)  -> stop and coordinate
//   dependent:   their files depend on ours, or ours on theirs  -> proceed, but carefully
//   clear:       no overlap
export async function checkOverlap(projectId, userId, targets, { ignoreIntentId } = {}) {
  const [intents, edges] = await Promise.all([activeIntents(projectId), loadEdges(projectId)]);
  const others = intents.filter((i) => i.user_id !== userId && i.id !== ignoreIntentId);
  if (!others.length || !targets.length) return { status: 'clear', conflicts: [], message: 'No one else is working on this.' };

  const related = [
    ...(await downstream(projectId, targets, edges)),
    ...(await upstream(projectId, targets, edges)),
  ];
  const names = await namesFor(others.map((i) => i.user_id));
  const conflicts = [];

  for (const i of others) {
    const same = intersect(targets, i.targets);
    const linked = same.length ? [] : intersect(related, i.targets);
    if (!same.length && !linked.length) continue;
    const who = names[i.user_id] || 'Someone';
    const shared = same.length ? same : linked;
    conflicts.push({
      kind: same.length ? 'same_target' : 'dependent',
      intentId: i.id,
      userId: i.user_id,
      who,
      goal: i.goal,
      shared,
      message: same.length
        ? `${who}'s Builder is already working on ${shared.map(humanizeKey).join(', ')} ("${i.goal}").`
        : `${who}'s Builder is working on ${shared.map(humanizeKey).join(', ')}, which is connected to your work.`,
    });
  }

  const status = conflicts.some((c) => c.kind === 'same_target') ? 'same_target'
    : conflicts.length ? 'dependent' : 'clear';
  return {
    status,
    conflicts,
    message: status === 'clear' ? 'No one else is working on this.' : conflicts.map((c) => c.message).join(' '),
  };
}

export async function declareIntent({ projectId, userId, agentId = null, taskId = null, goal, targets, baseVersion }) {
  return q(db.from('intents').insert({
    project_id: projectId, user_id: userId, agent_id: agentId, task_id: taskId,
    goal: String(goal).slice(0, 300), targets, base_version: baseVersion,
  }).select().single());
}

export async function releaseIntents(ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return;
  await q(db.from('intents').update({ status: 'released', released_at: new Date().toISOString() })
    .in('id', clean).eq('status', 'active'));
}

export async function getIntent(intentId) {
  const rows = await q(db.from('intents').select('*').eq('id', intentId));
  if (!rows[0]) throw new HttpError(404, 'Intent not found');
  return rows[0];
}

// After something changes (approved merge or brief edit), find every piece of
// unfinished work that depended on it and mark it stale. With dryRun it only
// reports the impact (used for the "what will this affect?" preview).
export async function propagateChange(projectId, changedKeys, newVersion, actorId, reason, opts = {}) {
  const { dryRun = false, excludeMergeRequestId = null } = opts;
  const edges = await loadEdges(projectId);
  const affected = new Set([...changedKeys, ...(await downstream(projectId, changedKeys, edges))]);
  const hits = (arr) => (arr || []).some((k) => affected.has(k));

  const [proposals, mergeRequests, intents] = await Promise.all([
    q(db.from('proposals').select('id,user_id,summary,targets,depends_on,base_version,status')
      .eq('project_id', projectId).in('status', ['draft', 'reviewed', 'submitted'])),
    q(db.from('merge_requests').select('id,submitted_by,targets,depends_on,base_version,status')
      .eq('project_id', projectId).eq('status', 'pending')),
    activeIntents(projectId),
  ]);

  const staleProposals = proposals.filter((p) => p.base_version < newVersion && (hits(p.targets) || hits(p.depends_on)));
  const staleMergeRequests = mergeRequests.filter((m) => m.id !== excludeMergeRequestId
    && m.base_version < newVersion && (hits(m.targets) || hits(m.depends_on)));
  const interrupted = intents.filter((i) => hits(i.targets));

  const users = new Set([
    ...staleProposals.map((p) => p.user_id),
    ...staleMergeRequests.map((m) => m.submitted_by),
    ...interrupted.map((i) => i.user_id),
  ]);
  users.delete(actorId);
  const names = await namesFor([...users]);

  const impact = {
    affectedKeys: [...affected],
    affectedAreas: [...affected].map(humanizeKey),
    staleProposals: staleProposals.map((p) => ({ id: p.id, who: names[p.user_id] || null, summary: p.summary })),
    staleMergeRequests: staleMergeRequests.map((m) => ({ id: m.id, who: names[m.submitted_by] || null })),
    interruptedWork: interrupted.map((i) => ({ intentId: i.id, who: names[i.user_id] || null, goal: i.goal })),
    peopleAffected: [...users].map((u) => names[u] || u),
  };
  if (dryRun) return impact;

  if (staleProposals.length) {
    await q(db.from('proposals').update({ status: 'stale', stale_reason: reason })
      .in('id', staleProposals.map((p) => p.id)));
  }
  if (staleMergeRequests.length) {
    await q(db.from('merge_requests').update({ status: 'stale', conflict_reason: reason })
      .in('id', staleMergeRequests.map((m) => m.id)));
  }
  await notify([...users].map((userId) => ({
    user_id: userId,
    project_id: projectId,
    kind: 'stale',
    title: 'Some of your work is now out of date',
    body: `${reason} Re-run your Builder on the latest version (v${newVersion}).`,
  })));
  return impact;
}
