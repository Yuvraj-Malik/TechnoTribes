// The owner's full flow against a real Supabase stack. Only Claude is faked.
// Start Supabase first (docs/architecture/DATABASE_SETUP.md, Option C), then:
//   npm run test:supabase
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url || '')) {
  throw new Error('Integration tests create test data, so they only run against a local Supabase. Check SUPABASE_URL in .env.local');
}

// Every Claude call lands here. Tests set `builderOutput` before running a Builder.
let builderOutput = null;
const realFetch = globalThis.fetch;
process.env.ANTHROPIC_API_KEY = 'test-key';
globalThis.fetch = async (input, options) => {
  if (!String(input?.url ?? input).startsWith('https://api.anthropic.com/')) return realFetch(input, options);
  const { system } = JSON.parse(options.body);
  let text = 'The team shipped an update.';
  if (system.includes('Builder agent')) text = JSON.stringify(builderOutput);
  else if (system.includes('"order"')) text = JSON.stringify({ order: [], reasons: {}, recommendations: {} });
  else if (system.includes('Critic agent')) text = JSON.stringify({ verdict: 'approve', score: 90, summary: 'Looks right.', issues: [] });
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
};

const { default: handler } = await import('../../api/index.js');

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);

async function signUp(role, name) {
  const email = `${role}-${run}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: name },
  });
  assert.ifError(error);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);
  return { id: data.user.id, email, name, token: signedIn.session.access_token, client };
}

// Calls the real router, the same way Vercel and the Vite dev server do.
function call(person, method, route, { body, query } = {}) {
  return new Promise((resolve, reject) => {
    let status = 200;
    const res = {
      status(code) { status = code; return res; },
      json(payload) { resolve({ status, body: payload }); return res; },
    };
    const req = {
      method,
      headers: person ? { authorization: `Bearer ${person.token}` } : {},
      query: { ...query, route },
      body,
    };
    handler(req, res).catch(reject);
  });
}

const post = (person, route, body) => call(person, 'POST', route, { body });
const get = (person, route, query) => call(person, 'GET', route, { query });

function ok(response) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function refused(response, status, message) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (message) assert.match(response.body.error, message);
}

const builds = (path, summary, dependsOn = ['req:audience']) => ({
  summary,
  reason: 'Asked for in the task',
  changes: [{ path, action: 'update', content: `// ${summary}` }],
  depends_on: dependsOn,
  notes_for_team: '',
});

async function runBuilder(person, path, summary, extra = {}) {
  builderOutput = builds(path, summary, extra.dependsOn);
  return post(person, 'agents/builder/run', {
    projectId, instruction: summary, targets: [path], force: extra.force, taskId: extra.taskId,
  });
}

// Open Realtime sockets would keep the test process alive.
after(() => {
  [owner, priya, rohan, sam, meera, investor, stranger, late].forEach((person) => person?.client.realtime.disconnect());
});

let projectId;
let observerCode;
let owner;
let priya;
let rohan;
let sam;
let meera;
let investor;
let stranger;
let late;

test('setting up: real accounts sign in through Supabase Auth', async () => {
  [owner, priya, rohan, sam, meera, investor, stranger] = await Promise.all([
    signUp('owner', 'Aarav Mehta'), signUp('priya', 'Priya Nair'), signUp('rohan', 'Rohan Das'),
    signUp('sam', 'Sam Lee'), signUp('meera', 'Meera Iyer'), signUp('investor', 'Kabir Rao'), signUp('stranger', 'Not Invited'),
  ]);
  refused(await get(null, 'auth/me'), 401, /sign in/);
  const me = ok(await get(owner, 'auth/me'));
  assert.equal(me.user.display_name, 'Aarav Mehta');
  assert.deepEqual(me.projects, []);
});

test('the owner creates a project and gets their own Builder and Critic', async () => {
  const created = ok(await post(owner, 'projects/create', {
    name: 'Integration project',
    description: 'Online orders for cafes',
    brief: { goal: 'Online orders', audience: 'Students', tone: 'Warm' },
  }));
  projectId = created.project.id;
  observerCode = created.observerCode;
  assert.match(observerCode, /^OBS-/);

  const { members } = ok(await get(owner, 'projects/members', { projectId }));
  assert.equal(members.length, 1);
  assert.equal(members[0].role, 'owner');
  assert.deepEqual(members[0].agents.map((a) => a.kind).sort(), ['builder', 'critic']);
});

