// Project settings (owner): details, access codes, departments and managers.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Button } from '../../components/common/ui';
import { PageHeader } from '../../components/dashboard/ui';
import {
  Copyable, Loading, Notice, Page, Section, areaClass, inputClass, selectClass, useAction, useLive, useProjectApi,
} from './shared';

function Details({ project, api, onSaved }) {
  const act = useAction();
  const [form, setForm] = useState({ name: project.name, description: project.description ?? '' });
  useEffect(() => { setForm({ name: project.name, description: project.description ?? '' }); }, [project.name, project.description]);
  const dirty = form.name !== project.name || form.description !== (project.description ?? '');
  return (
    <Section title="Project details">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await act.run('save', () => api.post('projects/update', form), 'Saved.')) onSaved(); }}>
        <Notice error={act.error} ok={act.ok} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Name</span>
          <input className={inputClass} required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Description</span>
          <textarea className={areaClass} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <Button type="submit" className="min-h-11" disabled={!dirty || !!act.busy}>Save details</Button>
      </form>
    </Section>
  );
}

function Codes({ project, api, onChanged }) {
  const act = useAction();
  const regen = (path, label) => {
    if (!window.confirm(`Make a new ${label}? The old one stops working.`)) return;
    act.run(path, () => api.post(path), `New ${label} ready.`).then(onChanged);
  };
  return (
    <Section title="Access codes" description="Only you can see these.">
      <Notice error={act.error} ok={act.ok} />
      <div className="space-y-4">
        <div>
          <p className="m-0 text-sm font-medium text-ink">Project ID</p>
          <p className="m-0 mb-2 text-sm text-dim">Everyone needs it to open the project.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Copyable value={project.project_code ?? '—'} label="project ID" />
            <Button variant="ghost" className="min-h-11" disabled={!!act.busy} onClick={() => regen('projects/project-code', 'project ID')}>Regenerate</Button>
          </div>
        </div>
        <div>
          <p className="m-0 text-sm font-medium text-ink">Observer code</p>
          <p className="m-0 mb-2 text-sm text-dim">For your one non-technical observer (a founder, client or judge).</p>
          <div className="flex flex-wrap items-center gap-2">
            <Copyable value={project.observer_code ?? '—'} label="observer code" />
            <Button variant="ghost" className="min-h-11" disabled={!!act.busy} onClick={() => regen('projects/observer-code', 'observer code')}>Regenerate</Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Departments({ departments, people, onChanged }) {
  const { post } = useTeam();
  const act = useAction();
  const [name, setName] = useState('');
  const admins = people.filter((p) => p.role === 'admin');
  return (
    <Section title="Departments" description="Each department has its own context, its own manager who reviews its work, and workers with their own workspaces.">
      <Notice error={act.error} ok={act.ok} />
      <ul className="m-0 list-none p-0">
        {departments.map((d) => (
          <li key={d.id} className="flex flex-col gap-3 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <input
                type="color" value={d.color} aria-label={`${d.name} colour`}
                className="size-9 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0.5"
                onChange={(e) => act.run(d.id, () => post('departments/update', { departmentId: d.id, color: e.target.value })).then(onChanged)}
              />
              <div className="min-w-0">
                <p className="m-0 font-semibold text-ink">{d.name}</p>
                <p className="m-0 text-xs text-dim">{d.members} {d.members === 1 ? 'person' : 'people'} · context v{d.contextVersion}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className={selectClass} aria-label={`${d.name} manager`} value={d.managerId ?? ''} disabled={!!act.busy}
                onChange={(e) => act.run(d.id, () => post('departments/update', { departmentId: d.id, managerId: e.target.value || null }), 'Manager updated.').then(onChanged)}
              >
                <option value="">No manager (you review)</option>
                {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <Button
                variant="ghost" className="min-h-11" disabled={!!act.busy || departments.length <= 1}
                onClick={() => { if (window.confirm(`Delete ${d.name}?`)) act.run(d.id, () => post('departments/delete', { departmentId: d.id }), 'Department deleted.').then(onChanged); }}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row"
        onSubmit={async (e) => { e.preventDefault(); if (await act.run('new', () => post('departments/create', { name }), `${name} created.`)) { setName(''); onChanged(); } }}
      >
        <input className={inputClass} required placeholder="New department, e.g. Mobile" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" className="min-h-11 shrink-0" disabled={!!act.busy}>Add department</Button>
      </form>
      {admins.length === 0 && <p className="m-0 mt-3 text-xs text-dim">Invite an admin from Members to give a department its own manager.</p>}
    </Section>
  );
}

export default function SettingsPage() {
  const { get, me, boot, reload: reloadTeam, projectId } = useTeam();
  const api = useProjectApi();
  const { data, loading, error, reload } = useLive(() => get('overview'), [me.id]);
  if (me.role !== 'owner' || me.actingAs) return <Page><Notice error="Only the project owner can change settings." /></Page>;
  if (loading && !data) return <Page><Loading /></Page>;
  if (!data) return <Page><Notice error={error} /></Page>;
  const onChanged = () => { reload(); reloadTeam(); };
  return (
    <Page wide>
      <PageHeader title="Settings" description="Project details, who can get in, and how the team is split." />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Details project={data.project} api={api} onSaved={onChanged} />
          <Codes project={data.project} api={api} onChanged={onChanged} />
        </div>
        <div className="space-y-5">
          <Departments departments={data.departments} people={boot.people} onChanged={onChanged} />
          <Section title="Demo team" description="Add a scripted demo team (CampusEats people, context and files) to show the workflow, and act as any of them.">
            <Link to={`/projects/${projectId}/setup`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent no-underline hover:underline">Open demo team setup →</Link>
          </Section>
        </div>
      </div>
    </Page>
  );
}
