// Tasks. Owner/admin: assign work to developers and follow it.
// Worker: the tasks assigned to them; starting one opens their agent workspace.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Avatar, Badge, Button } from '../../components/common/ui';
import { EmptyState, PageHeader, buttonPrimary } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/time';
import {
  Loading, Notice, Page, Section, TASK_STATUS, areaClass, inputClass, selectClass, useAction, useLive, useProjectApi,
} from './shared';

function TaskRow({ t, deptById, canDelete, onDelete, busy, action }) {
  const s = TASK_STATUS[t.status] ?? { label: t.status, tone: 'slate' };
  const d = deptById(t.department);
  return (
    <li className="flex flex-col gap-3 border-b border-line py-3.5 last:border-b-0 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 font-semibold text-ink">{t.title}</p>
          <Badge tone={s.tone}>{s.label}</Badge>
          {t.observerRequestId && <Badge tone="violet">Observer request</Badge>}
        </div>
        {t.description && <p className="m-0 mt-1 text-sm text-dim">{t.description}</p>}
        <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-dim">
          {t.assignee && <><Avatar person={{ id: t.assigneeId ?? t.assignee, name: t.assignee }} size={16} /> {t.assignee}</>}
          {d && <span>· {d.name}</span>}
          {t.assignedBy && <span>· from {t.assignedBy}</span>}
          <span>· {timeAgo(t.createdAt)}</span>
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {action}
        {canDelete && t.status === 'open' && (
          <Button variant="ghost" className="min-h-11" disabled={busy === t.id} onClick={() => onDelete(t)}>Delete</Button>
        )}
      </div>
    </li>
  );
}

