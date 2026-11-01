// End-to-end team workflow (the hackathon demo scenario) through the real
// router and handlers, against an in-memory Supabase stand-in and the
// simulated agent. Run: npm run test:integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');

const owner = fake.addUser('Olivia');
const projectId = 'p-campuseats';
fake.tables.projects = [{ id: projectId, name: 'CampusEats', description: 'Campus food ordering', owner_id: owner.id }];
fake.tables.project_members = [{ project_id: projectId, user_id: owner.id, role: 'owner', status: 'active', department: null }];

let people = {};

/** Calls an endpoint as the owner, acting as a demo person when `as` is given. */
async function call(method, route, { body = {}, query = {}, as } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  const headers = { authorization: `Bearer ${owner.token}`, ...(as ? { 'x-act-as': people[as] } : {}) };
  const req = { method, headers, body: { projectId, ...body }, query: { route, projectId, ...query } };
  await handler(req, res);
  if (status >= 400) throw new Error(`${method} ${route} → ${status}: ${json?.error}`);
  return json;
}

const start = (as, text) => call('POST', 'team/task/start', { as, body: { text } });
const confirmPlan = (as, t) => call('POST', 'team/task/plan-decision', { as, body: { taskId: t.id } });
const current = async (as) => (await call('GET', 'team/task/current', { as })).task;

test('demo setup seeds departments, people, context and files', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
  const boot = await call('GET', 'team/bootstrap', { as: 'rohan' });
  assert.equal(boot.me.isDeveloper, true);
  assert.equal(boot.departments.length, 2);
  assert.equal(boot.agentMode, 'mock');
});

test('only the owner can act as demo people', async () => {
  const intruder = fake.addUser('Mallory');
  fake.tables.project_members.push({ project_id: projectId, user_id: intruder.id, role: 'worker', status: 'active', department: 'frontend' });
  let status;
  const res = { status(c) { status = c; return res; }, json() { return res; } };
  await handler({ method: 'GET', headers: { authorization: `Bearer ${intruder.token}`, 'x-act-as': people.vikram }, body: {}, query: { route: 'team/bootstrap', projectId } }, res);
  assert.equal(status, 403);
});

test('conflict warning before acting', async () => {
  const t = await start('meera', 'Restyle the checkout with Bootstrap');
  assert.equal(t.status, 'needs_conflict_decision');
  assert.equal(t.conflicts[0].sectionId, 'fe-no-frameworks');
  await call('POST', 'team/task/conflict-decision', { as: 'meera', body: { taskId: t.id, choice: 'cancel' } });
});

