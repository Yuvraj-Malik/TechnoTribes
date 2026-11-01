// Observer requests. The observer asks for changes in plain words; the owner or
// an admin turns one into a task for a developer, or declines it with a reason.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Badge, Button, cx } from '../../components/common/ui';
import { EmptyState, PageHeader } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, REQUEST_STATUS, Section, areaClass, inputClass, useAction, useLive, useProjectApi } from './shared';

function NewRequest({ api, onSent }) {
  const act = useAction();
  const [message, setMessage] = useState('');
  return (
    <Section title="Ask for a change" description="Describe it the way you would to a person. The team decides who builds it, and you see its progress here.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await act.run('send', () => api.post('observer/request', { message }), 'Sent. The managers were notified.')) { setMessage(''); onSent(); } }}>
        <Notice error={act.error} ok={act.ok} />
        <textarea className={areaClass} rows={4} required minLength={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. The checkout button is hard to find on phones. Can it be bigger and green?" />
        <Button type="submit" className="min-h-11" disabled={!!act.busy || message.trim().length < 5}>{act.busy ? 'Sending…' : 'Send request'}</Button>
      </form>
    </Section>
  );
}

function RequestItem({ r, manage, api, onChange }) {
  const navigate = useNavigate();
  const { projectId } = useTeam();
  const act = useAction();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const st = REQUEST_STATUS[r.status] ?? { label: r.status, tone: 'slate' };
  return (
    <li className={cx('rounded-xl border p-4', r.status === 'pending' && manage ? 'border-mark bg-mark/5' : 'border-line bg-surface')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="m-0 min-w-0 flex-1 whitespace-pre-line text-ink">“{r.message}”</p>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="m-0 mt-1.5 text-xs text-dim">
        {manage && r.observerName ? `${r.observerName} · ` : ''}{timeAgo(r.created_at)}
        {r.adminName && r.status !== 'pending' ? ` · handled by ${r.adminName}` : ''}
      </p>
      {r.response && <p className="m-0 mt-2 rounded-lg bg-bg px-3 py-2 text-sm text-ink">{r.response}</p>}
      <Notice error={act.error} />
      {manage && r.status === 'pending' && !declining && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => navigate(`/projects/${projectId}/tasks?request=${r.id}&title=${encodeURIComponent(r.message.slice(0, 180))}`)}>Assign as a task</Button>
          <Button variant="secondary" className="min-h-11" onClick={() => setDeclining(true)}>Decline</Button>
        </div>
      )}
      {manage && r.status === 'accepted' && (
        <Button variant="ghost" className="mt-2 min-h-11" disabled={!!act.busy}
          onClick={() => act.run('done', () => api.post('observer/request/respond', { requestId: r.id, status: 'done' })).then(onChange)}>
          Mark as done
        </Button>
      )}
      {declining && (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={async (e) => { e.preventDefault(); if (await act.run('no', () => api.post('observer/request/respond', { requestId: r.id, status: 'rejected', response: reason }))) onChange(); }}>
          <input className={inputClass} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell them why, in plain words" />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" className="min-h-11" disabled={!!act.busy}>Decline</Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setDeclining(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function RequestsPage() {
  const { me } = useTeam();
  const api = useProjectApi();
  const { data, loading, error, reload } = useLive(() => api.get('observer/requests'), []);
  const isObserver = me.role === 'observer';
  const manage = !isObserver && !me.actingAs;
  const [filter, setFilter] = useState('open');
  const all = data?.requests ?? [];
  const shown = all.filter((r) => (filter === 'open' ? ['pending', 'accepted'].includes(r.status) : ['done', 'rejected'].includes(r.status)));

  return (
    <Page wide={!isObserver}>
      <PageHeader
        title={isObserver ? 'My requests' : 'Observer requests'}
        description={isObserver ? 'Changes you asked for and where each one stands.' : 'What the observer asked for. Assign one as a task and they follow it to done.'}
      />
      <Notice error={error} />
      <div className={cx('grid gap-5', isObserver && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
        {isObserver && <div><NewRequest api={api} onSent={reload} /></div>}
        <div className="min-w-0">
          <div className="mb-4 flex gap-2" role="tablist">
            {[['open', 'Open'], ['closed', 'Closed']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={cx('min-h-11 cursor-pointer rounded-full border-[1.5px] px-4 text-sm font-semibold', filter === k ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-dim')}>
                {label}
              </button>
            ))}
          </div>
          {loading && !data ? <Loading /> : shown.length === 0 ? (
            <EmptyState icon="inbox" title={filter === 'open' ? 'No open requests' : 'Nothing closed yet'} text={isObserver ? 'Ask for a change and it appears here.' : 'When the observer asks for something, it lands here.'} />
          ) : (
            <ul className="m-0 list-none space-y-3 p-0">
              {shown.map((r) => <RequestItem key={r.id} r={r} manage={manage} api={api} onChange={reload} />)}
            </ul>
          )}
        </div>
      </div>
    </Page>
  );
}