test('admins join with a code and wait for the owner', async () => {
  refused(await post(priya, 'projects/admin-code', { projectId }), 403);

  for (const admin of [priya, rohan]) {
    const { code } = ok(await post(owner, 'projects/admin-code', { projectId }));
    const joined = ok(await post(admin, 'projects/join', { code }));
    assert.equal(joined.status, 'pending');
    refused(await get(admin, 'projects/members', { projectId }), 403);
    ok(await post(owner, 'projects/admins/approve', { projectId, userId: admin.id, approve: true }));
  }

  const { members } = ok(await get(owner, 'projects/members', { projectId }));
  const active = members.filter((m) => m.role === 'admin' && m.status === 'active');
  assert.equal(active.length, 2);
  assert.ok(active.every((m) => m.agents.length === 2));
});

test('the investor joins with the observer code', async () => {
  const joined = ok(await post(investor, 'projects/join', { code: observerCode }));
  assert.equal(joined.role, 'observer');
  refused(await post(stranger, 'projects/join', { code: observerCode }), 409, /already has an observer/);
});

test('workers are added and placed on an admin\'s team', async () => {
  for (const worker of [sam, meera]) ok(await post(priya, 'projects/members/add', { projectId, email: worker.email }));

  ok(await post(owner, 'projects/members/update', { projectId, userId: priya.id, team: 'Frontend', designation: 'Frontend lead' }));
  ok(await post(owner, 'projects/members/update', { projectId, userId: sam.id, leadId: priya.id, designation: 'UI engineer' }));
  ok(await post(priya, 'projects/members/update', { projectId, userId: meera.id, leadId: priya.id }));

  const { members } = ok(await get(owner, 'projects/members', { projectId }));
  const find = (person) => members.find((m) => m.user_id === person.id);
  assert.equal(find(priya).team, 'Frontend');
  assert.equal(find(sam).lead_id, priya.id);
  assert.equal(find(sam).designation, 'UI engineer');
});

test('team changes stay valid and need the right role', async () => {
  refused(await post(owner, 'projects/members/update', { projectId, userId: sam.id, team: 'Web' }), 400, /Only admins/);
  refused(await post(owner, 'projects/members/update', { projectId, userId: priya.id, leadId: rohan.id }), 400, /Only workers/);
  refused(await post(owner, 'projects/members/update', { projectId, userId: sam.id, leadId: meera.id }), 400, /active admin/);
  refused(await post(owner, 'projects/members/update', { projectId, userId: stranger.id, designation: 'x' }), 404);
  refused(await post(owner, 'projects/members/update', { projectId, userId: sam.id }), 400, /Nothing to update/);
  refused(await post(sam, 'projects/members/update', { projectId, userId: sam.id, designation: 'Boss' }), 403);
  refused(await post(stranger, 'projects/members/update', { projectId, userId: sam.id, designation: 'x' }), 403);
});

test('only the owner can change project settings', async () => {
  refused(await post(priya, 'projects/update', { projectId, name: 'Taken over' }), 403);
  refused(await post(owner, 'projects/update', { projectId, name: '   ' }), 400, /needs a name/);
  const { project } = ok(await post(owner, 'projects/update', {
    projectId, name: 'Cafe orders', description: '', repo: { owner: 'cafeflow', name: 'website', branch: '' },
  }));
  assert.equal(project.name, 'Cafe orders');
  assert.equal(project.description, null);
  assert.equal(project.repo_owner, 'cafeflow');
  assert.equal(project.default_branch, 'main');
});

