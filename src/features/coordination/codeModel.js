// Turns project data into the views on the owner's Code tab. No React here, so
// tests/unit can check these rules directly.

// Mid-tones that read on both the light and the dark surface.
const PERSON_COLORS = ['#3f7fe0', '#2e9e6b', '#e39a12', '#c2557a', '#7a6ff0', '#1aa6b7', '#d9653b', '#8a8f3c'];

export const ROW_HEIGHT = 58;
const LANE_WIDTH = 20;
const PAD = 16;
const COMPACT_PAD = 12;

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 44; // also a comfortable tap target
const COLUMN_GAP = 60;
const NODE_GAP = 12;
const STOP_HEIGHT = 4;

// Everyone with agents gets one colour, kept stable by the order they joined.
export function personColors(members = []) {
  const order = members
    .filter((m) => m.role !== 'observer')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.user_id).localeCompare(String(b.user_id)));
  return Object.fromEntries(order.map((m, i) => [m.user_id, PERSON_COLORS[i % PERSON_COLORS.length]]));
}

const FILLER_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);

export function branchName(who, goal) {
  const person = String(who || 'team').trim().split(/\s+/)[0].toLowerCase();
  const words = String(goal || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const slug = words.filter((word) => word && !FILLER_WORDS.has(word)).slice(0, 4).join('-');
  return `${person}/${slug || 'work'}`;
}

// Every open piece of work, as a branch off the version it was based on.
// A submitted request replaces the intent it came from.
export function buildBranches({ work = [], queue = {}, headVersion = 0 }) {
  const requests = [
    ...(queue.buckets || []).flatMap((bucket) => (bucket.mergeRequests || [])
      .map((mr) => ({ ...mr, state: bucket.mergeRequests.length > 1 ? 'clash' : 'review' }))),
    ...(queue.needsAttention || []).map((mr) => ({ ...mr, state: 'outdated' })),
  ];

  const submitted = new Set(requests.flatMap((mr) => (mr.proposals || []).map((p) => p.intent_id)));
  const branches = [
    ...requests.map((mr) => ({
      id: `mr-${mr.id}`,
      userId: mr.submitted_by,
      who: mr.submittedByName,
      goal: mr.proposals?.[0]?.summary || mr.note || 'Submitted change',
      targets: mr.targets || [],
      baseVersion: mr.base_version,
      state: mr.state,
      reason: mr.conflict_reason || null,
    })),
    ...work.filter((w) => !submitted.has(w.intentId)).map((w) => ({
      id: `intent-${w.intentId}`,
      userId: w.userId,
      who: w.who,
      goal: w.goal,
      targets: w.targets || [],
      baseVersion: w.basedOnVersion,
      state: 'building',
      reason: null,
    })),
  ];

  return branches
    .map((b) => ({ ...b, name: branchName(b.who, b.goal), behind: Math.max(headVersion - b.baseVersion, 0) }))
    .sort((a, b) => b.baseVersion - a.baseVersion || a.name.localeCompare(b.name));
}

// Lays out a `git log --graph`: branch tips on top, then main from newest to
// oldest. Branches on newer versions take the lanes closest to main, so their
// lines leave the graph first and never cross. Expects buildBranches' order.
// Pass a smaller laneWidth to leave more room for text on narrow screens.
export function layoutBranchMap({ branches = [], log = [], laneWidth = LANE_WIDTH }) {
  const commits = log.map((entry) => ({ ...entry, type: 'commit', key: `v${entry.version}` }));
  if ((commits.at(-1)?.version ?? 0) <= 1) commits.push({ type: 'root', key: 'root', version: 0 });

  const rows = [
    ...branches.map((b, i) => ({ ...b, type: 'branch', key: b.id, lane: i + 1 })),
    ...commits.map((c) => ({ ...c, lane: 0 })),
  ];
  const pad = laneWidth < LANE_WIDTH ? COMPACT_PAD : PAD;
  const x = (lane) => pad + lane * laneWidth;
  const y = (row) => ROW_HEIGHT / 2 + row * ROW_HEIGHT;
  const rowOfVersion = new Map(commits.map((c, i) => [c.version, branches.length + i]));
  const lastRow = rows.length - 1;

  const links = branches.map((b, i) => {
    const top = y(i);
    const bottom = y(rowOfVersion.get(b.baseVersion) ?? lastRow); // an older base than the log shows
    const lane = x(i + 1);
    return {
      key: b.id,
      userId: b.userId,
      state: b.state,
      d: `M ${lane} ${top} V ${bottom - ROW_HEIGHT * 0.7} Q ${lane} ${bottom} ${x(0)} ${bottom}`,
    };
  });

  return {
    rows: rows.map((row, i) => ({ ...row, cx: x(row.lane), cy: y(i) })),
    links,
    trunk: { x: x(0), top: y(branches.length), bottom: y(lastRow) },
    width: x(branches.length) + pad,
    height: rows.length * ROW_HEIGHT,
  };
}

// Flat rows for a file tree: folders first, with a depth for indenting.
export function buildFileTree(paths = []) {
  const root = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split('/');
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ name, path });
  }

  const rows = [];
  const walk = (node, prefix, depth) => {
    for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const path = prefix ? `${prefix}/${name}` : name;
      rows.push({ name, path, depth, isDir: true });
      walk(child, path, depth + 1);
    }
    for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ ...file, depth, isDir: false });
    }
  };
  walk(root, '', 0);
  return rows;
}

