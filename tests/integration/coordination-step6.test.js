// Step 6: file claims, requests between departments, and the structured
// end-of-task summary checked against the diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');

const owner = fake.addUser('Founder');
const projectId = 'p-step6';
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
const run = async (as, text, extra = {}) => {
  const t = await call('POST', 'team/task/start', { as, body: { text, ...extra } });
  return call('POST', 'team/task/plan-decision', { as, body: { taskId: t.id } });
};

test('setup', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
});

// ---------------------------------------------------------------- file claims
test('two agents never change the same file at once: the first to confirm its plan holds it', async () => {
  const meera = await run('meera', 'Build the checkout page with a card payment form');
  assert.equal(meera.status, 'done');
  assert.ok(meera.claims.includes('web/checkout.html'));

  const rohan = await run('rohan', 'Build the checkout page with a card payment form');
  assert.ok(!rohan.changedFiles.includes('web/checkout.html'), 'not written: Meera holds it');
  assert.ok(rohan.messages.some((m) => /claimed by Meera/.test(m.text)));
  const blocked = (await call('GET', 'team/log')).events.find((e) => e.type === 'permission.blocked' && e.taskId === rohan.id);
  assert.equal(blocked.data.reason, 'claimed');
});

test('a claim ends when the work is cancelled or submitted', async () => {
  const meera = (await call('GET', 'team/task/current', { as: 'meera' })).task;
  await call('POST', 'team/task/cancel', { as: 'meera', body: { taskId: meera.id } });
  const rohan = (await call('GET', 'team/task/current', { as: 'rohan' })).task;
  const again = await call('POST', 'team/task/follow-up', { as: 'rohan', body: { taskId: rohan.id, message: 'build the card form now' } });
  assert.ok(again.changedFiles.includes('web/checkout.html'), 'free again, so it is written');
  await call('POST', 'team/task/cancel', { as: 'rohan', body: { taskId: rohan.id } });
});

// ---------------------------------------------------------------- summary
test('the end-of-task summary is drafted from facts: real files, new files, what other departments must do', async () => {
  const t = await run('rohan', 'Build the order tracking page');
  const sm = t.summaryDraft;
  assert.deepEqual([...sm.changed].sort(), ['web/js/orders.js', 'web/orders.html']);
  assert.ok(sm.dependsOn.some((d) => /web\/orders\.html is new/.test(d)));
  assert.equal(sm.forOtherDepartments[0].department, 'backend', 'from what the agent was blocked from');
  assert.match(sm.forOtherDepartments[0].need, /status/);
  assert.ok(sm.open.some((o) => /server\/routes\/orders\.js/.test(o)));
});

test('sharing: the developer edits it, facts are re-checked, and needs become requests', async () => {
  const t = (await call('GET', 'team/task/current', { as: 'rohan' })).task;
  const edited = { ...t.summaryDraft, whatChanged: 'Order tracking page: four steps, refreshes every 10 seconds.', changed: ['made-up.js'] };
  const r = await call('POST', 'team/task/share', { as: 'rohan', body: { taskId: t.id, summary: edited } });
  assert.equal(r.suggestion.status, 'applied');
  assert.deepEqual([...r.summary.changed].sort(), ['web/js/orders.js', 'web/orders.html'], 'files come from the diff, not the edit');
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].toDepartment, 'backend');
  const ctx = await call('GET', 'team/context', { as: 'rohan' });
  const note = ctx.layers.department.progress.find((i) => i.title === t.text);
  assert.match(note.content, /Order tracking page: four steps/);
  assert.match(note.content, /Needs from other departments: backend/);
  await assert.rejects(call('POST', 'team/task/share', { as: 'rohan', body: { taskId: t.id } }), /Already shared/);
});

// ---------------------------------------------------------------- requests
test('a request lands in the receiving department, the manager assigns it, and the result comes back', async () => {
  const incoming = (await call('GET', 'team/requests/list', { as: 'vikram' })).incoming;
  const req = incoming.find((r) => r.fromDepartment === 'frontend');
  assert.equal(req.state, 'waiting');
  assert.ok((await call('GET', 'team/requests/list', { as: 'rohan' })).outgoing.some((r) => r.id === req.id));
  assert.ok((await call('GET', 'team/goals/drafts', { as: 'vikram' })).tasks.some((t) => t.id === req.id && t.fromDepartment === 'frontend'));

  await call('POST', 'team/goals/assign', { as: 'vikram', body: { taskId: req.id, assigneeId: people.arjun } });
  const work = await run('arjun', 'Add an order status endpoint', { assignmentId: req.id });
  assert.ok(work.changedFiles.includes('server/routes/orders.js'));
  const sub = await call('POST', 'team/task/submit', { as: 'arjun', body: { taskId: work.id, why: 'Requested by Frontend' } });
  await call('POST', 'team/review/decide', { as: 'vikram', body: { submissionId: sub.submission.id, action: 'approve' } });

  const done = (await call('GET', 'team/requests/list', { as: 'rohan' })).outgoing.find((r) => r.id === req.id);
  assert.equal(done.state, 'done');
  assert.match(done.result, /status/);
  assert.ok(fake.tables.notifications.some((n) => n.user_id === people.rohan && n.kind === 'request_done'));
  const rohanTask = (await call('GET', 'team/task/current', { as: 'rohan' })).task;
  assert.ok(rohanTask.messages.some((m) => /is done/.test(m.text)), 'the waiting agent hears about it');
});

test('requests are short and go to another department; the receiver can decline with a reason', async () => {
  await assert.rejects(call('POST', 'team/requests/create', { as: 'rohan', body: { toDepartment: 'frontend', title: 'Do it', body: 'x' } }), /own department/);
  await assert.rejects(call('POST', 'team/requests/create', { as: 'rohan', body: { toDepartment: 'backend', title: 'Long', body: 'x'.repeat(700) } }), /short and concrete/);
  const r = await call('POST', 'team/requests/create', { as: 'rohan', body: { toDepartment: 'backend', title: 'Add a GraphQL API', body: 'For a nicer checkout.' } });
  await assert.rejects(call('POST', 'team/requests/decline', { as: 'ananya', body: { requestId: r.id, reason: 'x' } }), /receiving department/);
  const d = await call('POST', 'team/requests/decline', { as: 'vikram', body: { requestId: r.id, reason: 'Central › Tech choices: Express REST only.' } });
  assert.equal(d.state, 'declined');
  assert.ok(!(await call('GET', 'team/goals/drafts', { as: 'vikram' })).tasks.some((t) => t.id === r.id), 'no longer a draft');
  assert.ok(fake.tables.notifications.some((n) => n.user_id === people.rohan && /Declined/.test(n.title)));
});
