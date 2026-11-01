import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import Alert from '../../components/common/Alert';
import Icon from '../../components/common/Icon';
import { PageHeader, EmptyState, CardSkeleton, buttonPrimary, buttonSecondary } from '../../components/dashboard/ui';
import { MyProjectCard, EnterProjectDialog } from '../../components/dashboard/ProjectCards';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'owner', label: 'Owned by me' },
  { id: 'team', label: 'Admin & worker' },
  { id: 'observer', label: 'Observing' },
];

export default function MyProjectsPage() {
  const me = useApi('auth/me');
  const [filter, setFilter] = useState('all');
  const [opening, setOpening] = useState(null);
  const all = me.data?.projects || [];
  const shown = all.filter((p) => filter === 'all'
    || (filter === 'owner' && p.role === 'owner')
    || (filter === 'team' && (p.role === 'admin' || p.role === 'worker'))
    || (filter === 'observer' && p.role === 'observer'));

  return (
    <>
      <PageHeader
        title="My projects"
        description="Projects you own or were added to. You'll need the project ID from the owner to open one."
        actions={<Link to="/onboarding?start=founder" className={buttonPrimary}><Icon name="plus" size={17} /> New project</Link>}
      />

      {all.length > 0 && (
        <div role="group" aria-label="Filter projects" className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-11 shrink-0 cursor-pointer rounded-full border px-4 text-sm font-semibold whitespace-nowrap focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-mark ${
                filter === f.id ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-dim hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <Alert tone="error">{me.error}</Alert>
      {me.loading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"><CardSkeleton count={4} /></div>
      ) : all.length === 0 ? (
        <EmptyState icon="folder" title="No projects yet" text="Create one, or join with an invite code from a project owner.">
          <Link to="/onboarding?start=founder" className={buttonPrimary}><Icon name="plus" size={17} /> New project</Link>
          <Link to="/onboarding?start=admin" className={buttonSecondary}><Icon name="key" size={17} /> Join with a code</Link>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="text-dim">No projects in this view.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((p) => <MyProjectCard key={p.projectId} project={p} onOpen={setOpening} />)}
        </div>
      )}

      <EnterProjectDialog project={opening} onClose={() => setOpening(null)} />
    </>
  );
}