// { path: [branches touching it] }. Two people on one path is a clash waiting to happen.
export function filePresence(branches = []) {
  const byPath = {};
  for (const branch of branches) {
    for (const key of branch.targets) {
      if (key.startsWith('file:')) (byPath[key.slice(5)] ||= []).push(branch);
    }
  }
  return byPath;
}

export function fileFacts(path, { log = [], edges = [] }) {
  const key = `file:${path}`;
  return {
    lastChange: log.find((entry) => (entry.targets || []).includes(key)) || null,
    dependsOn: edges.filter((e) => e.from_key === key).map((e) => e.to_key),
    usedBy: edges.filter((e) => e.to_key === key).map((e) => e.from_key),
  };
}

// Each person's goal, and what they have finished so far.
export function buildPeople({ members = [], tasks = [], log = [], branches = [] }) {
  return members
    .filter((m) => m.status === 'active' && m.role !== 'observer')
    .map((m) => {
      const mine = tasks.filter((t) => t.assignee_id === m.user_id);
      const finished = mine.filter((t) => t.status === 'done');
      const open = mine.filter((t) => t.status !== 'done');
      const active = branches.filter((b) => b.userId === m.user_id);
      return {
        userId: m.user_id,
        name: m.name,
        role: m.role,
        designation: m.designation || null,
        goal: active[0]?.goal || open[0]?.title || null,
        branches: active,
        openTasks: open,
        tasksDone: finished.length,
        tasksTotal: mine.length,
        progress: mine.length ? Math.round((finished.length / mine.length) * 100) : 0,
        shipped: log.filter((entry) => entry.kind === 'change' && entry.submitted_by === m.user_id),
      };
    })
    .sort((a, b) => b.branches.length - a.branches.length || b.shipped.length - a.shipped.length);
}

const keyLabel = (key) => key.slice(key.indexOf(':') + 1).split('/').pop();

