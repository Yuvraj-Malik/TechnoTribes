// Review bucketing: groups pending merge requests that touch the same files,
// so the admin reviews one bucket instead of many separate requests.
import { db, q } from './supabase-admin.js';
import { humanizeKey } from './paths.js';

export async function pendingMergeRequests(projectId) {
  return q(db.from('merge_requests').select('*').eq('project_id', projectId)
    .eq('status', 'pending').order('created_at'));
}

// Union-find over shared targets: A and B share a file -> same bucket,
// and if B and C share another file, all three end up together.
export function groupBySharedTargets(items) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  items.forEach((item, i) => {
    for (const key of item.targets || []) {
      if (owner.has(key)) parent[find(i)] = find(owner.get(key));
      else owner.set(key, i);
    }
  });
  const groups = new Map();
  items.forEach((item, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  return [...groups.values()];
}

export function bucketLabel(items) {
  const targets = [...new Set(items.flatMap((m) => m.targets || []))];
  const areas = [...new Set(targets.map(humanizeKey))];
  const shown = areas.slice(0, 3).join(', ') + (areas.length > 3 ? ` and ${areas.length - 3} more` : '');
  return `${items.length} change${items.length > 1 ? 's' : ''} to ${shown || 'the project'}`;
}

// Rebuild all open buckets from the current pending merge requests.
export async function rebucket(projectId) {
  const pending = await pendingMergeRequests(projectId);
  await q(db.from('review_buckets').delete().eq('project_id', projectId).eq('status', 'open'));
  const groups = groupBySharedTargets(pending);
  const buckets = [];
  for (const items of groups) {
    const bucket = await q(db.from('review_buckets').insert({
      project_id: projectId,
      label: bucketLabel(items),
      kind: items.length > 1 ? 'same_target' : 'single',
      targets: [...new Set(items.flatMap((m) => m.targets || []))],
    }).select().single());
    await q(db.from('merge_requests').update({ bucket_id: bucket.id }).in('id', items.map((m) => m.id)));
    buckets.push({ ...bucket, mergeRequestIds: items.map((m) => m.id) });
  }
  return buckets;
}
