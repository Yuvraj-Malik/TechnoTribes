// Team workspace basics: bootstrap, context view, the activity story,
// notifications (respecting demo mode), member departments, and the demo setup.
import { randomUUID } from 'node:crypto';
import { db, q } from '../api/_lib/supabase-admin.js';
import { HttpError } from '../api/_lib/errors.js';
import { requireRole, OWNER } from '../api/_lib/permissions.js';
import { asArray } from '../api/_lib/http.js';
import { listDepartments, listPeople, teamActor } from '../api/_lib/team.js';
import { getScopeVersions, insertSection, listSections, listVersions, layers } from '../api/_lib/context.js';
import { diffMaps, resetWorkspace, writeAll, writeEdits, BASE, readAll } from '../api/_lib/files.js';
import { logEvent, toEvent } from '../api/_lib/activity.js';
import { devTasks, workSubmissions } from '../api/_lib/records.js';
import { agentInfo } from '../api/_lib/team-agent/index.js';
import { DEPARTMENTS, PEOPLE, SAMPLE_FILES, SAVED_CARD_JS, SCOPE_VERSIONS, SECTIONS } from '../api/_lib/demo-seed.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;

// GET /api/team/bootstrap?projectId
export async function bootstrap(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const [project, departments, people] = await Promise.all([
    q(db.from('projects').select('id,name,description').eq('id', projectId).single()),
    listDepartments(projectId),
    listPeople(projectId),
  ]);
  const realRole = people.find((p) => p.id === ctx.user.id)?.role;
  return {
    project, departments, people, me: actor, ...agentInfo(),
    canUseDemoMode: realRole === 'owner', demoReady: departments.length > 0,
  };
}

// GET /api/team/context?projectId
export async function context(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const seenRow = (await q(db.from('project_members').select('context_seen_at').eq('project_id', projectId).eq('user_id', actor.id)))[0];
  const lastSeenAt = seenRow?.context_seen_at ?? null;
  const visible = (scope) => scope === 'central' || scope === actor.department;
  const [sections, scopeVersions, changed] = await Promise.all([
    listSections(projectId), getScopeVersions(projectId),
    lastSeenAt ? listVersions(projectId, { since: lastSeenAt }) : [],
  ]);
  return {
    central: sections.filter((s) => s.scope === 'central'),
    department: sections.filter((s) => s.scope === actor.department),
    // The owner edits every department's context.
    all: actor.role === 'owner' && !actor.actingAs ? sections : undefined,
    // The same items as layers, each split into plan (what is required) and progress (what is built).
    layers: layers(sections, actor.department),
    scopeVersions, lastSeenAt,
    changedSinceLastVisit: changed.filter((v) => visible(v.scope)),
  };
}

// POST /api/team/context/seen { projectId }   ("Got it" on "What changed since your last visit")
export async function contextSeen(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  await q(db.from('project_members').update({ context_seen_at: new Date().toISOString() }).eq('project_id', projectId).eq('user_id', actor.id));
  return { ok: true };
}

// GET /api/team/context/history?projectId&sectionId
export async function contextHistory(ctx) {
  const projectId = projectIdOf(ctx);
  await teamActor({ user: ctx.user, req: ctx.req, projectId });
  return { versions: await listVersions(projectId, { sectionId: ctx.query.sectionId }) };
}

// GET /api/team/log?projectId[&department][&limit]
export async function log(ctx) {
  const projectId = projectIdOf(ctx);
  await teamActor({ user: ctx.user, req: ctx.req, projectId });
  let query = db.from('activity_log').select('*').eq('project_id', projectId);
  if (ctx.query.department) query = query.or(`department.eq.${ctx.query.department},department.is.null`);
  // level=central: the central log only; level=department (with department): that department's log only.
  if (ctx.query.level === 'central') query = query.eq('level', 'central');
  if (ctx.query.level === 'department') query = query.eq('level', 'department');
  const rows = await q(query.order('id', { ascending: false }).limit(Math.min(Number(ctx.query.limit) || 500, 2000)));
  return { events: rows.map(toEvent) };
}

// GET /api/team/log/export?projectId  -> whole log, oldest first (for generating the story)
export async function logExport(ctx) {
  const projectId = projectIdOf(ctx);
  await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const rows = await q(db.from('activity_log').select('*').eq('project_id', projectId).order('id').limit(10000));
  return { events: rows.map(toEvent) };
}

// GET /api/team/commits?projectId  (main project history: only approvals land here)
export async function commits(ctx) {
  const projectId = projectIdOf(ctx);
  await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const rows = await q(db.from('main_commits').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30));
  return { commits: rows.map((c) => ({ id: c.id, authorId: c.author_id, message: c.message, files: c.files, at: c.created_at })) };
}

