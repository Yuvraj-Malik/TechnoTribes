// The Moderator: owns the approved project state, the permanent log, and the
// context packet every agent must fetch before it starts working.
import { db, q } from './supabase-admin.js';
import { HttpError } from './errors.js';
import { callClaude } from './claude.js';
import { loadEdges, upstream } from './dependency-graph.js';
import { fileKey, reqKey, isFileKey, keyToPath, humanizeKey } from './paths.js';
import { namesFor } from './log.js';

export async function getState(projectId) {
  const rows = await q(db.from('project_state').select('*').eq('project_id', projectId));
  if (!rows[0]) throw new HttpError(404, 'Project state not found');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Context packet
// ---------------------------------------------------------------------------
// Everything an agent needs: approved state, recent decisions, what others are
// doing right now (goals and targets only, never their content), and the
// dependencies of the files it is about to touch. `missing` lists required
// files that do not exist; agents must refuse to work while it is non-empty.
export async function buildContext({ projectId, userId, targets = [], taskId = null, historyLimit = 10 }) {
  const [state, log, intents, edges, history, tasks] = await Promise.all([
    getState(projectId),
    q(db.from('moderator_log').select('version,kind,summary,reason,targets,created_at,submitted_by')
      .eq('project_id', projectId).order('version', { ascending: false }).limit(20)),
    q(db.from('intents').select('id,user_id,goal,targets,base_version,created_at')
      .eq('project_id', projectId).eq('status', 'active')),
    loadEdges(projectId),
    userId
      ? q(db.from('personal_history').select('kind,payload,created_at').eq('project_id', projectId)
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(historyLimit))
      : [],
    taskId ? q(db.from('tasks').select('*').eq('id', taskId)) : [],
  ]);

  const files = state.files || {};
  const required = await upstream(projectId, targets, edges);
  const missing = required.filter((k) => isFileKey(k) && !(keyToPath(k) in files) && !targets.includes(k));

  const relevant = {};
  for (const key of [...targets, ...required]) {
    if (isFileKey(key) && keyToPath(key) in files) relevant[keyToPath(key)] = files[keyToPath(key)];
  }

  const others = intents.filter((i) => i.user_id !== userId);
  const names = await namesFor([...others.map((i) => i.user_id), ...log.map((l) => l.submitted_by)]);

  return {
    version: state.current_version,
    brief: state.brief,
    task: tasks[0] || null,
    targets,
    relevantFiles: relevant,
    fileIndex: Object.keys(files).sort(),
    requiredDependencies: required,
    missing,
    complete: missing.length === 0,
    recentChanges: log.map((l) => ({
      version: l.version, kind: l.kind, summary: l.summary, reason: l.reason,
      targets: l.targets, by: names[l.submitted_by] || null, at: l.created_at,
    })),
    activeWorkByOthers: others.map((i) => ({
      intentId: i.id, who: names[i.user_id] || 'Someone', goal: i.goal,
      targets: i.targets, basedOnVersion: i.base_version, since: i.created_at,
    })),
    myRecentHistory: history,
  };
}

// ---------------------------------------------------------------------------
// Committing an approved change
// ---------------------------------------------------------------------------
const OBSERVER_SYSTEM = 'You explain updates on a website project to a non-technical founder or investor. '
  + 'Write one or two short sentences in plain English. No file names, no code, no technical jargon. '
  + 'Say what changed and why it matters for the product.';

async function plainLanguage({ kind, summary, reason, changedKeys }) {
  try {
    const text = await callClaude({
      system: OBSERVER_SYSTEM,
      prompt: JSON.stringify({ kind, summary, reason, areas: changedKeys.map(humanizeKey) }),
      maxTokens: 200,
      timeoutMs: 15000,
    });
    return text.trim().slice(0, 600) || summary;
  } catch {
    return summary; // never block an approval because the summary failed
  }
}

// Applies file changes and/or a brief patch as ONE new version, writes the
// permanent log entry, and returns the graph keys that changed.
// Uses optimistic locking on current_version so two approvals can't collide.
export async function commitChange({
  projectId, actorId, submittedBy = null, mergeRequestId = null,
  kind = 'change', summary, reason = '', fileChanges = [], briefPatch = null,
}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await getState(projectId);
    const files = { ...(state.files || {}) };
    const brief = { ...(state.brief || {}) };
    const changedKeys = [];

    for (const c of fileChanges) {
      if (c.action === 'delete') {
        if (c.path in files) { delete files[c.path]; changedKeys.push(fileKey(c.path)); }
      } else if (files[c.path] !== c.content) {
        files[c.path] = c.content;
        changedKeys.push(fileKey(c.path));
      }
    }
    if (briefPatch) {
      for (const [field, value] of Object.entries(briefPatch)) {
        if (JSON.stringify(brief[field]) === JSON.stringify(value)) continue;
        if (value === null) delete brief[field]; else brief[field] = value;
        changedKeys.push(reqKey(field));
      }
    }
    if (!changedKeys.length) return { version: state.current_version, changedKeys, unchanged: true };

    const version = state.current_version + 1;
    const updated = await q(db.from('project_state')
      .update({ files, brief, current_version: version, updated_at: new Date().toISOString() })
      .eq('project_id', projectId).eq('current_version', state.current_version)
      .select('project_id'));
    if (!updated.length) continue; // someone committed first; retry on the fresh state

    const observerSummary = await plainLanguage({ kind, summary, reason, changedKeys });
    await q(db.from('moderator_log').insert({
      project_id: projectId,
      version,
      kind,
      merge_request_id: mergeRequestId,
      submitted_by: submittedBy,
      approved_by: actorId,
      summary,
      reason,
      observer_summary: observerSummary,
      changes: kind === 'brief' ? [briefPatch] : fileChanges,
      targets: changedKeys,
    }));
    return { version, changedKeys, observerSummary };
  }
  throw new HttpError(409, 'The project changed several times at once. Please try again');
}
