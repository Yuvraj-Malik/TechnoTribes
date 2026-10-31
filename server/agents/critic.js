// The Critic agent.
//  - review:      reviews one engineer's Builder proposal before it goes to the admin
//  - prioritize:  ranks the admin's review buckets (uses the admin's own Critic)
import { db, q } from '../../api/_lib/supabase-admin.js';
import { HttpError } from '../../api/_lib/errors.js';
import { requireFields } from '../../api/_lib/http.js';
import { requireRole, INSIDERS, MANAGERS, ENGINEERS } from '../../api/_lib/permissions.js';
import { callClaudeJSON } from '../../api/_lib/claude.js';
import { getState } from '../../api/_lib/moderator.js';
import { activeIntents } from '../../api/_lib/coordination.js';
import { loadEdges, downstream, upstream, intersect } from '../../api/_lib/dependency-graph.js';
import { rebucket } from '../../api/_lib/reviews.js';
import { getAgent, setAgentStatus, addHistory, namesFor } from '../../api/_lib/log.js';
import { isFileKey, keyToPath, humanizeKey } from '../../api/_lib/paths.js';

const REVIEW_SYSTEM = `You are the Critic agent. You review one engineer's proposed code change before it is sent to the admin.
Check: does it do what was asked; does it fit the project brief; could it break files that depend on it or that it depends on; code quality, accessibility and security.
Reply with ONLY one JSON object:
{ "verdict": "approve" | "revise" | "reject", "score": 0-100, "summary": "one plain-English sentence",
  "issues": [{ "severity": "high" | "medium" | "low", "path": "file or null", "message": "what is wrong", "suggestion": "how to fix it" }] }`;

function validateReview(o) {
  if (!['approve', 'revise', 'reject'].includes(o?.verdict)) throw new Error('"verdict" must be approve, revise or reject');
  const score = Math.max(0, Math.min(100, Math.round(Number(o.score) || 0)));
  const issues = (Array.isArray(o.issues) ? o.issues : []).slice(0, 30).map((i) => ({
    severity: ['high', 'medium', 'low'].includes(i?.severity) ? i.severity : 'low',
    path: typeof i?.path === 'string' ? i.path : null,
    message: String(i?.message || '').slice(0, 500),
    suggestion: String(i?.suggestion || '').slice(0, 500),
  }));
  return { verdict: o.verdict, score, summary: String(o.summary || '').slice(0, 500), issues };
}

// POST /api/agents/critic/review  { proposalId }   (the proposal's author)
export async function review({ user, body }) {
  requireFields(body, ['proposalId']);
  const proposal = (await q(db.from('proposals').select('*').eq('id', body.proposalId)))[0];
  if (!proposal) throw new HttpError(404, 'Proposal not found');
  await requireRole(user.id, proposal.project_id, ENGINEERS);
  if (proposal.user_id !== user.id) throw new HttpError(403, 'You can only run your Critic on your own work');
  if (proposal.status === 'stale') throw new HttpError(409, 'This proposal is out of date. Re-run your Builder first');

  const [state, edges] = await Promise.all([getState(proposal.project_id), loadEdges(proposal.project_id)]);
  const files = state.files || {};
  const related = await upstream(proposal.project_id, proposal.targets, edges);
  const relatedFiles = {};
  for (const key of related) if (isFileKey(key) && keyToPath(key) in files) relatedFiles[keyToPath(key)] = files[keyToPath(key)];

  const agent = await getAgent(proposal.project_id, user.id, 'critic');
  await setAgentStatus(agent.id, 'working', `Reviewing: ${proposal.summary}`.slice(0, 200));
  try {
    const result = await callClaudeJSON({
      system: REVIEW_SYSTEM,
      maxTokens: 3000,
      prompt: JSON.stringify({
        instruction: proposal.instruction,
        brief: state.brief,
        proposal: { summary: proposal.summary, reason: proposal.reason, changes: proposal.changes, dependsOn: proposal.depends_on },
        currentVersionOfChangedFiles: Object.fromEntries(proposal.changes.map((c) => [c.path, files[c.path] ?? null])),
        filesItDependsOn: relatedFiles,
        projectMovedOnSince: state.current_version > proposal.base_version,
      }),
    }, validateReview);

    const saved = await q(db.from('critic_reviews').insert({
      project_id: proposal.project_id, proposal_id: proposal.id, user_id: user.id, ...result,
    }).select().single());
    if (proposal.status === 'draft') await q(db.from('proposals').update({ status: 'reviewed' }).eq('id', proposal.id));
    await addHistory(proposal.project_id, user.id, 'critic_review', {
      proposalId: proposal.id, verdict: result.verdict, score: result.score, summary: result.summary,
    });
    return { review: saved };
  } finally {
    await setAgentStatus(agent.id, 'idle', null);
  }
}

// ---------------------------------------------------------------------------
// Prioritizing review buckets
// ---------------------------------------------------------------------------
const PRIORITY_SYSTEM = `You are the admin's Critic agent. You help the admin decide which group of code reviews to handle first.
Each bucket comes with signals: how many other engineers are blocked by it, whether the requests inside it conflict with each other, Critic issues found, whether it comes from the observer (founder/investor), and how long it has waited.
Reply with ONLY one JSON object:
{ "order": ["bucketId", ...],
  "reasons": { "bucketId": "one plain sentence on why it is at this position" },
  "recommendations": { "bucketId": "what the admin should do, e.g. approve X, reject the duplicate from Y" } }`;

