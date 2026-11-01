import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import Alert from '../../components/common/Alert';
import Icon from '../../components/common/Icon';
import { focusRing } from '../../components/common/styles';
import { PageHeader, EmptyState, CardSkeleton } from '../../components/dashboard/ui';
import { ExploreProjectCard, JoinRequestDialog } from '../../components/dashboard/ProjectCards';

export default function ExplorePage() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const discover = useApi('projects/discover', search ? { search } : undefined);
  const projects = discover.data?.projects || [];

  return (
    <>
      <PageHeader
        title="Explore projects"
        description="Projects you're not part of yet. Ask to join and the project's admins will review your request."
      />

      <div className="relative mb-6 max-w-md">
        <label htmlFor="project-search" className="sr-only">Search projects</label>
        <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim" />
        <input
          id="project-search"
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search by name or description"
          className={`w-full rounded-[10px] border-[1.5px] border-line bg-surface py-3 pr-3.5 pl-10 font-sans text-base text-ink ${focusRing}`}
        />
      </div>

      <Alert tone="error">{discover.error}</Alert>
      {discover.loading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"><CardSkeleton count={4} /></div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="compass"
          title={search ? `No projects match "${search}"` : 'Nothing to explore yet'}
          text={search ? 'Try a different word.' : 'When other teams create projects, they will appear here.'}
        />
      ) : (
        <>
          <p className="m-0 mb-3 text-sm text-dim" aria-live="polite">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</p>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {projects.map((p) => <ExploreProjectCard key={p.id} project={p} onRequest={setJoining} />)}
          </div>
        </>
      )}

      <JoinRequestDialog project={joining} onClose={() => setJoining(null)} onSent={() => discover.reload()} />
    </>
  );
}
