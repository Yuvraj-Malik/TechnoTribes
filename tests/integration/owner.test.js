// The owner's tools through the real router and handlers, against the in-memory
// Supabase stand-in and the simulated agent. Run: npm run test:integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');

const owner = fake.addUser('Olivia');
const projectId = 'p-owner';
fake.tables.projects = [{ id: projectId, name: 'CampusEats', description: '', owner_id: owner.id }];
fake.tables.project_members = [{ project_id: projectId, user_id: owner.id, role: 'owner', status: 'active', department: null }];

let people = [];
const idOf = (role, n = 0) => people.filter((p) => p.role === role)[n].id;

async function attempt(method, route, { body = {}, query = {}, as } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  const headers = { authorization: `Bearer ${owner.token}`, ...(as ? { 'x-act-as': as } : {}) };
  await handler({ method, headers, body: { projectId, ...body }, query: { route, projectId, ...query } }, res);
  return { status, json };
}

async function call(method, route, options) {
  const { status, json } = await attempt(method, route, options);
  if (status >= 400) throw new Error(`${method} ${route} → ${status}: ${json?.error}`);
  return json;
}

test('setup', async () => {
  people = (await call('POST', 'team/demo/setup')).people;
});

test('the owner messages one admin or all of them, and each admin sees only theirs', async () => {
  const [first, second] = [idOf('admin', 0), idOf('admin', 1)];
  await call('POST', 'team/messages/send', { body: { to: 'all', text: 'Launch moved to Friday' } });
  await call('POST', 'team/messages/send', { body: { to: second, text: 'Just for you' } });

  const sent = (await call('GET', 'team/messages')).messages;
  assert.equal(sent.length, 2);
  const inbox = async (id) => (await call('GET', 'team/messages', { as: id })).messages.map((m) => m.text).sort();
  assert.deepEqual(await inbox(first), ['Launch moved to Friday']);
  assert.deepEqual(await inbox(second), ['Just for you', 'Launch moved to Friday']);

  const told = fake.tables.notifications.filter((n) => n.kind === 'owner_message');
  assert.equal(told.length, people.filter((p) => p.role === 'admin').length + 1);
});

test('only the owner sends, and developers cannot read messages', async () => {
  const worker = idOf('worker');
  assert.equal((await attempt('POST', 'team/messages/send', { as: idOf('admin'), body: { to: 'all', text: 'Hi' } })).status, 403);
  assert.equal((await attempt('GET', 'team/messages', { as: worker })).status, 403);
  assert.equal((await attempt('POST', 'team/messages/send', { body: { to: worker, text: 'Hi' } })).status, 400);
});

test('the owner sets job titles, and everyone sees them', async () => {
  const worker = idOf('worker');
  await call('POST', 'team/members/designation', { body: { userId: worker, designation: '  Frontend engineer ' } });
  const members = (await call('GET', 'projects/members')).members;
  assert.equal(members.find((m) => m.userId === worker).designation, 'Frontend engineer');
  assert.equal((await attempt('POST', 'team/members/designation', { as: idOf('admin'), body: { userId: worker, designation: 'x' } })).status, 403);
});

test('the owner runs their own Builder and Critic, and a manager reviews the result', async () => {
  const boot = await call('GET', 'team/bootstrap');
  assert.equal(boot.me.hasAgent, true);
  assert.equal(boot.me.isDeveloper, false);

  let task = await call('POST', 'team/task/start', { body: { text: 'Build the checkout page with a card payment form', department: 'frontend' } });
  assert.equal(task.department, 'frontend');
  assert.equal(task.status, 'awaiting_plan_approval');

  const board = (await call('GET', 'team/overview')).board;
  assert.equal(board.find((b) => b.userId === owner.id).department, 'frontend');

  await assert.rejects(call('POST', 'team/task/critic', { body: { taskId: task.id } }), /409/);
  task = await call('POST', 'team/task/plan-decision', { body: { taskId: task.id } });
  assert.equal(task.status, 'done');

  task = await call('POST', 'team/task/critic', { body: { taskId: task.id } });
  assert.ok(['looks_good', 'minor_issues', 'needs_changes'].includes(task.critique.verdict));
  assert.equal(task.messages.at(-1).from, 'critic');
  const firstReview = task.critique.at;

  // The Critic reviews again on its own after the work changes.
  task = await call('POST', 'team/task/follow-up', { body: { taskId: task.id, message: 'Add a back to menu link' } });
  assert.ok(task.critique && task.critique.at >= firstReview, 'changed work gets a fresh review');

  const { submitted, submission } = await call('POST', 'team/task/submit', { body: { taskId: task.id, why: 'Students need to pay', force: true } });
  assert.equal(submitted, true);

  const code = await call('GET', 'team/code');
  const branch = code.branches.find((b) => b.userId === owner.id);
  assert.equal(branch.state, 'review');
  assert.ok(branch.targets.includes('web/checkout.html'));

  const before = code.version;
  await call('POST', 'team/review/decide', { as: idOf('admin'), body: { submissionId: submission.id, action: 'approve', note: 'Good' } });
  const after = await call('GET', 'team/code');
  assert.equal(after.version, before + 1);
  assert.equal(after.branches.some((b) => b.userId === owner.id), false);
  assert.ok(after.people.find((p) => p.userId === owner.id).shipped.length);
  assert.ok(after.edges.length, 'the sample app links its files together');
});

test('the owner shares finished work from the task\'s department', async () => {
  let task = await call('POST', 'team/task/start', { body: { text: 'Add a note about opening hours', department: 'frontend' } });
  task = await call('POST', 'team/task/plan-decision', { body: { taskId: task.id } });
  assert.equal(task.status, 'done');
  assert.equal((await call('GET', 'team/workspace/status')).area.department.id, 'frontend');

  const summary = { whatChanged: 'Added opening hours', forOtherDepartments: [{ department: 'backend', need: 'Store the opening hours', send: true }] };
  const shared = await call('POST', 'team/task/share', { body: { taskId: task.id, summary } });
  const { suggestions } = await call('GET', 'team/workspace/status');
  assert.equal(suggestions.find((s) => s.id === shared.suggestion.id).scope, 'frontend');
  assert.equal(shared.requests[0].fromDepartment, 'frontend');
  await call('POST', 'team/task/cancel', { body: { taskId: task.id } });
});

test('the code view is not for observers', async () => {
  const observer = fake.addUser('Olive');
  fake.tables.project_members.push({ project_id: projectId, user_id: observer.id, role: 'observer', status: 'active' });
  let status;
  const res = { status(c) { status = c; return res; }, json() { return res; } };
  await handler({ method: 'GET', headers: { authorization: `Bearer ${observer.token}` }, body: {}, query: { route: 'team/code', projectId } }, res);
  assert.equal(status, 403);
});

test('a worker still cannot pick another department for their task', async () => {
  const worker = people.find((p) => p.role === 'worker');
  const task = await call('POST', 'team/task/start', { as: worker.id, body: { text: 'Add a back to menu link on checkout', department: 'payments' } });
  assert.equal(task.department, worker.department);
  await call('POST', 'team/task/cancel', { as: worker.id, body: { taskId: task.id } });
});
