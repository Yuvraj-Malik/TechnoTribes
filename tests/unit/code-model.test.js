// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_HEIGHT, ROW_HEIGHT, branchName, buildBranches, buildFileTree, buildPeople, fileFacts, filePresence,
  impactOf, layoutBranchMap, layoutDependencyGraph, personColors,
} from '../../src/features/coordination/codeModel.js';

const work = [
  { intentId: 'i1', userId: 'a', who: 'Priya Nair', goal: 'Add three plans to pricing', targets: ['file:src/Pricing.jsx'], basedOnVersion: 12 },
  { intentId: 'i2', userId: 'b', who: 'Sam Lee', goal: 'Fix the signup form', targets: ['file:src/Signup.jsx', 'req:tone'], basedOnVersion: 10 },
];
const queue = {
  buckets: [{
    id: 'b1',
    mergeRequests: [{ id: 'm1', submitted_by: 'b', submittedByName: 'Sam Lee', base_version: 10, targets: ['file:src/Signup.jsx'], proposals: [{ intent_id: 'i2', summary: 'Shorter signup' }] }],
  }],
  needsAttention: [{ id: 'm2', submitted_by: 'c', submittedByName: 'Ravi Shah', base_version: 8, targets: ['file:src/Pricing.jsx'], conflict_reason: 'Audience changed', proposals: [] }],
};
const log = [12, 11, 10, 9, 8].map((version) => ({ version, kind: 'change', summary: `Change ${version}`, submitted_by: 'a', targets: [`file:src/${version}.jsx`] }));

test('branch names read like git branches', () => {
  assert.equal(branchName('Priya Nair', 'Add three plans to the pricing page!'), 'priya/add-three-plans-pricing');
  assert.equal(branchName(null, ''), 'team/work');
});

test('a submitted request replaces the intent it came from', () => {
  const branches = buildBranches({ work, queue, headVersion: 12 });
  assert.deepEqual(branches.map((b) => b.state), ['building', 'review', 'outdated']);
  assert.equal(branches.find((b) => b.userId === 'b').goal, 'Shorter signup');
  assert.equal(branches.find((b) => b.userId === 'c').reason, 'Audience changed');
});

test('branches show how far behind main they are, newest base first', () => {
  const branches = buildBranches({ work, queue, headVersion: 12 });
  assert.deepEqual(branches.map((b) => b.baseVersion), [12, 10, 8]);
  assert.deepEqual(branches.map((b) => b.behind), [0, 2, 4]);
});

test('two requests in one bucket are a clash', () => {
  const pair = { buckets: [{ id: 'b', mergeRequests: [{ id: 'x', base_version: 1 }, { id: 'y', base_version: 1 }] }] };
  assert.deepEqual(buildBranches({ queue: pair }).map((b) => b.state), ['clash', 'clash']);
});

test('the branch map joins each branch to the commit it was based on', () => {
  const branches = buildBranches({ work, queue, headVersion: 12 });
  const map = layoutBranchMap({ branches, log });
  assert.deepEqual(map.rows.map((r) => r.type), ['branch', 'branch', 'branch', 'commit', 'commit', 'commit', 'commit', 'commit']);
  assert.deepEqual(map.rows.slice(0, 3).map((r) => r.lane), [1, 2, 3]);
  assert.equal(map.height, 8 * ROW_HEIGHT);

  const v10 = map.rows.find((r) => r.key === 'v10');
  assert.ok(map.links[1].d.endsWith(`${map.trunk.x} ${v10.cy}`));
});

test('newer bases take closer lanes, so branch lines never cross', () => {
  const branches = buildBranches({ work, queue, headVersion: 12 });
  const map = layoutBranchMap({ branches, log });
  const bases = map.rows.filter((r) => r.type === 'branch').map((r) => r.baseVersion);
  assert.deepEqual(bases, [...bases].sort((a, b) => b - a));
});

