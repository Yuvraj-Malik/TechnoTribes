// Step 7: revert (with dependents), irreversible actions need a person,
// search past notes (keywords without an embeddings key), and the drift check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VOYAGE_API_KEY;
const { default: handler } = await import('../../api/index.js');
const { addItem } = await import('../../api/_lib/context.js');

const owner = fake.addUser('Founder');
const projectId = 'p-step7';
fake.tables.projects = [{ id: projectId, name: 'CampusEats', description: 'Campus food ordering', owner_id: owner.id }];
fake.tables.project_members = [{ project_id: projectId, user_id: owner.id, role: 'owner', status: 'active', department: null }];
let people = {};

async function call(method, route, { body = {}, query = {}, as, headers: extra = {} } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  const headers = { authorization: `Bearer ${owner.token}`, ...(as ? { 'x-act-as': people[as] } : {}), ...extra };
  await handler({ method, headers, body: { projectId, ...body }, query: { route, projectId, ...query } }, res);
  if (status >= 400) throw new Error(`${method} ${route} → ${status}: ${json?.error}`);
  return json;
}
const run = async (as, text) => {
  const t = await call('POST', 'team/task/start', { as, body: { text } });
  return call('POST', 'team/task/plan-decision', { as, body: { taskId: t.id } });
};

test('setup', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
});

// ---------------------------------------------------------------- revert
test('reverting context shows what depends on the change first, then writes the old content as a new version', async () => {
  // Central change approved by the founder, and Rohan starts work built on it.
  await call('POST', 'team/suggestions/create', { body: { scope: 'central', why: 'UPI only', changes: [{ op: 'update', itemId: 'c-payment-method', content: 'Students pay with UPI only.' }] } });
  await call('POST', 'team/task/start', { as: 'rohan', body: { text: 'Build the checkout page with UPI payment' } });

  const preview = await call('GET', 'team/revert/preview', { query: { itemId: 'c-payment-method', toVersion: 1 } });
  assert.equal(preview.dependents.laterVersions.length, 1);
  assert.ok(preview.dependents.tasks.some((t) => t.userName === 'Rohan'), 'Rohan\'s task was built on v2');
  assert.equal(preview.canRevert, true);
  assert.equal((await call('GET', 'team/revert/preview', { as: 'ananya', query: { itemId: 'c-payment-method', toVersion: 1 } })).canRevert, false);
  await assert.rejects(call('POST', 'team/revert/context', { as: 'ananya', body: { itemId: 'c-payment-method', toVersion: 1, reason: 'x' } }), /founder/);

  const r = await call('POST', 'team/revert/context', { body: { itemId: 'c-payment-method', toVersion: 1, reason: 'Gateway kept cards after all' } });
  assert.equal(r.suggestion.status, 'approved');
  const ctx = await call('GET', 'team/context', { as: 'rohan' });
  const item = ctx.central.find((s) => s.id === 'c-payment-method');
  assert.equal(item.version, 3, 'a new version, history kept');
  assert.match(item.content, /debit or credit card/);
  const task = (await call('GET', 'team/task/current', { as: 'rohan' })).task;
  assert.equal(task.status, 'needs_context_decision', 'work built on the reverted version is told');
  assert.ok((await call('GET', 'team/log', { query: { level: 'central' } })).events.some((e) => e.type === 'context.reverted'));
  await call('POST', 'team/task/cancel', { as: 'rohan', body: { taskId: task.id } });
});

test('a removed item can be brought back by reverting to its earlier version', async () => {
  await call('POST', 'team/suggestions/create', { as: 'ananya', body: { scope: 'frontend', why: 'Later', changes: [{ op: 'remove', itemId: 'fe-tracking' }] } });
  assert.ok(!(await call('GET', 'team/context', { as: 'rohan' })).department.some((s) => s.id === 'fe-tracking'));
  await call('POST', 'team/revert/context', { as: 'ananya', body: { itemId: 'fe-tracking', toVersion: 1, reason: 'Tracking is back in v1' } });
  assert.ok((await call('GET', 'team/context', { as: 'rohan' })).department.some((s) => s.id === 'fe-tracking'));
});

test('undoing a merge is an "undo" submission for review; later merges on the same files are listed', async () => {
  const t = await run('meera', 'Build the checkout page with a card payment form');
  const sub = await call('POST', 'team/task/submit', { as: 'meera', body: { taskId: t.id, why: 'Checkout' } });
  await call('POST', 'team/review/decide', { as: 'ananya', body: { submissionId: sub.submission.id, action: 'approve' } });
  const main = async () => (await call('GET', 'team/workspace/file', { query: { workspace: 'main', path: 'web/checkout.html' } })).content;
  assert.match(await main(), /Pay by card/);

  const undo = await call('POST', 'team/revert/merge', { as: 'ananya', body: { submissionId: sub.submission.id, reason: 'Checkout redesign starts over' } });
  assert.equal(undo.submission.status, 'pending');
  const r = await call('POST', 'team/review/decide', { as: 'ananya', body: { submissionId: undo.submission.id, action: 'approve' } });
  assert.equal(r.submission.status, 'approved');
  assert.equal(r.proposal, null, 'an undo does not propose context changes');
  assert.match(await main(), /Payment coming soon/, 'main is back to before');
});

