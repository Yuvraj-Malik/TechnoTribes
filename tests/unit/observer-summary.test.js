// The observer's plain-language progress. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWork, findOverlaps, mdBlocks, partName, plainText, plainUpdate, productMap, projectAbout, projectLine, reviewerOf, summarize, teamProgress } from '../../api/_lib/observer-summary.js';
import { brickSize, busiestPart, describePart, headline, layoutProjectLine, wallLayout, wallRows, wrapTitle } from '../../src/features/observer/progressModel.js';

const HOUR = 3600e3;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const ago = (h) => new Date(NOW - h * HOUR).toISOString();

const people = [
  { id: 'priya', name: 'Priya Sharma', role: 'owner', department: null },
  { id: 'arjun', name: 'Arjun Mehta', role: 'admin', department: 'website' },
  { id: 'kabir', name: 'Kabir Singh', role: 'worker', department: 'website' },
  { id: 'tara', name: 'Tara Nair', role: 'worker', department: 'content' },
  { id: 'meera', name: 'Meera Iyer', role: 'observer', department: null },
];
const departments = [{ id: 'website', name: 'Website', managerId: 'arjun' }, { id: 'content', name: 'Content', managerId: null }];
const nameOf = (id) => people.find((p) => p.id === id)?.name ?? 'Someone';

const dev = (id, userId, status, extra = {}) => ({
  id, userId, userName: nameOf(userId), status, text: `${id} work`, department: people.find((p) => p.id === userId).department,
  createdAt: ago(5), updatedAt: ago(1), peers: [], plan: null, changedFiles: [], summary: '', whyDraft: '', ...extra,
});

// LedgerLite: three things live, but only one of them came from an assigned task.
const ledger = () => ({
  tasks: [
    { id: 't-rupee', title: 'Show prices in rupees', description: null, assignee_id: 'kabir', status: 'done', dev_task_id: 'd-rupee', observer_request_id: 'r-rupee', created_at: ago(13) },
    { id: 't-trial', title: 'Add a 14-day free trial to pricing', description: 'No credit card.', assignee_id: 'kabir', status: 'in_review', dev_task_id: 'd-trial', observer_request_id: 'r-trial', created_at: ago(7) },
    { id: 't-faq', title: 'Add an FAQ section to the home page', description: null, assignee_id: 'tara', status: 'in_progress', dev_task_id: 'd-faq', observer_request_id: null, created_at: ago(4) },
    { id: 't-phone', title: 'Make the features grid stack on phones', description: null, assignee_id: 'kabir', status: 'in_progress', dev_task_id: 'd-phone', observer_request_id: null, created_at: ago(3) },
    { id: 't-about', title: 'Write the "About us" page copy', description: 'Under 150 words.', assignee_id: 'tara', status: 'open', dev_task_id: null, observer_request_id: null, created_at: ago(2) },
  ],
  devs: [
    dev('d-home', 'arjun', 'approved', { text: 'Landing page' }),
    dev('d-features', 'kabir', 'approved', { text: 'Add a features grid' }),
    dev('d-rupee', 'kabir', 'approved', { assignmentId: 't-rupee' }),
    dev('d-trial', 'kabir', 'submitted', { assignmentId: 't-trial', changedFiles: ['web/pricing.html', 'web/styles.css'] }),
    dev('d-faq', 'tara', 'done', { assignmentId: 't-faq', summary: 'Added an FAQ.', whyDraft: 'Owners ask.', changedFiles: ['web/index.html', 'web/styles.css'], peers: [{ taskId: 'd-phone', name: 'Kabir Singh', files: ['web/styles.css', 'web/index.html'] }] }),
    dev('d-phone', 'kabir', 'awaiting_plan_approval', { assignmentId: 't-phone', plan: { files: ['web/index.html', 'web/styles.css'] }, peers: [{ taskId: 'd-faq', name: 'Tara Nair', files: ['web/index.html', 'web/styles.css'] }] }),
  ],
  submissions: [
    { id: 's-home', taskId: 'd-home', title: 'Landing page: hero', summary: 'First home page.', why: 'Demo bookings.', status: 'approved', reviewedAt: ago(60), createdAt: ago(60) },
    { id: 's-features', taskId: 'd-features', title: 'Features grid', summary: 'Three cards.', why: 'Outcomes.', status: 'approved', reviewedAt: ago(30), createdAt: ago(32) },
    { id: 's-rupee', taskId: 'd-rupee', title: 'Pricing page with rupee plans', summary: 'A new Pricing page.', why: 'Meera asked.', status: 'approved', reviewedAt: ago(9), createdAt: ago(9) },
    { id: 's-trial', taskId: 'd-trial', title: 'Add a 14-day free trial to pricing', summary: 'Every plan has a trial.', why: 'Meera asked.', status: 'pending', createdAt: ago(6) },
  ],
  commits: [
    { id: 'c3', author_id: 'arjun', message: 'Pricing page with rupee plans', created_at: ago(9) },
    { id: 'c1', author_id: 'arjun', message: 'Landing page: hero', created_at: ago(60) },
    { id: 'c2', author_id: 'arjun', message: 'Kabir Singh\'s "Features grid"', created_at: ago(30) },
  ],
  requests: [
    { id: 'r-rupee', observer_id: 'meera', status: 'done', message: 'Rupees please', created_at: ago(14) },
    { id: 'r-trial', observer_id: 'meera', status: 'accepted', message: 'A free trial', created_at: ago(8) },
    { id: 'r-logos', observer_id: 'meera', status: 'pending', message: 'Could we show a few customer logos?', created_at: ago(1) },
  ],
  events: [{ actor_id: 'priya' }, { actor_id: 'priya' }, { actor_id: 'priya' }, { actor_id: 'priya' }, { actor_id: 'arjun' }],
  files: {
    'web/index.html': '<link rel="stylesheet" href="styles.css"><a href="pricing.html">Pricing</a><script src="app.js"></script>',
    'web/pricing.html': '<link href="styles.css"><a href="index.html">Home</a><a href="https://example.com">out</a><script src="app.js"></script>',
    'web/styles.css': 'body {}',
    'web/app.js': '',
    'README.md': '# Readme',
  },
  people, departments, nameOf, viewerId: 'meera', now: NOW,
});

