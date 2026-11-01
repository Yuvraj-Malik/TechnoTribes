// Left column: "What changed since your last visit" and the central +
// department context, with versions, owners and highlights.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { timeAgo } from '../../utils/time';
import { Avatar, Badge, Button, Card, PanelTitle, cx } from '../common/ui';

export function useContextData() {
  const { get, tick, me } = useTeam();
  const [data, setData] = useState(null);
  useEffect(() => { get('context').then(setData).catch(() => {}); }, [tick, me.id]);
  return data;
}

const RECENT_MS = 24 * 3600_000;

function SectionRow({ s, usedByTask, lastSeenAt }) {
  const { personById, nameOf, get } = useTeam();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const changedRecently = Date.now() - new Date(s.updatedAt).getTime() < RECENT_MS
    || (!!lastSeenAt && s.updatedAt > lastSeenAt && s.version > 1);

  return (
    <div className={cx('rounded-lg border transition',
      changedRecently ? 'border-mark bg-mark/10' : usedByTask ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface')}
    >
      <button type="button" className="flex w-full cursor-pointer items-start gap-2 border-0 bg-transparent px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className={cx('mt-0.5 text-dim transition', open && 'rotate-90')}>›</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{s.title}</span>
            <Badge tone={changedRecently ? 'amber' : 'slate'}>v{s.version}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
            <Avatar person={personById(s.ownerId)} size={14} />
            <span>owner {nameOf(s.ownerId)}</span>
            <span>·</span>
            <span>updated {timeAgo(s.updatedAt)}</span>
          </div>
          {(changedRecently || usedByTask) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {changedRecently && <Badge tone="amber">Changed recently</Badge>}
              {usedByTask && <Badge tone="violet">Your task uses this</Badge>}
            </div>
          )}
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2 text-sm">
          <p className="m-0 whitespace-pre-line text-ink">{s.content}</p>
          <p className="m-0 text-xs text-dim"><span className="font-medium">Why (v{s.version}):</span> {s.why} — {nameOf(s.updatedBy)}</p>
          {s.guardrails.length > 0 && (
            <div className="text-xs">
              <div className="font-medium text-dim">Agents watch for:</div>
              <ul className="m-0 ml-4 list-disc p-0 text-dim">
                {s.guardrails.map((g) => <li key={g.phrase}><span className="font-mono">“{g.phrase}”</span>: {g.note}</li>)}
              </ul>
            </div>
          )}
          {s.version > 1 && (history ? (
            <ol className="m-0 list-none space-y-1 border-l-2 border-line pl-2 text-xs text-dim">
              {history.map((h) => (
                <li key={h.version}>
                  <span className="font-medium text-ink">v{h.version}</span> · {nameOf(h.changedBy)} · {timeAgo(h.changedAt)}: {h.why}
                  {h.version !== s.version && <div className="mt-0.5 whitespace-pre-line line-through decoration-line">{h.content}</div>}
                </li>
              ))}
            </ol>
          ) : (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent underline"
              onClick={() => get('context/history', { sectionId: s.id }).then((r) => setHistory(r.versions))}
            >
              Show version history
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChangedSinceLastVisit({ data }) {
  const { nameOf, post, refresh } = useTeam();
  const items = data.changedSinceLastVisit;
  if (!items.length) {
    return (
      <div className="rounded-lg bg-bg px-3 py-2 text-xs text-dim">
        No context changes since your last visit{data.lastSeenAt ? ` (${timeAgo(data.lastSeenAt)})` : ''}.
      </div>
    );
  }
  return (
    <Card tone="amber" className="!p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">What changed since your last visit</span>
        <Button size="sm" variant="secondary" onClick={() => post('context/seen').then(refresh)}>Got it</Button>
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {items.slice(0, 8).map((v) => (
          <li key={`${v.sectionId}-${v.version}`} className="text-xs leading-snug">
            <span className="font-medium text-ink">{v.scope === 'central' ? 'Central' : 'Dept'} › {v.title} v{v.version}</span>
            <span className="text-dim"> · {nameOf(v.changedBy)} · {timeAgo(v.changedAt)}</span>
            <div className="text-dim">{v.why}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ContextPanel({ taskSectionIds = [] }) {
  const data = useContextData();
  const { dept } = useTeam();
  if (!data) return <div className="text-sm text-dim">Loading context…</div>;
  const used = new Set(taskSectionIds);
  return (
    <div className="space-y-4">
      <ChangedSinceLastVisit data={data} />
      <div>
        <PanelTitle right={<Badge tone="violet">Central v{data.scopeVersions.central}</Badge>}>Central context</PanelTitle>
        <div className="space-y-1.5">
          {data.central.map((s) => <SectionRow key={s.id} s={s} usedByTask={used.has(s.id)} lastSeenAt={data.lastSeenAt} />)}
        </div>
      </div>
      {dept && (
        <div>
          <PanelTitle right={<Badge tone="teal">{dept.name} v{data.scopeVersions[dept.id]}</Badge>}>{dept.name} context</PanelTitle>
          <div className="space-y-1.5">
            {data.department.map((s) => <SectionRow key={s.id} s={s} usedByTask={used.has(s.id)} lastSeenAt={data.lastSeenAt} />)}
          </div>
        </div>
      )}
    </div>
  );
}
