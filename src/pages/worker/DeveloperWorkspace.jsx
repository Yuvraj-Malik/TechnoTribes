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
  // Context is open by default on wide screens; on smaller ones it is a toggle so the code gets the room.
  const [showContext, setShowContext] = useState(() => window.innerWidth >= 1500);

  const load = useCallback(() => get('task/current').then(setCur).catch(() => {}), [me.id]);
  useEffect(() => { load(); }, [load, tick]);

  if (!me.isDeveloper) {
    return <div className="mx-auto max-w-xl p-8"><Empty>Only developers (workers in a department) have an agent workspace.</Empty></div>;
  }
  const task = cur.task && cur.task.status !== 'cancelled' ? cur.task : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`grid min-h-0 flex-1 grid-cols-1 ${showContext ? 'lg:grid-cols-[280px_minmax(0,1fr)_360px]' : 'lg:grid-cols-[44px_minmax(0,1fr)_360px]'}`}>
        <aside className={`overflow-y-auto border-b border-line bg-surface lg:border-b-0 lg:border-r ${showContext ? 'p-4' : 'p-1'}`}>
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            aria-expanded={showContext}
            className={`mb-2 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent text-sm font-semibold text-dim hover:bg-bg hover:text-ink ${showContext ? 'px-2' : 'justify-center px-0 lg:[writing-mode:vertical-rl] lg:min-h-40'}`}
            title={showContext ? 'Hide context' : 'Show context'}
          >
            {showContext ? '‹ Hide context' : 'Context ›'}
          </button>
          {showContext && <ContextPanel taskSectionIds={task?.relevantSectionIds ?? []} />}
        </aside>
        <section className="flex min-h-[480px] min-w-0 flex-col p-4">
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
