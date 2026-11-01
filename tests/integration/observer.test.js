// The observer's progress through the real router and handlers, against an
// in-memory Supabase stand-in and the simulated agent. Run: npm run test:integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';

const fake = createFakeSupabase();
globalThis.__TEST_DB__ = fake;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import('../../api/index.js');

const owner = fake.addUser('Olivia');
const investor = fake.addUser('Isaac');
const projectId = 'p-campuseats';
fake.tables.projects = [{ id: projectId, name: 'CampusEats', description: 'Campus food ordering', owner_id: owner.id }];
fake.tables.project_members = [
  { project_id: projectId, user_id: owner.id, role: 'owner', status: 'active', department: null },
  { project_id: projectId, user_id: investor.id, role: 'observer', status: 'active', department: null },
];

let people = {};

async function call(method, route, { body = {}, query = {}, as, user = owner } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  const headers = { authorization: `Bearer ${user.token}`, ...(as ? { 'x-act-as': people[as] } : {}) };
  await handler({ method, headers, body: { projectId, ...body }, query: { route, projectId, ...query } }, res);
  if (status >= 400) throw Object.assign(new Error(`${method} ${route} → ${status}: ${json?.error}`), { status });
  return json;
}

const feed = () => call('GET', 'observer/feed', { user: investor });

test('a team working only through its agents is not shown as having no work', async () => {
  const r = await call('POST', 'team/demo/setup');
  people = Object.fromEntries(r.people.map((p) => [p.name.toLowerCase(), p.id]));
  assert.equal(fake.tables.tasks?.length ?? 0, 0, 'the demo has no assigned tasks');
  const f = await feed();
  assert.ok(f.roadmap.length > 0);
  assert.equal(f.counts.done + f.counts.now + f.counts.upcoming, f.roadmap.length);
  assert.ok(f.counts.done >= f.version, 'every live version is a finished piece');
});

test('nothing technical reaches the observer in the progress views', async () => {
  const { people: rows, update, line, map, roadmap, changes } = await feed();
  const words = JSON.stringify({ rows, update, line, map, status: roadmap.map(({ statusWords, what, why }) => [statusWords, what, why]), changes });
  assert.doesNotMatch(words, /\bweb\/|server\/|config\/|\.html|\.css|\.sql|\.json|main_commits|needs_context|awaiting_plan/);
});

test('every person on the team has a row and the investor does not', async () => {
  const f = await feed();
  assert.equal(f.people.length, fake.tables.project_members.filter((m) => m.role !== 'observer').length);
  assert.ok(f.people.every((p) => p.title && Array.isArray(p.pieces)));
  assert.ok(!f.people.some((p) => p.name === 'Isaac'));
});

test('the product map reads the real site files', async () => {
  const { map } = await feed();
  assert.ok(map.parts.some((p) => p.name === 'Home page'));
  assert.ok(map.parts.some((p) => p.kind === 'shared'));
  assert.ok(map.links.every((l) => map.parts.some((p) => p.id === l.from) && map.parts.some((p) => p.id === l.to)));
  assert.ok(map.hidden > 0, 'the server code stays behind the scenes');
});

