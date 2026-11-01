// Project story: every task, agent step, human decision, review and context
// change (with old → new values), the main project history, and what is real
// vs simulated.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { scopeName } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import { Avatar, Badge, Card, PanelTitle, cx } from '../../components/common/ui';

const CATEGORY = {
  tasks: { label: 'Tasks & submissions', tone: 'blue', icon: '✎' },
  agent: { label: 'Agent actions', tone: 'violet', icon: '◆' },
  decisions: { label: 'Human decisions', tone: 'amber', icon: '☝' },
  reviews: { label: 'Reviews & merges', tone: 'green', icon: '✓' },
  context: { label: 'Context changes', tone: 'teal', icon: '◎' },
  notifications: { label: 'Notifications', tone: 'slate', icon: '✉' },
};

function categoryOf(type) {
  if (type.startsWith('agent.')) return 'agent';
  if (type.startsWith('developer.')) return 'decisions';
  if (type.startsWith('review.') || type.startsWith('merge.')) return 'reviews';
  if (type.startsWith('context.') || type === 'impact.decision') return 'context';
  if (type === 'notification.sent') return 'notifications';
  return 'tasks';
}

function Details({ e }) {
  const { nameOf, deptById } = useTeam();
  const d = e.data;
  if (e.type === 'context.changed') {
    return (
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        <div><div className="mb-0.5 font-medium text-dim">Old (v{d.fromVersion})</div><div className="whitespace-pre-line rounded bg-err/10 p-2 text-ink">{d.oldValue}</div></div>
        <div><div className="mb-0.5 font-medium text-dim">New (v{d.toVersion})</div><div className="whitespace-pre-line rounded bg-ok/10 p-2 text-ink">{d.newValue}</div></div>
        <div className="text-dim sm:col-span-2">
          Why: {d.why} · Who: {nameOf(d.who)} · {scopeName(d.scope)} context is now v{d.scopeVersion}
          {d.cause?.viaCentral && <> · follows the Central change</>}
        </div>
      </div>
    );
  }
  if (e.type === 'impact.decision') {
    return (
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex flex-wrap gap-1">
          <Badge tone={d.scope === 'cross_department' ? 'amber' : 'teal'}>{d.scope === 'cross_department' ? 'Cross-department' : 'Department only'}</Badge>
          {d.affectedDepartments.map((x) => <Badge key={x}>{deptById(x)?.name ?? x}</Badge>)}
          {d.editedByManager && <Badge tone="violet">edited by manager</Badge>}
        </div>
        <ul className="m-0 ml-4 list-disc p-0 text-dim">{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="text-dim">Notified: {d.notify.map((n) => `${nameOf(n.userId)}${n.affectsActiveWork ? ' (mid-task alert)' : ''}`).join(', ') || 'nobody'}</div>
        {d.unaffected.length > 0 && <div className="text-dim">Checked, not affected: {d.unaffected.map((n) => nameOf(n.userId)).join(', ')}</div>}
      </div>
    );
  }
  return <pre className="m-0 mt-2 max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[11px] text-dim">{JSON.stringify(d, null, 2)}</pre>;
}

export default function ProjectStory() {
  const { boot, personById, nameOf, deptById, get, tick } = useTeam();
  const [events, setEvents] = useState([]);
  const [commits, setCommits] = useState([]);
  const [cats, setCats] = useState(new Set(['tasks', 'agent', 'decisions', 'reviews', 'context']));
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState(new Set());

  useEffect(() => {
    get('log', { limit: 1000 }).then((r) => setEvents(r.events)).catch(() => {});
    get('commits').then((r) => setCommits(r.commits)).catch(() => {});
  }, [tick]);

  const shown = useMemo(() => events.filter((e) => cats.has(categoryOf(e.type)) && (!dept || e.department === dept || e.department === null)), [events, cats, dept]);
  const counts = [
    ['Context changes', events.filter((e) => e.type === 'context.changed').length],
    ['Mid-task alerts', events.filter((e) => e.type === 'task.context_alert').length],
    ['Human decisions', events.filter((e) => categoryOf(e.type) === 'decisions' || e.type.startsWith('review.')).length],
    ['Merges into main', events.filter((e) => e.type === 'merge.done').length],
  ];
  const toggle = (set, setter, key) => setter(() => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const exportLog = async () => {
    const r = await get('log/export');
    const blob = new Blob([r.events.map((e) => JSON.stringify(e)).join('\n') + '\n'], { type: 'application/x-ndjson' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${boot.project.name}-log.jsonl` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <h1 className="m-0 font-display text-2xl font-bold text-ink">How {boot.project.name} changed, and why</h1>
          <p className="m-0 mt-1 text-sm text-dim">Every task, agent step, human decision, review and context change, newest first. This is the raw material for the project story.</p>

          <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {counts.map(([l, n]) => (
              <Card key={l} className="!p-3"><div className="text-2xl font-semibold text-ink">{n}</div><div className="text-xs text-dim">{l}</div></Card>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {Object.entries(CATEGORY).map(([c, meta]) => (
              <button
                type="button"
                key={c}
                onClick={() => toggle(cats, setCats, c)}
                className={cx('cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-medium ring-1', cats.has(c) ? 'bg-ink text-bg ring-ink' : 'bg-surface text-dim ring-line')}
              >
                {meta.icon} {meta.label}
              </button>
            ))}
            <select className="ml-auto rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {boot.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button type="button" className="cursor-pointer border-0 bg-transparent text-xs font-semibold text-accent underline" onClick={exportLog}>Export JSONL</button>
          </div>

          <ol className="relative m-0 list-none space-y-2 border-l-2 border-line p-0 pl-5">
            {shown.map((e) => {
              const c = CATEGORY[categoryOf(e.type)];
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[31px] top-2 flex size-5 items-center justify-center rounded-full bg-surface text-[11px] ring-2 ring-line">{c.icon}</span>
                  <button type="button" className="w-full cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-left hover:border-dim" onClick={() => toggle(open, setOpen, e.id)}>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={c.tone}>{e.type}</Badge>
                      {e.department && <span className="text-dim">{deptById(e.department)?.name}</span>}
                      {e.actorId
                        ? <span className="flex items-center gap-1 text-dim"><Avatar person={personById(e.actorId)} size={14} />{nameOf(e.actorId)}</span>
                        : <span className="text-dim">{e.type.startsWith('agent.') ? 'agent' : 'system'}</span>}
                      <span className="ml-auto text-dim" title={e.at}>{timeAgo(e.at)}</span>
                    </div>
                    <div className="mt-1 text-sm text-ink">{e.summary}</div>
                    {open.has(e.id) && <Details e={e} />}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
      <aside className="overflow-y-auto border-t border-line bg-surface p-4 lg:border-l lg:border-t-0">
        <PanelTitle>Main project history</PanelTitle>
        <p className="m-0 mb-2 text-xs text-dim">Only a manager's approval merges into main.</p>
        <ol className="m-0 mb-6 list-none space-y-2 p-0">
          {commits.map((c) => (
            <li key={c.id} className="text-xs">
              <span className="text-ink">{c.message}</span>
              <div className="text-dim">{nameOf(c.authorId)} · {timeAgo(c.at)} · {c.files.length} file(s)</div>
            </li>
          ))}
        </ol>

        <PanelTitle>Real vs simulated</PanelTitle>
        <ul className="m-0 mb-6 list-none space-y-1 p-0 text-xs text-dim">
          <li><Badge tone="green">Real</Badge> sign-in, roles, departments, Postgres storage, notifications, activity log</li>
          <li><Badge tone="green">Real</Badge> per-developer project copies, diffs, 3-way merge into main, merge-conflict detection</li>
          <li><Badge tone="green">Real</Badge> versioned context, relevance, outdated detection, impact analysis</li>
          <li><Badge tone={boot.agentMode === 'live' ? 'green' : 'amber'}>{boot.agentMode === 'live' ? 'Real' : 'Simulated'}</Badge> agent reasoning and code edits ({boot.agentMode === 'live' ? `Claude ${boot.agentModel}` : 'scripted; set ANTHROPIC_API_KEY for live'})</li>
          <li><Badge tone="amber">Simulated</Badge> the eight CampusEats demo people, and four days of context history before the demo</li>
        </ul>
        {boot.canUseDemoMode && <Link to={`/projects/${boot.project.id}/setup`} className="text-sm font-semibold text-accent">Team setup / reset demo</Link>}
      </aside>
    </div>
  );
}
