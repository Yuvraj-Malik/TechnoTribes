// Project files in Postgres, so it runs on Vercel (no disk, no git).
// Workspaces: 'main' (the shared project), '<userId>' (a developer's isolated
// copy) and 'base:<userId>' (the main snapshot that copy started from, used
// for 3-way merges). Agents only write to a developer's copy; only a
// manager's approval merges into main.
import { db, q } from './supabase-admin.js';
import { HttpError } from './errors.js';

export const BASE = (userId) => `base:${userId}`;

export function safePath(p) {
  const clean = String(p || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  if (!clean || clean.startsWith('/') || clean.split('/').some((s) => s === '..' || s === '')) {
    throw new HttpError(400, `Unsafe path: ${p}`);
  }
  return clean;
}

/** { path: content } for one workspace. */
export async function readAll(projectId, workspace) {
  const rows = await q(db.from('project_files').select('path,content').eq('project_id', projectId).eq('workspace', workspace));
  return Object.fromEntries(rows.map((r) => [r.path, r.content]));
}

export async function readOne(projectId, workspace, path) {
  const rows = await q(db.from('project_files').select('content').eq('project_id', projectId).eq('workspace', workspace).eq('path', safePath(path)));
  return rows[0]?.content ?? null;
}

/** Replaces a workspace with exactly these files. */
export async function writeAll(projectId, workspace, files) {
  await q(db.from('project_files').delete().eq('project_id', projectId).eq('workspace', workspace));
  const rows = Object.entries(files).map(([path, content]) => ({ project_id: projectId, workspace, path, content }));
  if (rows.length) await q(db.from('project_files').insert(rows));
}

/** Applies edits ({ path, content | null }) to a workspace. */
export async function writeEdits(projectId, workspace, edits) {
  for (const e of edits) {
    const path = safePath(e.path);
    if (e.content === null) {
      await q(db.from('project_files').delete().eq('project_id', projectId).eq('workspace', workspace).eq('path', path));
    } else {
      await q(db.from('project_files').upsert(
        { project_id: projectId, workspace, path, content: e.content, updated_at: new Date().toISOString() },
        { onConflict: 'project_id,workspace,path' },
      ));
    }
  }
}

/** A developer's copy starts as a fresh copy of main; the snapshot is kept as its base. */
export async function resetWorkspace(projectId, userId) {
  const main = await readAll(projectId, 'main');
  await writeAll(projectId, userId, main);
  await writeAll(projectId, BASE(userId), main);
}

export async function ensureWorkspace(projectId, userId) {
  const rows = await q(db.from('project_files').select('path').eq('project_id', projectId).eq('workspace', BASE(userId)).limit(1));
  if (!rows.length) await resetWorkspace(projectId, userId);
}

// ---------------------------------------------------------------- diffs
function lineDiff(a, b) {
  // Classic LCS table; files here are small.
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: ' ', text: a[i], i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: '-', text: a[i], i }); i++; }
    else { ops.push({ op: '+', text: b[j], j }); j++; }
  }
  while (i < n) { ops.push({ op: '-', text: a[i], i }); i++; }
  while (j < m) { ops.push({ op: '+', text: b[j], j }); j++; }
  return ops;
}

const splitLines = (s) => (s === null || s === undefined || s === '' ? [] : s.replace(/\n$/, '').split('\n'));

/** Unified diff (git style, 3 lines of context) for one file. */
export function unifiedDiff(path, before, after) {
  if (before === after) return '';
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = lineDiff(a, b);
  const header = [`diff --git a/${path} b/${path}`];
  if (before === null || before === undefined) header.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`);
  else if (after === null || after === undefined) header.push('deleted file mode 100644', `--- a/${path}`, '+++ /dev/null');
  else header.push(`--- a/${path}`, `+++ b/${path}`);

  const changed = ops.map((o, k) => (o.op !== ' ' ? k : -1)).filter((k) => k >= 0);
  const hunks = [];
  let start = null;
  let end = null;
  for (const k of changed) {
    if (start === null) { start = Math.max(0, k - 3); end = Math.min(ops.length - 1, k + 3); continue; }
    if (k - 3 <= end + 1) end = Math.min(ops.length - 1, k + 3);
    else { hunks.push([start, end]); start = Math.max(0, k - 3); end = Math.min(ops.length - 1, k + 3); }
  }
  if (start !== null) hunks.push([start, end]);

  const out = [...header];
  for (const [s, e] of hunks) {
    const slice = ops.slice(s, e + 1);
    let oldStart = null; let newStart = null; let oldLen = 0; let newLen = 0;
    for (const o of slice) {
      if (o.op !== '+') { if (oldStart === null) oldStart = o.i + 1; oldLen++; }
      if (o.op !== '-') { if (newStart === null) newStart = o.j + 1; newLen++; }
    }
    out.push(`@@ -${oldLen ? oldStart : 0},${oldLen} +${newLen ? newStart : 0},${newLen} @@`);
    for (const o of slice) out.push(`${o.op}${o.text}`);
  }
  return `${out.join('\n')}\n`;
}

/** Diff of two { path: content } maps. */
export function diffMaps(before, after) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const files = paths.filter((p) => before[p] !== after[p]);
  const diff = files.map((p) => unifiedDiff(p, before[p] ?? null, after[p] ?? null)).join('');
  return { diff, files };
}

/** What a developer changed in their copy, relative to where it started from main. */
export async function workspaceDiff(projectId, userId) {
  await ensureWorkspace(projectId, userId);
  const [base, mine] = await Promise.all([readAll(projectId, BASE(userId)), readAll(projectId, userId)]);
  return diffMaps(base, mine);
}

export async function isBehindMain(projectId, userId) {
  const [base, main] = await Promise.all([readAll(projectId, BASE(userId)), readAll(projectId, 'main')]);
  return diffMaps(base, main).files.length > 0;
}

/**
 * 3-way merge of a change set into a target, file by file. A file conflicts
 * when both sides changed it differently since the base. Never resolves a
 * conflict silently: returns the conflicted files instead.
 */
export function threeWay(base, theirs, target) {
  const result = { ...target };
  const conflicted = [];
  const paths = new Set([...Object.keys(base), ...Object.keys(theirs)]);
  for (const p of paths) {
    const b = base[p]; const t = theirs[p]; const cur = target[p];
    if (t === b) continue;                 // they didn't change it
    if (cur === b || cur === t) {          // target untouched, or already the same
      if (t === undefined) delete result[p]; else result[p] = t;
      continue;
    }
    conflicted.push(p);
  }
  return { ok: conflicted.length === 0, files: result, conflicted };
}

/** Brings the latest main into a developer's copy, keeping their changes. */
export async function syncWithMain(projectId, userId) {
  const [base, mine, main] = await Promise.all([
    readAll(projectId, BASE(userId)), readAll(projectId, userId), readAll(projectId, 'main'),
  ]);
  const merged = threeWay(base, main, mine);
  if (!merged.ok) return { ok: false, conflictedFiles: merged.conflicted };
  await writeAll(projectId, userId, merged.files);
  await writeAll(projectId, BASE(userId), main);
  return { ok: true, conflictedFiles: [] };
}
