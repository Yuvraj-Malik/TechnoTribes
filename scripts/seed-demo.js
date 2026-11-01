// Demo data: 5 real logins, 4 projects, and LedgerLite fully filled in
// (departments, versioned context, approved files, assigned tasks, agent work,
// a submission waiting for review, observer requests, activity, notifications).
//
//   npm run seed:demo                     keeps existing passwords and projects
//   npm run seed:demo -- --reset-passwords puts demo passwords back to Demo@1234
//   npm run seed:demo -- --fresh           rebuilds LedgerLite from scratch
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, and every
// migration applied (npm run db:push, up to 005_unify.sql).
import { createClient } from '@supabase/supabase-js';
import * as L from './demo-ledgerlite.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!url || !key) && !globalThis.__TEST_DB__) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local first.');
  process.exit(1);
}
const db = globalThis.__TEST_DB__ ?? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

export const PASSWORD = 'Demo@1234';
// `npm run seed:demo -- --reset-passwords` puts existing demo accounts back to PASSWORD.
const RESET_PASSWORDS = process.argv.includes('--reset-passwords');
export const PEOPLE = {
  owner: { email: 'priya.owner@demo.buildify.dev', name: 'Priya Sharma' },
  admin: { email: 'arjun.admin@demo.buildify.dev', name: 'Arjun Mehta' },
  worker: { email: 'kabir.worker@demo.buildify.dev', name: 'Kabir Singh' },
  observer: { email: 'meera.observer@demo.buildify.dev', name: 'Meera Iyer' },
  worker2: { email: 'tara.worker@demo.buildify.dev', name: 'Tara Nair' },
};
const FRESH = process.argv.includes('--fresh');

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

async function must(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listing users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit || data.users.length < 200) return hit || null;
  }
  return null;
}

async function ensureUser({ email, name }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    // Changing a password signs that person out everywhere, so only do it when asked.
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      ...(RESET_PASSWORDS ? { password: PASSWORD } : {}),
      email_confirm: true, user_metadata: { display_name: name },
    });
    if (error) throw new Error(`updating ${email}: ${error.message}`);
    await must(db.from('profiles').upsert({ id: existing.id, email, display_name: name }), `profile ${email}`);
    return existing.id;
  }
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name },
  });
  if (error) throw new Error(`creating ${email}: ${error.message}`);
  // The signup trigger creates the profile; upsert in case it ran without the name.
  await must(db.from('profiles').upsert({ id: data.user.id, email, display_name: name }), `profile ${email}`);
  return data.user.id;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function projectByCode(code) {
  const rows = await must(db.from('projects').select('id,name').eq('project_code', code), `looking up ${code}`);
  return rows[0] || null;
}

async function addMember(projectId, userId, role, department = null, status = 'active') {
  await must(db.from('project_members').upsert(
    { project_id: projectId, user_id: userId, role, status, ...(department ? { department } : {}) },
    { onConflict: 'project_id,user_id' },
  ), `member ${role}`);
}

/** A project made the same way the app makes one (General department + brief section). */
async function createProject(lib, { name, description, ownerId, projectCode, observerCode, brief }) {
  const { project } = await lib.projects.create({
    user: { id: ownerId, email: '', user_metadata: {} },
    body: { name, description, brief: brief ? { product: brief } : undefined },
  });
  await must(db.from('projects').update({ project_code: projectCode, observer_code: observerCode }).eq('id', project.id), 'codes');
  return project;
}

