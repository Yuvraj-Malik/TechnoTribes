// GitHub: read the repo, import it as the project's starting state, and open
// branches / pull requests. Optional: everything else works without GitHub.
// Needs GITHUB_TOKEN and the project's repo_owner + repo_name.
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireFields, asArray } from '../api/_lib/http.js';
import { requireRole, INSIDERS, MANAGERS } from '../api/_lib/permissions.js';
import { normalizePath } from '../api/_lib/paths.js';
import { readAll, writeAll } from '../api/_lib/files.js';
import { logEvent } from '../api/_lib/activity.js';

const TEXT_FILE = /\.(jsx?|tsx?|css|html|json|md|svg|txt|mjs|cjs)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.git)\//;

async function gh(path, options = {}) {
  if (!process.env.GITHUB_TOKEN) throw new HttpError(500, 'GITHUB_TOKEN is not set');
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `GitHub: ${data.message || res.status}`);
  return data;
}

async function repoOf(projectId) {
  const p = await q(db.from('projects').select('repo_owner,repo_name,default_branch').eq('id', projectId).single());
  if (!p.repo_owner || !p.repo_name) throw new HttpError(400, 'This project has no GitHub repo connected');
  return { owner: p.repo_owner, name: p.repo_name, branch: p.default_branch || 'main' };
}

// GET /api/github/tree?projectId=&ref=
export async function tree({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  const repo = await repoOf(query.projectId);
  const data = await gh(`/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(query.ref || repo.branch)}?recursive=1`);
  return { truncated: data.truncated, files: data.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size })) };
}

// GET /api/github/file?projectId=&path=&ref=
export async function file({ user, query }) {
  await requireRole(user.id, query.projectId, INSIDERS);
  requireFields(query, ['path']);
  const repo = await repoOf(query.projectId);
  const data = await gh(`/repos/${repo.owner}/${repo.name}/contents/${encodeURI(query.path)}?ref=${encodeURIComponent(query.ref || repo.branch)}`);
  return { path: data.path, sha: data.sha, content: Buffer.from(data.content || '', 'base64').toString('utf8') };
}

// POST /api/github/import  { projectId, ref?, paths?: [] }   (owner/admin)
// Pulls text files from the repo into the approved (main) files as one commit.
export async function importRepo({ user, body }) {
  requireFields(body, ['projectId']);
  await requireRole(user.id, body.projectId, MANAGERS);
  const repo = await repoOf(body.projectId);
  const ref = body.ref || repo.branch;
  const wanted = asArray(body.paths);
  const treeData = await gh(`/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const blobs = treeData.tree
    .filter((t) => t.type === 'blob' && TEXT_FILE.test(t.path) && !SKIP.test(t.path) && t.size < 200000)
    .filter((t) => !wanted.length || wanted.includes(t.path))
    .slice(0, 200);

  const fileChanges = [];
  for (const blob of blobs) {
    const data = await gh(`/repos/${repo.owner}/${repo.name}/git/blobs/${blob.sha}`);
    fileChanges.push({ path: normalizePath(blob.path), action: 'update', content: Buffer.from(data.content, 'base64').toString('utf8') });
  }
  const main = await readAll(body.projectId, 'main');
  for (const f of fileChanges) main[f.path] = f.content;
  await writeAll(body.projectId, 'main', main);
  const message = `Imported ${fileChanges.length} files from GitHub (${repo.owner}/${repo.name}@${ref})`;
  const commit = await q(db.from('main_commits').insert({
    project_id: body.projectId, author_id: user.id, message, files: fileChanges.map((f) => f.path),
  }).select().single());
  await logEvent(body.projectId, { type: 'github.import', actorId: user.id, summary: message, data: { commitId: commit.id } });
  return { imported: fileChanges.length, commitId: commit.id };
}

// POST /api/github/branch  { projectId, name, from? }   (insiders)
export async function branch({ user, body }) {
  requireFields(body, ['projectId', 'name']);
  await requireRole(user.id, body.projectId, INSIDERS);
  const repo = await repoOf(body.projectId);
  const base = await gh(`/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(body.from || repo.branch)}`);
  const ref = await gh(`/repos/${repo.owner}/${repo.name}/git/refs`, {
    method: 'POST', body: JSON.stringify({ ref: `refs/heads/${body.name}`, sha: base.object.sha }),
  });
  return { ref: ref.ref, sha: ref.object.sha };
}

// POST /api/github/pull-request  { projectId, head, base?, title, body? }   (owner/admin)
export async function pullRequest({ user, body }) {
  requireFields(body, ['projectId', 'head', 'title']);
  await requireRole(user.id, body.projectId, MANAGERS);
  const repo = await repoOf(body.projectId);
  const pr = await gh(`/repos/${repo.owner}/${repo.name}/pulls`, {
    method: 'POST', body: JSON.stringify({ head: body.head, base: body.base || repo.branch, title: body.title, body: body.body || '' }),
  });
  return { number: pr.number, url: pr.html_url };
}
