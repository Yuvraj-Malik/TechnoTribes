// Manager Review: department queue (left), submission detail (centre),
// department overview (right).
import { useCallback, useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { SUB_STATUS } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import ReviewDetail from '../../components/reviews/ReviewDetail';
import DepartmentOverview from '../../components/reviews/DepartmentOverview';
import { Avatar, Badge, Empty, PanelTitle, cx } from '../../components/common/ui';

export default function ManagerReview() {
  const { me, boot, personById, get, tick } = useTeam();
  // The owner can review any department; a manager reviews their own.
  const [department, setDepartment] = useState(me.department ?? boot.departments[0]?.id);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => get('review/queue', { department }).then((r) => {
    setItems(r.items);
    setSelected((cur) => (cur && r.items.some((x) => x.id === cur) ? cur : r.items.find((x) => x.status === 'pending')?.id ?? r.items[0]?.id ?? null));
  }).catch(() => {}), [department]);
  useEffect(() => { load(); }, [load, tick]);

  if (!me.isManager) return <div className="mx-auto max-w-xl p-8"><Empty>Only managers review submissions.</Empty></div>;
  const waiting = items.filter((i) => i.status === 'pending' || i.status === 'merge_conflict').length;
  const deptName = boot.departments.find((d) => d.id === department)?.name;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
      <aside className="overflow-y-auto border-b border-line bg-surface p-4 lg:border-b-0 lg:border-r">
        <PanelTitle right={<Badge tone={waiting ? 'violet' : 'slate'}>{waiting} waiting</Badge>}>{deptName} review queue</PanelTitle>
        {me.role === 'owner' && (
          <select className="mb-3 min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink" value={department} onChange={(e) => { setDepartment(e.target.value); setSelected(null); }}>
            {boot.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {!items.length && <Empty>No submissions yet.</Empty>}
        <div className="space-y-1.5">
          {items.map((s) => {
            const open = s.status === 'pending' || s.status === 'merge_conflict';
            const dev = personById(s.userId) ?? { id: s.userId, name: s.userName };
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={cx('w-full cursor-pointer rounded-lg border p-2.5 text-left transition',
                  selected === s.id ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:bg-bg', !open && 'opacity-70')}
              >
                <div className="flex items-start gap-2">
                  <Avatar person={dev} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{s.title}</div>
                    <div className="text-[11px] text-dim">{dev.name} · {timeAgo(s.createdAt)}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={SUB_STATUS[s.status].tone}>{SUB_STATUS[s.status].label}</Badge>
                      {open && s.outdated.length > 0 && <Badge tone="red">Outdated</Badge>}
                      {open && s.conflicts.length > 0 && <Badge tone="red">Conflict</Badge>}
                      {s.proposalStatus === 'pending' && <Badge tone="amber">Context update to confirm</Badge>}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="overflow-y-auto p-5">
        {selected ? <ReviewDetail id={selected} onChanged={load} /> : <Empty>Select a submission to review.</Empty>}
      </section>
      <aside className="overflow-y-auto border-t border-line bg-bg p-4 lg:border-l lg:border-t-0">
        <DepartmentOverview department={department} />
      </aside>
    </div>
  );
}