// GET /api/team/notifications?projectId   (the acting person's, so demo mode works)
export async function notifications(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  const rows = await q(db.from('notifications').select('*').eq('user_id', actor.id).eq('project_id', projectId)
    .order('created_at', { ascending: false }).limit(100));
  return { notifications: rows };
}

// POST /api/team/notifications/read { projectId, ids? }
export async function notificationsRead(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  let builder = db.from('notifications').update({ read: true }).eq('user_id', actor.id).eq('project_id', projectId);
  if (ctx.body.ids) builder = builder.in('id', asArray(ctx.body.ids));
  await q(builder);
  return { ok: true };
}

// POST /api/team/members/department { projectId, userId, department, role? }   (owner)
// Puts a real member into a department: role 'admin' = manager, 'worker' = developer.
export async function setMemberDepartment({ user, body }) {
  await requireRole(user.id, body.projectId, OWNER);
  const departments = await listDepartments(body.projectId);
  if (body.department && !departments.some((d) => d.id === body.department)) throw new HttpError(400, 'Unknown department');
  const patch = { department: body.department || null };
  if (body.role === 'admin' || body.role === 'worker') patch.role = body.role;
  await q(db.from('project_members').update(patch).eq('project_id', body.projectId).eq('user_id', body.userId));
  if (patch.role === 'admin' && body.department) {
    await q(db.from('departments').update({ manager_id: body.userId }).eq('project_id', body.projectId).eq('slug', body.department));
  }
  return { ok: true };
}

// ---------------------------------------------------------------- demo setup
const TEAM_TABLES = ['context_suggestions', 'context_proposals', 'work_submissions', 'dev_tasks', 'activity_log', 'main_commits', 'project_files',
  'scope_versions', 'context_section_versions', 'context_sections', 'departments'];

async function demoPerson(p) {
  const email = `${p.key}@campuseats.demo`;
  const existing = (await q(db.from('profiles').select('id').eq('email', email)))[0];
  if (existing) return existing.id;
  const { data, error } = await db.auth.admin.createUser({
    email, password: randomUUID(), email_confirm: true, user_metadata: { display_name: p.name },
  });
  if (error) throw new HttpError(500, `Could not create demo person ${p.name}: ${error.message}`);
  return data.user.id;
}

/**
 * POST /api/team/demo/setup { projectId, reset? }   (owner)
 * Seeds CampusEats: two departments (Frontend, Backend), five demo people
 * (SIMULATED, labelled), the founder (= the project owner), four days of plan
 * and progress history, the sample app, and two older submissions.
 */
