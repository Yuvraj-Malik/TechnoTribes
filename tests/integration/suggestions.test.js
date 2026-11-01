// Step 2: the change router. Every path, decided from facts, with the log and
// the reasons going back to the suggester. Run: npm run test:integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');

const owner = fake.addUser('Founder');
const projectId = 'p-router';
fake.tables.projects = [{ id: projectId, name: 'CampusEats', description: 'Campus food ordering', owner_id: owner.id }];
fake.tables.project_members = [{ project_id: projectId, user_id: owner.id, role: 'owner', status: 'active', department: null }];
let people = {};

async function call(method, route, { body = {}, query = {}, as } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  const headers = { authorization: `Bearer ${owner.token}`, ...(as ? { 'x-act-as': people[as] } : {}) };
  await handler({ method, headers, body: { projectId, ...body }, query: { route, projectId, ...query } }, res);
  if (status >= 400) { const e = new Error(`${method} ${route} → ${status}: ${json?.error}`); e.status = status; throw e; }
  return json;
}
const suggest = (as, body) => call('POST', 'team/suggestions/create', { as, body });
const decide = (as, suggestionId, action, reason) => call('POST', 'team/suggestions/decide', { as, body: { suggestionId, action, reason } });
const ctxOf = (as) => call('GET', 'team/context', { as });
const log = async (filter = {}) => (await call('GET', 'team/log', { query: filter })).events;
const progress = (title, content) => ({ op: 'add', kind: 'progress', title, content });

test('setup', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
});

test('resetting the demo clears suggestions too', async () => {
  await call('POST', 'team/suggestions/create', { as: 'rohan', body: { scope: 'frontend', why: 'x', changes: [{ op: 'update', itemId: 'fe-checkout', content: 'x' }] } });
  const r = await call('POST', 'team/demo/setup', { body: { reset: true } });
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
  assert.equal((fake.tables.context_suggestions ?? []).length, 0);
});

test('path 1: a small in-line progress note goes straight into department context and the log', async () => {
  const s = await suggest('rohan', { scope: 'frontend', why: 'Login page done', changes: [progress('Login page built', 'The login page is built and calls the existing login API.')] });
  assert.equal(s.status, 'applied');
  assert.equal(s.label, 'progress');
  const ctx = await ctxOf('rohan');
  assert.ok(ctx.layers.department.progress.some((i) => i.title === 'Login page built'));
  const entries = (await log({ level: 'department' })).filter((e) => e.suggestionId === s.id);
  assert.ok(entries.some((e) => e.type === 'suggestion.applied'));
  assert.ok(entries.some((e) => e.type === 'context.added' && e.department === 'frontend'));
});

test("blocked: an agent can't change another department's context, and the block is logged", async () => {
  const before = (await ctxOf('arjun')).layers.department.progress.length;
  const s = await suggest('rohan', { scope: 'backend', why: 'Need the status field', changes: [progress('Status field', 'Orders return status.')] });
  assert.equal(s.status, 'blocked');
  assert.match(s.reasons[0], /another department/);
  assert.equal((await ctxOf('arjun')).layers.department.progress.length, before, 'nothing changed');
  assert.ok((await log()).some((e) => e.type === 'permission.blocked' && e.suggestionId === s.id));
});

test('path 3: a change that conflicts with the department plan goes to the department manager', async () => {
  const s = await suggest('meera', { scope: 'frontend', why: 'Looks nicer', changes: [progress('Checkout restyled', 'Checkout restyled with Bootstrap cards.')] });
  assert.equal(s.status, 'pending_manager');
  assert.equal(s.label, 'conflict');
  assert.equal(s.ruleHits[0].sectionId, 'fe-no-frameworks');

  const q = (await call('GET', 'team/suggestions/queue', { as: 'ananya' })).items;
  assert.ok(q.some((x) => x.id === s.id), 'it is in the Frontend manager queue');
  assert.ok(!(await call('GET', 'team/suggestions/queue', { as: 'vikram' })).items.some((x) => x.id === s.id), 'not in Backend\'s');

  await assert.rejects(decide('ananya', s.id, 'reject', ''), /reason/);
  const r = await decide('ananya', s.id, 'reject', 'No UI frameworks: reuse styles.css.');
  assert.equal(r.status, 'rejected');
  const notes = fake.tables.notifications.filter((n) => n.user_id === people.meera);
  assert.ok(notes.some((n) => /No UI frameworks/.test(n.body)), 'the suggester gets the reason');
});

test('path 2: changing the department plan needs the department manager', async () => {
  const s = await suggest('rohan', { scope: 'frontend', why: 'Testers wanted a bigger summary', changes: [{ op: 'update', itemId: 'fe-checkout', content: 'Single page: big order summary first, then the payment form and one Pay button.' }] });
  assert.equal(s.status, 'pending_manager');
  assert.equal(s.label, 'plan_change');
  await assert.rejects(suggest('meera', { scope: 'frontend', why: 'Also', changes: [{ op: 'update', itemId: 'fe-checkout', content: 'x' }] }), /already an open suggestion/);
  await assert.rejects(decide('vikram', s.id, 'approve'), /manager decides/);
  const r = await decide('ananya', s.id, 'approve');
  assert.equal(r.status, 'approved');
  assert.equal((await ctxOf('rohan')).department.find((i) => i.id === 'fe-checkout').version, 3);
});

