// The code at a glance: who is working on what as branches, the files, how they
// depend on each other, and each person's goal and progress. One view at a time.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { cx } from '../../components/common/ui';
import { PageHeader } from '../../components/dashboard/ui';
import BranchMap from '../../components/coordination/BranchMap';
import DependencyGraph from '../../components/coordination/DependencyGraph';
import FileExplorer from '../../components/coordination/FileExplorer';
import PeopleProgress from '../../components/coordination/PeopleProgress';
import { Loading, Notice, Page } from './shared';

const VIEWS = [['branches', 'Branches'], ['files', 'Files'], ['graph', 'Dependencies'], ['people', 'People']];
const TICKS_PER_REFRESH = 5; // this reads every file, so refresh less often than the team's poll

export default function CodePage() {
  const { get, me, tick } = useTeam();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  const refresh = Math.floor(tick / TICKS_PER_REFRESH);

  useEffect(() => {
    let live = true;
    get('code').then((r) => { if (live) { setData(r); setError(''); } }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [refresh, me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept in the URL, so a refresh or a shared link opens the same view.
  const view = VIEWS.some(([key]) => key === params.get('view')) ? params.get('view') : VIEWS[0][0];
  const setView = (next) => setParams(next === VIEWS[0][0] ? {} : { view: next }, { replace: true });

  if (!data) return <Page wide>{error ? <Notice error={error} /> : <Loading />}</Page>;
  const { branches, files, log, edges, people, version } = data;

  return (
    <Page wide>
      <PageHeader
        title="Code"
        description={`${branches.length} open ${branches.length === 1 ? 'branch' : 'branches'} on ${files.length} ${files.length === 1 ? 'file' : 'files'}, at v${version} on main.`}
      />
      <Notice error={error} />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Code views">
        {VIEWS.map(([key, label]) => (
          <button
            key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
            className={cx('min-h-11 cursor-pointer rounded-full border-[1.5px] px-4 text-sm font-semibold', view === key ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-dim')}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'branches' && <BranchMap branches={branches} log={log} />}
      {view === 'files' && <FileExplorer files={files} branches={branches} log={log} edges={edges} />}
      {view === 'graph' && <DependencyGraph edges={edges} branches={branches} />}
      {view === 'people' && <PeopleProgress people={people} />}
    </Page>
  );
}
