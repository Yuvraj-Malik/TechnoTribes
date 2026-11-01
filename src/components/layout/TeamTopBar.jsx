// Project bar of the team workspace (sits under the main navbar): department,
// who you are acting as, agent mode, and the owner's demo person switcher.
// Page tabs live in the sidebar; theme and your own notifications in the navbar.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { timeAgo } from '../../utils/time';
import { Avatar, Badge, cx } from '../common/ui';
import { focusRing } from '../common/styles';

const ROLE = { owner: 'Owner', admin: 'Manager', worker: 'Developer', observer: 'Observer' };

function PersonSwitcher() {
  const { boot, me, actAs, setActAs, projectId } = useTeam();
  const navigate = useNavigate();
  if (!boot.canUseDemoMode) return null;
  const demo = boot.people.filter((p) => p.isDemo);
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-bg py-1 pl-2 pr-1 text-sm">
      <Avatar person={me} size={22} />
      <span className="sr-only">Acting as</span>
      <select
        className="cursor-pointer bg-transparent pr-1 font-medium text-ink outline-none"
        value={actAs}
        onChange={(e) => {
          const next = boot.people.find((p) => p.id === e.target.value);
          setActAs(e.target.value);
          navigate(`/projects/${projectId}`);
        }}
      >
        <option value="">You (owner)</option>
        {boot.departments.map((d) => (
          <optgroup key={d.id} label={`${d.name} · demo people`}>
            {demo.filter((p) => p.department === d.id).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {ROLE[p.role]}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Bell() {
  const { get, post, tick, me } = useTeam();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => { get('notifications').then((r) => setItems(r.notifications)).catch(() => {}); }, [tick, me.id]);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = items.filter((n) => !n.read).length;
  const markAll = () => post('notifications/read').then(() => get('notifications')).then((r) => setItems(r.notifications));
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`relative flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-surface px-3 text-dim ${focusRing}`}
        aria-label={`${me.name}'s notifications (${unread} unread)`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-mark px-1 text-[11px] font-bold text-ink">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && <button type="button" className="cursor-pointer border-0 bg-transparent text-xs font-semibold text-accent underline" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="p-4 text-sm text-dim">Nothing yet.</div>}
            {items.map((n) => (
              <div key={n.id} className={cx('border-b border-line px-4 py-3 text-sm', !n.read && 'bg-mark/10')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-ink">{n.title}</span>
                  <span className="shrink-0 text-xs text-dim">{timeAgo(n.created_at)}</span>
                </div>
                <p className="m-0 mt-0.5 whitespace-pre-line text-dim">{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamTopBar() {
  const { boot, me, dept } = useTeam();
  const live = boot.agentMode === 'live';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2.5">
        {dept && <span className="size-2.5 shrink-0 rounded-full" style={{ background: dept.color }} aria-hidden="true" />}
        <p className="m-0 min-w-0 truncate text-sm text-dim">
          <span className="font-semibold text-ink">{dept ? dept.name : 'All departments'}</span>
          {' · '}{me.name} ({ROLE[me.role]}){me.actingAs ? ' · demo person' : ''}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Badge tone={live ? 'green' : 'amber'} title={live ? `Builder: ${boot.agentModel} · Critic: ${boot.criticModel}` : 'No model API key on the server: agents use scripted responses'}>
          {live ? `● Live agents · ${boot.agentModel}` : '⚙ Simulated agent'}
        </Badge>
        {/* Your own notifications are in the navbar bell. This one shows the demo person's. */}
        {me.actingAs && <Bell />}
        <PersonSwitcher />
      </div>
    </div>
  );
}