test('the owner messages one admin or all of them', async () => {
  const all = ok(await post(owner, 'messages/send', { projectId, to: 'all', text: 'Launch moved to Friday' }));
  assert.equal(all.message.to_all, true);
  assert.deepEqual([...all.message.recipient_ids].sort(), [priya.id, rohan.id].sort());

  const one = ok(await post(owner, 'messages/send', { projectId, to: rohan.id, text: 'Only for Rohan' }));
  assert.deepEqual(one.message.recipient_ids, [rohan.id]);

  refused(await post(owner, 'messages/send', { projectId, to: sam.id, text: 'Not an admin' }), 400, /active admin/);
  refused(await post(owner, 'messages/send', { projectId, to: 'all', text: '   ' }), 400, /Write a message/);
  refused(await post(priya, 'messages/send', { projectId, to: 'all', text: 'Admins cannot send' }), 403);

  const sent = ok(await get(owner, 'messages/list', { projectId }));
  assert.equal(sent.messages.length, 2);
  assert.equal(sent.messages[0].text, 'Only for Rohan');
  assert.deepEqual(sent.messages[0].recipientNames, ['Rohan Das']);

  const forPriya = ok(await get(priya, 'messages/list', { projectId }));
  assert.deepEqual(forPriya.messages.map((m) => m.text), ['Launch moved to Friday']);
  refused(await get(sam, 'messages/list', { projectId }), 403);

  const { notifications } = ok(await get(rohan, 'notifications/list', { projectId }));
  assert.equal(notifications.filter((n) => n.kind === 'owner_message').length, 2);
});

test('row-level security keeps direct reads private', async () => {
  const read = async (person, table) => {
    const { data, error } = await person.client.from(table).select('*').eq('project_id', projectId);
    assert.ifError(error);
    return data.length;
  };
  assert.equal(await read(owner, 'messages'), 2);
  assert.equal(await read(rohan, 'messages'), 2);
  assert.equal(await read(priya, 'messages'), 1);
  assert.equal(await read(sam, 'messages'), 0);
  assert.equal(await read(stranger, 'messages'), 0);

  assert.equal(await read(sam, 'project_state'), 1);
  assert.equal(await read(investor, 'project_state'), 0);
  assert.equal(await read(investor, 'moderator_log'), 0);
  assert.equal(await read(stranger, 'project_members'), 0);
});

test('the admin screen gets its role and only that admin\'s messages, newest first', async () => {
  const me = ok(await get(priya, 'auth/me'));
  const membership = me.projects.find((p) => p.projectId === projectId);
  assert.equal(membership.role, 'admin');
  assert.equal(membership.status, 'active');
  assert.equal(membership.name, 'Cafe orders');

  ok(await post(owner, 'messages/send', { projectId, to: priya.id, text: 'Only for Priya' }));

  const { messages } = ok(await get(priya, 'messages/list', { projectId }));
  assert.deepEqual(messages.map((m) => m.text), ['Only for Priya', 'Launch moved to Friday']);
  assert.deepEqual(messages.map((m) => m.to_all), [false, true]);
  assert.ok(messages.every((m) => m.senderName === 'Aarav Mehta'));

  const forRohan = ok(await get(rohan, 'messages/list', { projectId }));
  assert.ok(forRohan.messages.every((m) => m.text !== 'Only for Priya'));
});

test('an admin still waiting for approval cannot read messages', async () => {
  late = await signUp('late', 'Lena Fox');
  const { code } = ok(await post(owner, 'projects/admin-code', { projectId }));
  ok(await post(late, 'projects/join', { code }));

  const membership = ok(await get(late, 'auth/me')).projects.find((p) => p.projectId === projectId);
  assert.equal(membership.status, 'pending');
  refused(await get(late, 'messages/list', { projectId }), 403);
});

test('nobody outside the project can read it through the API', async () => {
  for (const route of ['projects/members', 'moderator/state', 'moderator/graph', 'reviews/queue', 'tasks/list', 'coordination/board']) {
    refused(await get(stranger, route, { projectId }), 403);
  }
  refused(await get(investor, 'moderator/state', { projectId }), 403);
  refused(await get(investor, 'moderator/context', { projectId }), 403);
});

let samRequest;
let meeraRequest;
let task;

test('a worker gets a task, the Builder proposes, the Critic reviews, and it goes for review', async () => {
  ({ task } = ok(await post(priya, 'tasks/assign', {
    projectId, assigneeId: sam.id, title: 'Pricing page', targets: ['src/pages/Pricing.jsx'],
  })));

  const before = ok(await get(owner, 'coordination/board', { projectId }));
  assert.deepEqual(before.work, []);

  const { proposal, basedOnVersion } = ok(await runBuilder(sam, 'src/pages/Pricing.jsx', 'Sam adds the pricing page', { taskId: task.id }));
  assert.equal(proposal.status, 'draft');
  assert.equal(basedOnVersion, 0);

  const board = ok(await get(owner, 'coordination/board', { projectId }));
  assert.equal(board.work.length, 1);
  assert.equal(board.work[0].who, 'Sam Lee');
  assert.equal(board.work[0].basedOnVersion, 0);

  const { review } = ok(await post(sam, 'agents/critic/review', { proposalId: proposal.id }));
  assert.equal(review.verdict, 'approve');
  refused(await post(meera, 'agents/critic/review', { proposalId: proposal.id }), 403);

  ({ mergeRequest: samRequest } = ok(await post(sam, 'reviews/submit', { projectId, proposalIds: [proposal.id] })));
  const { tasks } = ok(await get(owner, 'tasks/list', { projectId }));
  assert.equal(tasks[0].status, 'in_review');
});

