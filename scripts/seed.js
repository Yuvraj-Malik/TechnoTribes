// Fills a LOCAL Supabase with a sample team and project, so the whole app can be
// tried with real data. Run with: npm run seed
//
// Everyone signs in with the password below. Aarav is the project owner.
// The password only exists in local test databases: this script refuses to run
// against anything else.
import { db, q } from '../api/_lib/supabase-admin.js';
import { makeCode } from '../api/_lib/codes.js';
import { addDependencies } from '../api/_lib/dependency-graph.js';
import { declareIntent } from '../api/_lib/coordination.js';
import { getAgent, setAgentStatus, ensureAgents, notify } from '../api/_lib/log.js';
import { commitChange } from '../api/_lib/moderator.js';
import { fileKey } from '../api/_lib/paths.js';
import { rebucket } from '../api/_lib/reviews.js';

const PASSWORD = 'buildify-demo';
const PROJECT_NAME = 'Cafe orders';

const PEOPLE = {
  aarav: { name: 'Aarav Mehta', role: 'owner', designation: 'Founder and CTO' },
  priya: { name: 'Priya Nair', role: 'admin', team: 'Frontend', designation: 'Frontend lead' },
  rohan: { name: 'Rohan Das', role: 'admin', team: 'Backend', designation: 'Backend lead' },
  sam: { name: 'Sam Lee', role: 'worker', lead: 'priya', designation: 'UI engineer' },
  meera: { name: 'Meera Iyer', role: 'worker', lead: 'priya', designation: 'Frontend engineer' },
  ravi: { name: 'Ravi Shah', role: 'worker', lead: 'rohan', designation: 'API engineer' },
  nina: { name: 'Nina Costa', role: 'worker', lead: 'rohan', designation: 'Database engineer' },
  omar: { name: 'Omar Haddad', role: 'worker' },
  lena: { name: 'Lena Fox', role: 'admin', status: 'pending' },
  kabir: { name: 'Kabir Rao', role: 'observer' },
  tara: { name: 'Tara Quinn' }, // asks to join, so she is not a member yet
};

const FILES = {
  'README.md': '# Cafe orders\n',
  'src/App.jsx': "import Pricing from './pages/Pricing';\n\nexport default function App() {\n  return <Pricing />;\n}\n",
  'src/components/Button.jsx': "export default function Button({ children }) {\n  return <button className=\"btn\">{children}</button>;\n}\n",
  'src/components/Footer.jsx': "export default function Footer() {\n  return <footer>Made for cafes</footer>;\n}\n",
  'src/pages/Home.jsx': "import Button from '../components/Button';\n\nexport default function Home() {\n  return (\n    <main>\n      <h1>Online orders for small cafes</h1>\n      <Button>Start free</Button>\n    </main>\n  );\n}\n",
  'src/pages/Signup.jsx': "export default function Signup() {\n  return <form aria-label=\"Sign up\" />;\n}\n",
  'src/pages/Pricing.jsx': "import Button from '../components/Button';\n\nconst plans = ['Starter', 'Growth', 'Chain'];\n\nexport default function Pricing() {\n  return (\n    <section>\n      {plans.map((plan) => (\n        <article key={plan}>\n          <h2>{plan}</h2>\n          <Button>Choose {plan}</Button>\n        </article>\n      ))}\n    </section>\n  );\n}\n",
  'api/db.js': "import { createClient } from '@supabase/supabase-js';\n\nexport const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);\n",
  'api/menu.js': "import { db } from './db.js';\n\nexport const menu = (cafeId) => db.from('menu').select('*').eq('cafe_id', cafeId);\n",
  'api/orders.js': "import { db } from './db.js';\n\nexport const orders = (cafeId) => db.from('orders').select('*').eq('cafe_id', cafeId);\n",
};