function heuristicScore(s) {
  return s.blockingCount * 30 + (s.internalConflict ? 25 : 0) + (s.fromObserver ? 20 : 0)
    + s.highIssues * 10 + Math.min(s.waitingHours, 48) / 2 + s.size * 5;
}

// POST /api/agents/critic/prioritize  { projectId }   (owner/admin)
export async function prioritize({ user, body }) {
  requireFields(body, ['projectId']);
  const projectId = body.projectId;
  const me = await requireRole(user.id, projectId, MANAGERS);

  const buckets = await rebucket(projectId);
  if (!buckets.length) return { buckets: [] };

  const mrs = await q(db.from('merge_requests').select('*').eq('project_id', projectId).eq('status', 'pending'));
  const proposalIds = mrs.flatMap((m) => m.proposal_ids);
  const [reviews, proposals, intents, edges] = await Promise.all([
    proposalIds.length ? q(db.from('critic_reviews').select('proposal_id,verdict,issues').in('proposal_id', proposalIds)) : [],
    proposalIds.length ? q(db.from('proposals').select('id,task_id').in('id', proposalIds)) : [],
    activeIntents(projectId),
    loadEdges(projectId),
  ]);
  const taskIds = [...new Set(proposals.map((p) => p.task_id).filter(Boolean))];
  const tasks = taskIds.length ? await q(db.from('tasks').select('id,observer_request_id').in('id', taskIds)) : [];
  const names = await namesFor(mrs.map((m) => m.submitted_by));

  const signals = [];
  for (const b of buckets) {
    const items = mrs.filter((m) => b.mergeRequestIds.includes(m.id));
    const ids = items.flatMap((m) => m.proposal_ids);
    const affected = [...b.targets, ...(await downstream(projectId, b.targets, edges))];
    const submitters = new Set(items.map((m) => m.submitted_by));
    const blocking = intents.filter((i) => !submitters.has(i.user_id) && intersect(affected, i.targets).length);
    const linkedTasks = proposals.filter((p) => ids.includes(p.id)).map((p) => p.task_id);
    signals.push({
      bucketId: b.id,
      label: b.label,
      size: items.length,
      internalConflict: items.length > 1,
      blockingCount: blocking.length,
      blockedPeople: [...new Set(blocking.map((i) => i.goal))].slice(0, 5),
      highIssues: reviews.filter((r) => ids.includes(r.proposal_id))
        .flatMap((r) => r.issues || []).filter((i) => i.severity === 'high').length,
      criticVerdicts: reviews.filter((r) => ids.includes(r.proposal_id)).map((r) => r.verdict),
      fromObserver: tasks.some((t) => linkedTasks.includes(t.id) && t.observer_request_id),
      waitingHours: Math.round((Date.now() - Math.min(...items.map((m) => new Date(m.created_at).getTime()))) / 36e5),
      requests: items.map((m) => ({ id: m.id, by: names[m.submitted_by], changes: m.change_list.map((c) => c.summary || c.path) })),
    });
  }

  // Deterministic order first, so prioritizing never fails.
  signals.sort((a, b) => heuristicScore(b) - heuristicScore(a));
  let order = signals.map((s) => s.bucketId);
  let reasons = Object.fromEntries(signals.map((s) => [s.bucketId, [
    s.blockingCount ? `${s.blockingCount} other engineer(s) are waiting on this` : null,
    s.internalConflict ? `${s.size} requests change the same files` : null,
    s.fromObserver ? 'requested by the observer' : null,
    s.highIssues ? `${s.highIssues} serious issue(s) found by the Critic` : null,
  ].filter(Boolean).join('; ') || 'no urgency signals']));
  let recommendations = {};

  // The reviewer's own Critic refines the order and explains it.
  if (ENGINEERS.includes(me.role)) {
    const agent = await getAgent(projectId, user.id, 'critic');
    await setAgentStatus(agent.id, 'working', 'Prioritizing the review queue');
    try {
      const ai = await callClaudeJSON({ system: PRIORITY_SYSTEM, maxTokens: 2000, prompt: JSON.stringify({ buckets: signals }) });
      const valid = Array.isArray(ai.order) ? ai.order.filter((id) => order.includes(id)) : [];
      if (valid.length) order = [...valid, ...order.filter((id) => !valid.includes(id))];
      if (ai.reasons && typeof ai.reasons === 'object') reasons = { ...reasons, ...ai.reasons };
      if (ai.recommendations && typeof ai.recommendations === 'object') recommendations = ai.recommendations;
    } catch {
      // keep the heuristic order
    } finally {
      await setAgentStatus(agent.id, 'idle', null);
    }
  }

  for (const [i, id] of order.entries()) {
    await q(db.from('review_buckets').update({
      priority: i + 1,
      priority_reason: String(reasons[id] || '').slice(0, 500),
      recommendation: recommendations[id] ? String(recommendations[id]).slice(0, 500) : null,
    }).eq('id', id));
    await q(db.from('merge_requests').update({ priority: i + 1 }).eq('bucket_id', id));
  }

  return {
    buckets: order.map((id, i) => {
      const s = signals.find((x) => x.bucketId === id);
      return { ...s, priority: i + 1, reason: reasons[id], recommendation: recommendations[id] || null,
        areas: buckets.find((b) => b.id === id).targets.map(humanizeKey) };
    }),
  };
}
