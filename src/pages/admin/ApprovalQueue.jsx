// Approvals: suggestions to shared context that need a person.
// Department manager: plan changes, conflicts and large changes in their
// department, plus central matters they look at first (workaround or escalate).
// Founder: anything touching central context, and checkpoints.
// Every item shows what is suggested, who suggested it, why it needs approval
// (the rule or plan item it changes or breaks) and what depends on it.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { Avatar, Badge, Button, cx } from '../../components/common/ui';
import { PageHeader } from '../../components/dashboard/ui';
import { scopeName } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, Section, areaClass, useAction, useLive } from '../projects/shared';

const LABEL = {
  plan_change: { text: 'Plan change', tone: 'violet' },
  conflict: { text: 'Conflict', tone: 'red' },
  large_change: { text: 'Large change', tone: 'amber' },
  checkpoint: { text: 'Checkpoint', tone: 'green' },
  progress: { text: 'Progress', tone: 'slate' },
  unchecked: { text: 'Needs a check', tone: 'amber' },
  revert: { text: 'Revert', tone: 'amber' },
};
const KIND = {
  goal: 'Goal', must_do: 'Must do', must_not: 'Must not', decision: 'Decision', done: 'Definition of done',
  progress: 'Progress', checkpoint: 'Checkpoint', note: 'Note',
};

/** Which decisions this item allows (the server enforces the same rules). */
function actionsFor(s) {
  const central = s.scope === 'central' || (s.ruleHits ?? []).some((h) => h.scope === 'central');
  if (s.status === 'pending_manager' && central) return ['workaround', 'escalate', 'reject'];
  return ['approve', 'reject'];
}

const ACTION = {
  approve: { text: 'Approve', variant: 'success', needsReason: false },
  reject: { text: 'Reject', variant: 'danger', needsReason: true, prompt: 'Why is it rejected? The agent gets this so it does not repeat it.' },
  workaround: { text: 'Resolve with a workaround', variant: 'secondary', needsReason: true, prompt: 'What should they do instead, inside the department?' },
  escalate: { text: 'Escalate to the founder', variant: 'warning', needsReason: true, prompt: 'Why does the central context have to change?' },
};

function Change({ c }) {
  const verb = c.op === 'add' ? 'Add' : c.op === 'remove' ? 'Remove' : 'Change';
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-semibold text-ink">{verb}</span>
        <Badge>{scopeName(c.scope ?? 'central')}</Badge>
        <Badge tone="violet">{KIND[c.kind] ?? 'Item'}</Badge>
        <span className="font-medium text-ink">{c.title}</span>
        {c.current && <span className="text-xs text-dim">now v{c.current.version}</span>}
      </div>
      {c.op === 'update' && c.current ? (
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="mb-0.5 text-xs font-medium text-dim">Now</div>
            <div className="whitespace-pre-line rounded bg-err/10 p-2 text-ink">{c.current.content}</div>
          </div>
          <div>
            <div className="mb-0.5 text-xs font-medium text-dim">Suggested</div>
            <div className="whitespace-pre-line rounded bg-ok/10 p-2 text-ink">{c.content}</div>
          </div>
        </div>
      ) : c.op === 'remove' ? (
        <p className="m-0 mt-2 whitespace-pre-line rounded bg-err/10 p-2 text-sm text-ink line-through decoration-err/60">{c.current?.content}</p>
      ) : (
        <p className="m-0 mt-2 whitespace-pre-line rounded bg-ok/10 p-2 text-sm text-ink">{c.content}</p>
      )}
    </li>
  );
}

