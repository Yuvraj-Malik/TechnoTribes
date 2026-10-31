// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentLine, buildNeedsYou, buildOrg, statusLine } from '../../src/features/projects/overviewModel.js';
import { briefPatch, briefRows, fieldKey, fieldLabel } from '../../src/features/projects/briefModel.js';

const admin = { user_id: 'a', name: 'Priya Nair', role: 'admin', status: 'active', team: 'Frontend', agents: [{ status: 'working' }] };
const worker = { user_id: 'b', name: 'Sam', role: 'worker', status: 'active', lead_id: 'a', agents: [{ status: 'idle' }] };
const single = { id: 'b1', label: '1 change to the Home page', mergeRequests: [{ id: 'm1', submittedByName: 'Sam', proposals: [{ summary: 'Adds a hero' }] }] };
const clash = {
  id: 'b2',
  label: '2 changes to the Pricing page',
  mergeRequests: [{ id: 'm2', submittedByName: 'Priya' }, { id: 'm3', submittedByName: 'Sam' }],
};

test('everyday reviews stay with admins, clashes reach the owner', () => {
  const { items, withAdmins } = buildNeedsYou({ members: [admin, worker], queue: { buckets: [single, clash] } });
  assert.equal(withAdmins, 1);
  assert.deepEqual(items.map((i) => i.kind), ['clash']);
  assert.match(items[0].text, /^Priya and Sam sent 2 changes/);
  assert.equal(items[0].mergeRequests.length, 2);
});

test('with no admin, the owner reviews everything', () => {
  const { items, withAdmins } = buildNeedsYou({ members: [worker], queue: { buckets: [single] } });
  assert.equal(withAdmins, 0);
  assert.equal(items[0].kind, 'review');
  assert.match(items[0].text, /Adds a hero/);
});

test('out of date work, people and investor requests all appear', () => {
  const { items } = buildNeedsYou({
    members: [{ user_id: 'c', name: 'Nina', role: 'admin', status: 'pending' }],
    joinRequests: [{ id: 'j1', name: 'Ravi', message: null }],
    queue: { needsAttention: [{ id: 'm4', submittedByName: 'Sam', conflict_reason: 'The pricing page changed.' }] },
    requests: [{ id: 'r1', status: 'pending', message: 'Add a banner' }, { id: 'r2', status: 'done', message: 'Old' }],
  });
  assert.deepEqual(items.map((i) => i.kind), ['outdated', 'admin', 'join', 'investor']);
  assert.equal(items[1].userId, 'c');
  assert.equal(items[2].requestId, 'j1');
});

test('the status line reads naturally for one and for many', () => {
  assert.equal(statusLine({ members: [admin], needsYouCount: 1 }), '1 agent is working. 1 item needs you.');
  assert.equal(
    statusLine({ members: [admin, { agents: [{ status: 'working' }] }], needsYouCount: 2, withAdmins: 3 }),
    '2 agents are working. 2 items need you. 3 changes are with your admins.',
  );
  assert.equal(statusLine({ members: [worker] }), 'No agents are working right now. Nothing needs you.');
});

test('the org chart puts each worker under their admin', () => {
  const owner = { user_id: 'o', name: 'Asha', role: 'owner', status: 'active' };
  const investor = { user_id: 'i', role: 'observer', status: 'active' };
  const unnamed = { user_id: 'e', name: 'Rohan Das', role: 'admin', status: 'active' };
  const pending = { user_id: 'p', role: 'admin', status: 'pending' };
  const loose = { user_id: 'w', name: 'Omar', role: 'worker', status: 'active', lead_id: null };
  const orphan = { user_id: 'x', name: 'Lee', role: 'worker', status: 'active', lead_id: 'gone' };
  const org = buildOrg([owner, investor, admin, unnamed, worker, pending, loose, orphan]);

  assert.equal(org.owner.user_id, 'o');
  assert.equal(org.investor.user_id, 'i');
  assert.deepEqual(org.teams.map((t) => t.name), ['Frontend', "Rohan's team"]);
  assert.deepEqual(org.teams[0].people.map((p) => p.user_id), ['b']);
  assert.deepEqual(org.unassigned.map((p) => p.user_id), ['w', 'x']);
});

test('agent lines say what the agent is doing', () => {
  assert.equal(agentLine({ kind: 'builder', status: 'working', current_activity: 'Writing pricing' }), 'Builder: Writing pricing');
  assert.equal(agentLine({ kind: 'critic', status: 'working', current_activity: 'Reviewing: signup form' }), 'Critic: reviewing signup form');
  assert.equal(agentLine({ kind: 'critic', status: 'idle' }), 'Critic: idle');
  assert.equal(agentLine({ kind: 'builder', status: 'blocked' }), 'Builder: blocked');
});

test('brief rows keep the standard order and any extra fields', () => {
  const rows = briefRows({ pricing_model: 'Monthly', audience: 'Cafes', limits: { pages: 3 } });
  assert.deepEqual(rows.slice(0, 2).map((r) => r.key), ['goal', 'audience']);
  assert.equal(rows[1].value, 'Cafes');
  assert.deepEqual(rows.slice(-2).map((r) => r.label), ['Pricing model', 'Limits']);
  assert.equal(rows.at(-1).value, '{"pages":3}');
});

test('a brief patch holds only what changed, and null removes a field', () => {
  const current = { audience: 'Students', tone: 'Warm', limits: { pages: 3 } };
  const draft = { audience: 'Small businesses', tone: '  Warm ', goal: '', limits: '{"pages":3}', must_have: 'Checkout' };
  assert.deepEqual(briefPatch(current, draft), { audience: 'Small businesses', must_have: 'Checkout' });
  assert.deepEqual(briefPatch(current, { tone: '   ' }), { tone: null });
});

test('field names turn into graph keys and back', () => {
  assert.equal(fieldKey('  Launch date! '), 'launch_date');
  assert.equal(fieldLabel('launch_date'), 'Launch date');
  assert.equal(fieldLabel('must_have'), 'Must have');
});
