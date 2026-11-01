// The owner's tools against a real local Supabase: real auth, real Postgres and
// row-level security, with only the agent simulated. It needs no Claude key.
// Run: npm run test:supabase  (migrations applied first, for example with `supabase db reset`)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url ?? '')) {
  console.error('This test only runs against a local Supabase. Check SUPABASE_URL in .env.local.');
  process.exit(1);
}
delete process.env.ANTHROPIC_API_KEY;

const { default: handler } = await import('../../api/index.js');
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8);
const people = {};
let projectId;

async function person(key, name) {
  const email = `${key}-${run}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  people[key] = { id: data.user.id, token: session.data.session.access_token, client };
}

async function attempt(who, method, route, { body = {}, query = {} } = {}) {
  let status = 200;
  let json;
  const res = { status(c) { status = c; return res; }, json(o) { json = o; return res; } };
  await handler({ method, headers: { authorization: `Bearer ${people[who].token}` }, body: { projectId, ...body }, query: { route, projectId, ...query } }, res);
  return { status, json };
}

async function call(who, method, route, options) {
  const { status, json } = await attempt(who, method, route, options);
  if (status >= 400) throw new Error(`${method} ${route} → ${status}: ${json?.error}`);
  return json;
}

before(async () => {
  await person('owner', 'Olivia Owner');
  await person('admin', 'Ada Admin');
  await person('second', 'Sam Second');
  await person('worker', 'Wes Worker');
  ({ project: { id: projectId } } = await call('owner', 'POST', 'projects/create', { body: { name: `Trial ${run}`, description: 'Test' } }));
  const member = (key, role) => ({ project_id: projectId, user_id: people[key].id, role, status: 'active', department: 'general' });
  const { error } = await service.from('project_members').insert([member('admin', 'admin'), member('second', 'admin'), member('worker', 'worker')]);
  if (error) throw error;
});

after(async () => {
  await Promise.all(Object.values(people).map((p) => p.client.auth.signOut().catch(() => {})));
});

test('messages reach the right admins and stay private', async () => {
  await call('owner', 'POST', 'team/messages/send', { body: { to: 'all', text: 'For everyone' } });
  await call('owner', 'POST', 'team/messages/send', { body: { to: people.second.id, text: 'Only Sam' } });

  const texts = async (who) => (await call(who, 'GET', 'team/messages')).messages.map((m) => m.text).sort();
  assert.deepEqual(await texts('owner'), ['For everyone', 'Only Sam']);
  assert.deepEqual(await texts('admin'), ['For everyone']);
  assert.deepEqual(await texts('second'), ['For everyone', 'Only Sam']);
  assert.equal((await attempt('worker', 'GET', 'team/messages')).status, 403);
  assert.equal((await attempt('admin', 'POST', 'team/messages/send', { body: { to: 'all', text: 'No' } })).status, 403);

  const direct = async (who) => (await people[who].client.from('messages').select('text').eq('project_id', projectId)).data.length;
  assert.equal(await direct('admin'), 1, 'row-level security: only your own messages');
  assert.equal(await direct('worker'), 0, 'row-level security: nothing for workers');

  const { data } = await service.from('notifications').select('user_id').eq('project_id', projectId).eq('kind', 'owner_message').eq('read', false);
  assert.equal(data.filter((n) => n.user_id === people.second.id).length, 2);
});

test('job titles are saved and cleared', async () => {
  await call('owner', 'POST', 'team/members/designation', { body: { userId: people.worker.id, designation: 'Frontend engineer' } });
  const titleOf = async () => (await call('admin', 'GET', 'projects/members')).members.find((m) => m.userId === people.worker.id).designation;
  assert.equal(await titleOf(), 'Frontend engineer');
  assert.equal((await call('worker', 'GET', 'team/bootstrap')).people.find((p) => p.id === people.worker.id).designation, 'Frontend engineer');
  await call('owner', 'POST', 'team/members/designation', { body: { userId: people.worker.id, designation: '' } });
  assert.equal(await titleOf(), null);
});

test('the owner builds, asks the Critic, submits, and an admin merges', async () => {
  let task = await call('owner', 'POST', 'team/task/start', { body: { text: 'Add a welcome page', department: 'general' } });
  assert.equal(task.status, 'awaiting_plan_approval');

  const during = await call('owner', 'GET', 'team/code');
  assert.deepEqual(during.branches.map((b) => b.who), ['Olivia Owner']);

  task = await call('owner', 'POST', 'team/task/plan-decision', { body: { taskId: task.id } });
  assert.equal(task.status, 'done');

  task = await call('owner', 'POST', 'team/task/critic', { body: { taskId: task.id } });
  assert.equal(task.critique.verdict, 'needs_changes', 'the simulated Builder leaves a TODO, and the Critic must catch it');

  const { submission } = await call('owner', 'POST', 'team/task/submit', { body: { taskId: task.id, why: 'Trial', force: true } });
  await call('admin', 'POST', 'team/review/decide', { body: { submissionId: submission.id, action: 'approve', note: 'Good' } });

  const code = await call('owner', 'GET', 'team/code');
  assert.equal(code.branches.length, 0);
  assert.ok(code.version >= 1);
  assert.ok(code.files.length >= 1);
  assert.equal(code.people.find((p) => p.userId === people.owner.id).shipped.length, 1);
  const file = await call('owner', 'GET', 'team/workspace/file', { query: { workspace: 'main', path: code.files[0] } });
  assert.equal(typeof file.content, 'string');
});

test('observers cannot open the code view', async () => {
  await person('observer', 'Omar Observer');
  await service.from('project_members').insert({ project_id: projectId, user_id: people.observer.id, role: 'observer', status: 'active' });
  assert.equal((await attempt('observer', 'GET', 'team/code')).status, 403);
});
