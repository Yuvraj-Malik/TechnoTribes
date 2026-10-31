// Developer Workspace: context (left), work area (centre), agent (right),
// submission bar (bottom).
import { useCallback, useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import ContextPanel, { useContextData } from '../../components/agents/ContextPanel';
import WorkArea from '../../components/preview/WorkArea';
import AgentPanel from '../../components/agents/AgentPanel';
import SubmissionBar from '../../components/agents/SubmissionBar';
import { Empty } from '../../components/common/ui';

export default function DeveloperWorkspace() {
  const { me, get, tick } = useTeam();
  const [cur, setCur] = useState({ task: null, submission: null, check: null });
  const ctx = useContextData();

  const load = useCallback(() => get('task/current').then(setCur).catch(() => {}), [me.id]);
  useEffect(() => { load(); }, [load, tick]);

  if (!me.isDeveloper) {
    return <div className="mx-auto max-w-xl p-8"><Empty>Only developers (workers in a department) have an agent workspace.</Empty></div>;
  }
  const task = cur.task && cur.task.status !== 'cancelled' ? cur.task : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_380px]">
        <aside className="overflow-y-auto border-b border-line bg-surface p-4 lg:border-b-0 lg:border-r">
          <ContextPanel taskSectionIds={task?.relevantSectionIds ?? []} />
        </aside>
        <section className="min-h-[480px] p-4">
          <WorkArea task={task} />
        </section>
        <aside className="overflow-y-auto border-t border-line bg-bg p-4 lg:border-l lg:border-t-0">
          <AgentPanel task={cur.task} onChanged={load} />
        </aside>
      </div>
      <SubmissionBar task={task} submission={cur.submission} check={cur.check} scopeVersions={ctx?.scopeVersions} onChanged={load} />
    </div>
  );
}
