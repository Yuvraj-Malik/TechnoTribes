// Revert, with what depends on the change shown first.
//   kind 'context': write an earlier version of a context item back (a new version).
//   kind 'merge':   ask to undo a merge (an "undo" submission in the review queue).
// The server decides who may do it; this shows the facts before anyone confirms.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { scopeName } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import { Button, Card, textareaClass } from './ui';

export default function RevertPanel({ kind, itemId, toVersion, submissionId, onClose, onDone }) {
  const { get, post, nameOf } = useTeam();
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    const load = kind === 'context'
      ? get('revert/preview', { itemId, toVersion })
      : get('revert/merge-preview', { submissionId });
    load.then(setPreview).catch((e) => setError(e.message));
  }, [kind, itemId, toVersion, submissionId]);

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      const r = kind === 'context'
        ? await post('revert/context', { itemId, toVersion, reason })
        : await post('revert/merge', { submissionId, reason });
      setResult(r);
      onDone?.(r);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (error && !preview) return <Card tone="red" className="!p-3 text-xs">{error}</Card>;
  if (!preview) return <Card className="!p-3 text-xs text-dim">Checking what depends on it…</Card>;
  if (result) {
    const s = result.suggestion ?? result.submission;
    return (
      <Card tone="green" className="!p-3 text-xs text-ink">
        {kind === 'context'
          ? (s.status === 'approved' || s.status === 'applied' ? 'Reverted: the earlier content is now the newest version. Everyone affected was told.' : `Sent for approval: ${s.reasons?.join(' ')}`)
          : 'The undo is in the review queue. Approving it merges it back; if later work touched the same lines, you will see a conflict, not a forced change.'}
      </Card>
    );
  }

  const d = preview.dependents;
  const later = kind === 'merge' ? preview.laterMerges : [];
  const warn = kind === 'context' ? d.count > 0 || d.laterVersions.length > 1 : later.length > 0;
  return (
    <Card tone={warn ? 'amber' : undefined} className="space-y-2 !p-3 text-xs">
      {kind === 'context' ? (
        <>
          <div className="font-semibold text-ink">Revert {scopeName(preview.item.scope)} › {preview.item.title} to v{preview.target.version}</div>
          <div className="whitespace-pre-line rounded bg-surface p-2 text-ink">{preview.target.content}</div>
          <div className="font-medium text-ink">What depends on the newer version{d.laterVersions.length > 1 ? 's' : ''}:</div>
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-ink">
            {d.laterVersions.map((v) => <li key={v.version}>v{v.version} by {nameOf(v.changedBy)}, {timeAgo(v.changedAt)}: {v.why}</li>)}
            {d.tasks.map((t) => <li key={t.taskId}><b>{t.userName}</b>'s task “{t.text}” was built on v{t.builtOnVersion} and will be told.</li>)}
            {d.submissions.map((s) => <li key={s.submissionId}>Waiting submission “{s.title}” by {s.userName} will show as Outdated.</li>)}
            {d.checkpoints.map((c) => <li key={c.id}>Checkpoint “{c.title}” links to it.</li>)}
            {d.count === 0 && <li className="text-dim">No active work or checkpoint is built on it.</li>}
          </ul>
        </>
      ) : (
        <>
          <div className="font-semibold text-ink">Undo the merge “{preview.submission.title}”</div>
          <div className="text-ink">Files: <span className="font-mono">{preview.submission.files.join(', ')}</span></div>
          <div className="font-medium text-ink">Later merges that touched the same files:</div>
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-ink">
            {later.map((c) => <li key={c.id}>{c.message} ({c.files.join(', ')}, {timeAgo(c.at)})</li>)}
            {later.length === 0 && <li className="text-dim">None, so the undo should apply cleanly.</li>}
          </ul>
        </>
      )}
      {!preview.canRevert ? (
        <p className="m-0 text-dim">{preview.item?.scope === 'central' ? 'Only the founder can revert central context.' : 'Only this department\'s manager or the founder can revert it.'}</p>
      ) : (
        <>
          <textarea className={textareaClass} rows={2} placeholder="Why are you reverting? Everyone affected reads this." value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p className="m-0 text-err">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="warning" disabled={busy || !reason.trim()} onClick={confirm}>{kind === 'context' ? 'Revert' : 'Ask to undo'}</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}
    </Card>
  );
}
