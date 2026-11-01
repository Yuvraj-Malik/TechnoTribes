// The rules behind the owner's tools: who a message goes to, and what the Code page shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipients } from '../../api/_lib/messages.js';
import { branchName, buildBranches, buildLog, buildPeople, fileEdges } from '../../api/_lib/code.js';
import { buildFileTree, fileFacts, filePresence, impactOf, layoutBranchMap, layoutDependencyGraph } from '../../src/features/coordination/codeModel.js';

test('a message goes to every admin, or to one active admin', () => {
  assert.deepEqual(resolveRecipients('all', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(resolveRecipients('b', ['a', 'b']), ['b']);
  assert.throws(() => resolveRecipients('c', ['a', 'b']), /active admin/);
  assert.throws(() => resolveRecipients('all', []), /no admins/);
});

test('file links come from imports and html, and ignore outside addresses', () => {
  const edges = fileEdges({
    'web/index.html': '<link href="css/styles.css"><script src="js/app.js"></script><a href="https://example.com">x</a>',
    'web/css/styles.css': '@import "./base.css";',
    'web/css/base.css': 'body {}',
    'web/js/app.js': "import { cart } from './cart'; import React from 'react';",
    'web/js/cart.js': "const old = require('../legacy/old.js');",
    'web/legacy/old.js': '',
  });
  assert.deepEqual(edges.map((e) => `${e.from_key} > ${e.to_key}`).sort(), [
    'web/css/styles.css > web/css/base.css',
    'web/index.html > web/css/styles.css',
    'web/index.html > web/js/app.js',
    'web/js/app.js > web/js/cart.js',
    'web/js/cart.js > web/legacy/old.js',
  ]);
});

const commits = [
  { id: 'c2', author_id: 'a', message: 'Second', files: ['b.js'], created_at: '2026-01-02T00:00:00Z' },
  { id: 'c1', author_id: 'a', message: 'First', files: ['a.js'], created_at: '2026-01-01T00:00:00Z' },
];
const log = buildLog(commits, [{ id: 'a', name: 'Arjun' }]);
const task = (o) => ({ userName: 'Kabir Singh', text: 'Add the pricing page', createdAt: '2026-01-01T12:00:00Z', plan: { files: ['a.js'] }, changedFiles: [], ...o });

test('main is numbered from v1, newest first', () => {
  assert.deepEqual(log.map((e) => [e.version, e.summary, e.author]), [[2, 'Second', 'Arjun'], [1, 'First', 'Arjun']]);
});

test('open work becomes branches; finished work does not', () => {
  const branches = buildBranches({
    log,
    submissions: [{ id: 's1', status: 'pending' }, { id: 's2', status: 'approved' }],
    tasks: [
      task({ id: 't1', userId: 'k', status: 'working' }),
      task({ id: 't2', userId: 't', status: 'submitted', submissionId: 's1', plan: { files: ['c.js'] } }),
      task({ id: 't3', userId: 'x', status: 'submitted', submissionId: 's2' }),
      task({ id: 't4', userId: 'y', status: 'cancelled' }),
    ],
  });
  assert.deepEqual(branches.map((b) => [b.id, b.state]).sort(), [['t1', 'building'], ['t2', 'review']]);
  assert.equal(branches[0].baseVersion, 1);
  assert.equal(branches[0].behind, 1);
});

test('two people on one file is a clash, and old context is out of date', () => {
  const branches = buildBranches({
    log,
    tasks: [
      task({ id: 't1', userId: 'k', status: 'working' }),
      task({ id: 't2', userId: 't', status: 'working' }),
      task({ id: 't3', userId: 'x', status: 'working', outdated: true, plan: { files: ['z.js'] } }),
    ],
  });
  assert.deepEqual(Object.fromEntries(branches.map((b) => [b.id, b.state])), { t1: 'clash', t2: 'clash', t3: 'outdated' });
});

test('branch names read like git branches', () => {
  assert.equal(branchName('Kabir Singh', 'Add the 14-day free trial to pricing'), 'kabir/add-14-day-free');
  assert.equal(branchName('', ''), 'team/work');
});

test('people show their goal, progress and approved work; observers are left out', () => {
  const people = buildPeople({
    people: [{ id: 'w', name: 'Kabir', role: 'worker' }, { id: 'o', name: 'Priya', role: 'owner', designation: 'Founder' }, { id: 'm', name: 'Meera', role: 'observer' }],
    assignments: [{ title: 'A', status: 'done', assignee_id: 'w' }, { title: 'B', status: 'open', assignee_id: 'w' }, { title: 'C', status: 'open', assignee_id: 'w' }],
    submissions: [{ id: 's', userId: 'w', status: 'approved', title: 'Shipped', createdAt: 'x' }],
    branches: [{ userId: 'w', goal: 'Build it' }],
  });
  assert.deepEqual(people.map((p) => p.name), ['Priya', 'Kabir']);
  assert.equal(people[0].designation, 'Founder');
  const kabir = people[1];
  assert.deepEqual([kabir.goal, kabir.upNext, kabir.tasksDone, kabir.tasksTotal, kabir.progress], ['Build it', 'B', 1, 3, 33]);
  assert.deepEqual(kabir.shipped.map((s) => s.title), ['Shipped']);
});

test('the file tree puts folders first', () => {
  assert.deepEqual(buildFileTree(['z.js', 'web/b.js', 'web/a.js']).map((r) => [r.path, r.depth, r.isDir]), [
    ['web', 0, true], ['web/a.js', 1, false], ['web/b.js', 1, false], ['z.js', 0, false],
  ]);
});

test('each file knows who is in it, its last change and its links', () => {
  const edges = [{ from_key: 'a.js', to_key: 'b.js' }];
  assert.deepEqual(Object.keys(filePresence([{ targets: ['a.js'] }])), ['a.js']);
  const facts = fileFacts('b.js', { log, edges });
  assert.equal(facts.lastChange.version, 2);
  assert.deepEqual(facts.usedBy, ['a.js']);
});

test('the branch map connects each branch to the version it started from', () => {
  const map = layoutBranchMap({ branches: [{ id: 'b', userId: 'k', baseVersion: 1, state: 'building' }], log });
  assert.deepEqual(map.rows.map((r) => r.key), ['b', 'v2', 'v1', 'root']);
  assert.equal(map.links.length, 1);
});

test('pages linking to each other are navigation, not dependencies', () => {
  const edges = fileEdges({ 'a.html': '<a href="b.html"></a><link href="s.css">', 'b.html': '<a href="a.html"></a>', 's.css': '' });
  assert.deepEqual(edges.map((e) => e.to_key), ['s.css']);
});

test('the graph survives a cycle and traces impact both ways', () => {
  const edges = [{ from_key: 'a', to_key: 'b' }, { from_key: 'b', to_key: 'a' }, { from_key: 'c', to_key: 'a' }];
  const graph = layoutDependencyGraph({ edges });
  assert.equal(graph.placed.length, 3);
  assert.ok(graph.width < 800, 'a loop must not stretch the graph');
  const line = [{ from_key: 'a', to_key: 'b' }, { from_key: 'b', to_key: 'c' }];
  const impact = impactOf('b', line);
  assert.deepEqual([[...impact.dependsOn], [...impact.affects]], [['c'], ['a']]);
});

test('work paused for approval of a risky step stays on the branch map', () => {
  const tasks = [{ id: 't', userId: 'u', userName: 'Kabir', text: 'Drop old data', status: 'needs_action_approval', createdAt: '2026-01-01' }];
  assert.equal(buildBranches({ tasks }).length, 1);
});