const work = () => buildWork(ledger());
const piece = (id) => work().find((w) => w.id === id);

test('work finished without an assigned task still counts', () => {
  const { counts, work: all } = summarize(ledger());
  assert.deepEqual(counts, { done: 3, now: 3, upcoming: 1 });
  assert.equal(all.length, 7);
  assert.equal(all.find((w) => w.id === 'd-home').who, 'Arjun Mehta');
});

test('work given straight to an agent counts, and abandoned work does not', () => {
  const input = { ...ledger(), tasks: [], submissions: [], commits: [] };
  input.devs = [dev('a', 'kabir', 'working', { text: 'Add a footer. Keep it short.' }), dev('b', 'kabir', 'cancelled'), dev('c', 'tara', 'rejected'), dev('e', 'tara', 'approved')];
  const all = buildWork(input);
  assert.deepEqual(all.map((w) => [w.id, w.stage]), [['e', 'done'], ['a', 'now']]);
  assert.equal(all[1].title, 'Add a footer', 'a long brief becomes its first sentence');
});

test('anything on the live site counts, even with no task or agent work behind it', () => {
  const all = buildWork({ commits: [{ id: 'c1', author_id: 'priya', message: 'Initial project', created_at: ago(9) }], people, nameOf });
  assert.deepEqual(all.map((w) => [w.title, w.who, w.stage, w.version]), [['Initial project', 'Priya Sharma', 'done', 1]]);
  assert.equal(summarize(ledger()).work.filter((w) => w.version).length, 3, 'work that has a submission is not counted twice');
});

test('file names in what an agent wrote become part names', () => {
  assert.equal(plainText('Adds web/js/saved-card.js: stores the token.'), 'Adds Saved card actions: stores the token.');
  assert.equal(plainText('Changed web/index.html and styles.css.'), 'Changed Home page and Look and feel.');
  assert.equal(plainText('Built on Node.js and v2.0 of the rules.'), 'Built on Node.js and v2.0 of the rules.');
  assert.equal(plainText(''), null);
  assert.equal(plainText(undefined), null);
  const [w] = buildWork({ devs: [dev('x', 'kabir', 'done', { summary: 'Edited web/index.html.' })], people, departments, nameOf });
  assert.equal(w.what, 'Edited Home page.');
});