export async function demoSetup({ user, body }) {
  const projectId = body.projectId;
  await requireRole(user.id, projectId, OWNER);
  const existing = await listDepartments(projectId);
  if (existing.length && !body.reset) throw new HttpError(409, 'The demo is already set up. Send reset: true to start over');
  for (const t of TEAM_TABLES) await q(db.from(t).delete().eq('project_id', projectId));
  await q(db.from('notifications').delete().eq('project_id', projectId).in('kind', ['submission', 'review', 'context_change', 'task_alert']));

  const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  const ids = { founder: user.id };
  for (const p of PEOPLE) {
    ids[p.key] = await demoPerson(p);
    await q(db.from('profiles').update({ is_demo: true, display_name: p.name }).eq('id', ids[p.key]));
    await q(db.from('project_members').upsert(
      { project_id: projectId, user_id: ids[p.key], role: p.role, status: 'active', department: p.department, context_seen_at: ago(48) },
      { onConflict: 'project_id,user_id' },
    ));
  }
  await q(db.from('departments').insert(DEPARTMENTS.map((d, i) => ({
    project_id: projectId, slug: d.slug, name: d.name, color: d.color, paths: d.paths, manager_id: ids[d.manager], position: i,
  }))));

  for (const [i, s] of SECTIONS.entries()) {
    const meta = Object.fromEntries(Object.entries(s.meta ?? {}).map(([k, v]) => [k, ids[v] ?? v]));
    await insertSection(projectId, { ...s, meta, ownerId: ids[s.ownerId] }, i,
      s.history.map((h) => ({ content: h.content, why: h.why, by: ids[h.by], at: ago(h.hoursAgo) })));
  }
  await q(db.from('scope_versions').insert(Object.entries(SCOPE_VERSIONS).map(([scope, version]) => ({ project_id: projectId, scope, version }))));

  await writeAll(projectId, 'main', SAMPLE_FILES);
  await q(db.from('main_commits').insert({ project_id: projectId, author_id: user.id, message: 'Initial CampusEats project', files: Object.keys(SAMPLE_FILES) }));
  for (const p of PEOPLE.filter((x) => x.role === 'worker')) await resetWorkspace(projectId, ids[p.key]);

  await q(db.from('activity_log').insert({
    project_id: projectId, at: ago(96), type: 'seed', level: 'central', title: 'Project started',
    plain: 'CampusEats started with a product goal, a plan for version 1, and Frontend and Backend teams.',
    summary: 'Project CampusEats created with central context and Frontend and Backend departments.',
    data: { simulatedHistory: true }, links: [],
  }));
  // Past checkpoints: a central log entry each, linked to the department progress behind them.
  for (const s of SECTIONS.filter((x) => x.kind === 'checkpoint')) {
    const h = s.history[s.history.length - 1];
    const dept = s.meta?.department ?? null;
    await q(db.from('activity_log').insert({
      project_id: projectId, at: ago(h.hoursAgo), type: 'checkpoint.confirmed', level: 'central', actor_id: user.id,
      department: null, item_id: s.id, checkpoint_id: s.id, title: `Checkpoint: ${s.title}`, plain: h.content,
      links: SECTIONS.filter((x) => x.kind === 'progress' && x.scope === dept).map((x) => ({ type: 'item', id: x.id })),
      summary: `Founder confirmed the checkpoint "${s.title}" flagged by ${dept ? DEPARTMENTS.find((d) => d.slug === dept).name : 'a manager'}`,
      data: { sectionId: s.id, department: dept, simulatedHistory: true },
    }));
  }

  const schema = SAMPLE_FILES['server/db/schema.sql'];
  await seedOldSubmission(projectId, ids, {
    key: 'meera', department: 'frontend', title: 'Remember the card on checkout',
    text: 'Let returning students pay with a saved card in one tap.',
    summary: 'Adds web/js/saved-card.js: stores the gateway card token and last 4 digits, and shows "Pay with card ending 1234" on checkout.',
    why: 'Students reorder several times a week; typing the card every time slows checkout down.',
    edits: [{ path: 'web/js/saved-card.js', content: SAVED_CARD_JS }],
    sections: { 'c-payment-method': 1, 'c-payment-api': 1, 'fe-checkout': 2, 'fe-conventions': 3 }, at: ago(20),
  });
  await seedOldSubmission(projectId, ids, {
    key: 'arjun', department: 'backend', title: 'Index orders by student', text: 'Speed up "my orders" lookups.',
    summary: 'Adds an index on orders(student_id) in server/db/schema.sql so a student\'s order list loads quickly.',
    why: 'The "my orders" query scans the whole orders table; it will get slow during lunch rush.',
    edits: [{ path: 'server/db/schema.sql', content: `${schema}\ncreate index orders_student_idx on orders (student_id);\n` }],
    sections: { 'be-schema': 2, 'be-order-api': 1 }, at: ago(6),
  });
  return { ok: true, people: PEOPLE.map((p) => ({ id: ids[p.key], name: p.name, role: p.role, department: p.department })) };
}

/** An older pending submission (built on Payment method v1 for Meera). */
async function seedOldSubmission(projectId, ids, o) {
  const userId = ids[o.key];
  const name = PEOPLE.find((p) => p.key === o.key).name;
  await writeEdits(projectId, userId, o.edits);
  const [base, mine] = await Promise.all([readAll(projectId, BASE(userId)), readAll(projectId, userId)]);
  const { diff, files } = diffMaps(base, mine);
  const builtOn = { scopes: { ...SCOPE_VERSIONS }, sections: o.sections };
  const taskId = devTasks.newId();
  const subId = workSubmissions.newId();
  await devTasks.put({
    id: taskId, projectId, userId, userName: name, department: o.department, text: o.text, status: 'submitted',
    relevantSectionIds: Object.keys(o.sections), conflicts: [], plan: { understanding: o.summary, steps: [o.summary], files },
    summary: o.summary, whyDraft: o.why, changedFiles: files, contextAlert: null, builtOn,
    messages: [{ from: 'system', text: 'Created before this demo started (seed data).', at: o.at }],
    submissionId: subId, reviewNote: null, resumeStatus: null, createdAt: o.at, updatedAt: o.at,
  });
  await workSubmissions.put({
    id: subId, projectId, taskId, userId, userName: name, department: o.department, title: o.title, summary: o.summary,
    why: o.why, diff, files, builtOn, status: 'pending',
    base: Object.fromEntries(files.map((p) => [p, base[p] ?? null])), changes: Object.fromEntries(files.map((p) => [p, mine[p] ?? null])),
    reviewNote: null, reviewedBy: null, reviewedAt: null, mergeInfo: null, createdAt: o.at,
  });
  await logEvent(projectId, {
    type: 'task.submitted', actorId: userId, department: o.department, taskId, submissionId: subId,
    summary: `${name} submitted "${o.title}"`, data: { builtOn, files, why: o.why, seeded: true },
  });
}