// Approved history, oldest first. Each entry becomes one version on main.
const HISTORY = [
  { kind: 'brief', by: 'aarav', summary: 'Aarav Mehta wrote the first brief', brief: { goal: 'A website where small cafes take online orders and manage their menu.', audience: 'University students', tone: 'Warm, simple and quick to scan' } },
  { kind: 'import', by: 'aarav', summary: 'Imported the starter project from GitHub', files: ['README.md', 'src/App.jsx'] },
  { kind: 'brief', by: 'aarav', summary: 'Aarav Mehta changed the project requirements: must_have, constraints', brief: { must_have: 'Menu, ordering, three pricing plans, and an owner dashboard', constraints: 'React and Supabase. Launch before the end of the month.' } },
  { by: 'priya', approver: 'aarav', summary: 'Shared Button component', files: ['src/components/Button.jsx'], dependsOn: ['req:tone'] },
  { by: 'meera', approver: 'priya', summary: 'Home page hero and call to action', files: ['src/pages/Home.jsx'], dependsOn: ['file:src/components/Button.jsx', 'req:audience', 'req:tone'] },
  { by: 'ravi', approver: 'rohan', summary: 'Added the menu API', files: ['api/db.js', 'api/menu.js'] },
  { by: 'sam', approver: 'priya', summary: 'Signup form is shorter', files: ['src/pages/Signup.jsx'], dependsOn: ['req:audience'] },
  { by: 'nina', approver: 'rohan', summary: 'Orders are stored per cafe', files: ['api/orders.js'], dependsOn: ['file:api/db.js', 'req:must_have'] },
  { kind: 'brief', by: 'aarav', summary: 'Aarav Mehta changed the project requirements: audience', reason: 'Students were not converting. Cafe owners are the paying customers.', brief: { audience: 'Independent cafe owners with one to three locations' } },
  { by: 'priya', approver: 'rohan', summary: 'Pricing page shows the new plan cards', files: ['src/pages/Pricing.jsx', 'src/App.jsx'], dependsOn: ['file:src/components/Button.jsx', 'req:audience'] },
  { by: 'sam', approver: 'priya', summary: 'Footer with the company name', files: ['src/components/Footer.jsx'] },
];

const TASKS = [
  ['priya', 'Pricing page', 'in_review'], ['priya', 'Shared components', 'done'],
  ['sam', 'Signup form', 'done'], ['sam', 'Footer', 'in_review'], ['sam', 'Checkout screen', 'open'],
  ['meera', 'Home page', 'done'], ['meera', 'Yearly pricing toggle', 'in_review'],
  ['ravi', 'Menu API', 'done'], ['ravi', 'Order history', 'in_progress'],
  ['nina', 'Orders table', 'done'], ['nina', 'Plan storage', 'in_progress'], ['nina', 'Backups', 'open'],
];

function refuseUnlessLocal() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.SUPABASE_URL || '')) {
    throw new Error('Seeding creates accounts with a shared password, so it only runs against a local Supabase. Check SUPABASE_URL in .env.local');
  }
}