// ---------------------------------------------------------------------------
// LedgerLite: the fully filled project
// ---------------------------------------------------------------------------
async function seedLedgerLite(ids, lib) {
  const existing = await projectByCode('PRJ-LEDGER26');
  if (existing) {
    const marker = await must(db.from('departments').select('slug').eq('project_id', existing.id).eq('slug', 'content'), 'marker');
    if (marker.length && !FRESH) {
      console.log('  LedgerLite already filled in, keeping it (add --fresh to rebuild it).');
      return existing;
    }
    console.log('  Rebuilding LedgerLite on the new team model…');
    await must(db.from('projects').delete().eq('id', existing.id), 'delete old LedgerLite');
  }

  const h = hoursAgo;
  const { writeAll, diffMaps, BASE } = lib.files;
  const { insertSection } = lib.context;
  const { devTasks, workSubmissions } = lib.records;
  const name = { [ids.owner]: PEOPLE.owner.name, [ids.admin]: PEOPLE.admin.name, [ids.worker]: PEOPLE.worker.name, [ids.observer]: PEOPLE.observer.name, [ids.worker2]: PEOPLE.worker2.name };

  const p = await createProject(lib, {
    name: 'LedgerLite', description: 'Marketing website for a bookkeeping app for Indian small businesses. Goal: demo bookings.',
    ownerId: ids.owner, projectCode: 'PRJ-LEDGER26', observerCode: 'OBS-LEDGER26', brief: L.BRIEF,
  });
  const pid = p.id;
  await must(db.from('projects').update({ created_at: h(74) }).eq('id', pid), 'created_at');

  // Departments: General becomes "Website" (Arjun manages it); "Content" has no manager, so the owner reviews it.
  await must(db.from('departments').update({ slug: 'website', name: 'Website', color: '#1b7f4a', manager_id: ids.admin }).eq('project_id', pid).eq('slug', 'general'), 'website dept');
  await must(db.from('scope_versions').delete().eq('project_id', pid).eq('scope', 'general'), 'old scope');
  await must(db.from('activity_log').update({ at: h(74), summary: 'Priya Sharma created the project LedgerLite' }).eq('project_id', pid).eq('type', 'seed'), 'created event');
  await must(db.from('departments').insert({ project_id: pid, slug: 'content', name: 'Content', color: '#b45309', paths: [], position: 1 }), 'content dept');

  await addMember(pid, ids.admin, 'admin', 'website');
  await addMember(pid, ids.worker, 'worker', 'website');
  await addMember(pid, ids.worker2, 'worker', 'content');
  await addMember(pid, ids.observer, 'observer');

  // Context: the brief already exists (v1); the rest with their version history.
  let pos = 1;
  for (const s of L.SECTIONS(ids, h)) {
    await insertSection(pid, { ...s, guardrails: s.guardrails ?? [] }, pos++, s.history);
  }
  await must(db.from('scope_versions').upsert([
    { project_id: pid, scope: 'central', version: 4 },
    { project_id: pid, scope: 'website', version: 1 },
    { project_id: pid, scope: 'content', version: 1 },
  ], { onConflict: 'project_id,scope' }), 'scope versions');
  const builtOnOld = { scopes: { central: 3, website: 1 }, sections: { 'c-brief': 1, 'c-pricing': 1, 'web-design': 1, 'web-structure': 1 } };
  const builtOnNow = { scopes: { central: 4, website: 1 }, sections: { 'c-brief': 1, 'c-pricing': 2, 'web-design': 1, 'web-structure': 1 } };

  // Approved files and their commit history (v1 → v3).
  await writeAll(pid, 'main', L.MAIN_V3);
  await must(db.from('main_commits').insert([
    { project_id: pid, author_id: ids.admin, message: 'Landing page: hero and "Book a free demo"', files: Object.keys(L.MAIN_V1), created_at: h(60) },
    { project_id: pid, author_id: ids.worker, message: "Kabir Singh's \"Features grid with three benefits\"", files: ['web/index.html', 'web/styles.css'], created_at: h(30) },
    { project_id: pid, author_id: ids.worker, message: 'Pricing page with rupee plans', files: ['web/pricing.html', 'web/styles.css'], created_at: h(9) },
  ]), 'commits');

  // Every developer has their own workspace, starting from main.
  for (const uid of [ids.worker, ids.worker2]) {
    await writeAll(pid, uid, L.MAIN_V3);
    await writeAll(pid, BASE(uid), L.MAIN_V3);
  }

  // Observer requests.
  const [trialReq, logosReq, rupeeReq] = await must(db.from('observer_requests').insert([
    { project_id: pid, observer_id: ids.observer, message: 'Visitors keep asking if they can try it first. Can the pricing page say clearly that there is a free trial?', status: 'accepted', admin_id: ids.admin, created_at: h(8), updated_at: h(7) },
    { project_id: pid, observer_id: ids.observer, message: 'Could we show a few customer logos under the headline? It would help people trust us.', status: 'pending', created_at: h(1.2), updated_at: h(1.2) },
    { project_id: pid, observer_id: ids.observer, message: 'Please show prices in rupees, not dollars.', status: 'done', admin_id: ids.owner, response: 'Done: the new pricing page shows ₹ for every plan.', created_at: h(14), updated_at: h(9) },
  ]).select(), 'observer requests');

  // Assigned tasks.
  const tasks = await must(db.from('tasks').insert([
    { project_id: pid, title: 'Add a 14-day free trial to pricing', description: 'From Meera\'s request. Make the trial obvious on every plan; no credit card.', assignee_id: ids.worker, assigned_by: ids.admin, department: 'website', status: 'in_review', targets: [], observer_request_id: trialReq.id, created_at: h(7) },
    { project_id: pid, title: 'Make the features grid stack on phones', description: 'Below 640px the three cards should be one column.', assignee_id: ids.worker, assigned_by: ids.admin, department: 'website', status: 'in_progress', targets: [], created_at: h(3) },
    { project_id: pid, title: 'Add an FAQ section to the home page', description: 'Three questions owners ask most, in plain words.', assignee_id: ids.worker2, assigned_by: ids.owner, department: 'content', status: 'in_progress', targets: [], created_at: h(4) },
    { project_id: pid, title: 'Show prices in rupees', description: null, assignee_id: ids.worker, assigned_by: ids.owner, department: 'website', status: 'done', targets: [], observer_request_id: rupeeReq.id, created_at: h(13) },
    { project_id: pid, title: 'Write the "About us" page copy', description: 'Who we are and why we built LedgerLite, under 150 words.', assignee_id: ids.worker2, assigned_by: ids.owner, department: 'content', status: 'open', targets: [], created_at: h(2) },
  ]).select(), 'tasks');
  const byTitle = (t) => tasks.find((x) => x.title.startsWith(t));
  await must(db.from('observer_requests').update({ task_id: byTitle('Add a 14-day').id }).eq('id', trialReq.id), 'link trial');
  await must(db.from('observer_requests').update({ task_id: byTitle('Show prices').id }).eq('id', rupeeReq.id), 'link rupees');

  // Kabir: the free-trial change, submitted and waiting for Arjun.
  const trial = diffMaps(L.MAIN_V3, { ...L.MAIN_V3, ...L.KABIR_TRIAL });
  const trialTaskId = devTasks.newId();
  const trialSubId = workSubmissions.newId();
  const msg = (from, text, at) => ({ from, text, at });
  await devTasks.put({
    id: trialTaskId, projectId: pid, userId: ids.worker, userName: name[ids.worker], department: 'website',
    text: 'Add a 14-day free trial to pricing. Make the trial obvious on every plan; no credit card.', status: 'submitted',
    relevantSectionIds: ['c-brief', 'c-pricing', 'web-design', 'web-structure'], conflicts: [],
    plan: { understanding: 'Show a 14-day free trial on the pricing page: the intro line, the plan buttons and a note on what happens after.', steps: ['Change the pricing intro to mention the trial', 'Rename the Starter and Growth buttons to "Start 14-day trial"', 'Add a note about what happens after 14 days'], files: trial.files },
    summary: 'The pricing page now says every plan starts with a 14-day free trial with no credit card, and the main buttons say "Start 14-day trial".',
    whyDraft: 'Meera asked for a clear free trial; the pricing rules now include it.', changedFiles: trial.files, contextAlert: null, builtOn: builtOnNow,
    messages: [
      msg('developer', 'Add a 14-day free trial to pricing. Make the trial obvious on every plan; no credit card.', h(6.5)),
      msg('agent', 'I read 4 context sections that relate to this task: Project brief v1, Pricing rules v2, Design rules v1, Files and structure v1.', h(6.5)),
      msg('agent', 'No conflicts: Pricing rules v2 already say every plan starts with a 14-day free trial.', h(6.5)),
      msg('agent', 'Done. I changed web/pricing.html and web/styles.css.', h(6.2)),
      msg('system', 'Submitted for review.', h(6)),
    ],
    submissionId: trialSubId, reviewNote: null, resumeStatus: null, assignmentId: byTitle('Add a 14-day').id, peers: [], createdAt: h(6.5), updatedAt: h(6),
  });
  await workSubmissions.put({
    id: trialSubId, projectId: pid, taskId: trialTaskId, userId: ids.worker, userName: name[ids.worker], department: 'website',
    title: 'Add a 14-day free trial to pricing', summary: 'The pricing page now says every plan starts with a 14-day free trial with no credit card, and the main buttons say "Start 14-day trial".',
    why: 'Meera asked for a clear free trial; the pricing rules now include it.', diff: trial.diff, files: trial.files, builtOn: builtOnNow, status: 'pending',
    base: Object.fromEntries(trial.files.map((f) => [f, L.MAIN_V3[f] ?? null])), changes: Object.fromEntries(trial.files.map((f) => [f, L.KABIR_TRIAL[f] ?? null])),
    reviewNote: null, reviewedBy: null, reviewedAt: null, mergeInfo: null, createdAt: h(6),
  });
  await must(db.from('tasks').update({ dev_task_id: trialTaskId }).eq('id', byTitle('Add a 14-day').id), 'link trial task');

  // Kabir now: planning the mobile grid, waiting for him to approve the plan.
  const gridTaskId = devTasks.newId();
  const gridFiles = ['web/index.html', 'web/styles.css'];
  // Tara: FAQ on the home page, agent finished; the same files as Kabir's plan, so both were warned.
  const faq = diffMaps(L.MAIN_V3, { ...L.MAIN_V3, ...L.TARA_FAQ });
  const faqTaskId = devTasks.newId();
  await devTasks.put({
    id: gridTaskId, projectId: pid, userId: ids.worker, userName: name[ids.worker], department: 'website',
    text: 'Make the features grid stack on phones. Below 640px the three cards should be one column.', status: 'awaiting_plan_approval',
    relevantSectionIds: ['c-brief', 'web-design', 'web-structure'], conflicts: [],
    plan: { understanding: 'Add a mobile rule so the features grid (and the pricing plans) become one column below 640px.', steps: ['Add a max-width: 640px media query in web/styles.css', 'Stack .features and .plans to one column', 'Check the home page still reads well on a phone'], files: gridFiles },
    summary: '', whyDraft: '', changedFiles: [], contextAlert: null, builtOn: builtOnNow,
    messages: [
      msg('developer', 'Make the features grid stack on phones. Below 640px the three cards should be one column.', h(0.6)),
      msg('agent', 'I read 3 context sections that relate to this task: Project brief v1, Design rules v1, Files and structure v1.', h(0.6)),
      msg('agent', `Heads up: ${name[ids.worker2]} (Content) is also changing web/index.html, web/styles.css for "Add an FAQ section to the home page". Keep your edits to the parts you need, and talk to them if you plan to restructure these files.`, h(0.55)),
      msg('agent', 'Here is my plan. Approve it and I will start.', h(0.5)),
    ],
    submissionId: null, reviewNote: null, resumeStatus: null, assignmentId: byTitle('Make the features').id,
    peers: [{ userId: ids.worker2, name: name[ids.worker2], department: 'content', taskId: faqTaskId, task: 'Add an FAQ section to the home page', files: gridFiles, status: 'done' }],
    createdAt: h(0.6), updatedAt: h(0.5),
  });
  await must(db.from('tasks').update({ dev_task_id: gridTaskId }).eq('id', byTitle('Make the features').id), 'link grid task');

  await writeAll(pid, ids.worker2, { ...L.MAIN_V3, ...L.TARA_FAQ });
  await devTasks.put({
    id: faqTaskId, projectId: pid, userId: ids.worker2, userName: name[ids.worker2], department: 'content',
    text: 'Add an FAQ section to the home page. Three questions owners ask most, in plain words.', status: 'done',
    relevantSectionIds: ['c-brief', 'c-audience', 'c-tone', 'content-copy'], conflicts: [],
    plan: { understanding: 'Add three short questions and answers under the features, in the tone of voice.', steps: ['Write three questions owners ask', 'Add a .faq section to web/index.html', 'Style it in web/styles.css'], files: faq.files },
    summary: 'Added an FAQ under the features with three questions: accounting knowledge, data safety and inviting an accountant.',
    whyDraft: 'Owners ask the same three questions on every demo call.', changedFiles: faq.files, contextAlert: null,
    builtOn: { scopes: { central: 4, content: 1 }, sections: { 'c-brief': 1, 'c-audience': 2, 'c-tone': 1, 'content-copy': 1 } },
    messages: [
      msg('developer', 'Add an FAQ section to the home page. Three questions owners ask most, in plain words.', h(1.5)),
      msg('agent', 'I read 4 context sections that relate to this task: Project brief v1, Audience v2, Tone of voice v1, Copy guidelines v1.', h(1.5)),
      msg('agent', 'Done. I changed web/index.html and web/styles.css. Review it in the work area, then submit.', h(1.1)),
      msg('agent', `Heads up: ${name[ids.worker]} (Website) just planned changes to web/index.html, web/styles.css for "Make the features grid stack on phones".`, h(0.55)),
    ],
    submissionId: null, reviewNote: null, resumeStatus: null, assignmentId: byTitle('Add an FAQ').id,
    peers: [{ userId: ids.worker, name: name[ids.worker], department: 'website', taskId: gridTaskId, task: 'Make the features grid stack on phones', files: gridFiles, status: 'awaiting_plan_approval' }],
    createdAt: h(1.5), updatedAt: h(0.55),
  });
  await must(db.from('tasks').update({ dev_task_id: faqTaskId }).eq('id', byTitle('Add an FAQ').id), 'link faq task');

  // An older approved submission (Kabir's features grid) and one sent back to Tara earlier.
  const oldGrid = diffMaps(L.MAIN_V1, L.MAIN_V2);
  const oldGridTaskId = devTasks.newId();
  const oldGridSubId = workSubmissions.newId();
  // The submission points at its workspace task (foreign key), so the task row goes in first.
  await devTasks.put({
    id: oldGridTaskId, projectId: pid, userId: ids.worker, userName: name[ids.worker], department: 'website',
    text: 'Add a features grid with three benefits under the hero', status: 'approved',
    relevantSectionIds: ['c-brief', 'web-design'], conflicts: [],
    plan: { understanding: 'Three feature cards under the hero.', steps: ['Add the cards', 'Style them'], files: oldGrid.files },
    summary: 'Added three feature cards under the hero: GST invoices, bank sync and plain reports.', whyDraft: '',
    changedFiles: oldGrid.files, contextAlert: null, builtOn: builtOnOld, messages: [], submissionId: oldGridSubId,
    reviewNote: 'Nice and clear. Merged.', resumeStatus: null, assignmentId: null, peers: [], createdAt: h(33), updatedAt: h(30),
  });
  await workSubmissions.put({
    id: oldGridSubId, projectId: pid, taskId: oldGridTaskId, userId: ids.worker, userName: name[ids.worker], department: 'website',
    title: 'Features grid with three benefits', summary: 'Added three feature cards under the hero: GST invoices, bank sync and plain reports.',
    why: 'The brief says to talk about outcomes; three clear benefits help people book a demo.', diff: oldGrid.diff, files: oldGrid.files,
    builtOn: builtOnOld, status: 'approved', base: {}, changes: {}, reviewNote: 'Nice and clear. Merged.', reviewedBy: ids.admin, reviewedAt: h(30),
    mergeInfo: { conflicted: [] }, createdAt: h(32),
  });

  // The approved work behind Arjun's two merges, so every change has what changed and why.
  const approvedWork = async ({ userId, title, summary, why, files, at, taskRowId }) => {
    const tid = devTasks.newId();
    const sid = workSubmissions.newId();
    await devTasks.put({
      id: tid, projectId: pid, userId, userName: name[userId], department: 'website', text: title, status: 'approved',
      relevantSectionIds: [], conflicts: [], plan: null, summary, whyDraft: why, changedFiles: files, contextAlert: null, builtOn: builtOnOld,
      messages: [], submissionId: sid, reviewNote: null, resumeStatus: null, assignmentId: taskRowId ?? null, peers: [], createdAt: at, updatedAt: at,
    });
    await workSubmissions.put({
      id: sid, projectId: pid, taskId: tid, userId, userName: name[userId], department: 'website', title, summary, why,
      diff: '', files, builtOn: builtOnOld, status: 'approved', base: {}, changes: {}, reviewNote: 'Approved.',
      reviewedBy: ids.owner, reviewedAt: at, mergeInfo: { conflicted: [] }, createdAt: at,
    });
    if (taskRowId) await must(db.from('tasks').update({ dev_task_id: tid }).eq('id', taskRowId), 'link approved work');
  };
  await approvedWork({
    userId: ids.admin, title: 'Landing page: hero and "Book a free demo"', files: Object.keys(L.MAIN_V1), at: h(60),
    summary: 'The first version of the home page: a headline, one line on what LedgerLite does, and a big "Book a free demo" button.',
    why: 'The goal of the site is demo bookings, so the very first thing visitors see is the way to book one.',
  });
  await approvedWork({
    userId: ids.worker, title: 'Pricing page with rupee plans', files: ['web/pricing.html', 'web/styles.css'], at: h(9), taskRowId: byTitle('Show prices').id,
    summary: 'A new Pricing page with three plans (Starter free, Growth ₹499, Business ₹1,299 a month), linked from the menu.',
    why: 'Meera asked for prices in rupees; small business owners in India compare prices before booking a demo.',
  });

  // The story so far (newest last).
  const events = [
    [h(72), 'context.created', ids.owner, null, 'Priya Sharma added "Audience", "Tone of voice" to the central context', { why: 'So every page talks to the right people, in the same voice' }],
    [h(70), 'context.created', ids.admin, 'website', 'Arjun Mehta set the Website design rules and file structure', { why: 'One look and one way of building pages, so changes from different people fit together' }],
    [h(60), 'review.approved', ids.admin, 'website', 'Arjun Mehta\'s "Landing page: hero and Book a free demo" was approved and merged'],
    [h(40), 'department.created', ids.owner, 'content', 'Department Content created'],
    [h(32), 'task.submitted', ids.worker, 'website', 'Kabir Singh submitted "Features grid with three benefits"'],
    [h(30), 'review.approved', ids.admin, 'website', 'Kabir Singh\'s "Features grid with three benefits" was approved and merged'],
    [h(30), 'context.changed', ids.owner, null, 'Audience v1 → v2', { title: 'Audience', why: 'Our pilot users are all Indian shops and clinics, mostly on mobile' }],
    [h(14), 'observer.request', ids.observer, null, 'The observer asked: "Please show prices in rupees, not dollars."'],
    [h(13), 'assignment.created', ids.owner, 'website', 'Priya Sharma assigned "Show prices in rupees" to Kabir Singh'],
    [h(10), 'context.created', ids.owner, null, 'Priya Sharma added "Pricing rules" to the central context', { why: 'Prices must be the same everywhere, and always in rupees' }],
    [h(9), 'review.approved', ids.worker, 'website', 'Kabir Singh\'s "Pricing page with rupee plans" was approved and merged'],
    [h(8), 'observer.request', ids.observer, null, 'The observer asked: "Can the pricing page say clearly that there is a free trial?"'],
    [h(7), 'assignment.created', ids.admin, 'website', 'Arjun Mehta assigned "Add a 14-day free trial to pricing" to Kabir Singh'],
    [h(6.4), 'context.changed', ids.owner, null, 'Pricing rules v1 → v2', { title: 'Pricing rules', why: 'Meera asked for a clear free trial; sales confirmed it' }],
    [h(6), 'task.submitted', ids.worker, 'website', 'Kabir Singh submitted "Add a 14-day free trial to pricing"'],
    [h(4), 'assignment.created', ids.owner, 'content', 'Priya Sharma assigned "Add an FAQ section to the home page" to Tara Nair'],
    [h(1.5), 'task.created', ids.worker2, 'content', 'Tara Nair gave their agent a task: "Add an FAQ section to the home page"'],
    [h(1.2), 'observer.request', ids.observer, null, 'The observer asked: "Could we show a few customer logos under the headline?"'],
    [h(0.6), 'task.created', ids.worker, 'website', 'Kabir Singh gave their agent a task: "Make the features grid stack on phones"'],
    [h(0.55), 'agent.overlap_warning', ids.worker, 'website', 'Agents warned Kabir Singh and Tara Nair: both are changing web/index.html, web/styles.css'],
  ];
  await must(db.from('activity_log').insert(events.map(([at, type, actor, department, summary, data]) => ({
    project_id: pid, at, type, actor_id: actor, department, summary, data: data ?? {},
    level: department ? 'department' : 'central',
  }))), 'activity');

  await must(db.from('notifications').insert([
    { user_id: ids.admin, project_id: pid, kind: 'review', title: 'Kabir Singh submitted "Add a 14-day free trial to pricing"', body: 'Waiting for your review in Website.', created_at: h(6) },
    { user_id: ids.admin, project_id: pid, kind: 'observer_request', title: 'The observer asked for a change', body: logosReq.message, created_at: h(1.2) },
    { user_id: ids.owner, project_id: pid, kind: 'observer_request', title: 'The observer asked for a change', body: logosReq.message, created_at: h(1.2) },
    { user_id: ids.owner, project_id: pid, kind: 'review', title: 'Pricing page with rupee plans was merged', body: 'Version 3 of the site is live.', read: true, created_at: h(9) },
    { user_id: ids.worker, project_id: pid, kind: 'task_assigned', title: 'New task: Make the features grid stack on phones', body: 'Below 640px the three cards should be one column.', created_at: h(3) },
    { user_id: ids.worker, project_id: pid, kind: 'agent_overlap', title: 'Tara Nair is changing the same files', body: 'web/index.html, web/styles.css for "Add an FAQ section to the home page".', created_at: h(0.55) },
    { user_id: ids.worker, project_id: pid, kind: 'context_change', title: 'Priya Sharma updated the central context', body: 'Pricing rules v1 → v2: Meera asked for a clear free trial; sales confirmed it', read: true, created_at: h(6.4) },
    { user_id: ids.worker2, project_id: pid, kind: 'task_assigned', title: 'New task: Write the "About us" page copy', body: 'Who we are and why we built LedgerLite, under 150 words.', created_at: h(2) },
    { user_id: ids.worker2, project_id: pid, kind: 'agent_overlap', title: 'Kabir Singh is changing the same files', body: 'web/index.html, web/styles.css for "Make the features grid stack on phones".', created_at: h(0.55) },
    { user_id: ids.observer, project_id: pid, kind: 'request_accepted', title: 'Your request is being worked on', body: 'It became the task "Add a 14-day free trial to pricing", assigned to Kabir Singh.', created_at: h(7) },
    { user_id: ids.observer, project_id: pid, kind: 'request_done', title: 'Your request is done', body: 'Done: the new pricing page shows ₹ for every plan.', read: true, created_at: h(9) },
  ]), 'notifications');

  console.log('  LedgerLite filled in: 2 departments, 7 context sections, 3 merges, 5 tasks, 1 submission waiting, 3 observer requests.');
  return p;
}

