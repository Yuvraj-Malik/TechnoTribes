// Left column: "What changed since your last visit" and the central +
// department context, with versions, owners and highlights.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { timeAgo } from '../../utils/time';
import { KIND_LABEL } from '../../constants/statuses';
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

const PLAN_ORDER = ['goal', 'must_do', 'must_not', 'decision', 'done', 'note'];

/** One layer (central or department): its plan grouped by kind, then its progress. */
function Layer({ title, owner, version, tone, layer, used, lastSeenAt, progressLabel }) {
  const groups = PLAN_ORDER.map((k) => [k, layer.plan.filter((s) => (s.kind ?? 'note') === k)]).filter(([, items]) => items.length);
  return (
    <section className="rounded-xl border border-line p-3">
      <PanelTitle right={<Badge tone={tone}>v{version}</Badge>}>{title}</PanelTitle>
      <p className="m-0 mb-2 text-[11px] text-dim">Owned by {owner}. Agents read it; changes go through suggestions.</p>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink uppercase">Plan</div>
      <div className="space-y-2">
        {groups.map(([kind, items]) => (
          <div key={kind}>
            <div className="mb-1 text-[11px] text-dim">{KIND_LABEL[kind]}</div>
            <div className="space-y-1.5">{items.map((s) => <SectionRow key={s.id} s={s} usedByTask={used.has(s.id)} lastSeenAt={lastSeenAt} />)}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 mb-1 text-[11px] font-semibold tracking-wide text-ink uppercase">{progressLabel}</div>
      {layer.progress.length
        ? <div className="space-y-1.5">{layer.progress.map((s) => <SectionRow key={s.id} s={s} usedByTask={used.has(s.id)} lastSeenAt={lastSeenAt} />)}</div>
        : <p className="m-0 text-xs text-dim">Nothing yet.</p>}
    </section>
  );
}

/** The agent's own work for its current task: private, nobody else needs it. */
function AgentLayer({ task, name }) {
  return (
    <section className="rounded-xl border border-dashed border-line p-3">
      <PanelTitle right={<Badge>private</Badge>}>{name}'s agent: own work</PanelTitle>
      {!task ? <p className="m-0 text-xs text-dim">No task yet.</p> : (
        <div className="space-y-1.5 text-xs text-ink">
          <p className="m-0"><span className="text-dim">Task:</span> {task.text}</p>
          {task.plan && <p className="m-0"><span className="text-dim">Plan:</span> {task.plan.understanding}</p>}
          {task.changedFiles?.length > 0 && <p className="m-0"><span className="text-dim">Changed:</span> <span className="font-mono">{task.changedFiles.join(', ')}</span></p>}
          {task.summary && <p className="m-0"><span className="text-dim">Result:</span> {task.summary}</p>}
          <p className="m-0 text-dim">Only the summary you share reaches the department; this working history stays with you.</p>
        </div>
      )}
    </section>
  );
}

export default function ContextPanel({ task = null }) {
  const data = useContextData();
  const { dept, me, boot, nameOf } = useTeam();
  if (!data) return <div className="text-sm text-dim">Loading context…</div>;
  const used = new Set(task?.relevantSectionIds ?? []);
  const founder = boot.people.find((p) => p.role === 'owner');
  return (
    <div className="space-y-4">
      <ChangedSinceLastVisit data={data} />
      <Layer
        title="Central context" owner={`the founder${founder ? ` (${founder.name})` : ''}`} version={data.scopeVersions.central} tone="violet"
        layer={data.layers.central} used={used} lastSeenAt={data.lastSeenAt} progressLabel="Progress: checkpoints"
      />
      {dept && (
        <Layer
          title={`${dept.name} context`} owner={dept.managerId ? `${nameOf(dept.managerId)} (manager)` : 'the department manager'}
          version={data.scopeVersions[dept.id]} tone="teal" layer={data.layers.department} used={used} lastSeenAt={data.lastSeenAt} progressLabel="Progress: what is built"
        />
      )}
      <AgentLayer task={task} name={me.name} />
    </div>
  );
}
