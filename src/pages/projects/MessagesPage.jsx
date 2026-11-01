// Messages. The owner writes to one admin or to all of them and sees what was
// sent. An admin reads what the owner sent them. Each message also notifies.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Avatar, Badge, Button } from '../../components/common/ui';
import { EmptyState, PageHeader, buttonPrimary } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, Section, areaClass, selectClass, useAction, useLive } from './shared';

function MessageList({ messages, owner }) {
  return (
    <ol className="m-0 list-none p-0">
      {messages.map((m) => (
        <li key={m.id} className="border-b border-line py-3.5 first:pt-0 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Avatar person={{ id: m.senderId, name: m.senderName }} size={26} />
            <span className="min-w-0 text-sm font-semibold text-ink">
              {owner ? `To ${m.toAll ? 'all admins' : m.recipientNames.join(', ')}` : m.senderName}
            </span>
            {!owner && <Badge>{m.toAll ? 'All admins' : 'Just you'}</Badge>}
            <span className="ml-auto text-xs text-dim">{timeAgo(m.at)}</span>
          </div>
          <p className="m-0 mt-2 text-sm break-words whitespace-pre-wrap text-ink">{m.text}</p>
        </li>
      ))}
    </ol>
  );
}

function Compose({ admins, onSent }) {
  const { post } = useTeam();
  const act = useAction();
  const [to, setTo] = useState('all');
  const [text, setText] = useState('');
  const send = async (e) => {
    e.preventDefault();
    const name = to === 'all' ? 'all admins' : admins.find((a) => a.id === to)?.name;
    const sent = await act.run('send', () => post('messages/send', { to, text }), `Sent to ${name}.`);
    if (sent) { setText(''); onSent(); }
  };
  return (
    <Section title="New message" description="They get a notification straight away.">
      <form className="space-y-3" onSubmit={send}>
        <Notice error={act.error} ok={act.ok} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Send to</span>
          <select className={`${selectClass} w-full`} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="all">All admins ({admins.length})</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Message</span>
          <textarea className={areaClass} rows={5} required maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="The launch moved to Friday. Please re-plan your team's work." />
        </label>
        <Button type="submit" className="min-h-11" disabled={!!act.busy || !text.trim()}>{act.busy ? 'Sending…' : 'Send'}</Button>
      </form>
    </Section>
  );
}

export default function MessagesPage() {
  const { boot, get, me, projectId } = useTeam();
  const { data, loading, error, reload } = useLive(() => get('messages'), [me.id]);
  const owner = me.role === 'owner';
  const admins = boot.people.filter((p) => p.role === 'admin');

  if (me.role !== 'owner' && me.role !== 'admin') return <Page><Notice error="Messages are for the owner and admins." /></Page>;
  if (loading && !data) return <Page><Loading /></Page>;
  if (!data) return <Page><Notice error={error} /></Page>;

  if (owner && !admins.length) {
    return (
      <Page>
        <PageHeader title="Messages" description="Write to one admin or to all of them." />
        <EmptyState icon="message" title="No admins yet" text="You can send messages once an admin joins.">
          <Link to={`/projects/${projectId}/team`} className={buttonPrimary}>Invite an admin</Link>
        </EmptyState>
      </Page>
    );
  }

  const list = data.messages.length
    ? <MessageList messages={data.messages} owner={owner} />
    : <p className="m-0 text-sm text-dim">{owner ? 'Messages you send will show up here.' : 'Messages from the owner will show up here.'}</p>;

  return (
    <Page wide={owner}>
      <PageHeader title="Messages" description={owner ? 'Write to one admin or to all of them.' : 'What the project owner has sent you.'} />
      <Notice error={error} />
      {owner ? (
        <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Compose admins={admins} onSent={reload} />
          <Section title={`Sent (${data.messages.length})`}>{list}</Section>
        </div>
      ) : <Section>{list}</Section>}
    </Page>
  );
}