test('a branch older than the visible log runs to the bottom of the graph', () => {
  const old = [{ id: 'old', userId: 'a', state: 'building', baseVersion: 2, targets: [] }];
  const map = layoutBranchMap({ branches: old, log: log.slice(0, 2) });
  assert.ok(map.links[0].d.endsWith(`${map.trunk.x} ${map.trunk.bottom}`));
});

test('narrow screens get a tighter graph that still joins up', () => {
  const branches = buildBranches({ work, queue, headVersion: 12 });
  const wide = layoutBranchMap({ branches, log });
  const narrow = layoutBranchMap({ branches, log, laneWidth: 10 });
  assert.ok(narrow.width < wide.width / 1.5);
  assert.deepEqual(narrow.rows.map((r) => r.key), wide.rows.map((r) => r.key));

  const v10 = narrow.rows.find((r) => r.key === 'v10');
  assert.ok(narrow.links[1].d.endsWith(`${narrow.trunk.x} ${v10.cy}`));
});

test('a new project still has a starting point', () => {
  const map = layoutBranchMap({ branches: [{ id: 'first', userId: 'a', state: 'building', baseVersion: 0, targets: [] }], log: [] });
  assert.deepEqual(map.rows.map((r) => r.type), ['branch', 'root']);
  assert.equal(map.trunk.top, map.trunk.bottom);
});

test('the file tree lists folders first and indents by depth', () => {
  const rows = buildFileTree(['README.md', 'src/App.jsx', 'src/pages/Home.jsx', 'src/components/Button.jsx']);
  assert.deepEqual(rows.map((r) => r.path), ['src', 'src/components', 'src/components/Button.jsx', 'src/pages', 'src/pages/Home.jsx', 'src/App.jsx', 'README.md']);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2, 1, 2, 1, 0]);
  assert.equal(rows[0].isDir, true);
  assert.equal(rows.at(-1).isDir, false);
});

test('file presence shows who is touching a file and skips requirements', () => {
  const presence = filePresence([
    { userId: 'a', targets: ['file:src/Pricing.jsx', 'req:tone'] },
    { userId: 'b', targets: ['file:src/Pricing.jsx'] },
  ]);
  assert.deepEqual(Object.keys(presence), ['src/Pricing.jsx']);
  assert.equal(presence['src/Pricing.jsx'].length, 2);
});

test('file facts come from the log and the graph', () => {
  const edges = [
    { from_key: 'file:src/9.jsx', to_key: 'file:src/Button.jsx' },
    { from_key: 'file:src/Page.jsx', to_key: 'file:src/9.jsx' },
  ];
  const facts = fileFacts('src/9.jsx', { log, edges });
  assert.equal(facts.lastChange.version, 9);
  assert.deepEqual(facts.dependsOn, ['file:src/Button.jsx']);
  assert.deepEqual(facts.usedBy, ['file:src/Page.jsx']);
  assert.equal(fileFacts('src/None.jsx', { log, edges }).lastChange, null);
});

test('each person has a goal and what they have done so far', () => {
  const members = [
    { user_id: 'a', name: 'Priya', role: 'admin', status: 'active', designation: 'Lead' },
    { user_id: 'b', name: 'Sam', role: 'worker', status: 'active' },
    { user_id: 'i', name: 'Investor', role: 'observer', status: 'active' },
    { user_id: 'p', name: 'New', role: 'admin', status: 'pending' },
  ];
  const tasks = [
    { assignee_id: 'b', title: 'Build checkout', status: 'in_progress' },
    { assignee_id: 'b', title: 'Build cart', status: 'done' },
    { assignee_id: 'b', title: 'Build menu', status: 'done' },
    { assignee_id: 'b', title: 'Build footer', status: 'open' },
  ];
  const people = buildPeople({ members, tasks, log, branches: buildBranches({ work: [work[0]], headVersion: 12 }) });

  assert.deepEqual(people.map((p) => p.name), ['Priya', 'Sam']);
  assert.equal(people[0].goal, 'Add three plans to pricing');
  assert.equal(people[0].shipped.length, 5);
  assert.equal(people[1].goal, 'Build checkout');
  assert.equal(people[1].progress, 50);
  assert.equal(people[1].tasksDone, 2);
  assert.equal(people[1].openTasks.length, 2);
});

