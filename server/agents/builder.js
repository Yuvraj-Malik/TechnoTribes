// The Builder agent: writes code changes for ONE engineer.
// Flow: fetch Moderator context -> refuse if context is incomplete -> check
// overlap with other agents -> declare intent -> ask Claude -> save a DRAFT proposal.
// Nothing reaches the project until the worker submits and an admin approves.
import { db, q } from '../../api/_lib/supabase-admin.js';
import { HttpError } from '../../api/_lib/errors.js';
import { requireFields, asArray } from '../../api/_lib/http.js';
import { requireRole, ENGINEERS } from '../../api/_lib/permissions.js';
import { callClaudeJSON } from '../../api/_lib/claude.js';
import { buildContext } from '../../api/_lib/moderator.js';
import { checkOverlap, declareIntent, releaseIntents } from '../../api/_lib/coordination.js';
import { getAgent, setAgentStatus, addHistory } from '../../api/_lib/log.js';
import { normalizePath, fileKey, keyToPath } from '../../api/_lib/paths.js';

const SYSTEM = `You are the Builder agent in a shared workspace where several engineers, each with their own AI agents, build one website together (React + JavaScript + Tailwind CSS).
You write code changes for ONE engineer.

Rules:
- Change only the files needed for the instruction. Respect the project brief.
- "activeWorkByOthers" lists what other engineers' agents are doing right now. Do not edit their target files unless the instruction explicitly says so. Stay compatible with their stated goals.
- "relevantFiles" holds the current approved content of the files you touch and the files they depend on. Do not assume files that are not in "fileIndex" exist, unless you create them.
- If an admin redirected earlier work, follow their note exactly.

Reply with ONLY one JSON object:
{
  "summary": "one plain-English sentence a non-technical person understands",
  "reason": "why this change, tied to the instruction and the brief",
  "changes": [{ "path": "src/pages/Pricing.jsx", "action": "create" | "update" | "delete", "content": "FULL new file content (omit for delete)" }],
  "depends_on": ["src/components/Button.jsx", "req:audience"],
  "notes_for_team": "anything other engineers should know, or empty"
}
"depends_on" lists other project files (paths) or brief fields ("req:<field>") your change relies on.`;

export function validateBuilderOutput(o) {
  if (!o || typeof o !== 'object') throw new Error('reply is not an object');
  if (typeof o.summary !== 'string' || !o.summary.trim()) throw new Error('"summary" is missing');
  if (!Array.isArray(o.changes) || !o.changes.length) throw new Error('"changes" must be a non-empty array');
  if (o.changes.length > 20) throw new Error('too many files changed at once (max 20)');
  const changes = o.changes.map((c) => {
    const path = normalizePath(c?.path);
    if (!['create', 'update', 'delete'].includes(c.action)) throw new Error(`invalid action for ${path}`);
    if (c.action !== 'delete' && typeof c.content !== 'string') throw new Error(`content missing for ${path}`);
    if (c.content && c.content.length > 200000) throw new Error(`${path} is too large`);
    return { path, action: c.action, content: c.action === 'delete' ? null : c.content };
  });
  const dependsOn = (Array.isArray(o.depends_on) ? o.depends_on : [])
    .filter((d) => typeof d === 'string' && d.trim())
    .map((d) => (d.startsWith('req:') || d.startsWith('file:') ? d : fileKey(normalizePath(d))))
    .slice(0, 50);
  return {
    summary: o.summary.trim().slice(0, 500),
    reason: String(o.reason || '').slice(0, 2000),
    changes,
    dependsOn,
    notesForTeam: String(o.notes_for_team || '').slice(0, 1000),
  };
}

// GET /api/agents/proposals?projectId=   -> your own proposals, newest first, with the latest Critic review
export async function proposals({ user, query }) {
  await requireRole(user.id, query.projectId, ENGINEERS);
  const rows = await q(db.from('proposals').select('*')
    .eq('project_id', query.projectId).eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(50));
  const reviews = rows.length
    ? await q(db.from('critic_reviews').select('*').in('proposal_id', rows.map((p) => p.id)).order('created_at', { ascending: false }))
    : [];
  return { proposals: rows.map((p) => ({ ...p, review: reviews.find((r) => r.proposal_id === p.id) || null })) };
}