function Item({ s, onDone }) {
  const { personById, nameOf, post } = useTeam();
  const act = useAction();
  const [mode, setMode] = useState('');
  const [reason, setReason] = useState('');
  const label = LABEL[s.label] ?? { text: 'Suggestion', tone: 'slate' };
  const actions = actionsFor(s);
  const decide = async (action) => {
    const r = await act.run(action, () => post('suggestions/decide', { suggestionId: s.id, action, reason }));
    if (r) onDone(r);
  };
  const person = personById(s.suggestedBy) ?? { id: s.suggestedBy, name: s.suggesterName };

  return (
    <Section className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar person={person} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={label.tone}>{label.text}</Badge>
            {s.status === 'pending_founder' && <Badge tone="violet">Founder decides</Badge>}
            {s.status === 'pending_manager' && actions.includes('escalate') && <Badge tone="amber">Touches central: you look first</Badge>}
            <span className="text-sm text-dim">{scopeName(s.scope)} context</span>
          </div>
          <p className="m-0 mt-1 text-sm text-ink">
            <strong>{person.name}</strong>{s.source === 'agent' ? "'s agent" : ''} suggested this {timeAgo(s.createdAt)}.
          </p>
          <p className="m-0 mt-1 text-sm text-dim">Their reason: “{s.why}”</p>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold tracking-wide text-dim uppercase">What is suggested</div>
        <ul className="m-0 list-none space-y-2 p-0">{s.changes.map((c, i) => <Change key={i} c={c} />)}</ul>
      </div>

      <div className="rounded-lg bg-mark/10 p-3 text-sm">
        <div className="mb-1 text-xs font-semibold tracking-wide text-dim uppercase">Why it needs your decision</div>
        <ul className="m-0 list-disc space-y-1 pl-5 text-ink">{(s.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}</ul>
        {s.ruleHits?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {s.ruleHits.map((h, i) => <Badge key={i} tone="red">{h.rule === 'reviewer' ? 'Reviewer' : 'Rule'}: {scopeName(h.scope)} › {h.sectionTitle}</Badge>)}
          </div>
        )}
        {s.managerNote && <p className="m-0 mt-2 text-ink"><strong>{nameOf(s.escalatedBy)} escalated it:</strong> {s.managerNote}</p>}
      </div>

      <div className="text-sm">
        <div className="mb-1 text-xs font-semibold tracking-wide text-dim uppercase">What depends on it</div>
        {s.dependents.tasks.length + s.dependents.suggestions.length === 0
          ? <p className="m-0 text-dim">No active work or other suggestions use these items.</p>
          : (
            <ul className="m-0 list-disc space-y-0.5 pl-5 text-ink">
              {s.dependents.tasks.map((t) => <li key={t.taskId}><strong>{t.userName}</strong>'s active task “{t.text}” ({t.status.replace(/_/g, ' ')}) uses these items and will be told.</li>)}
              {s.dependents.suggestions.map((o) => <li key={o.id}>Another open suggestion: “{o.why}”</li>)}
            </ul>
          )}
      </div>

      <Notice error={act.error} />
      {mode ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-ink" htmlFor={`reason-${s.id}`}>{ACTION[mode].prompt}</label>
          <textarea id={`reason-${s.id}`} className={areaClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant={ACTION[mode].variant} disabled={!!act.busy || !reason.trim()} onClick={() => decide(mode)}>{ACTION[mode].text}</Button>
            <Button variant="ghost" onClick={() => { setMode(''); setReason(''); }}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a} variant={ACTION[a].variant} disabled={!!act.busy}
              onClick={() => (ACTION[a].needsReason ? setMode(a) : decide(a))}
            >
              {act.busy === a ? 'Working…' : ACTION[a].text}
            </Button>
          ))}
        </div>
      )}
    </Section>
  );
}

const DONE_WORDS = {
  approved: 'Approved and applied', rejected: 'Rejected', workaround: 'Resolved with a workaround',
  pending_founder: 'Escalated to the founder', sent_back: 'Sent back: it was based on changed context',
};

/** The drift check: the whole project against the plans, for slow drift no single change shows. */
function DriftCard() {
  const { get, post, tick } = useTeam();
  const [data, setData] = useState(undefined);
  const act = useAction();
  useEffect(() => { get('drift/latest').then((r) => setData(r.run)).catch(() => setData(null)); }, [tick]);
  const run = async () => { const r = await act.run('drift', () => post('drift/run')); if (r) setData(r); };
  return (
    <Section
      title="Drift check"
      description="Compares the whole project with the plans: rules broken in the built project, department plans that contradict central, outdated progress, workarounds piling up. Also runs daily."
      right={<Button variant="secondary" className="min-h-11" disabled={!!act.busy} onClick={run}>{act.busy ? 'Checking…' : 'Run now'}</Button>}
      className="mb-5"
    >
      <Notice error={act.error} />
      {data === undefined ? <Loading /> : !data ? <p className="m-0 text-sm text-dim">Not run yet.</p> : (
        <>
          <p className={cx('m-0 text-sm', data.findings.length ? 'text-err' : 'text-ok')}>{data.headline} <span className="text-dim">({timeAgo(data.ranAt)})</span></p>
          {data.findings.length > 0 && (
            <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              {data.findings.map((f, i) => <li key={i}><Badge tone={f.severity === 'high' ? 'red' : 'amber'}>{f.kind}</Badge> {f.text}</li>)}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

export default function ApprovalQueue() {
  const { me, get } = useTeam();
  const { data, loading, error, reload } = useLive(() => get('suggestions/queue'), [me.id]);
  const [done, setDone] = useState([]);
  const founder = me.role === 'owner';
  const items = data?.items ?? [];

  return (
    <Page>
      <PageHeader
        title="Approvals"
        description={founder
          ? 'Changes to the central context and checkpoints. Only you can approve these.'
          : 'Plan changes and conflicts in your department, and central matters you look at first.'}
      />
      <DriftCard />
      <Notice error={error} />
      {done.map((d) => (
        <div key={d.id} className={cx('mb-3 rounded-lg px-3 py-2 text-sm', d.status === 'rejected' ? 'bg-err/10 text-err' : 'bg-ok/10 text-ok')}>
          {DONE_WORDS[d.status] ?? d.status}: “{d.why}”. The suggester was told.
        </div>
      ))}
      {loading && !data ? <Loading /> : items.length === 0 ? (
        <Section><p className="m-0 text-dim">Nothing is waiting for you.</p></Section>
      ) : (
        <div className="space-y-4">
          {items.map((s) => <Item key={s.id} s={s} onDone={(r) => { setDone((x) => [r, ...x].slice(0, 3)); reload(); }} />)}
        </div>
      )}
    </Page>
  );
}