const sections = [
  { id: 'brief', scope: 'central', title: 'Project brief', content: 'A bookkeeping site. See web/index.html.', version: 1, why: 'Set up', updatedBy: 'priya', updatedAt: ago(70), guardrails: [{ phrase: 'dollar', note: 'Secret guardrail' }] },
  { id: 'pricing', scope: 'central', title: 'Pricing rules', content: 'Prices in rupees.', version: 2, why: 'Meera asked', updatedBy: 'priya', updatedAt: ago(6), guardrails: [] },
  { id: 'tone', scope: 'central', title: 'Tone of voice', content: 'Plain words.', version: 1, why: 'First draft', updatedBy: 'priya', updatedAt: ago(70), guardrails: [] },
  { id: 'design', scope: 'website', title: 'Design rules', content: 'Department only text.', version: 1, why: '', updatedBy: 'arjun', updatedAt: ago(70), guardrails: [] },
];

test('a piece lists the rules it was built on, and flags open work that fell behind', () => {
  const built = { sections: { pricing: 1, brief: 1 } };
  const devs = [dev('old', 'kabir', 'working', { relevantSectionIds: ['pricing', 'brief', 'gone'], builtOn: built }), dev('live', 'tara', 'approved', { relevantSectionIds: ['pricing'], builtOn: built })];
  const byId = Object.fromEntries(buildWork({ devs, sections, people, departments, nameOf }).map((w) => [w.id, w.rules]));
  assert.deepEqual(byId.old, [{ id: 'pricing', title: 'Pricing rules', version: 1, changed: true }, { id: 'brief', title: 'Project brief', version: 1, changed: false }]);
  assert.equal(byId.live[0].changed, false, 'live work is settled');
  assert.deepEqual(buildWork({ commits: [{ id: 'c', message: 'x', created_at: ago(1) }], nameOf })[0].rules, []);
});

test('the about section shares central context only, in plain words', () => {
  const technical = { id: 'api', scope: 'central', title: 'Order API contract', content: 'POST /api/orders', version: 1, guardrails: [] };
  const about = projectAbout({ sections: [...sections, technical], nameOf });
  assert.equal(about.brief, 'A bookkeeping site. See Home page.');
  assert.deepEqual(about.rules.map((r) => [r.title, r.who, r.why]), [['Pricing rules', 'Priya', 'Meera asked'], ['Tone of voice', 'Priya', null]]);
  assert.equal(about.teamRules, 2, 'the department rule and the technical one');
  assert.doesNotMatch(JSON.stringify(about), /Department only text|Secret guardrail|POST \/api/);
  assert.equal(projectAbout({ description: 'From the project' }).brief, 'From the project');
  assert.deepEqual(projectAbout({}), { brief: null, rules: [], teamRules: 0, milestones: [], notes: [], docs: [] });
});

test('context kinds become the plan, milestones and progress notes', () => {
  const item = (id, kind, scope, title, content, at) => ({ id, kind, scope, title, content, version: 1, updatedBy: 'tara', updatedAt: ago(at), guardrails: [] });
  const about = projectAbout({
    departments, nameOf,
    sections: [
      item('goal', 'goal', 'central', 'Product goal', 'Fast ordering.', 9),
      item('rule', 'must_not', 'central', 'Never handle card numbers', 'Use the gateway.', 9),
      item('old', 'checkpoint', 'central', 'Menu live', 'Students can browse.', 8),
      item('new', 'checkpoint', 'central', 'Cart live', 'Students can order.', 2),
      item('note', 'progress', 'content', 'FAQ drafted', 'Secret detail in web/faq.html', 1),
      item('team', 'decision', 'content', 'Copy rules', 'Team only.', 9),
    ],
  });
  assert.equal(about.brief, 'Fast ordering.', 'the first goal stands in for a brief');
  assert.deepEqual(about.rules.map((r) => [r.label, r.title]), [['Must not', 'Never handle card numbers']]);
  assert.deepEqual(about.milestones.map((m) => m.title), ['Cart live', 'Menu live']);
  assert.deepEqual(about.notes.map(({ title, team, who }) => [title, team, who]), [['FAQ drafted', 'Content', 'Tara']]);
  assert.equal(about.teamRules, 1);
  assert.doesNotMatch(JSON.stringify(about.notes), /Secret detail/);
});

