// One submission: summary, why, context it was built on vs now, the diff,
// Approve / Send back / Reject, and the impact step after approval.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { SUB_STATUS, scopeName } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import DiffViewer from './DiffViewer';
import CriticCard from '../agents/CriticCard';
import ImpactStep from './ImpactStep';
import { BuiltOnBadges } from '../agents/SubmissionBar';
import { Avatar, Badge, Button, Card, Empty, cx, textareaClass } from '../common/ui';

export default function ReviewDetail({ id, onChanged }) {
  const { personById, nameOf, get, post, tick } = useTeam();
  const [d, setD] = useState(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => get('review/detail', { submissionId: id }).then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id, tick]);
  useEffect(() => { setMode('none'); setNote(''); setError(''); setD(null); }, [id]);

  if (!d) return error ? <Empty>{error}</Empty> : <Empty>Loading…</Empty>;
  const s = d.submission;
  const dev = personById(s.userId) ?? { id: s.userId, name: s.userName };
  const open = s.status === 'pending' || s.status === 'merge_conflict';

  const act = async (action) => {
    setBusy(true);
    setError('');
    try {
      await post('review/decide', { submissionId: s.id, action, note });
      setMode('none'); setNote('');
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const last = (o) => o.changes.at(-1);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Avatar person={dev} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-display text-xl font-bold text-ink">{s.title}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-dim">
            <span>{dev.name} · submitted {timeAgo(s.createdAt)}</span>
            <Badge tone={SUB_STATUS[s.status].tone}>{SUB_STATUS[s.status].label}</Badge>
            {s.reviewedBy && <span>by {nameOf(s.reviewedBy)} {timeAgo(s.reviewedAt)}</span>}
          </div>
        </div>
      </div>

      {s.outdated.length > 0 && (
        <Card tone="red">
          <div className="mb-1 font-semibold text-err">⚠ Outdated: the context changed after this was built</div>
          <ul className="m-0 list-none space-y-1 p-0 text-sm text-ink">
            {s.outdated.map((o) => (
              <li key={o.sectionId}>
                This was built on <b>{scopeName(o.scope)} › {o.title} v{o.builtOnVersion}</b>, current is <b>v{o.currentVersion}</b>: {last(o)?.why}
                <span className="text-dim"> ({nameOf(last(o)?.changedBy)}, {timeAgo(last(o)?.changedAt)})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {s.conflicts.length > 0 && (
        <Card tone="amber">
          <div className="mb-1 font-semibold text-ink">Conflicts with the current context</div>
          <ul className="m-0 ml-4 list-disc p-0 text-sm">{s.conflicts.map((c, i) => <li key={i}>{c.explanation}</li>)}</ul>
        </Card>
      )}
      {s.status === 'merge_conflict' && (
        <Card tone="red">
          <div className="font-semibold text-err">Merge conflict: nothing was merged</div>
          <p className="m-0 text-sm text-ink">The main project changed the same files: <span className="font-mono">{s.mergeInfo?.conflictedFiles?.join(', ')}</span>. Send it back so {dev.name} can update their copy, or reject it.</p>
        </Card>
      )}
      {s.reviewNote && !open && <Card><span className="text-sm"><b>{nameOf(s.reviewedBy)}'s note:</b> {s.reviewNote}</span></Card>}

      {s.critique && <CriticCard critique={s.critique} />}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">What changed (plain words)</div>
          <p className="m-0 text-sm text-ink">{s.summary}</p>
        </Card>
        <Card>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Why</div>
          <p className="m-0 text-sm text-ink">{s.why}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-dim">Context it was built on vs now</div>
          <BuiltOnBadges builtOn={s.builtOn} current={d.currentScopes} scope={s.department} />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-dim"><th className="py-1 font-medium">Section</th><th className="font-medium">Built on</th><th className="font-medium">Current</th><th /></tr></thead>
          <tbody>
            {d.used.map((u) => {
              const changed = u.currentVersion > u.builtOnVersion;
              return (
                <tr key={u.sectionId} className={cx('border-t border-line', changed && 'bg-err/5')}>
                  <td className="py-1">{scopeName(u.scope)} › {u.title}</td>
                  <td>v{u.builtOnVersion}</td>
                  <td className={cx(changed && 'font-semibold text-err')}>v{u.currentVersion}</td>
                  <td>{changed ? <Badge tone="red">changed since</Badge> : <Badge tone="green">same</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {open && (
        <Card className="sticky top-0 z-10 shadow-sm">
          {mode === 'none' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="success" disabled={busy || s.status === 'merge_conflict'} onClick={() => act('approve')}>{busy ? 'Merging…' : 'Approve and merge'}</Button>
              <Button variant="warning" onClick={() => setMode('send_back')}>Send back</Button>
              <Button variant="danger" onClick={() => setMode('reject')}>Reject</Button>
              {s.outdated.length > 0 && <span className="text-xs text-err">Built on older context: consider sending it back.</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-ink">{mode === 'reject' ? 'Why are you rejecting it? (required)' : 'What should the developer change? (required)'}</label>
              <textarea
                className={textareaClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={mode === 'send_back' && s.outdated.length ? `e.g. ${s.outdated[0].title} changed to v${s.outdated[0].currentVersion}; please rebuild on the new context.` : ''}
              />
              <div className="flex gap-2">
                <Button variant={mode === 'reject' ? 'danger' : 'warning'} disabled={busy || !note.trim()} onClick={() => act(mode)}>{mode === 'reject' ? 'Reject' : 'Send back'}</Button>
                <Button variant="ghost" onClick={() => setMode('none')}>Back</Button>
              </div>
            </div>
          )}
          {error && <div className="mt-2 text-sm text-err">{error}</div>}
        </Card>
      )}

      {d.proposal?.status === 'pending' && <ImpactStep proposal={d.proposal} onDone={() => { load(); onChanged?.(); }} />}
      {d.proposal && d.proposal.status !== 'pending' && (
        <Card tone={d.proposal.status === 'applied' ? 'green' : undefined}>
          <div className="text-sm">
            <b>{d.proposal.status === 'applied' ? 'Context updated' : 'Context update skipped'}</b>
            {d.proposal.status === 'applied' && (
              <> · {d.proposal.impact.scope === 'cross_department' ? 'cross-department' : 'department only'}: {d.proposal.changes.filter((c) => c.include).map((c) => `${scopeName(c.scope)} › ${c.title}`).join(', ')}. Notified {d.proposal.impact.notify.map((n) => nameOf(n.userId)).join(', ') || 'nobody'}.</>
            )}
          </div>
        </Card>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">File changes</div>
        <DiffViewer diff={s.diff} />
      </div>
    </div>
  );
}
