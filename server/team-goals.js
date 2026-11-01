// Goals and the orchestrator agent. The founder (whole project) or a manager
// (their department) gives a goal; the orchestrator drafts tasks per
// department; the department manager reviews them and assigns each to a
// developer. Nothing reaches an agent until a person assigned it.
import { HttpError } from '../api/_lib/errors.js';
import { db, q } from '../api/_lib/supabase-admin.js';
import { getMembership } from '../api/_lib/permissions.js';
import { namesFor, notify } from '../api/_lib/log.js';
import { logEvent } from '../api/_lib/activity.js';
import { listDepartments, teamActor } from '../api/_lib/team.js';
import { listSections } from '../api/_lib/context.js';
import { agentMode, getTeamAgent } from '../api/_lib/team-agent/index.js';

const projectIdOf = (ctx) => ctx.body?.projectId ?? ctx.query?.projectId;

const shape = (t, names = {}) => ({
  id: t.id, title: t.title, description: t.description, department: t.department, status: t.status,
  source: t.source ?? 'person', goal: t.goal ?? null, planItems: t.plan_items ?? [],
  fromDepartment: t.from_department ?? null, requestedBy: names[t.requested_by] ?? null,
  assigneeId: t.assignee_id ?? null, assignee: names[t.assignee_id] ?? null,
  createdById: t.assigned_by, createdBy: names[t.assigned_by] ?? null, createdAt: t.created_at,
});

async function plannerActor(ctx) {
  const projectId = projectIdOf(ctx);
  const actor = await teamActor({ user: ctx.user, req: ctx.req, projectId });
  if (actor.role !== 'owner' && !(actor.role === 'admin' && actor.department)) {
    throw new HttpError(403, 'Goals come from the founder or a department manager');
  }
  return { projectId, actor };
}

// POST /api/team/goals/plan { projectId, goal }
// Founder: tasks for any department. Manager: tasks for their own department only.
export async function plan(ctx) {
  const { projectId, actor } = await plannerActor(ctx);
  const goal = String(ctx.body.goal ?? '').trim();
  if (goal.length < 5) throw new HttpError(400, 'Describe the goal in a sentence');
  const all = await listDepartments(projectId);
  const departments = actor.role === 'owner' ? all : all.filter((d) => d.id === actor.department);
  const sections = await listSections(projectId);
  const plain = (s) => s.kind !== 'progress' && s.kind !== 'checkpoint';
  const result = await getTeamAgent(projectId).orchestrate({
    goal,
    centralPlan: sections.filter((s) => s.scope === 'central' && plain(s)),
    departments: departments.map((d) => ({ ...d, plan: sections.filter((s) => s.scope === d.id && plain(s)) })),
  });
  if (!result.tasks.length) throw new HttpError(422, 'The orchestrator found no task for this goal');
  const known = new Set(sections.map((s) => s.id));
  const rows = await q(db.from('tasks').insert(result.tasks.map((t) => ({
    project_id: projectId, title: t.title.slice(0, 200), description: t.description || null, department: t.department,
    assignee_id: null, assigned_by: actor.id, status: 'open', source: 'orchestrator', goal,
    plan_items: (t.planItemIds ?? []).filter((id) => known.has(id)),
  }))).select('*'));
  await logEvent(projectId, {
    type: 'goal.planned', actorId: actor.id, department: actor.role === 'owner' ? null : actor.department,
    title: `Goal planned: ${goal}`, plain: `The orchestrator turned "${goal}" into ${rows.length} draft task(s): ${rows.map((t) => t.title).join('; ')}.`,
    summary: `${actor.name} gave the goal "${goal}"; the ${agentMode() === 'live' ? '' : 'simulated '}orchestrator drafted ${rows.length} task(s) for ${[...new Set(rows.map((t) => t.department))].join(', ')}`,
    links: rows.map((t) => ({ type: 'task', id: t.id })), data: { goal, tasks: rows.map((t) => ({ id: t.id, department: t.department, title: t.title })), mode: agentMode() },
  });
  const managers = departments.filter((d) => rows.some((t) => t.department === d.id) && d.managerId && d.managerId !== actor.id);
  await notify(managers.map((d) => ({
    user_id: d.managerId, project_id: projectId, kind: 'task_draft', title: `Draft tasks for ${d.name}`,
    body: `From the goal "${goal}". Review them and assign each to a developer.`,
  })));
  return { tasks: rows.map((t) => shape(t)) };
}

// GET /api/team/goals/drafts?projectId   (manager: their department; founder: all)
export async function drafts(ctx) {
  const { projectId, actor } = await plannerActor(ctx);
  let builder = db.from('tasks').select('*').eq('project_id', projectId).is('assignee_id', null);
  if (actor.role !== 'owner') builder = builder.eq('department', actor.department);
  const rows = await q(builder.order('created_at', { ascending: false }));
  // Declined requests are closed, not drafts.
  const open = rows.filter((t) => !t.declined_reason);
  const names = await namesFor(open.flatMap((t) => [t.assigned_by, t.requested_by]));
  return { tasks: open.map((t) => shape(t, names)) };
}

// POST /api/team/goals/assign { projectId, taskId, assigneeId }   (that department's manager, or the founder)
export async function assign(ctx) {
  const { projectId, actor } = await plannerActor(ctx);
  const task = (await q(db.from('tasks').select('*').eq('id', ctx.body.taskId).eq('project_id', projectId)))[0];
  if (!task) throw new HttpError(404, 'Task not found');
  if (task.assignee_id) throw new HttpError(409, 'Already assigned');
  if (actor.role !== 'owner' && actor.department !== task.department) throw new HttpError(403, 'Only this department\'s manager assigns its tasks');
  const dev = await getMembership(ctx.body.assigneeId, projectId);
  if (!dev || dev.role !== 'worker' || dev.department !== task.department) throw new HttpError(400, 'Assign it to a developer in that department');
  await q(db.from('tasks').update({ assignee_id: dev.user_id }).eq('id', task.id));
  const names = await namesFor([dev.user_id]);
  await logEvent(projectId, {
    type: 'assignment.created', actorId: actor.id, department: task.department,
    title: `Task assigned: ${task.title}`, plain: `${actor.name} gave "${task.title}" to ${names[dev.user_id]}.`,
    summary: `${actor.name} assigned "${task.title}" (from the goal "${task.goal ?? '—'}") to ${names[dev.user_id]}`,
    links: [{ type: 'task', id: task.id }], data: { assignmentId: task.id, source: task.source },
  });
  await notify([{ user_id: dev.user_id, project_id: projectId, kind: 'task_assigned', title: `New task: ${task.title}`, body: task.description }]);
  return { task: shape({ ...task, assignee_id: dev.user_id }, names) };
}