test('a declined request is not finished work, and drafts wait to be assigned', () => {
  const tasks = [
    { id: 'no', title: 'Declined', assignee_id: null, status: 'done', declined_reason: 'Not now', created_at: ago(2) },
    { id: 'draft', title: 'Draft from the planner', assignee_id: null, status: 'open', source: 'orchestrator', created_at: ago(1) },
  ];
  const all = buildWork({ tasks, people, nameOf });
  assert.deepEqual(all.map((w) => [w.id, w.stage, w.who, w.userId]), [['draft', 'upcoming', 'Not assigned yet', null]]);
  assert.equal(plainUpdate({ work: all }).next[0].words, 'Waiting to be assigned.');
  assert.equal(productMap({ work: all }).planned[0].who, null);
});

test('Markdown files in the project become readable documents', () => {
  const files = { 'docs/plan.md': 'No heading here.', 'web/index.html': '<p>', 'README.md': '# LedgerLite\n\nOne line\nwrapped over two.\n\n## Parts\n\n- **Site** in `web/index.html`\n1. [Docs](https://x.y)\n\n---\n' };
  const { docs } = projectAbout({ files });
  assert.deepEqual(docs.map((d) => d.title), ['LedgerLite', 'Plan']);
  assert.deepEqual(docs[0].blocks, [
    { kind: 'text', text: 'One line wrapped over two.' },
    { kind: 'heading', text: 'Parts' },
    { kind: 'item', text: 'Site in Home page' },
    { kind: 'item', text: 'Docs' },
  ]);
  assert.deepEqual(docs[1].blocks, [{ kind: 'text', text: 'No heading here.' }]);
  assert.deepEqual(mdBlocks(''), []);
  assert.equal(projectAbout({ files: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i}.md`, 'x'])) }).docs.length, 8);
});

test('a task and the agent work carrying it out are one piece', () => {
  assert.equal(work().filter((w) => w.title.includes('rupees') || w.title.includes('Pricing page')).length, 1);
});

test('the wall reads from live, through closest to live, to not started', () => {
  assert.deepEqual(work().map((w) => w.id), ['d-home', 'd-features', 't-rupee', 't-trial', 't-faq', 't-phone', 't-about']);
});

test('finished work knows the version it went live in, oldest commit first', () => {
  assert.equal(piece('d-home').version, 1);
  assert.equal(piece('t-rupee').version, 3);
  assert.equal(piece('d-features').statusWords, 'Live since version 2.');
});

test('each piece says where it is and whose turn it is, in plain words', () => {
  assert.equal(piece('t-trial').statusWords, 'Built. Waiting for Arjun to approve.');
  assert.equal(piece('t-trial').waitingOn.userId, 'arjun');
  assert.equal(piece('t-faq').statusWords, 'AI agent finished. Tara is checking it.');
  assert.equal(piece('t-phone').statusWords, 'Plan ready. Kabir needs to OK it.');
  assert.equal(piece('t-about').statusWords, 'Not started.');
  assert.ok(piece('t-trial').fromYourRequest);
  assert.equal(piece('t-faq').what, 'Added an FAQ.', 'the agent summary shows before anything is submitted');
});

test('every agent status has plain words, and the agent working needs nobody', () => {
  const statuses = { needs_action_approval: 1, reading_context: 0, checking_conflicts: 0, planning: 0, needs_conflict_decision: 0, awaiting_plan_approval: 0, working: 1, needs_context_decision: 1, failed: 1, sent_back: 1, done: 2, submitted: 3 };
  for (const [status, step] of Object.entries(statuses)) {
    const [w] = buildWork({ devs: [dev('x', 'kabir', status)], people, departments, nameOf });
    assert.equal(w.step, step, status);
    assert.doesNotMatch(w.statusWords, /_|context|merge|commit|submit/i, status);
  }
  const busy = buildWork({ devs: [dev('x', 'kabir', 'working')], people, departments, nameOf })[0];
  assert.equal(busy.waitingOn, null);
});

test('work clashing with newer work waits on its reviewer', () => {
  const [w] = buildWork({ devs: [dev('x', 'kabir', 'submitted')], submissions: [{ id: 's', taskId: 'x', title: 'Thing', status: 'merge_conflict', createdAt: ago(2) }], people, departments, nameOf });
  assert.equal(w.statusWords, 'Built. Arjun is sorting out a clash with newer work.');
});

test('a department with no manager is reviewed by the owner', () => {
  assert.equal(reviewerOf('content', departments, people).id, 'priya');
  assert.equal(reviewerOf('website', departments, people).id, 'arjun');
  const [w] = buildWork({ devs: [dev('x', 'tara', 'submitted')], people, departments, nameOf });
  assert.equal(w.waitingOn.userId, 'priya');
  assert.equal(reviewerOf('content', [], [])?.id, undefined);
  assert.match(buildWork({ devs: [dev('x', 'tara', 'submitted')], people: [people[3]], nameOf: () => 'Tara' })[0].statusWords, /A manager/);
});

test('an unlinked or hand-moved task still gets words', () => {
  const tasks = [
    { id: 'a', title: 'A', assignee_id: 'kabir', status: 'in_progress', created_at: ago(1) },
    { id: 'b', title: 'B', assignee_id: 'kabir', status: 'in_review', created_at: ago(1) },
    { id: 'c', title: 'C', assignee_id: 'kabir', status: 'done', created_at: ago(1) },
  ];
  const words = Object.fromEntries(buildWork({ tasks, people, nameOf }).map((w) => [w.id, w.statusWords]));
  assert.deepEqual(words, { a: 'Being built right now.', b: 'Built. Waiting for a manager to approve.', c: 'Finished and live.' });
});

test('one row per person, in role order, without the investor', () => {
  const rows = summarize(ledger()).people;
  assert.deepEqual(rows.map((r) => r.name), ['Priya Sharma', 'Arjun Mehta', 'Kabir Singh', 'Tara Nair']);
  assert.deepEqual(rows.map((r) => r.title), ['Project owner', 'Website manager', 'Website developer', 'Content developer']);
  assert.equal(rows[2].pieces.length, 4);
  assert.equal(rows[0].rules, 4);
});

test('a job title wins over the role when one is set', () => {
  const titled = people.map((p) => (p.id === 'kabir' ? { ...p, designation: 'Frontend engineer' } : p));
  const rows = teamProgress({ people: titled, departments, work: [] });
  assert.equal(rows.find((r) => r.name === 'Kabir Singh').title, 'Frontend engineer');
});

test('next says what each person has to do, and the owner answers open requests', () => {
  const rows = summarize(ledger()).people;
  const next = Object.fromEntries(rows.map((r) => [r.name.split(' ')[0], r.next?.words]));
  assert.equal(next.Arjun, 'Approve "Add a 14-day free trial to pricing"');
  assert.equal(next.Kabir, 'OK the plan for "Make the features grid stack on phones"');
  assert.equal(next.Tara, 'Check "Add an FAQ section to the home page" and send it for approval');
  assert.equal(next.Priya, 'Decide on your request');
  const other = teamProgress({ people, departments, requests: [{ status: 'pending', observer_id: 'someone', created_at: ago(1) }], viewerId: 'priya' });
  assert.equal(other[0].next.words, 'Decide on a request from the investor');
  const two = teamProgress({ people, departments, requests: [{ status: 'pending', created_at: ago(1) }, { status: 'pending', created_at: ago(2) }] });
  assert.equal(two[0].next.words, 'Decide on 2 requests');
});

test('the update covers the last day, and falls back to the latest finished work', () => {
  const update = summarize(ledger()).update;
  assert.deepEqual(update.finished.map((f) => [f.title, f.words]), [['Show prices in rupees', 'Kabir finished it, as you asked.']]);
  assert.deepEqual(update.now.map((n) => n.words)[0], 'Built. Waiting for Arjun to approve.');
  assert.deepEqual(update.next.map((n) => n.words), ['Tara is next.', '"Could we show a few customer logos?" is waiting for a decision.']);
  const quiet = plainUpdate({ work: work(), now: NOW + 100 * HOUR });
  assert.equal(quiet.finished.length, 1);
  assert.equal(quiet.finished[0].title, 'Show prices in rupees');
  assert.deepEqual(plainUpdate({}), { finished: [], now: [], next: [], notes: [] });
});

test('an overlap is one note, about the page, and only while both people are working', () => {
  const { devs } = ledger();
  const found = findOverlaps(devs);
  assert.equal(found.length, 1);
  assert.equal(found[0].part, 'Home page');
  assert.match(summarize(ledger()).update.notes[0], /^Tara and Kabir are both changing the Home page\. Their AI agents warned them/);
  const finished = devs.map((d) => (d.id === 'd-phone' ? { ...d, status: 'approved' } : d));
  assert.deepEqual(findOverlaps(finished), []);
});

test('files get names a person would use', () => {
  assert.equal(partName('web/index.html'), 'Home page');
  assert.equal(partName('web/pricing.html'), 'Pricing page');
  assert.equal(partName('web/order-status.html'), 'Order status page');
  assert.equal(partName('web/styles.css'), 'Look and feel');
  assert.equal(partName('web/print.css'), 'Print look and feel');
  assert.equal(partName('web/app.js'), 'Buttons and actions');
  assert.equal(partName('web/js/checkout.js'), 'Checkout actions');
  assert.equal(partName('config/payments.json'), 'Payments');
});

test('the map shows pages and what they share, with no file paths', () => {
  const map = summarize(ledger()).map;
  assert.deepEqual(map.parts.map((p) => [p.name, p.kind]), [['Home page', 'page'], ['Pricing page', 'page'], ['Buttons and actions', 'shared'], ['Look and feel', 'shared']]);
  assert.equal(map.links.length, 4);
  assert.deepEqual(map.parts.find((p) => p.name === 'Home page').people, ['Tara', 'Kabir']);
  assert.deepEqual(map.parts.find((p) => p.name === 'Buttons and actions').people, []);
  assert.deepEqual(map.planned.map((p) => p.who), ['Tara']);
  assert.equal(map.hidden, 1, 'the readme is behind the scenes');
  assert.doesNotMatch(JSON.stringify(map), /web\/|\.html|\.css|\.js\b/);
});

test('a page still being built appears on the map as new', () => {
  const { files } = ledger();
  const map = productMap({ files, devs: [dev('x', 'kabir', 'working', { plan: { files: ['web/about.html'] } })] });
  const about = map.parts.find((p) => p.name === 'About page');
  assert.equal(about.isNew, true);
  assert.deepEqual(about.people, ['Kabir']);
  assert.deepEqual(productMap({}).parts, []);
});

test('links resolve from the page that makes them, and external ones are ignored', () => {
  const map = productMap({ files: { 'web/shop/cart.html': '<link href="../css/site.css"><link href="//cdn.example.com/x.css">', 'web/css/site.css': '' } });
  assert.deepEqual(map.parts.map((p) => p.name), ['Cart page', 'Site look and feel']);
  assert.equal(map.links.length, 1);
});

test('the line credits whoever built each version, not whoever merged it', () => {
  const { versions, tracks, planned, overlaps } = summarize(ledger()).line;
  assert.deepEqual(versions.map((v) => [v.version, v.title, v.who]), [
    [1, 'Landing page: hero', 'Arjun Mehta'], [2, 'Features grid', 'Kabir Singh'], [3, 'Show prices in rupees', 'Kabir Singh'],
  ]);
  assert.deepEqual(tracks.map((t) => t.step), [3, 2, 0]);
  assert.equal(planned.length, 1);
  assert.deepEqual(overlaps, [{ pieces: ['t-faq', 't-phone'], part: 'Home page' }]);
  const stray = projectLine({ commits: [{ author_id: 'arjun', message: 'Kabir Singh\'s "Hotfix"', created_at: ago(1) }], nameOf });
  assert.deepEqual([stray.versions[0].title, stray.versions[0].who], ['Hotfix', 'Arjun Mehta']);
});

test('the headline leads with the answer and reads correctly at every count', () => {
  assert.deepEqual(headline({ done: 3, now: 3, upcoming: 1 }), { lead: '3 of 7', rest: 'pieces are live.', detail: 'That is 43% of the work planned so far. 3 more are being finished and 1 has not started.' });
  assert.equal(headline({ done: 1, now: 1 }).rest, 'pieces is live.');
  assert.equal(headline({ done: 1 }).rest, 'piece is live.');
  assert.equal(headline({ done: 2 }).detail, 'Everything planned so far is live.');
  assert.equal(headline({ now: 2, upcoming: 2 }).detail, '2 are being finished and 2 have not started.');
  assert.equal(headline({ done: 1, now: 1 }).detail, 'That is 50% of the work planned so far. 1 more is being finished.');
  assert.equal(headline({ upcoming: 1 }).detail, '1 has not started.');
  assert.equal(headline({}), null);
  assert.equal(headline(), null);
});

test('the wall starts at the bottom and every other row is staggered', () => {
  const rows = wallRows(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3);
  assert.deepEqual(rows.map((r) => r.bricks), [['g'], ['d', 'e', 'f'], ['a', 'b', 'c']]);
  assert.deepEqual(rows.map((r) => r.offset), [false, true, false]);
  assert.deepEqual(wallRows([], 3), []);
});

test('a staggered row exactly fills the wall', () => {
  const evaluate = (expr, width) => Function(`return ${expr.replace('calc', '').replaceAll('100%', width).replaceAll('px', '')}`)();
  for (const perRow of [2, 3, 5, 7]) {
    const { width, shift } = brickSize(perRow);
    const w = 480;
    assert.ok(Math.abs(evaluate(shift, w) + perRow * evaluate(width, w) + (perRow - 1) * 4 - w) < 0.01, `${perRow} a row`);
  }
});

test('bricks lose their names only when there are too many to read', () => {
  assert.deepEqual(wallLayout(7, 500), { named: true, perRow: 3 });
  assert.deepEqual(wallLayout(7, 320), { named: true, perRow: 2 });
  assert.deepEqual(wallLayout(7, 0), { named: true, perRow: 3 }, 'not measured yet');
  assert.deepEqual(wallLayout(40, 500), { named: false, perRow: 7 });
  assert.deepEqual(wallLayout(40, 320), { named: false, perRow: 5 });
});

test('titles wrap to two lines and long ones are clipped', () => {
  assert.deepEqual(wrapTitle('Rupee pricing'), ['Rupee pricing']);
  assert.deepEqual(wrapTitle('Landing page: hero and "Book a free demo"'), ['Landing page: hero', 'and "Book a free…']);
  assert.ok(wrapTitle('Landing page: hero and "Book a free demo"').every((line) => line.length <= 18));
  assert.ok(wrapTitle('one two three four five six seven eight nine ten eleven twelve thirteen')[1].endsWith('…'));
  assert.equal(wrapTitle('one two three four five six seven eight nine ten eleven twelve thirteen').length, 2);
});

test('the project line handles a project at any stage', () => {
  const empty = layoutProjectLine({});
  assert.deepEqual([empty.stops.length, empty.tracks.length, empty.showNext, empty.planned], [0, 0, false, null]);
  assert.ok(layoutProjectLine({ planned: [{ title: 'First', who: 'Tara' }] }).showNext);

  const versions = [1, 2, 3, 4, 5].map((v) => ({ version: v, title: `V${v}` }));
  const many = layoutProjectLine({ versions, tracks: Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, title: 'T', step: 0 })) });
  assert.deepEqual(many.stops.map((s) => s.version), [3, 4, 5]);
  assert.equal(many.earlier, 2);
  assert.equal(many.tracks.length, 5);
  assert.equal(many.hiddenTracks, 2);

  const { versions: v, tracks, planned, overlaps } = summarize(ledger()).line;
  const line = layoutProjectLine({ versions: v, tracks, planned, overlaps });
  assert.deepEqual(line.tracks.map((t) => t.tip), [880, 787, 600], 'further along sits further right');
  assert.ok(line.tracks.every((t) => t.y < line.mainY));
  assert.equal(line.overlap.part, 'Home page');
  assert.ok(line.overlap.top < line.overlap.bottom);
  assert.ok(line.height > line.mainY + 60, 'room for labels under the line');
  assert.equal(layoutProjectLine({ tracks, overlaps: [{ pieces: ['gone', 'also-gone'], part: 'x' }] }).overlap, null);
});

test('the product map explains each part in a sentence', () => {
  const { map } = summarize(ledger());
  const named = (n) => map.parts.find((p) => p.name === n);
  assert.equal(describePart(named('Look and feel'), map), 'A change to Look and feel also shows up on the Home page and the Pricing page. Kabir and Tara are changing it now.');
  assert.equal(describePart(named('Pricing page'), map), 'The Pricing page relies on Look and feel, Buttons and actions. Kabir is changing it now.');
  assert.equal(describePart(named('Buttons and actions'), map).endsWith('Nobody is changing it now.'), true);
  assert.equal(busiestPart(map).name, 'Look and feel');
  assert.equal(busiestPart({ parts: [] }), null);
  assert.equal(describePart({ id: 'x', name: 'Cart page', kind: 'page', people: [], isNew: true }, { parts: [], links: [] }), 'The Cart page is new and not live yet. Nobody is changing it now.');
  assert.equal(describePart({ id: 'x', name: 'Cart page', kind: 'page', people: [] }, { parts: [], links: [] }), 'The Cart page stands on its own. Nobody is changing it now.');
});