test('a piece moves from happening now to live, and the wall and the line follow', async () => {
  const before = await feed();
  const started = await call('POST', 'team/task/start', { as: 'rohan', body: { text: 'Add a loyalty banner to the menu page' } });
  const during = await feed();
  assert.equal(during.counts.now, before.counts.now + 1);
  const planned = during.roadmap.find((w) => w.id === started.id);
  assert.equal(planned.statusWords, 'Plan ready. Rohan needs to OK it.');
  assert.equal(during.people.find((p) => p.name.startsWith('Rohan')).next.words, `OK the plan for "${planned.title}"`);

  const built = await call('POST', 'team/task/plan-decision', { as: 'rohan', body: { taskId: started.id } });
  assert.equal(built.status, 'done');
  assert.match((await feed()).roadmap.find((w) => w.id === started.id).statusWords, /^AI agent finished\. Rohan is checking it\.$/);

  const sub = await call('POST', 'team/task/submit', { as: 'rohan', body: { taskId: started.id, why: 'More repeat orders' } });
  assert.equal(sub.submitted, true);
  const waiting = (await feed()).roadmap.find((w) => w.id === started.id);
  assert.equal(waiting.statusWords, 'Built. Waiting for Ananya to approve.');
  assert.equal(waiting.step, 3);

  await call('POST', 'team/review/decide', { as: 'ananya', body: { submissionId: sub.submission.id, action: 'approve' } });
  const after = await feed();
  const live = after.roadmap.find((w) => w.id === started.id);
  assert.equal(live.stage, 'done');
  assert.equal(live.statusWords, `Live since version ${after.version}.`);
  assert.equal(after.line.versions.at(-1).title, live.title);
  assert.equal(after.line.versions.at(-1).who, 'Rohan');
  assert.equal(after.counts.done, before.counts.done + 1);
  assert.ok(after.update.finished.some((f) => f.id === started.id));
});

test('an assigned task and the agent work behind it count once', async () => {
  const before = await feed();
  const { task } = await call('POST', 'tasks/assign', { body: { assigneeId: people.rohan, title: 'Show the canteen opening hours' } });
  assert.equal((await feed()).counts.upcoming, before.counts.upcoming + 1);
  const row = (await feed()).roadmap.find((w) => w.id === task.id);
  assert.equal(row.statusWords, 'Not started.');
  await call('POST', 'team/task/start', { as: 'rohan', body: { assignmentId: task.id } });
  const f = await feed();
  assert.equal(f.roadmap.length, before.roadmap.length + 1, 'no second piece for the agent work');
  assert.equal(f.roadmap.find((w) => w.id === task.id).stage, 'now');
});

test('the rule changes no longer read like a database', async () => {
  const s = (await call('GET', 'team/context')).central[0];
  await call('POST', 'team/context/save', { body: { scope: 'central', edits: [{ sectionId: s.id, content: `${s.content}\nDeliveries stop at 10pm.`, why: 'Campus curfew' }] } });
  fake.tables.activity_log.push({ id: 9000, project_id: projectId, type: 'context.created', actor_id: owner.id, at: new Date().toISOString(), summary: 'Olivia added "Audience" to the central context', data: {} });
  const rules = (await feed()).changes.filter((c) => c.kind === 'requirement');
  assert.ok(rules.some((c) => c.why === 'Campus curfew'));
  assert.ok(rules.some((c) => c.title === 'Olivia added "Audience" to the team\'s rules'));
  assert.doesNotMatch(JSON.stringify(rules), /central context/);
});

test('the observer reads central context and documents, but not team-only context', async () => {
  const { about, roadmap } = await feed();
  const context = (await call('GET', 'team/context')).central;
  assert.ok(about.rules.length > 0 && about.rules.length <= context.length);
  assert.ok(about.rules.every((r) => context.some((s) => s.id === r.id)));
  assert.ok(about.teamRules > 0);
  assert.ok(about.docs.some((d) => d.title === 'CampusEats'), 'the README is a document');
  assert.doesNotMatch(JSON.stringify(about.rules), /guardrail|phrase|POST \/api/i);
  assert.ok(roadmap.some((w) => w.rules.length > 0), 'work lists the rules it was built on');
  assert.ok(about.milestones.some((m) => m.title === 'Menu and cart live'), 'a confirmed checkpoint is a milestone');
  assert.ok(about.notes.some((n) => n.title === 'Menu page built' && n.team === 'Frontend'));
  assert.ok(about.rules.some((r) => r.label === 'Must not'));
});

test('the team-only code view stays closed to the observer', async () => {
  await assert.rejects(call('GET', 'team/code', { user: investor }), (e) => e.status === 403 || e.status === 404);
});
