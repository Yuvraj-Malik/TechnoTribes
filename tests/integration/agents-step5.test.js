// Step 5: agents check context versions at every step, the reviewer only adds
// flags, and the orchestrator drafts tasks that a manager assigns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');
const { changeSection } = await import('../../api/_lib/context.js');
const { setReviewer } = await import('../../api/_lib/suggestions.js');

const owner = fake.addUser('Founder');
const projectId = 'p-step5';
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
const current = async (as) => (await call('GET', 'team/task/current', { as })).task;
const progress = (title, content) => ({ op: 'add', kind: 'progress', title, content });

test('setup', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
});

// ---------------------------------------------------------------- version check at every step
test('a change to context the task uses pauses the agent at its next step', async () => {
  const t = await call('POST', 'team/task/start', { as: 'rohan', body: { text: 'Build the checkout page with a card payment form' } });
  assert.equal(t.status, 'awaiting_plan_approval');
  // Changed underneath the agent (no alert raised at the time of the change).
  await changeSection(projectId, { sectionId: 'c-payment-api', content: 'POST /api/payments { orderId, method } → { paymentId }', why: 'Simplified', by: owner.id });
  const paused = await call('POST', 'team/task/plan-decision', { as: 'rohan', body: { taskId: t.id } });
  assert.equal(paused.status, 'needs_context_decision', 'the step does not run on old context');
  assert.equal(paused.contextAlert.changes[0].sectionId, 'c-payment-api');
  assert.equal(paused.changedFiles.length, 0, 'nothing was written');
});

test('"Continue as is" acknowledges the change, so the next step goes ahead', async () => {
  const t = await current('rohan');
  const back = await call('POST', 'team/task/context-decision', { as: 'rohan', body: { taskId: t.id, choice: 'continue' } });
  assert.equal(back.status, 'awaiting_plan_approval');
  const done = await call('POST', 'team/task/plan-decision', { as: 'rohan', body: { taskId: t.id } });
  assert.equal(done.status, 'done');
});

test('a change the task does not use is only noted', async () => {
  await changeSection(projectId, { sectionId: 'be-order-api', content: 'Order API, now with pagination.', why: 'Lists got long', by: people.vikram });
  const t = await current('rohan');
  const after = await call('POST', 'team/task/follow-up', { as: 'rohan', body: { taskId: t.id, message: 'add a back to menu link' } });
  assert.equal(after.status, 'done');
  assert.ok(after.messages.some((m) => /Picked up the latest context/.test(m.text) && /Nothing this task uses changed/.test(m.text)));
});

// ---------------------------------------------------------------- reviewer
test('the reviewer can flag a change that would otherwise apply directly', async () => {
  const s = await call('POST', 'team/suggestions/create', { as: 'meera', body: { scope: 'frontend', why: 'Faster updates', changes: [progress('Tracking uses WebSockets', 'Order tracking now uses WebSockets instead of polling.')] } });
  assert.equal(s.status, 'pending_manager');
  assert.equal(s.label, 'conflict');
  assert.ok(s.ruleHits.some((h) => h.rule === 'reviewer' && h.sectionId === 'fe-tracking'));
  assert.equal(s.reviewer.mode, 'mock');
});

test('the reviewer never clears a rule hit, and its silence is not approval of plan changes', async () => {
  setReviewer(async () => ({ flags: [], confident: true }));
  const rule = await call('POST', 'team/suggestions/create', { as: 'meera', body: { scope: 'frontend', why: 'x', changes: [progress('Restyle', 'Checkout restyled with Bootstrap.')] } });
  assert.equal(rule.label, 'conflict', 'the rule hit stands');
  assert.equal(rule.reviewer, null, 'the reviewer is not even asked for changes already going to a person');
  setReviewer(null);
});

test('if the reviewer fails or is unsure, a person decides', async () => {
  setReviewer(async () => { throw new Error('timeout'); });
  const failed = await call('POST', 'team/suggestions/create', { as: 'arjun', body: { scope: 'backend', why: 'Done', changes: [progress('Menu route cached', 'GET /api/menu is cached for 60 seconds.')] } });
  assert.equal(failed.status, 'pending_manager');
  assert.equal(failed.label, 'unchecked');
  assert.match(failed.reasons[0], /could not check/);
  setReviewer(async () => ({ flags: [], confident: false }));
  const unsure = await call('POST', 'team/suggestions/create', { as: 'arjun', body: { scope: 'backend', why: 'Done', changes: [progress('Health route', 'GET /api/health returns ok.')] } });
  assert.equal(unsure.label, 'unchecked');
  setReviewer(null);
  const r = await call('POST', 'team/suggestions/decide', { as: 'vikram', body: { suggestionId: unsure.id, action: 'approve' } });
  assert.equal(r.status, 'approved');
});

// ---------------------------------------------------------------- orchestrator
test('the founder gives a goal; the orchestrator drafts tasks per department', async () => {
  const { tasks } = await call('POST', 'team/goals/plan', { body: { goal: 'Students can track their order live' } });
  assert.deepEqual(tasks.map((t) => t.department).sort(), ['backend', 'frontend']);
  assert.ok(tasks.every((t) => t.assigneeId === null && t.source === 'orchestrator'));
  assert.ok(tasks.find((t) => t.department === 'frontend').planItems.includes('fe-tracking'));
  const notes = fake.tables.notifications.filter((n) => n.kind === 'task_draft');
  assert.ok(notes.some((n) => n.user_id === people.ananya) && notes.some((n) => n.user_id === people.vikram));
});

test('a manager sees and assigns only their own department\'s drafts', async () => {
  const mine = (await call('GET', 'team/goals/drafts', { as: 'ananya' })).tasks;
  assert.ok(mine.length && mine.every((t) => t.department === 'frontend'));
  const all = (await call('GET', 'team/goals/drafts')).tasks;
  const backendDraft = all.find((t) => t.department === 'backend');
  await assert.rejects(call('POST', 'team/goals/assign', { as: 'ananya', body: { taskId: backendDraft.id, assigneeId: people.arjun } }), /department's manager/);
  await assert.rejects(call('POST', 'team/goals/assign', { as: 'ananya', body: { taskId: mine[0].id, assigneeId: people.vikram } }), /developer in that department/);
  const r = await call('POST', 'team/goals/assign', { as: 'ananya', body: { taskId: mine[0].id, assigneeId: people.meera } });
  assert.equal(r.task.assigneeId, people.meera);
  assert.ok(fake.tables.notifications.some((n) => n.user_id === people.meera && n.kind === 'task_assigned'));
});

test('a manager\'s goal only drafts tasks for their own department; developers cannot give goals', async () => {
  const { tasks } = await call('POST', 'team/goals/plan', { as: 'vikram', body: { goal: 'Students can track their order live' } });
  assert.deepEqual(tasks.map((t) => t.department), ['backend']);
  await assert.rejects(call('POST', 'team/goals/plan', { as: 'rohan', body: { goal: 'Do everything' } }), /founder or a department manager/);
  assert.ok((await call('GET', 'team/log', { query: { level: 'central' } })).events.some((e) => e.type === 'goal.planned'));
});