// POST /api/agents/builder/run
// { projectId, instruction, targets?: [paths], taskId?, redirectFromMergeRequestId?, force? }
// 409 -> another agent is already on the same files (send force:true to go ahead anyway)
// 422 -> the context is incomplete (a required file is missing)
export async function run({ user, body }) {
  requireFields(body, ['projectId', 'instruction']);
  const projectId = body.projectId;
  await requireRole(user.id, projectId, ENGINEERS);

  let task = null;
  if (body.taskId) {
    task = (await q(db.from('tasks').select('*').eq('id', body.taskId).eq('project_id', projectId)))[0];
    if (!task) throw new HttpError(404, 'Task not found');
  }

  let redirect = null;
  if (body.redirectFromMergeRequestId) {
    const mr = (await q(db.from('merge_requests').select('*').eq('id', body.redirectFromMergeRequestId)))[0];
    if (!mr || mr.submitted_by !== user.id) throw new HttpError(404, 'Redirected merge request not found');
    redirect = { adminNote: mr.decision_note, previousChanges: mr.change_list, targets: mr.targets };
  }

  let targets;
  try {
    targets = asArray(body.targets).map((p) => fileKey(normalizePath(p)));
  } catch (e) { throw new HttpError(400, e.message); }
  if (!targets.length && task) targets = task.targets || [];
  if (!targets.length && redirect) targets = redirect.targets || [];

  // 1. Context from the Moderator
  const context = await buildContext({ projectId, userId: user.id, targets, taskId: task?.id });
  if (!context.complete) {
    throw new HttpError(422, 'The Builder cannot start: some files this work depends on are missing.', {
      missing: context.missing.map(keyToPath),
    });
  }

  // 2. Are other agents working on the same thing?
  const overlap = await checkOverlap(projectId, user.id, targets);
  if (overlap.status === 'same_target' && !body.force) {
    throw new HttpError(409, overlap.message, { overlap });
  }

  // 3. Announce what we are about to do, so other agents can see it
  const agent = await getAgent(projectId, user.id, 'builder');
  const intent = await declareIntent({
    projectId, userId: user.id, agentId: agent.id, taskId: task?.id,
    goal: body.instruction, targets, baseVersion: context.version,
  });
  await setAgentStatus(agent.id, 'working', body.instruction.slice(0, 200));
  if (task && task.status === 'open') await q(db.from('tasks').update({ status: 'in_progress' }).eq('id', task.id));

  try {
    // 4. Ask Claude
    const output = await callClaudeJSON({
      system: SYSTEM,
      maxTokens: 8000,
      timeoutMs: 90000,
      prompt: JSON.stringify({
        instruction: body.instruction,
        task,
        redirect,
        overlapWarnings: overlap.conflicts,
        context,
      }),
    }, validateBuilderOutput);

    const changedTargets = output.changes.map((c) => fileKey(c.path));
    const allTargets = [...new Set([...targets, ...changedTargets])];
    if (allTargets.length !== targets.length) {
      await q(db.from('intents').update({ targets: allTargets }).eq('id', intent.id));
    }

    // 5. Save a draft proposal stamped with the version it was based on
    const proposal = await q(db.from('proposals').insert({
      project_id: projectId,
      user_id: user.id,
      agent_id: agent.id,
      task_id: task?.id || null,
      intent_id: intent.id,
      instruction: body.instruction,
      summary: output.summary,
      reason: output.reason,
      notes_for_team: output.notesForTeam,
      changes: output.changes,
      targets: changedTargets,
      depends_on: output.dependsOn,
      base_version: context.version,
    }).select().single());

    await setAgentStatus(agent.id, 'idle', null);
    await addHistory(projectId, user.id, 'builder_proposal', {
      proposalId: proposal.id, instruction: body.instruction, summary: output.summary,
      files: output.changes.map((c) => c.path), basedOnVersion: context.version,
    });
    return {
      proposal,
      basedOnVersion: context.version,
      overlap: overlap.status === 'clear' ? null : overlap,
    };
  } catch (err) {
    await releaseIntents([intent.id]);
    await setAgentStatus(agent.id, 'idle', null);
    throw err;
  }
}