// ---------------------------------------------------------------------------
// Fieldnote, Campus Connect (for the dashboard), CampusEats (team demo)
// ---------------------------------------------------------------------------
async function seedOtherProjects(ids, lib) {
  let fieldnote = await projectByCode('PRJ-FIELDN26');
  if (!fieldnote) {
    fieldnote = await createProject(lib, {
      name: 'Fieldnote', description: 'Note-taking for field researchers with offline sync.',
      ownerId: ids.admin, projectCode: 'PRJ-FIELDN26', observerCode: 'OBS-FIELDN26', brief: 'Note-taking app for field researchers. Goal: waitlist signups.',
    });
    await must(db.from('join_requests').insert({
      project_id: fieldnote.id, user_id: ids.worker, message: 'I built offline sync before and would love to help.', created_at: hoursAgo(5),
    }), 'join request');
    await must(db.from('notifications').insert({
      user_id: ids.admin, project_id: fieldnote.id, kind: 'join_request', title: 'Someone wants to join as a worker', body: 'Kabir Singh: I built offline sync before and would love to help.', created_at: hoursAgo(5),
    }), 'join notification');
  }
  let campus = await projectByCode('PRJ-CAMPUS26');
  if (!campus) {
    campus = await createProject(lib, {
      name: 'Campus Connect', description: 'Event discovery app for university students.',
      ownerId: ids.worker, projectCode: 'PRJ-CAMPUS26', observerCode: 'OBS-CAMPUS26', brief: 'Event discovery for university students. Goal: app installs.',
    });
  }
}