// ---------------------------------------------------------------- irreversible actions
test('an agent asks before an irreversible action and shows what would happen; nothing is written until approved', async () => {
  const t = await run('arjun', 'Remove the payments table from the schema');
  assert.equal(t.status, 'needs_action_approval');
  assert.ok(t.pendingAction.reasons.some((r) => r.kind === 'delete_data'));
  assert.match(t.pendingAction.diff, /drop table payments/);
  const files = (await call('GET', 'team/workspace/files', { as: 'arjun' })).files;
  assert.ok(!files.includes('server/db/migrations/002_drop_payments.sql'), 'not written yet');

  const rejected = await call('POST', 'team/task/action-decision', { as: 'arjun', body: { taskId: t.id, choice: 'reject' } });
  assert.equal(rejected.status, 'awaiting_plan_approval');
  const again = await call('POST', 'team/task/plan-decision', { as: 'arjun', body: { taskId: t.id } });
  const ok = await call('POST', 'team/task/action-decision', { as: 'arjun', body: { taskId: again.id, choice: 'approve' } });
  assert.equal(ok.status, 'done');
  assert.ok(ok.changedFiles.includes('server/db/migrations/002_drop_payments.sql'));
  const types = (await call('GET', 'team/log')).events.map((e) => e.type);
  assert.ok(types.includes('agent.asks_permission') && types.includes('developer.action_approved') && types.includes('developer.action_rejected'));
});

// ---------------------------------------------------------------- search
test('search finds past decisions and rejected suggestions (keywords without an embeddings key)', async () => {
  const s = await call('POST', 'team/suggestions/create', { as: 'rohan', body: { scope: 'frontend', why: 'Prettier', changes: [{ op: 'add', kind: 'progress', title: 'Restyle with Bootstrap', content: 'Checkout restyled with Bootstrap.' }] } });
  await call('POST', 'team/suggestions/decide', { as: 'ananya', body: { suggestionId: s.id, action: 'reject', reason: 'No UI frameworks, reuse styles.css' } });
  const r = await call('GET', 'team/search', { as: 'rohan', query: { q: 'bootstrap styling' } });
  assert.equal(r.mode, 'keywords');
  const hit = r.results.find((x) => x.type === 'rejected suggestion');
  assert.ok(hit, 'the rejected suggestion is found');
  assert.match(hit.text, /reuse styles\.css/, 'with its reason');
  assert.ok(!r.results.some((x) => x.scope === 'backend'), 'only what Rohan may read');
});

test('agents read related past notes before acting, including rejections', async () => {
  const t = await call('POST', 'team/task/start', { as: 'rohan', body: { text: 'Restyle the checkout with Bootstrap' } });
  assert.ok(t.memory.some((m) => m.type === 'rejected suggestion'));
  assert.ok(t.messages.some((m) => /checked past notes/.test(m.text)));
  await call('POST', 'team/task/conflict-decision', { as: 'rohan', body: { taskId: t.id, choice: 'cancel' } });
});

// ---------------------------------------------------------------- drift
test('the drift check finds where the project moved away from the plan', async () => {
  const clean = await call('POST', 'team/drift/run');
  const before = clean.findings.length;
  // The router stops this at the door (it breaks a central rule, so the founder decides)...
  const blocked = await call('POST', 'team/suggestions/create', { as: 'vikram', body: { scope: 'backend', why: 'Faster', changes: [{ op: 'add', kind: 'decision', title: 'Store card numbers', content: 'Store the card number for one-tap reorders.' }] } });
  assert.equal(blocked.status, 'pending_founder');
  // ...but drift can still creep in (an older note, an exception): the check finds it.
  await addItem(projectId, { scope: 'backend', kind: 'decision', title: 'Reorder shortcut', content: 'Keep the card number for one-tap reorders.', why: 'Old note', by: people.vikram, tags: ['payment'] });
  const r = await call('POST', 'team/drift/run', { as: 'vikram' });
  assert.ok(r.findings.length > before);
  assert.ok(r.findings.some((f) => f.kind === 'plan' && f.sectionId === 'c-no-card-data'));
  assert.deepEqual((await call('GET', 'team/drift/latest')).run, { findings: r.findings, headline: r.headline, ranAt: r.ranAt });
  await assert.rejects(call('POST', 'team/drift/run', { as: 'rohan' }), /founder or a manager/);
});

test('the daily drift run needs the cron secret', async () => {
  process.env.CRON_SECRET = 'shh';
  let status;
  const res = { status(c) { status = c; return res; }, json() { return res; } };
  await handler({ method: 'GET', headers: {}, body: {}, query: { route: 'team/drift/cron' } }, res);
  assert.equal(status, 401);
  const ok = await call('GET', 'team/drift/cron', { headers: { authorization: 'Bearer shh' } });
  assert.ok(ok.ran.some((x) => x.projectId === projectId));
});
