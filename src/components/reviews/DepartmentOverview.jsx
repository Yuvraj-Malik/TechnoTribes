// Manager's right column: changes coming from other departments, who is
// working on what, the department context, and the recent log.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { timeAgo } from '../../utils/time';
import { useContextData, ChangedSinceLastVisit } from '../agents/ContextPanel';
import { Avatar, Badge, Card, PanelTitle } from '../common/ui';

const TASK_TONE = {
  reading_context: 'blue', checking_conflicts: 'blue', planning: 'blue', working: 'blue',
  needs_conflict_decision: 'amber', awaiting_plan_approval: 'amber', needs_context_decision: 'red',
  done: 'green', submitted: 'violet', approved: 'green', sent_back: 'amber', rejected: 'red', cancelled: 'slate', failed: 'red',
};

export default function DepartmentOverview({ department }) {
  const { personById, nameOf, deptById, get, tick } = useTeam();
  const dept = deptById(department);
  const ctx = useContextData();
  const [ov, setOv] = useState(null);
  const [log, setLog] = useState([]);

  useEffect(() => {
    get('review/overview', { department }).then(setOv).catch(() => {});
    get('log', { department, limit: 12 }).then((r) => setLog(r.events)).catch(() => {});
  }, [department, tick]);

  return (
    <div className="space-y-5">
      {ov?.incoming.length > 0 && (
        <div>
          <PanelTitle>From other departments</PanelTitle>
          <div className="space-y-2">
            {ov.incoming.slice(0, 3).map((e) => (
              <Card key={e.id} tone="amber" className="!p-3 text-xs">
                <div className="font-semibold text-ink">{deptById(e.department)?.name}: {String(e.data.summary)}</div>
                <div className="text-dim">Confirmed by {nameOf(e.actorId)} · {timeAgo(e.at)}</div>
                {e.data.deptNotes?.[department] && <div className="mt-1 text-ink"><b>For {dept?.name}:</b> {e.data.deptNotes[department]}</div>}
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <PanelTitle>Developers right now</PanelTitle>
        <div className="space-y-2">
          {ov?.developers.map(({ userId, task }) => (
            <div key={userId} className="flex items-start gap-2 rounded-lg border border-line bg-surface p-2">
              <Avatar person={personById(userId)} size={26} />
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium text-ink">{nameOf(userId)}</div>
                {task ? (
                  <>
                    <div className="truncate text-dim" title={task.text}>{task.text}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge tone={TASK_TONE[task.status]}>{task.status.replace(/_/g, ' ')}</Badge>
                      {task.outdated && !['approved', 'rejected', 'cancelled'].includes(task.status) && <Badge tone="red">outdated</Badge>}
                      <span className="text-dim">{timeAgo(task.updatedAt)}</span>
                    </div>
                  </>
                ) : <div className="text-dim">No task yet</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {ctx && dept && (
        <div>
          <PanelTitle right={<Badge tone="teal">{dept.name} v{ctx.scopeVersions[dept.id]}</Badge>}>{dept.name} context</PanelTitle>
          <ul className="m-0 list-none space-y-1 p-0 text-xs">
            {ctx.department.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded bg-surface px-2 py-1 ring-1 ring-line">
                <span className="truncate" title={s.content}>{s.title}</span>
                <span className="shrink-0 text-dim">v{s.version} · {timeAgo(s.updatedAt)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2"><ChangedSinceLastVisit data={ctx} /></div>
        </div>
      )}

      <div>
        <PanelTitle>Recent log</PanelTitle>
        <ol className="m-0 list-none space-y-1.5 border-l-2 border-line p-0 pl-3">
          {log.map((e) => (
            <li key={e.id} className="text-xs">
              <span className="text-dim">{timeAgo(e.at)} · </span>
              <span className="text-ink">{e.summary}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