async function seedCampusEats(ids, lib) {
  let campus = await projectByCode('PRJ-EATS2026');
  if (!campus) {
    campus = await createProject(lib, {
      name: 'CampusEats', description: 'Food ordering for college campuses. Team workspace demo with Frontend and Backend departments.',
      ownerId: ids.owner, projectCode: 'PRJ-EATS2026', observerCode: 'OBS-EATS2026',
    });
  }
  const departments = await must(db.from('departments').select('slug').eq('project_id', campus.id), 'departments');
  if (!departments.some((d) => d.slug === 'frontend')) {
    await lib.team.demoSetup({ user: { id: ids.owner }, body: { projectId: campus.id, reset: true } });
    console.log('  CampusEats team demo created (3 departments, 8 simulated people).');
  } else {
    console.log('  CampusEats already set up, keeping it.');
  }
  await addMember(campus.id, ids.admin, 'admin');
  await addMember(campus.id, ids.worker, 'worker');
  await addMember(campus.id, ids.observer, 'observer');
  await lib.team.setMemberDepartment({ user: { id: ids.owner }, body: { projectId: campus.id, userId: ids.admin, department: 'backend', role: 'admin' } });
  await lib.team.setMemberDepartment({ user: { id: ids.owner }, body: { projectId: campus.id, userId: ids.worker, department: 'frontend', role: 'worker' } });
}

