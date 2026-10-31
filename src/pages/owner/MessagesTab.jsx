// The owner writes to one admin or to all of them. Admins get a notification.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useOwner } from '../../features/projects/ownerContext';
import { useProjectResource } from '../../features/projects/useProjectResource';
import { firstName } from '../../features/projects/overviewModel';
import Alert from '../../components/common/Alert';
import Avatar from '../../components/common/Avatar';
import PageHeader from '../../components/common/PageHeader';
import TextArea from '../../components/common/TextArea';
import { when } from '../../components/timeline/RecentChanges';
import { card, sectionTitle, solidButton } from '../../components/common/styles';

function RecipientOption({ value, label, color, checked, onChange }) {
  const id = `to-${value}`;
  return (
    <div className="relative">
      <input type="radio" name="to" id={id} value={value} checked={checked} onChange={onChange} className="peer absolute inset-0 cursor-pointer opacity-0" />
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-line bg-surface px-3.5 py-1.5 text-sm max-lg:min-h-11 peer-checked:border-accent peer-checked:font-semibold peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mark peer-focus-visible:outline-solid"
      >
        {color && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />}
        {label}
      </label>
    </div>
  );
}

export default function MessagesTab() {
  const { data, projectId, base, colors } = useOwner();
  const sent = useProjectResource('messages/list');
  const [to, setTo] = useState('all');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const admins = data.members.filter((m) => m.role === 'admin' && m.status === 'active');
  const chosen = admins.find((a) => a.user_id === to);
  const audience = chosen ? chosen.name : 'all admins';

  async function onSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return setError('Write a message first.');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('messages/send', { method: 'POST', body: { projectId, to, text: text.trim() } });
      setNotice(`Sent to ${audience}.`);
      setText('');
      await sent.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!admins.length) {
    return (
      <>
        <PageHeader title="Messages">Write to one admin or to all of them.</PageHeader>
        <p className={`${card} m-0 px-6 py-8 text-center text-sm text-dim`}>
          You can send messages once an admin joins. <Link to={`${base}/settings`} className="font-semibold text-accent">Create an admin code in Settings</Link>
        </p>
      </>
    );
  }

  const messages = sent.data?.messages;

  return (
    <>
      <PageHeader title="Messages">Write to one admin or to all of them. They get a notification straight away.</PageHeader>
      <div className="grid gap-7 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <form onSubmit={onSubmit} className={`${card} self-start p-4`}>
          <fieldset className="m-0 mb-4 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">Send to</legend>
            <div className="flex flex-wrap gap-1.5">
              <RecipientOption value="all" label="All admins" checked={to === 'all'} onChange={() => setTo('all')} />
              {admins.map((admin) => (
                <RecipientOption
                  key={admin.user_id}
                  value={admin.user_id}
                  label={firstName(admin.name)}
                  color={colors[admin.user_id]}
                  checked={to === admin.user_id}
                  onChange={() => setTo(admin.user_id)}
                />
              ))}
            </div>
          </fieldset>
          <TextArea label="Message" rows={5} placeholder="The launch moved to Friday. Please re-plan your team's work." value={text} onChange={(e) => { setText(e.target.value); setError(''); }} />
          <Alert tone="error">{error}</Alert>
          <Alert tone="ok">{notice}</Alert>
          <button type="submit" className={solidButton} disabled={busy}>{busy ? 'Sending…' : `Send to ${chosen ? firstName(chosen.name) : 'all admins'}`}</button>
        </form>

        <section aria-label="Sent messages">
          <h2 className={`${sectionTitle} mb-2`}>Sent</h2>
          <Alert tone="error">{sent.error}</Alert>
          {messages?.length === 0 && <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>Messages you send will show up here.</p>}
          {messages?.length > 0 && (
            <ol className="m-0 list-none space-y-2 p-0">
              {messages.map((message) => (
                <li key={message.id} className={`${card} px-4 py-3`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar name={message.senderName} className="size-7" />
                    <span className="text-sm font-semibold">To {message.to_all ? 'all admins' : message.recipientNames.join(', ')}</span>
                    <span className="ml-auto text-xs text-dim">{when(message.created_at)}</span>
                  </div>
                  <p className="m-0 mt-1.5 text-sm break-words whitespace-pre-wrap">{message.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