function WorkerTasks() {
  const { get, me, projectId, deptById } = useTeam();
  const { data, loading, error } = useLive(() => get('my/assignments'), [me.id]);
  const tasks = data?.tasks ?? [];
  const [filter, setFilter] = useState('active');
  const shown = tasks.filter((t) => (filter === 'active' ? t.status !== 'done' : t.status === 'done'));
  return (
    <Page>
      <PageHeader title="My tasks" description="Work your manager assigned to you. Start one and your agent reads the context, checks what others are doing, then plans it with you." />
      <Notice error={error} />
      <div className="mb-4 flex gap-2" role="tablist">
        {[['active', 'To do'], ['done', 'Done']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`min-h-11 cursor-pointer rounded-full border-[1.5px] px-4 text-sm font-semibold ${filter === k ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-dim'}`}>
            {label} ({tasks.filter((t) => (k === 'active' ? t.status !== 'done' : t.status === 'done')).length})
          </button>
        ))}
      </div>
      {loading && !data ? <Loading /> : shown.length === 0 ? (
        <EmptyState icon="check" title={filter === 'active' ? 'Nothing assigned right now' : 'No finished tasks yet'} text="You can still give your agent your own task in the workspace.">
          <Link to={`/projects/${projectId}/workspace`} className={buttonPrimary}>Open my workspace</Link>
        </EmptyState>
      ) : (
        <Section>
          <ul className="m-0 list-none p-0">
            {shown.map((t) => (
              <TaskRow
                key={t.id} t={t} deptById={deptById}
                action={t.status !== 'done' && (
                  <Link to={`/projects/${projectId}/workspace`} className={buttonPrimary}>
                    {t.status === 'open' ? 'Start in workspace' : 'Continue'}
                  </Link>
                )}
              />
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}

function AssignForm({ workers, onDone, prefill }) {
  const { post } = useProjectApi();
  const act = useAction();
  const [form, setForm] = useState({ assigneeId: '', title: prefill?.title ?? '', description: prefill?.description ?? '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const r = await act.run('assign', () => post('tasks/assign', { ...form, observerRequestId: prefill?.requestId }), 'Task assigned. The developer was notified.');
    if (r) { setForm({ assigneeId: '', title: '', description: '' }); onDone?.(); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Notice error={act.error} ok={act.ok} />
      {prefill?.requestId && <p className="m-0 rounded-lg bg-accent/5 px-3 py-2 text-sm text-ink">From the observer's request. They are told who is working on it.</p>}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Task</span>
        <input className={inputClass} required minLength={3} value={form.title} onChange={set('title')} placeholder="e.g. Add a dark mode toggle to the header" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Details <span className="font-normal text-dim">(optional)</span></span>
        <textarea className={areaClass} rows={3} value={form.description} onChange={set('description')} placeholder="Anything the developer and their agent should know" />
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1 block text-sm font-medium text-ink">Assign to</span>
          <select className={`${selectClass} w-full`} required value={form.assigneeId} onChange={set('assigneeId')}>
            <option value="">Choose a developer</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.name}{w.deptName ? ` · ${w.deptName}` : ''}</option>)}
          </select>
        </label>
        <Button type="submit" className="min-h-11" disabled={act.busy === 'assign' || !workers.length}>{act.busy ? 'Assigning…' : 'Assign task'}</Button>
      </div>
      {!workers.length && <p className="m-0 text-sm text-dim">No developers to assign to yet. Add workers in Members.</p>}
    </form>
  );
}

/**
 * Goals: the founder (any department) or a manager (their department) gives a
 * goal; the orchestrator agent drafts tasks; the manager assigns each one.
 */
function GoalPlanner({ workers, onAssigned }) {
  const { me, boot, deptById, get, post } = useTeam();
  const { data, reload } = useLive(() => get('goals/drafts'), [me.id]);
  const act = useAction();
  const [goal, setGoal] = useState('');
  const [pick, setPick] = useState({});
  const plan = async (e) => {
    e.preventDefault();
    const r = await act.run('plan', () => post('goals/plan', { goal }), 'Draft tasks are ready below. Assign each one to a developer.');
    if (r) { setGoal(''); reload(); }
  };
  const assign = async (t) => {
    const r = await act.run(t.id, () => post('goals/assign', { taskId: t.id, assigneeId: pick[t.id] }), 'Assigned. The developer was told.');
    if (r) { reload(); onAssigned?.(); }
  };
  const decline = async (t) => {
    const reason = window.prompt(`Why decline "${t.title}"? They get this reason.`);
    if (!reason?.trim()) return;
    const r = await act.run(`d-${t.id}`, () => post('requests/decline', { requestId: t.id, reason }), 'Declined. They were told why.');
    if (r) reload();
  };
  const drafts = data?.tasks ?? [];
  return (
    <Section
      title="Goals"
      description={me.role === 'owner' ? 'Give a goal; the orchestrator agent drafts tasks for the departments that are needed.' : 'Give a goal for your department; the orchestrator agent drafts the tasks.'}
      right={boot.agentMode === 'mock' && <Badge tone="amber">⚙ Simulated orchestrator</Badge>}
    >
      <Notice error={act.error} ok={act.ok} />
      <form onSubmit={plan} className="flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} placeholder="e.g. Students can track their order live" value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Goal" />
        <Button type="submit" className="min-h-11 shrink-0" disabled={act.busy === 'plan' || goal.trim().length < 5}>{act.busy === 'plan' ? 'Planning…' : 'Draft tasks'}</Button>
      </form>
      {drafts.length > 0 && (
        <ul className="m-0 mt-4 list-none space-y-2 p-0">
          {drafts.map((t) => {
            const options = workers.filter((w) => w.department === t.department);
            const canAssign = me.role === 'owner' || me.department === t.department;
            return (
              <li key={t.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {t.source === 'request' ? <Badge tone="amber">Request from {deptById(t.fromDepartment)?.name}</Badge> : <Badge tone="violet">Draft</Badge>}
                  <Badge>{deptById(t.department)?.name ?? t.department}</Badge>
                  <span className="font-medium text-ink">{t.title}</span>
                </div>
                {t.description && <p className="m-0 mt-1 text-sm text-dim">{t.description}</p>}
                <p className="m-0 mt-1 text-xs text-dim">
                  {t.source === 'request' ? `Asked by ${t.requestedBy ?? 'another department'}` : `From the goal “${t.goal}”${t.createdBy ? ` · ${t.createdBy}` : ''}${t.planItems.length ? ` · serves ${t.planItems.join(', ')}` : ''}`}
                </p>
                {canAssign && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select className={selectClass} value={pick[t.id] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [t.id]: e.target.value }))} aria-label={`Developer for ${t.title}`}>
                      <option value="">Choose a developer…</option>
                      {options.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <Button variant="secondary" className="min-h-11" disabled={!pick[t.id] || act.busy === t.id} onClick={() => assign(t)}>Assign</Button>
                    {t.source === 'request' && (
                      <Button variant="ghost" className="min-h-11" disabled={act.busy === `d-${t.id}`} onClick={() => decline(t)}>Decline…</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function ManagerTasks() {
  const { boot, me, deptById, projectId } = useTeam();
  const api = useProjectApi();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useLive(() => api.get('tasks/list'), [me.id]);
  const del = useAction();
  const [status, setStatus] = useState('all');
  const workers = boot.people
    .filter((p) => p.role === 'worker' && (me.role === 'owner' || p.department === me.department))
    .map((p) => ({ ...p, deptName: deptById(p.department)?.name }));
  const prefill = params.get('request') ? { requestId: params.get('request'), title: params.get('title') ?? '' } : null;
  // Drafts (no developer yet) are listed under Goals.
  const tasks = (data?.tasks ?? []).filter((t) => t.assigneeId && (status === 'all' || t.status === status));

  return (
    <Page wide>
      <PageHeader
        title="Tasks"
        description={me.role === 'owner' ? 'Assign work to any developer. Its status follows their agent work: started, in review, then done when you approve it.' : 'Assign work to the developers in your department. Status updates by itself as they work.'}
      />
      <GoalPlanner workers={workers} onAssigned={reload} />
      <div className="mt-5 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Section title="Assign a task">
          <AssignForm key={prefill?.requestId ?? 'new'} workers={workers} prefill={prefill} onDone={() => { reload(); if (prefill) setParams({}); }} />
        </Section>
        <Section
          title="All tasks"
          right={(
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {Object.entries({ open: 'Not started', in_progress: 'In progress', in_review: 'In review', done: 'Done' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        >
          <Notice error={error || del.error} />
          {loading && !data ? <Loading /> : tasks.length === 0 ? <p className="m-0 py-6 text-center text-sm text-dim">No tasks here yet.</p> : (
            <ul className="m-0 list-none p-0">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id} t={t} deptById={deptById} busy={del.busy}
                  canDelete={me.role === 'owner' || t.assignedById === boot.me.realUserId}
                  onDelete={(x) => del.run(x.id, () => api.post('tasks/delete', { taskId: x.id })).then(reload)}
                  action={t.status === 'in_review' && <Link to={`/projects/${projectId}/review`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent no-underline hover:underline">Review</Link>}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Page>
  );
}

export default function TasksPage() {
  const { me } = useTeam();
  return me.role === 'worker' ? <WorkerTasks /> : <ManagerTasks />;
}