test('a second agent on the same file is stopped, then shows as a clash if forced', async () => {
  const blocked = await runBuilder(meera, 'src/pages/Pricing.jsx', 'Meera adds a yearly toggle');
  refused(blocked, 409, /Sam Lee/);
  assert.equal(blocked.body.details.overlap.status, 'same_target');

  const { proposal } = ok(await runBuilder(meera, 'src/pages/Pricing.jsx', 'Meera adds a yearly toggle', { force: true }));
  ({ mergeRequest: meeraRequest } = ok(await post(meera, 'reviews/submit', { projectId, proposalIds: [proposal.id] })));

  const queue = ok(await get(owner, 'reviews/queue', { projectId }));
  const [bucket] = queue.buckets;
  assert.equal(bucket.kind, 'same_target');
  assert.equal(bucket.mergeRequests.length, 2);
  assert.ok(bucket.mergeRequests.every((m) => m.submittedByName && m.proposals.length === 1));
  assert.equal(bucket.mergeRequests.find((m) => m.submitted_by === sam.id).criticReviews.length, 1);
});

test('changing the brief mid-flight shows the impact, then marks that work out of date', async () => {
  const preview = ok(await post(owner, 'projects/brief/preview', { projectId, brief: { audience: 'Cafe owners' } }));
  assert.deepEqual(preview.changedFields, ['audience']);
  assert.equal(preview.impact.staleMergeRequests.length, 2);
  assert.deepEqual([...preview.impact.peopleAffected].sort(), ['Meera Iyer', 'Sam Lee']);

  const unchanged = ok(await get(owner, 'moderator/state', { projectId }));
  assert.equal(unchanged.brief.audience, 'Students');

  const saved = ok(await post(owner, 'projects/brief', { projectId, brief: { audience: 'Cafe owners' }, reason: 'Cafes pay' }));
  assert.equal(saved.version, 1);

  const queue = ok(await get(owner, 'reviews/queue', { projectId }));
  assert.equal(queue.needsAttention.length, 2);
  assert.ok(queue.needsAttention.every((m) => m.status === 'stale' && m.conflict_reason));

  const { notifications } = ok(await get(sam, 'notifications/list', { projectId }));
  assert.ok(notifications.some((n) => n.kind === 'stale'));

  const log = ok(await get(owner, 'moderator/log', { projectId }));
  assert.equal(log.entries[0].kind, 'brief');
  assert.equal(log.entries[0].reason, 'Cafes pay');
});

test('stale work cannot be approved, and its owner can re-run on the new version', async () => {
  const { results } = ok(await post(owner, 'reviews/decide', {
    projectId, decisions: [{ mergeRequestId: samRequest.id, decision: 'approve' }],
  }));
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /out of date/);

  const { proposal, basedOnVersion } = ok(await runBuilder(sam, 'src/pages/Pricing.jsx', 'Sam rebuilds pricing for cafes', { taskId: task.id }));
  assert.equal(basedOnVersion, 1);
  ({ mergeRequest: samRequest } = ok(await post(sam, 'reviews/submit', { projectId, proposalIds: [proposal.id] })));

  // Sam's new request replaces the old one. Meera still has to re-run hers.
  const queue = ok(await get(owner, 'reviews/queue', { projectId }));
  assert.deepEqual(queue.needsAttention.map((m) => m.submitted_by), [meera.id]);
});