test('demo scenario: cross-department change, mid-task alert, outdated submission, merge', async () => {
  let rohan = await start('rohan', 'Build the checkout page with a card payment form');
  assert.equal(rohan.status, 'awaiting_plan_approval');
  rohan = await confirmPlan('rohan', rohan);
  assert.equal(rohan.status, 'done');
  assert.ok(rohan.changedFiles.includes('web/checkout.html'));
  assert.ok(rohan.critique && ['looks_good', 'minor_issues', 'needs_changes'].includes(rohan.critique.verdict), 'the Critic reviewed the Builder\'s change');

  const orderTask = await start('arjun', 'Add an order status endpoint');
  assert.ok(!orderTask.relevantSectionIds.includes('c-payment-api'), 'an order endpoint does not depend on payments');
  await call('POST', 'team/task/cancel', { as: 'arjun', body: { taskId: orderTask.id } });

  const upi = await confirmPlan('arjun', await start('arjun', 'Switch from card payments to UPI only'));
  const sub = await call('POST', 'team/task/submit', { as: 'arjun', body: { taskId: upi.id, why: 'CampusPay is ending card support' } });
  assert.equal(sub.submitted, true);

  const { proposal } = await call('POST', 'team/review/decide', { as: 'vikram', body: { submissionId: sub.submission.id, action: 'approve' } });
  assert.equal(proposal.impact.scope, 'cross_department');
  assert.deepEqual([...proposal.impact.affectedDepartments].sort(), ['frontend']);
  assert.ok(proposal.impact.notify.some((n) => n.userId === people.rohan && n.affectsActiveWork));
  assert.ok(!proposal.changes.some((c) => c.sectionId === 'fe-conventions'), '.card CSS class is not a payment card');

  const confirmed = await call('POST', 'team/proposals/confirm', { as: 'vikram', body: { proposalId: proposal.id } });
  // Backend's own changes apply now; central + Frontend changes are a central matter: the founder decides.
  const toFounder = confirmed.suggestions.find((s) => s.status === 'pending_founder');
  assert.ok(toFounder, 'central and other departments\' changes wait for the founder');
  assert.ok(confirmed.suggestions.some((s) => s.scope === 'backend' && s.status === 'approved'));
  assert.equal((await call('GET', 'team/context', { as: 'rohan' })).central.find((s) => s.id === 'c-payment-method').version, 1, 'not before the founder approves');
  await call('POST', 'team/suggestions/decide', { body: { suggestionId: toFounder.id, action: 'approve' } });
  const ctx = await call('GET', 'team/context', { as: 'rohan' });
  assert.equal(ctx.central.find((s) => s.id === 'c-payment-method').version, 2);
  assert.equal(ctx.scopeVersions.central, 3, 'one confirmed update bumps a scope once');

  rohan = await current('rohan');
  assert.equal(rohan.status, 'needs_context_decision');
  assert.match(rohan.contextAlert.relation, /card/);

  rohan = (await call('POST', 'team/task/context-decision', { as: 'rohan', body: { taskId: rohan.id, choice: 'adjust', newText: rohan.contextAlert.suggestedTask } }));
  assert.equal(rohan.status, 'awaiting_plan_approval');
  rohan = await confirmPlan('rohan', rohan);
  assert.match(rohan.summary, /UPI/);

  const queue = (await call('GET', 'team/review/queue', { as: 'ananya' })).items;
  const meera = queue.find((s) => s.userId === people.meera);
  assert.ok(meera.outdated.some((o) => o.sectionId === 'c-payment-method'));
  await call('POST', 'team/review/decide', { as: 'ananya', body: { submissionId: meera.id, action: 'send_back', note: 'Payment is UPI only now.' } });

  const rsub = await call('POST', 'team/task/submit', { as: 'rohan', body: { taskId: rohan.id, why: 'UPI checkout' } });
  assert.equal(rsub.submitted, true, 'pre-submit check passes after adjusting');
  const approved = await call('POST', 'team/review/decide', { as: 'ananya', body: { submissionId: rsub.submission.id, action: 'approve' } });
  assert.equal(approved.submission.status, 'approved');

  const main = await call('GET', 'team/workspace/file', { query: { workspace: 'main', path: 'web/checkout.html' } });
  assert.match(main.content, /Pay with UPI/);
  assert.match((await call('GET', 'team/workspace/file', { query: { workspace: 'main', path: 'config/payments.json' } })).content, /"upi"/);

  const restarted = await call('POST', 'team/agent/restart', { as: 'meera' });
  assert.ok(restarted.points.length >= 3);

  const types = new Set((await call('GET', 'team/log')).events.map((e) => e.type));
  for (const t of ['task.context_alert', 'developer.context_choice', 'impact.decision', 'context.changed', 'merge.done', 'review.sent_back', 'agent.restarted']) {
    assert.ok(types.has(t), `log has ${t}`);
  }
});

test('approving work built on files main has since changed reports a merge conflict', async () => {
  // Arjun's seeded "Index orders by student" edits server/db/schema.sql; change the same file in main first.
  const files = fake.tables.project_files.find((f) => f.workspace === 'main' && f.path === 'server/db/schema.sql');
  files.content += '\n-- edited directly in main\n';
  const old = (await call('GET', 'team/review/queue', { as: 'vikram' })).items.find((s) => s.title === 'Index orders by student');
  const r = await call('POST', 'team/review/decide', { as: 'vikram', body: { submissionId: old.id, action: 'approve' } });
  assert.equal(r.submission.status, 'merge_conflict');
  assert.deepEqual(r.submission.mergeInfo.conflictedFiles, ['server/db/schema.sql']);
});

test('overview shows departments, the live board and the owner-only codes', async () => {
  const o = await call('GET', 'team/overview');
  assert.equal(o.me.role, 'owner');
  assert.ok(o.departments.length >= 2);
  assert.ok(o.board.length >= 3);
  assert.ok(o.stats.merges >= 1);
  const asDev = await call('GET', 'team/overview', { as: 'rohan' });
  assert.equal(asDev.project.observer_code, undefined, 'codes are hidden when acting as someone else');
});