test('colours are stable and skip the investor', () => {
  const a = { user_id: 'a', role: 'admin', created_at: '2026-01-01' };
  const b = { user_id: 'b', role: 'worker', created_at: '2026-01-02' };
  const i = { user_id: 'i', role: 'observer', created_at: '2026-01-03' };
  assert.deepEqual(personColors([b, i, a]), personColors([a, b, i]));
  assert.equal(personColors([a, i]).i, undefined);
});

const edges = [
  { from_key: 'file:src/Button.jsx', to_key: 'req:tone' },
  { from_key: 'file:src/Pricing.jsx', to_key: 'file:src/Button.jsx' },
  { from_key: 'file:src/Signup.jsx', to_key: 'file:src/Button.jsx' },
];

test('the graph puts requirements left and dependents right', () => {
  const graph = layoutDependencyGraph({ nodes: [{ key: 'file:src/Lone.jsx' }], edges });
  const at = Object.fromEntries(graph.placed.map((n) => [n.key, n.x]));
  assert.equal(at['req:tone'], 0);
  assert.ok(at['file:src/Button.jsx'] > at['req:tone']);
  assert.ok(at['file:src/Pricing.jsx'] > at['file:src/Button.jsx']);
  assert.equal(at['file:src/Pricing.jsx'], at['file:src/Signup.jsx']);
  assert.equal(graph.links.length, 3);
  assert.equal(graph.placed.find((n) => n.key === 'req:tone').label, 'tone');
  assert.equal(graph.placed.find((n) => n.key === 'file:src/Button.jsx').label, 'Button.jsx');
});

test('nodes in one column never overlap', () => {
  const graph = layoutDependencyGraph({ edges });
  const column = graph.placed.filter((n) => n.key.includes('Pricing') || n.key.includes('Signup'));
  assert.ok(Math.abs(column[0].y - column[1].y) >= NODE_HEIGHT);
});

test('a long edge runs between nodes instead of behind them', () => {
  const graph = layoutDependencyGraph({
    edges: [
      { from_key: 'file:App.jsx', to_key: 'file:Page.jsx' },
      { from_key: 'file:Page.jsx', to_key: 'req:tone' },
      { from_key: 'file:App.jsx', to_key: 'req:tone' },
    ],
  });
  assert.deepEqual(graph.placed.map((n) => n.key), ['file:App.jsx', 'file:Page.jsx', 'req:tone']);

  const long = graph.links.find((l) => l.from === 'file:App.jsx' && l.to === 'req:tone');
  const short = graph.links.find((l) => l.from === 'file:Page.jsx');
  assert.match(long.d, / H /);
  assert.doesNotMatch(short.d, / H /);

  const page = graph.placed.find((n) => n.key === 'file:Page.jsx');
  const crossing = Number(long.d.match(/([\d.]+) H /)[1]);
  assert.ok(crossing < page.y || crossing > page.y + NODE_HEIGHT, 'the edge must miss the node it passes');
});

test('a dependency cycle and an empty graph both stay safe', () => {
  const cycle = layoutDependencyGraph({ edges: [{ from_key: 'a:1', to_key: 'a:2' }, { from_key: 'a:2', to_key: 'a:1' }] });
  assert.equal(cycle.placed.length, 2);
  assert.ok(cycle.placed.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.deepEqual(layoutDependencyGraph({}), { placed: [], links: [], width: 0, height: 0 });
});

test('impact walks both ways through the graph', () => {
  const { dependsOn, affects } = impactOf('file:src/Button.jsx', edges);
  assert.deepEqual([...dependsOn], ['req:tone']);
  assert.deepEqual([...affects].sort(), ['file:src/Pricing.jsx', 'file:src/Signup.jsx']);
  assert.deepEqual([...impactOf('req:tone', edges).affects].length, 3);
});
