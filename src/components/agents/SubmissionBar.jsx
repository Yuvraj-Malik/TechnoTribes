// Bottom bar: work status, "built on" versions, the editable why, and Submit.
// Shows the agent's pre-submit re-check and the manager's note.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { WORK_STATUS_TONE, scopeName, workStatus } from '../../constants/statuses';
import { Badge, Button, cx, textareaClass } from '../common/ui';

export function BuiltOnBadges({ builtOn, current, scope }) {
  const { me } = useTeam();
  return (
    <span className="flex flex-wrap items-center gap-1">
      {['central', scope ?? me.department].filter(Boolean).map((s) => {
        const stale = current && current[s] !== undefined && current[s] !== builtOn.scopes[s];
        return (
          <Badge key={s} tone={stale ? 'red' : s === 'central' ? 'violet' : 'teal'} title={stale ? `Now v${current[s]}` : undefined}>
            {scopeName(s)} v{builtOn.scopes[s]}{stale ? ` → now v${current[s]}` : ''}
          </Badge>
        );
      })}
    </span>
  );
}

const label = 'text-[11px] font-medium uppercase tracking-wide text-dim';

export default function SubmissionBar({ task, submission, check, scopeVersions, onChanged }) {
  const { post } = useTeam();
  const outdated = !!check && check.outdated.length > 0;
  const status = workStatus(task, submission, outdated);
  const [why, setWhy] = useState(task?.whyDraft ?? '');
  const [blocked, setBlocked] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setWhy(task?.whyDraft ?? ''); setBlocked(null); }, [task?.id, task?.whyDraft]);

  const canSubmit = !!task && ['done', 'sent_back'].includes(task.status);
  const send = async (force = false) => {
    setBusy(true);
    setError('');
    try {
      const r = await post('task/submit', { taskId: task.id, why, force });
      setBlocked(r.submitted ? null : r.check ?? null);
      onChanged?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const note = task?.reviewNote && ['sent_back', 'rejected'].includes(task.status) ? task.reviewNote : null;

  return (
    <footer className="shrink-0 border-t border-line bg-surface px-4 py-3">
      {(blocked || note) && (
        <div className="mb-2 flex flex-col gap-2">
          {note && (
            <div className={cx('rounded-lg px-3 py-2 text-sm', task.status === 'rejected' ? 'bg-err/10 text-err' : 'bg-mark/15 text-ink')}>
              <span className="font-semibold">{task.status === 'rejected' ? 'Rejected' : 'Sent back'} by your manager:</span> {note}
            </div>
          )}
          {blocked && (
            <div className="rounded-lg bg-err/10 px-3 py-2 text-sm text-err">
              <div className="font-semibold">Agent re-check before submit: the context changed while you worked.</div>
              <ul className="m-0 ml-4 list-disc p-0">
                {blocked.outdated.map((o) => (
                  <li key={o.sectionId}>{scopeName(o.scope)} › {o.title}: built on v{o.builtOnVersion}, now v{o.currentVersion}. {o.changes.at(-1)?.why}</li>
                ))}
                {blocked.conflicts.map((c, i) => <li key={i}>{c.explanation}</li>)}
              </ul>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" onClick={() => send(true)}>Submit anyway (manager will see the warning)</Button>
                <Button size="sm" variant="secondary" onClick={() => setBlocked(null)}>Go back and adjust</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex shrink-0 flex-col gap-1">
          <span className={label}>Work status</span>
          <Badge tone={WORK_STATUS_TONE[status]} className="text-sm">{status}</Badge>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <span className={label}>Built on</span>
          {task?.builtOn ? <BuiltOnBadges builtOn={task.builtOn} current={scopeVersions} /> : <span className="text-xs text-dim">—</span>}
        </div>
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className={label}>Why (drafted by your agent, edit freely)</span>
          <textarea
            className={`${textareaClass} resize-none disabled:opacity-60`} rows={2} value={why} disabled={!canSubmit}
            onChange={(e) => setWhy(e.target.value)} placeholder="The agent drafts this when it finishes."
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button disabled={!canSubmit || busy || !why.trim()} onClick={() => send(false)}>
            {busy ? 'Checking…' : task?.status === 'sent_back' ? 'Resubmit' : 'Submit for review'}
          </Button>
          {outdated && canSubmit && <span className="text-[11px] text-err">Context changed since you started</span>}
          {error && <span className="text-[11px] text-err">{error}</span>}
        </div>
      </div>
    </footer>
  );
}