test('send back needs a note, and approval records a new version', async () => {
  const sendBack = ok(await post(owner, 'reviews/decide', {
    projectId, decisions: [{ mergeRequestId: samRequest.id, decision: 'redirect' }],
  }));
  assert.equal(sendBack.results[0].ok, false);
  assert.match(sendBack.results[0].error, /note/);

  const { results } = ok(await post(owner, 'reviews/decide', {
    projectId, decisions: [{ mergeRequestId: samRequest.id, decision: 'approve' }],
  }));
  assert.equal(results[0].status, 'approved');
  assert.equal(results[0].version, 2);

  const state = ok(await get(owner, 'moderator/state', { projectId }));
  assert.equal(state.version, 2);
  assert.ok(state.files['src/pages/Pricing.jsx'].includes('Sam rebuilds pricing'));

  const { entries } = ok(await get(owner, 'moderator/log', { projectId }));
  assert.equal(entries[0].submittedByName, 'Sam Lee');
  assert.equal(entries[0].approvedByName, 'Aarav Mehta');
  assert.ok(entries[0].targets.includes('file:src/pages/Pricing.jsx'));

  const graph = ok(await get(owner, 'moderator/graph', { projectId }));
  assert.ok(graph.edges.some((e) => e.from_key === 'file:src/pages/Pricing.jsx' && e.to_key === 'req:audience'));

  const { tasks } = ok(await get(owner, 'tasks/list', { projectId }));
  assert.equal(tasks[0].status, 'done');

  const board = ok(await get(owner, 'coordination/board', { projectId }));
  assert.ok(board.work.every((w) => w.who !== 'Sam Lee'));
});

test('work based on an older version cannot slip through', async () => {
  const { proposal } = ok(await runBuilder(meera, 'src/components/Footer.jsx', 'Meera adds footer links', {
    dependsOn: ['src/pages/Pricing.jsx'],
  }));
  const { mergeRequest } = ok(await post(meera, 'reviews/submit', { projectId, proposalIds: [proposal.id] }));

  const newer = ok(await runBuilder(sam, 'src/pages/Pricing.jsx', 'Sam tweaks pricing'));
  const sams = ok(await post(sam, 'reviews/submit', { projectId, proposalIds: [newer.proposal.id] }));
  ok(await post(owner, 'reviews/decide', { projectId, decisions: [{ mergeRequestId: sams.mergeRequest.id, decision: 'approve' }] }));

  // Sam's approval already marked Meera's request out of date.
  const decision = { projectId, decisions: [{ mergeRequestId: mergeRequest.id, decision: 'approve' }] };
  const first = ok(await post(owner, 'reviews/decide', decision));
  assert.equal(first.results[0].ok, false);
  assert.match(first.results[0].error, /out of date/);

  // If a request ever slips past that, approval compares versions again.
  await service.from('merge_requests').update({ status: 'pending' }).eq('id', mergeRequest.id);
  const second = ok(await post(owner, 'reviews/decide', decision));
  assert.equal(second.results[0].ok, false);
  assert.equal(second.results[0].status, 'conflict', JSON.stringify(second.results[0]));

  // Conflicted work has to be redone, so it stops blocking that file for others.
  const { proposals } = ok(await get(meera, 'agents/proposals', { projectId }));
  assert.equal(proposals.find((p) => p.id === proposal.id).status, 'stale');
  const board = ok(await get(owner, 'coordination/board', { projectId }));
  assert.ok(board.work.every((w) => !w.targets.includes('file:src/components/Footer.jsx')));
});

test('the owner runs their own Builder and Critic and recovers context', async () => {
  const context = ok(await get(owner, 'moderator/context', { projectId }));
  assert.equal(context.version, 3);
  assert.equal(context.brief.audience, 'Cafe owners');
  assert.ok(context.fileIndex.includes('src/pages/Pricing.jsx'));
  assert.equal(context.complete, true);

  const { proposal } = ok(await runBuilder(owner, 'src/pages/Home.jsx', 'Owner rewrites the home page', { dependsOn: ['req:tone'] }));
  ok(await post(owner, 'agents/critic/review', { proposalId: proposal.id }));

  const { proposals } = ok(await get(owner, 'agents/proposals', { projectId }));
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'reviewed');
  assert.equal(proposals[0].review.verdict, 'approve');
  refused(await get(investor, 'agents/proposals', { projectId }), 403);

  const others = ok(await get(priya, 'agents/proposals', { projectId }));
  assert.deepEqual(others.proposals, []);

  const { mergeRequest } = ok(await post(owner, 'reviews/submit', { projectId, proposalIds: [proposal.id] }));
  const { results } = ok(await post(priya, 'reviews/decide', {
    projectId, decisions: [{ mergeRequestId: mergeRequest.id, decision: 'approve' }],
  }));
  assert.equal(results[0].status, 'approved');

  const ranked = ok(await post(owner, 'agents/critic/prioritize', { projectId }));
  assert.ok(Array.isArray(ranked.buckets));
});