// A left-to-right dependency graph: a file sits one column right of whatever it
// depends on, so requirements land on the far left.
export function layoutDependencyGraph({ nodes = [], edges = [] }) {
  const keys = [...new Set([...nodes.map((n) => n.key), ...edges.flatMap((e) => [e.from_key, e.to_key])])].sort();
  const column = Object.fromEntries(keys.map((key) => [key, 0]));

  // At most one pass per node, so a dependency cycle cannot loop forever.
  for (let pass = 0; pass < keys.length; pass++) {
    let moved = false;
    for (const { from_key: from, to_key: to } of edges) {
      if (from !== to && column[from] <= column[to]) {
        column[from] = column[to] + 1;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const columns = new Map();
  const addToColumn = (index, key) => {
    if (!columns.has(index)) columns.set(index, []);
    columns.get(index).push(key);
  };
  keys.forEach((key) => addToColumn(column[key], key));

  // A long edge gets a stop in each column it crosses, so it runs between nodes
  // instead of behind them, where it would look like it touches them.
  const chains = edges.filter((e) => e.from_key !== e.to_key).map((e) => {
    const stops = [];
    for (let index = column[e.to_key] + 1; index < column[e.from_key]; index++) {
      const stop = `~${e.from_key}~${e.to_key}~${index}`;
      addToColumn(index, stop);
      stops.push(stop);
    }
    return { from: e.from_key, to: e.to_key, points: [e.to_key, ...stops, e.from_key] };
  });

  const isStop = (key) => key.startsWith('~');
  const sizeOf = (key) => (isStop(key) ? STOP_HEIGHT : NODE_HEIGHT);
  const columnHeight = (list) => list.reduce((sum, key) => sum + sizeOf(key) + NODE_GAP, -NODE_GAP);
  const height = Math.max(NODE_HEIGHT, ...[...columns.values()].map(columnHeight));

  const leftOf = new Map();
  for (const { points } of chains) {
    points.slice(1).forEach((key, i) => leftOf.set(key, [...(leftOf.get(key) || []), points[i]]));
  }

  // Sit each node near what connects to it from the left, so edges stay short.
  const position = {};
  const anchor = (key) => {
    const placed = (leftOf.get(key) || []).filter((left) => position[left]).map((left) => position[left].y);
    return placed.length ? placed.reduce((sum, value) => sum + value, 0) / placed.length : 0;
  };

  for (const index of [...columns.keys()].sort((a, b) => a - b)) {
    const order = columns.get(index)
      .map((key, i) => ({ key, i, at: anchor(key) }))
      .sort((a, b) => a.at - b.at || a.i - b.i);
    let y = (height - columnHeight(columns.get(index))) / 2;
    for (const { key } of order) {
      position[key] = { x: index * (NODE_WIDTH + COLUMN_GAP), y };
      y += sizeOf(key) + NODE_GAP;
    }
  }

  const middle = (key) => position[key].y + sizeOf(key) / 2;
  const links = chains.map(({ from, to, points }) => {
    let d = `M ${position[to].x + NODE_WIDTH} ${middle(to)}`;
    points.slice(1).forEach((key, i) => {
      const x1 = position[points[i]].x + NODE_WIDTH;
      const y1 = middle(points[i]);
      const x2 = position[key].x;
      const y2 = middle(key);
      const bend = Math.max(Math.abs(x2 - x1) / 2, 24);
      d += ` C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      if (isStop(key)) d += ` H ${x2 + NODE_WIDTH}`;
    });
    return { from, to, d };
  });

  return {
    placed: keys.map((key) => ({ key, label: keyLabel(key), kind: key.split(':')[0], ...position[key] })),
    links,
    width: keys.length ? (Math.max(...columns.keys()) + 1) * (NODE_WIDTH + COLUMN_GAP) - COLUMN_GAP : 0,
    height: keys.length ? height : 0,
  };
}

// Everything linked to a key: what it relies on, and what a change to it would affect.
export function impactOf(key, edges = []) {
  const walk = (from, to) => {
    const seen = new Set();
    const queue = [key];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of edges) {
        if (edge[from] === current && !seen.has(edge[to]) && edge[to] !== key) {
          seen.add(edge[to]);
          queue.push(edge[to]);
        }
      }
    }
    return seen;
  };
  return { dependsOn: walk('from_key', 'to_key'), affects: walk('to_key', 'from_key') };
}
