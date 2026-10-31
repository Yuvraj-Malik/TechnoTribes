// The owner's inbox: what is waiting on them, most urgent first. Reviews and investor
// replies open in place, so the owner can act without leaving the list.
import { useState } from 'react';
import ActionButton from '../common/ActionButton';
import Alert from '../common/Alert';
import Badge from '../common/Badge';
import TextArea from '../common/TextArea';
import { card, focusRing, outlineButton, quietButton } from '../common/styles';

function RequestReview({ request, onDecide }) {
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const review = request.criticReviews?.[0];
  const summary = request.proposals?.[0]?.summary;

  async function sendBack(e) {
    e.preventDefault();
    setBusy(true);
    await onDecide(request.id, 'redirect', note.trim());
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{request.submittedByName || 'A team member'}</span>
        {review && <Badge tone={review.verdict === 'approve' ? 'accent' : 'warn'}>Critic: {review.verdict}, {review.score}/100</Badge>}
      </div>
      {summary && <p className="m-0 mt-1 text-sm">{summary}</p>}
      <ul className="m-0 mt-2 list-none space-y-0.5 p-0 font-mono text-xs text-dim">
        {(request.change_list || []).map((change) => (
          <li key={`${change.proposalId}-${change.path}`} className="break-all">{change.action} {change.path}</li>
        ))}
      </ul>
      {sendingBack ? (
        <form onSubmit={sendBack} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            aria-label={`What should ${request.submittedByName || 'they'} do instead?`}
            placeholder="What should they do instead?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            className={`min-w-0 flex-1 basis-48 rounded-lg border border-line bg-surface px-3 py-1.5 text-base text-ink max-lg:min-h-11 lg:text-sm ${focusRing}`}
          />
          <button type="submit" disabled={busy} className={outlineButton}>Send back</button>
          <button type="button" className={quietButton} onClick={() => setSendingBack(false)}>Cancel</button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1">
          <ActionButton onAction={() => onDecide(request.id, 'approve')}>Approve</ActionButton>
          <button type="button" className={quietButton} onClick={() => setSendingBack(true)}>Send back</button>
          <ActionButton variant="quiet" onAction={() => onDecide(request.id, 'reject')}>Reject</ActionButton>
        </div>
      )}
    </div>
  );
}

// The endpoint takes done or rejected. Accepting a request means assigning it as a task.
function InvestorReply({ requestId, onReply, onSent }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(status) {
    const response = text.trim();
    if (status === 'rejected' && !response) return setError('Tell the investor why before you decline.');
    setBusy(true);
    setError('');
    try {
      await onReply(requestId, status, response);
      onSent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-bg p-3">
      <TextArea
        label="Your reply to the investor"
        hint="They read this as written, so keep it plain. You need one to decline."
        value={text}
        onChange={(e) => { setText(e.target.value); setError(''); }}
      />
      <Alert tone="error">{error}</Alert>
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={busy} className={outlineButton} onClick={() => send('done')}>Mark done</button>
        <button type="button" disabled={busy} className={quietButton} onClick={() => send('rejected')}>Decline</button>
      </div>
    </div>
  );
}

function Item({ item, onAdmin, onJoin, onDecide, onReply }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={item.tone}>{item.label}</Badge>
        <span className="min-w-48 flex-1 text-sm break-words">{item.text}</span>
        <span className="flex gap-1">
          {item.kind === 'admin' && (
            <>
              <ActionButton onAction={() => onAdmin(item.userId, true)}>Approve</ActionButton>
              <ActionButton variant="quiet" onAction={() => onAdmin(item.userId, false)}>Decline</ActionButton>
            </>
          )}
          {item.kind === 'join' && (
            <>
              <ActionButton onAction={() => onJoin(item.requestId, true)}>Accept</ActionButton>
              <ActionButton variant="quiet" onAction={() => onJoin(item.requestId, false)}>Decline</ActionButton>
            </>
          )}
          {item.mergeRequests && (
            <button type="button" aria-expanded={open} className={outlineButton} onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Review'}
            </button>
          )}
          {item.kind === 'investor' && (
            <button type="button" aria-expanded={open} className={outlineButton} onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Reply'}
            </button>
          )}
        </span>
      </div>
      {open && item.mergeRequests && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {item.mergeRequests.map((request) => <RequestReview key={request.id} request={request} onDecide={onDecide} />)}
        </div>
      )}
      {open && item.kind === 'investor' && <InvestorReply requestId={item.requestId} onReply={onReply} onSent={() => setOpen(false)} />}
    </li>
  );
}

export default function NeedsYouList({ items, onAdmin, onJoin, onDecide, onReply }) {
  if (!items.length) {
    return <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>You're all caught up.</p>;
  }
  return (
    <ul className={`${card} m-0 list-none divide-y divide-line p-0`}>
      {items.map((item) => <Item key={item.id} item={item} onAdmin={onAdmin} onJoin={onJoin} onDecide={onDecide} onReply={onReply} />)}
    </ul>
  );
}
