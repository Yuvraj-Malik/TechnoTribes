// Step 4: the developer workspace. The agent is blocked from other areas
// (and it is logged), finished work is shared through the router, and the
// status endpoint shows area, blocks, suggestions and the timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');

const owner = fake.addUser('Founder');
const projectId = 'p-workspace';
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

test('setup', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
});

test('the plan says up front which files are outside the agent\'s area', async () => {
  const t = await call('POST', 'team/task/start', { as: 'rohan', body: { text: 'Build the order tracking page' } });
  assert.equal(t.status, 'awaiting_plan_approval');
  assert.deepEqual(t.plan.outsideArea, ['server/routes/orders.js']);
});

test("the agent is blocked from changing another department's files, and it is logged", async () => {
  const before = (await call('GET', 'team/workspace/file', { as: 'rohan', query: { path: 'server/routes/orders.js' } })).content;
  const t = (await call('GET', 'team/task/current', { as: 'rohan' })).task;
  const done = await call('POST', 'team/task/plan-decision', { as: 'rohan', body: { taskId: t.id } });
  assert.equal(done.status, 'done');
  assert.ok(done.changedFiles.includes('web/orders.html'));
  assert.ok(!done.changedFiles.includes('server/routes/orders.js'), 'nothing written outside the area');
  assert.equal((await call('GET', 'team/workspace/file', { as: 'rohan', query: { path: 'server/routes/orders.js' } })).content, before);
  assert.deepEqual(done.blocked[0].files, ['server/routes/orders.js']);
  assert.equal(done.blocked[0].owner, 'backend', 'it knows whose area it is');
  assert.ok(done.messages.some((m) => /Blocked/.test(m.text) && /request/.test(m.text)));
  const entry = (await call('GET', 'team/log')).events.find((e) => e.type === 'permission.blocked' && e.taskId === t.id);
  assert.equal(entry.level, 'department');
  assert.match(entry.plain, /Nothing was written/);
});

test('finished work is shared as a progress suggestion and goes through the router', async () => {
  const t = (await call('GET', 'team/task/current', { as: 'rohan' })).task;
  const s = await call('POST', 'team/suggestions/create', {
    as: 'rohan',
    body: { scope: 'frontend', taskId: t.id, files: t.changedFiles, why: 'Tracking page built', changes: [{ op: 'add', kind: 'progress', title: 'Order tracking page built', content: t.summary }] },
  });
  assert.equal(s.status, 'applied');
  await assert.rejects(call('POST', 'team/suggestions/create', {
    as: 'meera', body: { scope: 'frontend', taskId: t.id, why: 'x', changes: [{ op: 'add', kind: 'progress', title: 'x', content: 'x' }] },
  }), /not your task/);
});

test('the status endpoint shows area, blocks, suggestions, conflicts and a timeline', async () => {
  await call('POST', 'team/suggestions/create', { as: 'rohan', body: { scope: 'frontend', why: 'Faster', changes: [{ op: 'add', kind: 'progress', title: 'Styles', content: 'Checkout restyled with Bootstrap.' }] } });
  const st = await call('GET', 'team/workspace/status', { as: 'rohan' });
  assert.deepEqual(st.area.files, ['web/']);
  assert.equal(st.blocked.length, 1);
  assert.deepEqual(st.suggestions.map((s) => s.status).sort(), ['applied', 'pending_manager']);
  assert.equal(st.conflicts.length, 1);
  assert.ok(st.conflicts[0].ruleHits.some((h) => h.sectionId === 'fe-no-frameworks'));
  const types = st.timeline.map((e) => e.type);
  for (const t of ['task.created', 'agent.plan', 'permission.blocked', 'agent.edits', 'suggestion.applied', 'suggestion.pending_manager']) {
    assert.ok(types.includes(t), `timeline has ${t}`);
  }
  await assert.rejects(call('GET', 'team/workspace/status', { as: 'ananya' }), /developers/);
});
