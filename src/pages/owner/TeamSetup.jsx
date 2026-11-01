// Owner only: set up (or reset) the CampusEats demo, and put real members
// into departments (Manager = admin, Developer = worker).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import Alert from '../../components/common/Alert';
import { Avatar, Badge, Button, Card, Empty, PanelTitle } from '../../components/common/ui';
import { heading } from '../../components/common/styles';

export default function TeamSetup() {
  const { boot, post, reload, projectId, refresh } = useTeam();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ tone: 'ok', text: '' });

  if (!boot.canUseDemoMode) return <div className="mx-auto max-w-xl p-8"><Empty>Only the project owner can set up the team.</Empty></div>;

  const setup = async (reset) => {
    if (reset && !window.confirm('Reset the demo? This wipes all team work, context and files in this project and re-seeds CampusEats.')) return;
    setBusy(true);
    try {
      await post('demo/setup', { reset });
      await reload();
      setMsg({ tone: 'ok', text: 'CampusEats demo is ready. Use the person switcher in the top bar to act as Rohan, Isha, Kabir, Ananya…' });
      refresh();
    } catch (e) { setMsg({ tone: 'error', text: e.message }); }
    setBusy(false);
  };
  const assign = async (userId, department, role) => {
    try { await post('members/department', { userId, department, role }); await reload(); } catch (e) { setMsg({ tone: 'error', text: e.message }); }
  };
  const real = boot.people.filter((p) => !p.isDemo && p.role !== 'owner' && p.role !== 'observer');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <h1 className={heading}>Team setup</h1>
          <p className="m-0 text-dim">Departments, managers and developers for {boot.project.name}.</p>
        </div>
        <Alert tone={msg.tone}>{msg.text}</Alert>

        <Card>
          <PanelTitle>CampusEats demo</PanelTitle>
          <p className="m-0 mb-3 text-sm text-dim">
            Seeds three departments (Frontend, Backend, Payments), eight <b>demo people</b> (simulated, labelled as such), four days of central and department context,
            the CampusEats sample app as the main project, and two older submissions. As the owner you can then act as any demo person from the top bar.
          </p>
          <div className="flex flex-wrap gap-2">
            {!boot.demoReady && <Button disabled={busy} onClick={() => setup(false)}>{busy ? 'Setting up…' : 'Set up CampusEats demo'}</Button>}
            {boot.demoReady && <Button variant="secondary" disabled={busy} onClick={() => setup(true)}>{busy ? 'Resetting…' : 'Reset demo'}</Button>}
            {boot.demoReady && <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}/story`)}>Open project story</Button>}
          </div>
        </Card>

        {boot.departments.length > 0 && (
          <Card>
            <PanelTitle>Departments</PanelTitle>
            <ul className="m-0 list-none space-y-2 p-0">
              {boot.departments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                  <span className="font-semibold text-ink">{d.name}</span>
                  <span className="text-dim">works in {d.paths.join(', ')}</span>
                  {boot.people.filter((p) => p.department === d.id).map((p) => (
                    <Badge key={p.id} tone={p.isManager ? 'violet' : 'slate'}>{p.name}{p.isManager ? ' · manager' : ''}{p.isDemo ? ' (demo)' : ''}</Badge>
                  ))}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <PanelTitle>Real members</PanelTitle>
          {!real.length && <p className="m-0 text-sm text-dim">Nobody has joined yet. Invite admins and workers from the project, then place them in a department here.</p>}
          <ul className="m-0 list-none space-y-2 p-0">
            {real.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Avatar person={p} size={24} />
                <span className="min-w-32 font-medium text-ink">{p.name}</span>
                <select className="rounded-lg border border-line bg-surface px-2 py-1 text-ink" value={p.department ?? ''} onChange={(e) => assign(p.id, e.target.value, p.role)}>
                  <option value="">No department</option>
                  {boot.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select className="rounded-lg border border-line bg-surface px-2 py-1 text-ink" value={p.role} onChange={(e) => assign(p.id, p.department, e.target.value)}>
                  <option value="worker">Developer</option>
                  <option value="admin">Manager</option>
                </select>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