test('path 4: a central change goes to the manager first, then the founder; other agents see it next', async () => {
  const s = await suggest('arjun', { scope: 'central', why: 'CampusPay is ending card support', changes: [{ op: 'update', itemId: 'c-payment-method', content: 'Students pay with UPI only through CampusPay. No cash on delivery.' }] });
  assert.equal(s.status, 'pending_manager', 'the Backend manager looks first');
  assert.equal(s.label, 'plan_change', 'repeating the item\'s own rule ("no cash") is not a conflict');
  await assert.rejects(decide('vikram', s.id, 'approve'), /workaround, escalate, reject/, 'a manager never approves central');
  const up = await decide('vikram', s.id, 'escalate', 'No workaround: the gateway drops cards next month.');
  assert.equal(up.status, 'pending_founder');
  const founderQueue = (await call('GET', 'team/suggestions/queue')).items;
  assert.ok(founderQueue.some((x) => x.id === s.id), 'in the founder queue');
  assert.ok(founderQueue.every((x) => x.status === 'pending_founder'), 'the founder queue holds central decisions only');
  await assert.rejects(decide('vikram', s.id, 'reject', 'x'), /founder decides/);

  const r = await decide(undefined, s.id, 'approve');
  assert.equal(r.status, 'approved');
  const rohanSees = (await ctxOf('rohan')).central.find((i) => i.id === 'c-payment-method');
  assert.equal(rohanSees.version, 2);
  assert.match(rohanSees.content, /UPI/);
  assert.ok((await log({ level: 'central' })).some((e) => e.suggestionId === s.id && e.type === 'context.changed'));
});

test('central conflict: the manager can resolve it with a workaround without bothering the founder', async () => {
  const s = await suggest('rohan', { scope: 'frontend', why: 'Faster reorders', changes: [progress('Saved cards', 'Keeps the card number in localStorage for one-tap reorders.')] });
  assert.equal(s.status, 'pending_manager');
  assert.equal(s.label, 'conflict');
  assert.ok(s.ruleHits.some((h) => h.sectionId === 'c-no-card-data'));
  const r = await decide('ananya', s.id, 'workaround', 'Use the gateway token instead; no card numbers.');
  assert.equal(r.status, 'workaround');
  assert.ok(!(await ctxOf('rohan')).layers.department.progress.some((i) => i.title === 'Saved cards'), 'nothing applied');
});

test('stale: a suggestion based on an old version is sent back to re-check', async () => {
  const s = await suggest('rohan', { scope: 'frontend', why: 'Tweak', basedOn: { 'fe-checkout': 1 }, changes: [{ op: 'update', itemId: 'fe-checkout', content: 'x' }] });
  assert.equal(s.status, 'sent_back');
  assert.match(s.reasons[0], /v1 → v3/);
});

test('split guard: many small direct changes are looked at together by the manager', async () => {
  for (const n of [1, 2, 3]) {
    assert.equal((await suggest('arjun', { scope: 'backend', why: `Part ${n}`, changes: [progress(`Part ${n}`, `Route part ${n} built.`)] })).status, 'applied');
  }
  const fourth = await suggest('arjun', { scope: 'backend', why: 'Part 4', changes: [progress('Part 4', 'Route part 4 built.')] });
  assert.equal(fourth.status, 'pending_manager');
  assert.equal(fourth.label, 'large_change');
  const big = await suggest('meera', { scope: 'frontend', why: 'All at once', changes: [1, 2, 3, 4].map((n) => progress(`Bit ${n}`, `Bit ${n}.`)) });
  assert.equal(big.label, 'large_change');
});

test('a manager decides their own department plan directly, and it is still logged', async () => {
  const s = await suggest('ananya', { scope: 'frontend', why: 'Stricter', changes: [{ op: 'update', itemId: 'fe-done', content: 'Works on a 360px phone, no console errors, 44px tap targets, and passes a screen reader check.' }] });
  assert.equal(s.status, 'approved');
  assert.ok((await log()).some((e) => e.suggestionId === s.id && e.type === 'context.changed'));
});

test('checkpoints: a manager flags one, the founder confirms it into central progress', async () => {
  const s = await call('POST', 'team/checkpoints/flag', { as: 'ananya', body: { title: 'Checkout ready', content: 'Students can check out and pay on their phones.', links: ['fe-p-cart', 'c-goal'] } });
  assert.equal(s.status, 'pending_founder');
  assert.deepEqual(s.links, [{ type: 'item', id: 'fe-p-cart' }], 'only own department progress can be linked');
  await decide(undefined, s.id, 'approve');
  const central = (await ctxOf('rohan')).layers.central.progress;
  const cp = central.find((i) => i.title === 'Checkout ready');
  assert.equal(cp.kind, 'checkpoint');
  assert.equal(cp.meta.flaggedBy, people.ananya);
  const entry = (await log({ level: 'central' })).find((e) => e.type === 'checkpoint.confirmed' && e.suggestionId === s.id);
  assert.equal(entry.checkpointId, cp.id);
  assert.ok(entry.links.some((l) => l.id === 'fe-p-cart'));
});

test('a rejection reason reaches the agent through its task', async () => {
  const t = await call('POST', 'team/task/start', { as: 'meera', body: { text: 'Add a back to menu link on checkout' } });
  const s = await suggest('meera', { scope: 'frontend', taskId: t.id, why: 'Plan tweak', changes: [{ op: 'update', itemId: 'fe-conventions', content: 'Anything goes.' }] });
  await decide('ananya', s.id, 'reject', 'Conventions stay as they are.');
  const task = (await call('GET', 'team/task/current', { as: 'meera' })).task;
  assert.ok(task.feedback.some((f) => f.suggestionId === s.id && /stay as they are/.test(f.reason)));
});