test('an assigned task follows the workspace task that carries it out', async () => {
  const worker = fake.tables.project_members.find((m) => m.user_id === people.arjun);
  worker.role = 'worker';
  await call('POST', 'team/task/cancel', { as: 'arjun', body: { taskId: (await current('arjun')).id } }).catch(() => {});
  const { task } = await call('POST', 'tasks/assign', { body: { assigneeId: people.arjun, title: 'Add an order history endpoint' } });
  assert.equal(task.status, 'open');
  let t = await call('POST', 'team/task/start', { as: 'arjun', body: { assignmentId: task.id } });
  assert.match(t.text, /order history/);
  const row = () => fake.tables.tasks.find((x) => x.id === task.id);
  assert.equal(row().status, 'in_progress');
  if (t.status === 'awaiting_plan_approval') t = await confirmPlan('arjun', t);
  const sub = await call('POST', 'team/task/submit', { as: 'arjun', body: { taskId: t.id, why: 'Order history' } });
  assert.equal(row().status, 'in_review');
  await call('POST', 'team/review/decide', { body: { submissionId: sub.submission.id, action: 'approve' } });
  assert.equal(row().status, 'done');
});

test('editing the central context directly needs a reason and records a new version', async () => {
  const ctx = await call('GET', 'team/context');
  const s = ctx.central[0];
  const edits = [{ sectionId: s.id, content: `${s.content}\nDeliveries stop at 10pm.` }];
  const preview = await call('POST', 'team/context/preview', { body: { scope: 'central', edits } });
  assert.equal(preview.changed.length, 1);
  await assert.rejects(call('POST', 'team/context/save', { body: { scope: 'central', edits } }), /why/);
  const saved = await call('POST', 'team/context/save', { body: { scope: 'central', edits: [{ ...edits[0], why: 'Campus curfew' }] } });
  assert.equal(saved.saved, 1);
  const after = (await call('GET', 'team/context')).central.find((x) => x.id === s.id);
  assert.equal(after.version, s.version + 1);
  await assert.rejects(call('POST', 'team/context/save', { as: 'rohan', body: { scope: 'central', edits } }), /owner/);
});

test('the observer feed speaks plain language and carries the live site', async () => {
  const f = await call('GET', 'observer/feed');
  assert.ok(f.changes.length > 0 && f.roadmap.length >= 0);
  assert.ok(Object.keys(f.currentSite.files).some((p) => p.endsWith('.html')));
});

test('the Critic flags placeholder work from the Builder', async () => {
  const { ruleChecks } = await import('../../api/_lib/team-agent/critic.js');
  const f = ruleChecks({ plan: { files: ['a.html'] }, before: { 'a.html': '<p>x</p>' }, after: { 'a.html': '<p>x</p>\n<!-- TODO (simulated agent): add a form -->', 'b.json': '{bad' }, changedFiles: ['a.html', 'b.json'], sections: [] });
  assert.ok(f.some((x) => x.severity === 'high' && /placeholder/.test(x.issue)));
  assert.ok(f.some((x) => /JSON is broken/.test(x.issue)));
  assert.ok(f.some((x) => /not in the confirmed plan/.test(x.issue)));
});

test('a developer can edit files by hand, import a folder, get a Critic review and submit', async () => {
  const before = await current('arjun');
  if (before && !['submitted', 'approved', 'rejected', 'cancelled'].includes(before.status)) {
    await call('POST', 'team/task/cancel', { as: 'arjun', body: { taskId: before.id } }).catch(() => {});
  }
  const saved = await call('POST', 'team/workspace/save', { as: 'arjun', body: { path: 'web/hello.html', content: '<h1>Hello</h1>' } });
  assert.ok(saved.changedFiles.includes('web/hello.html'));
  let t = await current('arjun');
  assert.equal(t.manual, true);
  await call('POST', 'team/workspace/import', { as: 'arjun', body: { files: { 'web/extra.css': 'h1{color:green}', '../evil.txt': 'x' } } });
  const files = (await call('GET', 'team/workspace/files', { as: 'arjun' })).files;
  assert.ok(files.includes('web/extra.css') && !files.some((f) => f.includes('evil')));
  await call('POST', 'team/workspace/save', { as: 'arjun', body: { path: 'web/extra.css', rename: 'web/site.css' } });
  t = await call('POST', 'team/workspace/review', { as: 'arjun', body: { taskId: t.id } });
  assert.ok(t.critique);
  const sub = await call('POST', 'team/task/submit', { as: 'arjun', body: { taskId: t.id, why: 'Hand edits', force: true } });
  assert.equal(sub.submitted, true);
  assert.ok(sub.submission.files.includes('web/site.css'));
});