test('the investor sees plain progress and can ask for a change', async () => {
  const feed = ok(await get(investor, 'observer/feed', { projectId }));
  assert.ok(feed.whatChanged.length >= 3);
  assert.ok(feed.whatChanged.every((entry) => entry.text));

  const { request } = ok(await post(investor, 'observer/request', { projectId, message: 'Add a free trial banner' }));
  const { requests } = ok(await get(owner, 'observer/requests', { projectId }));
  assert.equal(requests[0].id, request.id);
  assert.equal(requests[0].status, 'pending');
});

test('only managers can answer the investor, and only with rejected or done', async () => {
  const { requests: [request] } = ok(await get(owner, 'observer/requests', { projectId }));
  const answer = { requestId: request.id, status: 'done' };

  for (const person of [investor, sam, stranger]) refused(await post(person, 'observer/request/respond', answer), 403);
  refused(await post(owner, 'observer/request/respond', { ...answer, status: 'accepted' }), 400, /tasks\/assign/);
  refused(await post(owner, 'observer/request/respond', { requestId: request.id }), 400);
  refused(await post(owner, 'observer/request/respond', { ...answer, requestId: randomUUID() }), 404);

  const { requests } = ok(await get(owner, 'observer/requests', { projectId }));
  assert.equal(requests[0].status, 'pending');
  assert.equal(requests[0].response, null);
});

test('the owner declines with a reply, and the investor hears back', async () => {
  const { requests: [request] } = ok(await get(owner, 'observer/requests', { projectId }));
  const answered = ok(await post(owner, 'observer/request/respond', {
    requestId: request.id, status: 'rejected', response: 'Not before launch',
  }));
  assert.deepEqual(answered, { requestId: request.id, status: 'rejected' });

  const { myRequests } = ok(await get(investor, 'observer/feed', { projectId }));
  assert.equal(myRequests[0].status, 'rejected');
  assert.equal(myRequests[0].response, 'Not before launch');
  assert.equal(myRequests[0].admin_id, owner.id);

  const { notifications } = ok(await get(investor, 'notifications/list', { projectId }));
  const [note] = notifications.filter((n) => n.kind === 'request_rejected');
  assert.equal(note.title, 'Your request was declined');
  assert.equal(note.body, 'Not before launch');
});

test('an admin can mark a request done, with no reply needed', async () => {
  const { request } = ok(await post(investor, 'observer/request', { projectId, message: 'Add our logo to the footer' }));
  ok(await post(priya, 'observer/request/respond', { requestId: request.id, status: 'done', response: '' }));

  const { requests } = ok(await get(owner, 'observer/requests', { projectId }));
  assert.equal(requests[0].status, 'done');
  assert.equal(requests[0].response, null);
  assert.equal(requests[0].admin_id, priya.id);

  const { notifications } = ok(await get(investor, 'notifications/list', { projectId }));
  const [note] = notifications.filter((n) => n.kind === 'request_done');
  assert.equal(note.title, 'Your request is done');
  assert.equal(note.body, null);
});

test('live updates reach the owner over Supabase Realtime', async () => {
  // Realtime takes a few seconds to come back after a database reset, so the
  // change repeats until an event lands. A real fault still fails at the timeout.
  let repeat;
  const change = () => service.from('agents').update({ current_activity: `Working ${Date.now()}` })
    .eq('project_id', projectId).eq('user_id', sam.id).eq('kind', 'builder').then(({ error }) => assert.ifError(error));

  const seen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no realtime event within 30 seconds')), 30000);
    owner.client.realtime.setAuth(owner.token);
    const channel = owner.client.channel(`test-${run}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents', filter: `project_id=eq.${projectId}` }, (payload) => {
        clearTimeout(timer);
        owner.client.removeChannel(channel);
        resolve(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') repeat = setInterval(change, 1000);
      });
  });

  try {
    assert.equal((await seen).table, 'agents');
  } finally {
    clearInterval(repeat);
  }
});
