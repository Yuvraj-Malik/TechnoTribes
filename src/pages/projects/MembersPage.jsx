// Members. Owner: join requests, admin approvals, admin codes, roles and
// departments for everyone. Admin: their department (add, accept, remove
// workers). Worker: who is on the team.
import { useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { Avatar, Badge, Button } from '../../components/common/ui';
import { PageHeader, RoleBadge } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/time';
import {
  Copyable, Loading, Notice, Page, Section, inputClass, selectClass, useAction, useLive, useProjectApi,
} from './shared';

function JoinRequests({ requests, onChange, api, departments, isOwner }) {
  const act = useAction();
  const [dept, setDept] = useState({});
  if (!requests.length) return null;
  return (
    <Section title={`Join requests (${requests.length})`} description="People who asked to join as workers.">
      <Notice error={act.error} />
      <ul className="m-0 list-none p-0">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar person={{ id: r.userId, name: r.name ?? '?' }} size={32} />
              <div className="min-w-0">
                <p className="m-0 font-semibold text-ink">{r.name ?? 'Someone'}</p>
                <p className="m-0 text-sm text-dim">{r.message || 'No message'} · {timeAgo(r.createdAt)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {isOwner && (
                <select className={selectClass} value={dept[r.id] ?? ''} onChange={(e) => setDept({ ...dept, [r.id]: e.target.value })} aria-label="Department">
                  <option value="">Default department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <Button className="min-h-11" disabled={!!act.busy} onClick={() => act.run(r.id, () => api.post('projects/join-request/respond', { requestId: r.id, accept: true, department: dept[r.id] || undefined })).then(onChange)}>Accept</Button>
              <Button variant="secondary" className="min-h-11" disabled={!!act.busy} onClick={() => act.run(r.id, () => api.post('projects/join-request/respond', { requestId: r.id, accept: false })).then(onChange)}>Decline</Button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AddPeople({ api, onChange, isOwner, departments }) {
  const add = useAction();
  const code = useAction();
  const [email, setEmail] = useState('');
  const [dept, setDept] = useState('');
  const [adminCode, setAdminCode] = useState(null);
  return (
    <Section title="Add people">
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await add.run('add', () => api.post('projects/members/add', { email, department: dept || undefined }), 'Added as a worker. They have their own workspace now.');
          if (r) { setEmail(''); onChange(); }
        }}
      >
        <Notice error={add.error} ok={add.ok} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Add a worker by email</span>
          <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          {isOwner && (
            <select className={`${selectClass} flex-1`} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
              <option value="">Default department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <Button type="submit" className="min-h-11" disabled={!!add.busy}>Add worker</Button>
        </div>
        <p className="m-0 text-xs text-dim">They need a Buildify account first.</p>
      </form>
      {isOwner && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="m-0 text-sm font-medium text-ink">Invite an admin</p>
          <p className="m-0 mt-1 text-sm text-dim">Share a one-time admin code (valid 7 days). You approve them once they use it.</p>
          <Notice error={code.error} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="min-h-11" disabled={!!code.busy} onClick={async () => { const r = await code.run('code', () => api.post('projects/admin-code')); if (r) setAdminCode(r); }}>Create admin code</Button>
            {adminCode && <Copyable value={adminCode.code} label="admin code" />}
          </div>
        </div>
      )}
    </Section>
  );
}

/** The owner sets each person's job title. It shows on the member's row. */
function DesignationForm({ m, api, onChange, act, onClose }) {
  const [value, setValue] = useState(m.designation ?? '');
  return (
    <form
      className="flex w-full flex-wrap gap-2 md:w-auto"
      onSubmit={async (e) => {
        e.preventDefault();
        const saved = await act.run(m.userId, () => api.post('team/members/designation', { userId: m.userId, designation: value }), 'Title saved.');
        if (saved) { onChange(); onClose(); }
      }}
    >
      <input className={`${inputClass} min-w-0 flex-1 md:w-56 md:flex-none`} value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} placeholder="Frontend engineer" aria-label={`${m.name}'s title`} autoFocus />
      <Button type="submit" className="min-h-11" disabled={!!act.busy}>Save</Button>
      <Button variant="ghost" className="min-h-11" onClick={onClose}>Cancel</Button>
    </form>
  );
}

function MemberRow({ m, me, isOwner, departments, api, onChange, act }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const pendingAdmin = m.role === 'admin' && m.status === 'pending';
  const canManage = isOwner ? m.role !== 'owner' && m.role !== 'observer' : me.role === 'admin' && m.role === 'worker' && m.department === me.department;
  const canTitle = isOwner && m.role !== 'observer' && m.status === 'active';
  const dept = departments.find((d) => d.id === m.department);
  const titleButton = canTitle && (
    <Button variant="ghost" className="min-h-11" onClick={() => setEditingTitle(true)}>{m.designation ? 'Edit title' : 'Add title'}</Button>
  );
  return (
    <li className="flex flex-col gap-3 border-b border-line py-3.5 last:border-b-0 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar person={{ id: m.userId, name: m.name }} size={34} />
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-2 font-semibold text-ink">
            <span className="truncate">{m.name}{m.userId === me.realUserId ? ' (you)' : ''}</span>
            <RoleBadge role={m.role} pending={m.status === 'pending'} />
            {m.isDemo && <Badge>demo</Badge>}
            {dept?.managerId === m.userId && <Badge tone="violet">Manages {dept.name}</Badge>}
          </p>
          {m.designation && <p className="m-0 truncate text-sm font-medium text-ink">{m.designation}</p>}
          <p className="m-0 truncate text-sm text-dim">{m.email ?? ''}{m.email && dept ? ' · ' : ''}{dept?.name ?? (m.role === 'observer' || m.role === 'owner' ? '' : 'No department')}</p>
        </div>
      </div>
      {editingTitle ? <DesignationForm m={m} api={api} onChange={onChange} act={act} onClose={() => setEditingTitle(false)} /> : pendingAdmin && isOwner ? (
        <div className="flex gap-2">
          <Button className="min-h-11" disabled={!!act.busy} onClick={() => act.run(m.userId, () => api.post('projects/admins/approve', { userId: m.userId, approve: true }), `${m.name} is now an admin.`).then(onChange)}>Approve admin</Button>
          <Button variant="secondary" className="min-h-11" disabled={!!act.busy} onClick={() => act.run(m.userId, () => api.post('projects/admins/approve', { userId: m.userId, approve: false })).then(onChange)}>Decline</Button>
        </div>
      ) : !canManage ? titleButton : (
        <div className="flex flex-wrap gap-2">
          {titleButton}
          {isOwner && (
            <>
              <select
                className={selectClass} aria-label={`${m.name}'s role`} value={m.role} disabled={!!act.busy}
                onChange={(e) => act.run(m.userId, () => api.post('team/members/role', { userId: m.userId, role: e.target.value, department: m.department }), 'Role updated.').then(onChange)}
              >
                <option value="worker">Worker</option>
                <option value="admin">Admin</option>
              </select>
              <select
                className={selectClass} aria-label={`${m.name}'s department`} value={m.department ?? ''} disabled={!!act.busy}
                onChange={(e) => act.run(m.userId, () => api.post('team/members/role', { userId: m.userId, role: m.role, department: e.target.value }), 'Department updated.').then(onChange)}
              >
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </>
          )}
          <Button
            variant="ghost" className="min-h-11" disabled={!!act.busy}
            onClick={() => { if (window.confirm(`Remove ${m.name} from the project?`)) act.run(m.userId, () => api.post('projects/members/remove', { userId: m.userId }), `${m.name} was removed.`).then(onChange); }}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

export default function MembersPage() {
  const { me, reload: reloadTeam } = useTeam();
  const api = useProjectApi();
  const { data, loading, error, reload } = useLive(() => api.get('projects/members'), []);
  const act = useAction();
  const [filter, setFilter] = useState('all');
  if (loading && !data) return <Page><Loading /></Page>;
  if (!data) return <Page><Notice error={error} /></Page>;

  const realRole = data.me.role;
  const isOwner = realRole === 'owner';
  const isManager = isOwner || realRole === 'admin';
  const meReal = { ...data.me, realUserId: me.realUserId };
  const onChange = () => { reload(); reloadTeam(); };
  const deptOrder = Object.fromEntries(data.departments.map((d, i) => [d.id, i]));
  const order = { owner: 0, admin: 1, worker: 2, observer: 3 };
  const members = data.members
    .filter((m) => filter === 'all' || m.department === filter || (filter === 'none' && !m.department))
    .sort((a, b) => order[a.role] - order[b.role] || (deptOrder[a.department] ?? 99) - (deptOrder[b.department] ?? 99) || a.name.localeCompare(b.name));
  const pendingAdmins = data.members.filter((m) => m.role === 'admin' && m.status === 'pending').length;

  return (
    <Page wide>
      <PageHeader
        title={isManager ? 'Members & roles' : 'Team'}
        description={isOwner
          ? 'Everyone in the project. Admins manage a department and approve its work; workers each get their own workspace and agent.'
          : realRole === 'admin' ? 'Your team. You can add, accept and remove workers in your department.' : 'Who is on this project.'}
      />
      <Notice error={act.error} ok={act.ok} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {isManager && <JoinRequests requests={data.joinRequests} onChange={onChange} api={api} departments={data.departments} isOwner={isOwner} />}
          <Section
            title={`People (${data.members.length})`}
            description={pendingAdmins ? `${pendingAdmins} admin${pendingAdmins > 1 ? 's' : ''} waiting for your approval.` : undefined}
            right={(
              <select className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by department">
                <option value="all">All departments</option>
                {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          >
            <ul className="m-0 list-none p-0">
              {members.map((m) => (
                <MemberRow key={m.userId} m={m} me={meReal} isOwner={isOwner} departments={data.departments} api={api} onChange={onChange} act={act} />
              ))}
            </ul>
          </Section>
        </div>
        {isManager && (
          <div className="space-y-5">
            <AddPeople api={api} onChange={onChange} isOwner={isOwner} departments={data.departments} />
          </div>
        )}
      </div>
    </Page>
  );
}
