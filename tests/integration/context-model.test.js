// Step 1 of the coordination layer: structured context (plan vs progress),
// two-level logs, checkpoints, and history that is never overwritten.
// Run: npm run test:integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');
const { addItem, changeSection, listSections, listVersions, layers, PLAN_KINDS } = await import('../../api/_lib/context.js');

const owner = fake.addUser('Founder');
const projectId = 'p-context-model';
fake.tables.projects = [{ id: projectId, name: 'CampusEats', description: 'Campus food ordering', owner_id: owner.id }];
fake.tables.project_members = [{ project_id: projectId, user_id: owner.id, role: 'owner', status: 'active', department: null }];
let people = {};

async function call(method, route, { body = {}, query = {}, as } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  const headers = { authorization: `Bearer ${owner.token}`, ...(as ? { 'x-act-as': people[as] } : {}) };
  await handler({ method, headers, body: { projectId, ...body }, query: { route, projectId, ...query } }, res);
  if (status >= 400) throw new Error(`${method} ${route} → ${status}: ${json?.error}`);
  return json;
}

test('the demo has a founder, two departments, and five demo people', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
  const boot = await call('GET', 'team/bootstrap');
  assert.deepEqual(boot.departments.map((d) => d.id), ['frontend', 'backend']);
  assert.equal(r.people.length, 5);
  assert.equal(boot.me.role, 'owner', 'the founder is the project owner');
});

test('context comes as layers split into plan and progress', async () => {
  const ctx = await call('GET', 'team/context', { as: 'rohan' });
  const { central, department } = ctx.layers;
  assert.ok(central.plan.length >= 6);
  assert.ok(central.plan.every((s) => PLAN_KINDS.includes(s.kind)));
  assert.ok(central.progress.every((s) => s.kind === 'checkpoint'), 'central progress only holds checkpoints');
  assert.ok(department.plan.some((s) => s.kind === 'must_not'));
  assert.ok(department.progress.every((s) => s.kind === 'progress'));
  assert.ok(department.progress.length >= 2);
  assert.ok(ctx.department.every((s) => s.scope === 'frontend'), 'Rohan sees only his own department');
});

test('adding a department progress item logs it at department level with clean fields', async () => {
  const before = (await call('GET', 'team/context', { as: 'rohan' })).scopeVersions.frontend;
  const { id } = await addItem(projectId, {
    scope: 'frontend', kind: 'progress', title: 'Login page built', content: 'The login page is built and calls the existing login API.',
    why: 'Rohan finished the login page.', by: people.rohan, tags: ['login'],
  });
  const ctx = await call('GET', 'team/context', { as: 'rohan' });
  assert.equal(ctx.scopeVersions.frontend, before + 1);
  assert.ok(ctx.layers.department.progress.some((s) => s.id === id));

  const deptLog = (await call('GET', 'team/log', { query: { level: 'department' } })).events;
  const entry = deptLog.find((e) => e.itemId === id);
  assert.equal(entry.type, 'context.added');
  assert.equal(entry.level, 'department');
  assert.equal(entry.department, 'frontend');
  assert.equal(entry.title, 'Progress added: Login page built');
  assert.match(entry.plain, /login page/i);
});

test('central checkpoints are logged at central level with links to the department work behind them', async () => {
  const central = (await call('GET', 'team/log', { query: { level: 'central' } })).events;
  const cp = central.find((e) => e.type === 'checkpoint.confirmed');
  assert.equal(cp.level, 'central');
  assert.equal(cp.checkpointId, 'c-cp-menu-cart');
  assert.ok(cp.links.some((l) => l.id === 'fe-p-menu'));
  assert.ok(central.every((e) => e.level === 'central'));
});

test('changes keep every old version, and removal is a new archived version', async () => {
  await changeSection(projectId, { sectionId: 'fe-tracking', content: 'Build web/orders.html with a 4-step progress bar; poll every 5 seconds.', why: 'Faster updates.', by: people.ananya });
  await changeSection(projectId, { sectionId: 'fe-tracking', archived: true, why: 'Tracking moves to a later version.', by: people.ananya });
  const versions = await listVersions(projectId, { sectionId: 'fe-tracking' });
  assert.equal(versions.length, 3, 'v1 kept, v2 changed, v3 removed');
  assert.ok(!(await listSections(projectId, 'frontend')).some((s) => s.id === 'fe-tracking'), 'removed items leave the current context');
  assert.ok((await listSections(projectId, 'frontend', { includeArchived: true })).some((s) => s.id === 'fe-tracking'), 'but are never deleted');
  const removed = (await call('GET', 'team/log')).events.find((e) => e.type === 'context.removed');
  assert.equal(removed.itemId, 'fe-tracking');
});

test('layers() splits any list of items', () => {
  const items = [
    { scope: 'central', kind: 'goal' }, { scope: 'central', kind: 'checkpoint' },
    { scope: 'backend', kind: 'decision' }, { scope: 'backend', kind: 'progress' }, { scope: 'frontend', kind: 'progress' },
  ];
  const l = layers(items, 'backend');
  assert.equal(l.central.plan.length, 1);
  assert.equal(l.central.progress.length, 1);
  assert.equal(l.department.plan.length, 1);
  assert.equal(l.department.progress.length, 1);
});
