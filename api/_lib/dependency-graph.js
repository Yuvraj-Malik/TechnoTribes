// The dependency graph: which files/requirements depend on which.
// Edge from_key -> to_key means "from_key depends on to_key".
import { db, q } from './supabase-admin.js';

export async function loadEdges(projectId) {
  return q(db.from('dependency_edges').select('from_key,to_key,relation').eq('project_id', projectId));
}

export async function loadGraph(projectId) {
  const [nodes, edges] = await Promise.all([
    q(db.from('dependency_nodes').select('key,kind,label').eq('project_id', projectId)),
    loadEdges(projectId),
  ]);
  return { nodes, edges };
}

export async function ensureNodes(projectId, keys) {
  const unique = [...new Set(keys)].filter(Boolean);
  if (!unique.length) return;
  const rows = unique.map((key) => ({
    project_id: projectId,
    key,
    kind: key.split(':')[0],
    label: key.slice(key.indexOf(':') + 1),
  }));
  await q(db.from('dependency_nodes').upsert(rows, { onConflict: 'project_id,key', ignoreDuplicates: true }));
}

// Record that every key in fromKeys depends on every key in toKeys.
export async function addDependencies(projectId, fromKeys, toKeys, relation = 'depends_on') {
  await ensureNodes(projectId, [...fromKeys, ...toKeys]);
  const edges = [];
  for (const from of new Set(fromKeys)) {
    for (const to of new Set(toKeys)) {
      if (from !== to) edges.push({ project_id: projectId, from_key: from, to_key: to, relation });
    }
  }
  if (edges.length) {
    await q(db.from('dependency_edges').upsert(edges, {
      onConflict: 'project_id,from_key,to_key,relation', ignoreDuplicates: true,
    }));
  }
}

function walk(startKeys, adjacency) {
  const start = new Set(startKeys);
  const seen = new Set();
  const queue = [...startKeys];
  while (queue.length) {
    const key = queue.shift();
    for (const next of adjacency.get(key) || []) {
      if (!seen.has(next) && !start.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

function index(edges, from, to) {
  const map = new Map();
  for (const e of edges) {
    if (!map.has(e[from])) map.set(e[from], []);
    map.get(e[from]).push(e[to]);
  }
  return map;
}

// Everything that directly or indirectly depends on `keys` (what breaks if keys change).
export async function downstream(projectId, keys, edges) {
  return walk(keys, index(edges || await loadEdges(projectId), 'to_key', 'from_key'));
}

// Everything `keys` directly or indirectly depend on (what an agent must know about).
export async function upstream(projectId, keys, edges) {
  return walk(keys, index(edges || await loadEdges(projectId), 'from_key', 'to_key'));
}

export function intersect(a = [], b = []) {
  const set = new Set(a);
  return [...new Set(b.filter((x) => set.has(x)))];
}