async function createAccounts() {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const ids = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@example.com`;
    const existing = data.users.find((u) => u.email === email);
    if (existing) {
      ids[key] = existing.id;
      continue;
    }
    const created = await db.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: person.name },
    });
    if (created.error) throw created.error;
    ids[key] = created.data.user.id;
  }
  return ids;
}

async function addMembers(projectId, ids) {
  const rows = Object.entries(PEOPLE).filter(([, p]) => p.role).map(([key, p]) => ({
    project_id: projectId,
    user_id: ids[key],
    role: p.role,
    status: p.status || 'active',
    team: p.team || null,
    lead_id: p.lead ? ids[p.lead] : null,
    designation: p.designation || null,
  }));
  await q(db.from('project_members').insert(rows));
  for (const row of rows) {
    if (row.status === 'active' && row.role !== 'observer') await ensureAgents(projectId, row.user_id);
  }
}

async function writeHistory(projectId, ids) {
  for (const step of HISTORY) {
    const files = step.files || [];
    await commitChange({
      projectId,
      actorId: ids[step.approver || step.by],
      submittedBy: ids[step.by],
      kind: step.kind || 'change',
      summary: step.summary,
      reason: step.reason || '',
      briefPatch: step.brief || null,
      fileChanges: files.map((path) => ({ path, action: 'update', content: FILES[path] })),
    });
    if (step.dependsOn) await addDependencies(projectId, files.map(fileKey), step.dependsOn);
  }
  await addDependencies(projectId, ['file:src/App.jsx'], ['file:src/pages/Home.jsx', 'file:src/pages/Pricing.jsx']);
}

// One piece of unfinished work: an intent, and a proposal once the Builder has answered.
async function startWork(projectId, ids, { by, goal, paths, baseVersion, summary, dependsOn = [], status = 'submitted', staleReason = null }) {
  const agent = await getAgent(projectId, ids[by], 'builder');
  const targets = paths.map(fileKey);
  const intent = await declareIntent({ projectId, userId: ids[by], agentId: agent.id, goal, targets, baseVersion });
  if (!summary) return { agent };
  const proposal = await q(db.from('proposals').insert({
    project_id: projectId, user_id: ids[by], agent_id: agent.id, intent_id: intent.id,
    instruction: goal, summary, reason: 'From the assigned task.',
    changes: paths.map((path) => ({ path, action: 'update', content: FILES[path] || '// New file\n' })),
    targets, depends_on: dependsOn, base_version: baseVersion, status, stale_reason: staleReason,
  }).select().single());
  return { agent, proposal };
}

async function requestReview(projectId, submittedBy, proposal, { status = 'pending', reason = null } = {}) {
  return q(db.from('merge_requests').insert({
    project_id: projectId,
    submitted_by: submittedBy,
    proposal_ids: [proposal.id],
    change_list: proposal.changes.map((c) => ({
      proposalId: proposal.id, path: c.path, action: c.action, summary: proposal.summary, reason: proposal.reason, basedOnVersion: proposal.base_version,
    })),
    targets: proposal.targets,
    depends_on: proposal.depends_on,
    base_version: proposal.base_version,
    status,
    conflict_reason: reason,
  }).select().single());
}

async function addCriticReview(projectId, userId, proposal, verdict, score, summary, issues = []) {
  await q(db.from('critic_reviews').insert({
    project_id: projectId, proposal_id: proposal.id, user_id: userId, verdict, score, summary, issues,
  }));
}

async function openWork(projectId, ids, version) {
  const priya = await startWork(projectId, ids, {
    by: 'priya', goal: 'Show three plans on the pricing page', paths: ['src/pages/Pricing.jsx', 'src/components/PlanCard.jsx'],
    baseVersion: version - 1, summary: 'Show three plans on the pricing page', dependsOn: ['req:audience'],
  });
  await addCriticReview(projectId, ids.priya, priya.proposal, 'approve', 91, 'Clean and matches the brief.');
  await requestReview(projectId, ids.priya, priya.proposal);

  const meera = await startWork(projectId, ids, {
    by: 'meera', goal: 'Add a yearly pricing toggle', paths: ['src/pages/Pricing.jsx'],
    baseVersion: version - 2, summary: 'Add a yearly pricing toggle', dependsOn: ['req:audience'],
  });
  await addCriticReview(projectId, ids.meera, meera.proposal, 'revise', 64, 'Works, but the toggle has no keyboard support.', [
    { severity: 'medium', path: 'src/pages/Pricing.jsx', message: 'The toggle cannot be reached with the keyboard.', suggestion: 'Use a real button with aria-pressed.' },
  ]);
  await requestReview(projectId, ids.meera, meera.proposal);

  const sam = await startWork(projectId, ids, {
    by: 'sam', goal: 'Add contact links to the footer', paths: ['src/components/Footer.jsx'],
    baseVersion: version, summary: 'Add contact links to the footer',
  });
  await requestReview(projectId, ids.sam, sam.proposal);

  const reason = 'Aarav Mehta changed the requirements (audience).';
  const ravi = await startWork(projectId, ids, {
    by: 'ravi', goal: 'Add order history for students', paths: ['api/orders.js'],
    baseVersion: version - 4, summary: 'Add order history for students', dependsOn: ['req:audience'], status: 'stale', staleReason: reason,
  });
  await requestReview(projectId, ids.ravi, ravi.proposal, { status: 'stale', reason });

  const nina = await startWork(projectId, ids, { by: 'nina', goal: 'Save plan choices for each customer', paths: ['api/plans.js', 'api/db.js'], baseVersion: version });
  await setAgentStatus(nina.agent.id, 'working', 'Save plan choices for each customer');

  const omar = await startWork(projectId, ids, { by: 'omar', goal: 'Add a cafe dashboard page', paths: ['src/pages/Dashboard.jsx'], baseVersion: version - 3 });
  await setAgentStatus(omar.agent.id, 'blocked', null);

  const samCritic = await getAgent(projectId, ids.sam, 'critic');
  await setAgentStatus(samCritic.id, 'working', 'Reviewing: Add contact links to the footer');

  const owner = await startWork(projectId, ids, {
    by: 'aarav', goal: 'Add a monthly and yearly switch to pricing', paths: ['src/components/Toggle.jsx'],
    baseVersion: version, summary: 'Add a monthly and yearly switch to pricing', status: 'draft',
  });
  await q(db.from('intents').update({ status: 'released', released_at: new Date().toISOString() }).eq('id', owner.proposal.intent_id));

  await rebucket(projectId);
}

async function addConversations(projectId, ids) {
  const admins = [ids.priya, ids.rohan];
  await q(db.from('messages').insert([
    { project_id: projectId, sender_id: ids.aarav, recipient_ids: admins, to_all: true, text: 'We are now targeting cafes, not students. Please re-plan anything that assumed the old audience.' },
    { project_id: projectId, sender_id: ids.aarav, recipient_ids: [ids.rohan], to_all: false, text: 'Can Ravi pick up order history next?' },
  ]));
  await notify(admins.map((id) => ({
    user_id: id, project_id: projectId, kind: 'owner_message', title: 'Message from Aarav Mehta', body: 'We are now targeting cafes, not students.',
  })));
  await q(db.from('observer_requests').insert({ project_id: projectId, observer_id: ids.kabir, message: 'A free trial banner on the home page' }));
  await q(db.from('join_requests').insert({ project_id: projectId, user_id: ids.tara, message: 'I can help with testing' }));
}

async function main() {
  refuseUnlessLocal();
  delete process.env.ANTHROPIC_API_KEY; // summaries fall back to plain text, so seeding never spends credits

  const ids = await createAccounts();
  const existing = await q(db.from('projects').select('id').eq('owner_id', ids.aarav).eq('name', PROJECT_NAME));
  if (existing.length) {
    console.log(`"${PROJECT_NAME}" already exists. To start over, reset the local database and seed again.`);
    return;
  }

  const project = await q(db.from('projects').insert({
    name: PROJECT_NAME,
    description: 'A website where small cafes take online orders',
    owner_id: ids.aarav,
    observer_code: makeCode('OBS'),
  }).select().single());
  await q(db.from('project_state').insert({ project_id: project.id, brief: {}, files: {} }));

  await addMembers(project.id, ids);
  await writeHistory(project.id, ids);
  await q(db.from('tasks').insert(TASKS.map(([who, title, status]) => ({
    project_id: project.id, title, status, assignee_id: ids[who], assigned_by: ids[PEOPLE[who].lead] || ids.aarav,
  }))));
  await openWork(project.id, ids, HISTORY.length);
  await addConversations(project.id, ids);

  console.log(`Seeded "${PROJECT_NAME}". Sign in at http://localhost:3000 as aarav@example.com (the password is at the top of scripts/seed.js).`);
}

await main();