async function main() {
  // The app's own modules, so seeded data has exactly the shapes the API returns.
  const lib = {
    projects: await import('../server/projects.js'),
    team: await import('../server/team.js'),
    files: await import('../api/_lib/files.js'),
    context: await import('../api/_lib/context.js'),
    records: await import('../api/_lib/records.js'),
  };

  console.log('Creating demo accounts…');
  const ids = {};
  for (const [role, person] of Object.entries(PEOPLE)) {
    ids[role] = await ensureUser(person);
    console.log(`  ${role.padEnd(8)} ${person.email}`);
  }

  console.log('Creating demo projects…');
  await seedLedgerLite(ids, lib);
  await seedOtherProjects(ids, lib);
  await seedCampusEats(ids, lib);

  console.log(`
Done. Log in at http://localhost:3000 with any of these (password: ${PASSWORD})

  Owner     ${PEOPLE.owner.email}      Priya
  Admin     ${PEOPLE.admin.email}      Arjun (manages Website)
  Worker    ${PEOPLE.worker.email}     Kabir (Website developer)
  Worker    ${PEOPLE.worker2.email}      Tara (Content developer)
  Observer  ${PEOPLE.observer.email}   Meera

Project IDs (enter one to open a project):
  LedgerLite      PRJ-LEDGER26   fully filled: review queue, tasks, agent overlap warning, observer requests
                  (observer code OBS-LEDGER26)
  CampusEats      PRJ-EATS2026   scripted team demo; Priya can act as 8 simulated people
  Fieldnote       PRJ-FIELDN26   owned by Arjun; Kabir has asked to join
  Campus Connect  PRJ-CAMPUS26   owned by Kabir; others can find it in Explore
`);
}

main().catch((err) => {
  console.error(`\nSeeding failed: ${err.message}`);
  if (/relation .* does not exist|column .* does not exist|Could not find/i.test(err.message)) {
    console.error('The database is missing tables or columns. Run `npm run db:push` first.');
  }
  process.exit(1);
});
