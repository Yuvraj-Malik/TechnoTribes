// What the Code page shows, worked out from the project's files, tasks and
// merges. No database code here, so tests/unit can check these rules directly.

const OPEN_TASKS = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'done', 'needs_context_decision', 'sent_back', 'failed'];
const OPEN_SUBMISSIONS = ['pending', 'merge_conflict'];

const LINK_PATTERNS = [
  /\bfrom\s+['"](\.[^'"]+)['"]/g,
  /\bimport\s+['"](\.[^'"]+)['"]/g,
  /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /\b(?:src|href)=["']([^"'#?]+)/g,
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g,
];
const TRIED_ENDINGS = ['', '.js', '.jsx', '.ts', '.tsx', '.css', '/index.js', '/index.jsx'];

function resolveLink(from, link, paths) {
  if (/^([a-z]+:|\/\/)/i.test(link)) return null;
  const parts = link.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of link.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  const target = parts.join('/');
  return TRIED_ENDINGS.map((ending) => target + ending).find((path) => paths.has(path)) ?? null;
}

// Which file uses which, read from the imports and links in the files themselves.
export function fileEdges(files = {}) {
  const paths = new Set(Object.keys(files));
  const edges = new Map();
  for (const [from, content] of Object.entries(files)) {
    for (const pattern of LINK_PATTERNS) {
      for (const [, link] of String(content).matchAll(pattern)) {
        const to = resolveLink(from, link, paths);
        // One page linking to another is navigation, not a dependency.
        const navigation = /\.html?$/.test(from) && to && /\.html?$/.test(to);
        if (to && to !== from && !navigation) edges.set(`${from}>${to}`, { from_key: from, to_key: to });
      }
    }
  }
  return [...edges.values()];
}

const FILLER_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);

export function branchName(who, goal) {
  const person = String(who || 'team').trim().split(/\s+/)[0].toLowerCase();
  const words = String(goal || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const slug = words.filter((word) => word && !FILLER_WORDS.has(word)).slice(0, 4).join('-');
  return `${person}/${slug || 'work'}`;
}

const filesOf = (task) => [...new Set([...(task.plan?.files ?? []), ...(task.changedFiles ?? [])])];

// main's history, newest first, numbered from v1 like the live site's versions.
export function buildLog(commits = [], people = []) {
  const name = (id) => people.find((p) => p.id === id)?.name ?? null;
  return [...commits]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((c, i) => ({ version: i + 1, id: c.id, summary: c.message, authorId: c.author_id, author: name(c.author_id), files: c.files ?? [], at: c.created_at }))
    .reverse();
}

// Every open piece of work, as a branch off the version of main it started from.
export function buildBranches({ tasks = [], submissions = [], log = [] }) {
  const headVersion = log[0]?.version ?? 0;
  const versionAt = (at) => log.filter((entry) => String(entry.at) <= String(at)).length;
  const open = tasks.flatMap((task) => {
    const submission = submissions.find((s) => s.id === task.submissionId);
    const inReview = task.status === 'submitted' && OPEN_SUBMISSIONS.includes(submission?.status);
    if (!inReview && !OPEN_TASKS.includes(task.status)) return [];
    return [{
      id: task.id, userId: task.userId, who: task.userName, goal: task.text, department: task.department,
      targets: filesOf(task), baseVersion: versionAt(task.createdAt),
      state: submission?.status === 'merge_conflict' ? 'clash' : inReview ? 'review' : 'building',
      outdated: !!task.outdated,
    }];
  });

  return open
    .map((branch) => {
      const clashes = open.some((other) => other.userId !== branch.userId && other.targets.some((path) => branch.targets.includes(path)));
      const state = branch.outdated ? 'outdated' : clashes ? 'clash' : branch.state;
      return { ...branch, state, name: branchName(branch.who, branch.goal), behind: Math.max(headVersion - branch.baseVersion, 0) };
    })
    .sort((a, b) => b.baseVersion - a.baseVersion || a.name.localeCompare(b.name));
}

// Each person's goal, and what they have finished so far.
export function buildPeople({ people = [], assignments = [], submissions = [], branches = [] }) {
  const order = { owner: 0, admin: 1, worker: 2 };
  return people
    .filter((p) => p.role !== 'observer')
    .map((p) => {
      const mine = assignments.filter((t) => t.assignee_id === p.id);
      const finished = mine.filter((t) => t.status === 'done');
      const open = mine.filter((t) => t.status !== 'done');
      const active = branches.filter((b) => b.userId === p.id);
      return {
        userId: p.id, name: p.name, role: p.role, designation: p.designation ?? null, department: p.department,
        goal: active[0]?.goal ?? open[0]?.title ?? null,
        upNext: active.length ? open[0]?.title ?? null : open[1]?.title ?? null,
        tasksDone: finished.length, tasksTotal: mine.length,
        progress: mine.length ? Math.round((finished.length / mine.length) * 100) : 0,
        shipped: submissions.filter((s) => s.userId === p.id && s.status === 'approved').map((s) => ({ id: s.id, title: s.title, at: s.createdAt })),
      };
    })
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}
