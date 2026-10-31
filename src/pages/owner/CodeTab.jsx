// Who is working on what, seen three ways: as branches, as files and as a
// dependency graph. Below that, each person's goal and what they have done.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOwner } from '../../features/projects/ownerContext';
import { useProjectResource } from '../../features/projects/useProjectResource';
import { buildBranches, buildPeople } from '../../features/coordination/codeModel';
import Alert from '../../components/common/Alert';
import PageHeader from '../../components/common/PageHeader';
import Segmented from '../../components/common/Segmented';
import { focusRing, sectionTitle } from '../../components/common/styles';
import BranchMap from '../../components/coordination/BranchMap';
import DependencyGraph from '../../components/coordination/DependencyGraph';
import FileExplorer from '../../components/coordination/FileExplorer';
import PeopleProgress from '../../components/coordination/PeopleProgress';

const VIEWS = [
  { value: 'branches', label: 'Branches' },
  { value: 'files', label: 'Files' },
  { value: 'graph', label: 'Dependencies' },
];

function FocusChip({ label, color, active, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-none cursor-pointer items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-[13px] whitespace-nowrap max-lg:min-h-11 max-lg:px-3.5 ${active ? 'border-ink font-semibold text-ink' : 'border-line text-dim hover:text-ink'} ${focusRing}`}
    >
      {color && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </button>
  );
}

export default function CodeTab() {
  const { data, version, colors } = useOwner();
  const state = useProjectResource('moderator/state');
  const graph = useProjectResource('moderator/graph');
  const board = useProjectResource('coordination/board');
  const tasks = useProjectResource('tasks/list');
  const [params, setParams] = useSearchParams();
  const [focus, setFocus] = useState(null);

  // Kept in the URL, so a refresh or a shared link opens the same view.
  const view = VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : VIEWS[0].value;
  const setView = (next) => setParams(next === VIEWS[0].value ? {} : { view: next }, { replace: true });

  const branches = useMemo(
    () => buildBranches({ work: board.data?.work, queue: data.queue, headVersion: version }),
    [board.data, data.queue, version],
  );
  const people = useMemo(
    () => buildPeople({ members: data.members, tasks: tasks.data?.tasks, log: data.log, branches }),
    [data.members, data.log, tasks.data, branches],
  );

  const edges = graph.data?.edges || [];
  const error = state.error || graph.error || board.error || tasks.error;
  const fileCount = Object.keys(state.data?.files || {}).length;

  return (
    <>
      <PageHeader title="Code">
        {branches.length} open {branches.length === 1 ? 'branch' : 'branches'} on {fileCount} {fileCount === 1 ? 'file' : 'files'}, at v{version} on main.
      </PageHeader>
      <Alert tone="error">{error}</Alert>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
        <div role="group" aria-label="Focus on one person" className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <FocusChip label="Everyone" active={!focus} onClick={() => setFocus(null)} />
          {people.map((person) => (
            <FocusChip
              key={person.userId}
              label={person.name?.split(' ')[0] || 'Unnamed'}
              color={colors[person.userId]}
              active={focus === person.userId}
              onClick={() => setFocus(focus === person.userId ? null : person.userId)}
            />
          ))}
        </div>
      </div>

      {view === 'branches' && <BranchMap branches={branches} log={data.log} colors={colors} focus={focus} />}
      {view === 'files' && state.data && (
        <FileExplorer files={state.data.files} branches={branches} log={data.log} edges={edges} colors={colors} focus={focus} />
      )}
      {view === 'graph' && graph.data && (
        <DependencyGraph nodes={graph.data.nodes} edges={edges} branches={branches} colors={colors} focus={focus} />
      )}

      <section className="mt-8">
        <h2 className={`${sectionTitle} mb-3`}>Goals and progress</h2>
        <PeopleProgress people={people} colors={colors} focus={focus} onFocus={setFocus} />
      </section>
    </>
  );
}
