// Developer Workspace: context layers / status / timeline (left), work area
// (centre), agent (right), submission bar (bottom).
import { useCallback, useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import ContextPanel, { useContextData } from '../../components/agents/ContextPanel';
import WorkArea from '../../components/preview/WorkArea';
import AgentPanel from '../../components/agents/AgentPanel';
import SubmissionBar from '../../components/agents/SubmissionBar';
import { SearchPast, StatusPanel, SummaryCard, TimelinePanel, useWorkspaceStatus } from '../../components/agents/WorkspaceStatus';
import { Badge, Empty, cx } from '../../components/common/ui';

const LEFT_TABS = [['context', 'Context'], ['status', 'Status'], ['timeline', 'Timeline']];
const FINISHED_WORK = ['done', 'submitted', 'approved', 'sent_back'];

export default function DeveloperWorkspace() {
  const { me, get, tick, refresh } = useTeam();
  const [cur, setCur] = useState({ task: null, submission: null, check: null });
  const ctx = useContextData();
  const status = useWorkspaceStatus();
  // The left column is open by default on wide screens; on smaller ones it is a toggle so the code gets the room.
  const [showLeft, setShowLeft] = useState(() => window.innerWidth >= 1500);
  const [tab, setTab] = useState('context');

  const load = useCallback(() => get('task/current').then(setCur).catch(() => {}), [me.id]);
  useEffect(() => { load(); }, [load, tick]);

  if (!me.hasAgent) {
    return <div className="mx-auto max-w-xl p-8"><Empty>Only developers (workers in a department) and the owner have an agent workspace.</Empty></div>;
  }
  const task = cur.task && cur.task.status !== 'cancelled' ? cur.task : null;
  const waiting = status?.suggestions.filter((s) => s.status === 'pending_manager' || s.status === 'pending_founder').length ?? 0;
  const counts = { status: (status?.blocked.length ?? 0) + waiting, timeline: 0, context: 0 };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`grid min-h-0 flex-1 grid-cols-1 ${showLeft ? 'lg:grid-cols-[320px_minmax(0,1fr)_360px]' : 'lg:grid-cols-[44px_minmax(0,1fr)_360px]'}`}>
        <aside className={`overflow-y-auto border-b border-line bg-surface lg:border-b-0 lg:border-r ${showLeft ? 'p-4' : 'p-1'}`}>
          <button
            type="button"
            onClick={() => setShowLeft((v) => !v)}
            aria-expanded={showLeft}
            className={`mb-2 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent text-sm font-semibold text-dim hover:bg-bg hover:text-ink ${showLeft ? 'px-2' : 'justify-center px-0 lg:[writing-mode:vertical-rl] lg:min-h-40'}`}
            title={showLeft ? 'Hide' : 'Show context, status and timeline'}
          >
            {showLeft ? '‹ Hide' : 'Context · Status ›'}
          </button>
          {showLeft && (
            <>
              <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
                {LEFT_TABS.map(([k, label]) => (
                  <button
                    key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={cx('-mb-px flex min-h-11 cursor-pointer items-center gap-1 border-0 border-b-2 bg-transparent px-3 text-sm font-medium',
                      tab === k ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-ink')}
                  >
                    {label}{counts[k] > 0 && <Badge tone="amber">{counts[k]}</Badge>}
                  </button>
                ))}
              </div>
              {tab === 'context' && <><SearchPast /><ContextPanel task={task} /></>}
              {tab === 'status' && <StatusPanel data={status} />}
              {tab === 'timeline' && <TimelinePanel data={status} task={task} onChanged={() => { load(); refresh(); }} />}
            </>
          )}
        </aside>
        <section className="flex min-h-[480px] min-w-0 flex-col p-4">
          <WorkArea task={task} onChanged={load} />
        </section>
        <aside className="space-y-4 overflow-y-auto border-t border-line bg-bg p-4 lg:border-l lg:border-t-0">
          <AgentPanel task={cur.task} onChanged={load} />
          {task && FINISHED_WORK.includes(task.status) && task.summary && <SummaryCard task={task} status={status} onShared={() => { load(); refresh(); }} />}
        </aside>
      </div>
      <SubmissionBar task={task} submission={cur.submission} check={cur.check} scopeVersions={ctx?.scopeVersions} onChanged={load} />
    </div>
  );
}
