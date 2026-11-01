// Workflow records (dev tasks, work submissions, context proposals, context suggestions): key
// fields as columns for querying, the full record as JSON in `data`.
import { randomUUID } from 'node:crypto';
import { db, q } from './supabase-admin.js';

function table(name, columns) {
  const fromRow = (r) => r && { ...r.data, id: r.id, status: r.status, createdAt: r.created_at };
  return {
    newId: () => randomUUID(),
    async get(id) {
      const rows = await q(db.from(name).select('*').eq('id', id));
      return fromRow(rows[0]);
    },
    async list(projectId, where = {}, limit = 200) {
      let query = db.from(name).select('*').eq('project_id', projectId);
      for (const [col, val] of Object.entries(where)) query = Array.isArray(val) ? query.in(col, val) : query.eq(col, val);
      return (await q(query.order('created_at', { ascending: false }).limit(limit))).map(fromRow);
    },
    async put(doc) {
      const { id, status, createdAt, ...data } = doc;
      const row = { id, project_id: doc.projectId, status, data, ...columns(doc) };
      if (createdAt) row.created_at = createdAt;
      if (name === 'dev_tasks') row.updated_at = new Date().toISOString();
      await q(db.from(name).upsert(row, { onConflict: 'id' }));
      return doc;
    },
  };
}

export const devTasks = table('dev_tasks', (t) => ({ user_id: t.userId, department: t.department }));
export const workSubmissions = table('work_submissions', (s) => ({ user_id: s.userId, department: s.department, task_id: s.taskId }));
export const contextProposals = table('context_proposals', (p) => ({ submission_id: p.submissionId, department: p.department }));
// Suggestions: the only way shared context changes (see api/_lib/suggestions.js).
export const suggestions = table('context_suggestions', (s) => ({
  department: s.department ?? null, scope: s.scope, label: s.label ?? null,
  suggested_by: s.suggestedBy ?? null, task_id: s.taskId ?? null, decided_at: s.decidedAt ?? null,
}));
