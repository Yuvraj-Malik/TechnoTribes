// Right column: the developer's agent. Task input, status steps, and the
// decision cards (conflict, plan, context changed, sent back). Follow-ups are
// allowed, but decisions happen on cards, not in a chat.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { AGENT_STEPS, scopeName } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import { Badge, Button, Card, PanelTitle, SimulatedTag, cx, textareaClass } from '../common/ui';

const SUGGESTIONS = {
  frontend: ['Build the checkout page with a card payment form', 'Add a back to menu link on checkout'],
  backend: ['Add an order status endpoint', 'Add a refunds table to the schema'],
  payments: ['Switch from card payments to UPI only', 'Shorten the refund window to 3 minutes'],
};
/** Tasks your manager assigned to you: start one and your agent takes it from there. */
function AssignedTasks({ act, pending }) {
  const { get, tick, me } = useTeam();
  const [items, setItems] = useState([]);
  useEffect(() => {
    get('my/assignments')
      .then((r) => setItems(r.tasks.filter((t) => t.status === 'open' || (t.status === 'in_progress' && !t.devTaskId))))
      .catch(() => setItems([]));
  }, [tick, me.id]);
  if (!items.length) return null;
  return (
    <Card tone="blue" className="!p-3">
      <div className="mb-2 text-sm font-semibold text-ink">Assigned to you</div>
      <ul className="m-0 list-none space-y-2 p-0">
        {items.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface p-2 ring-1 ring-line">
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-ink">{t.title}</p>
              <p className="m-0 text-[11px] text-dim">from {t.assignedBy ?? 'your manager'}{t.observerRequestId ? ' · observer request' : ''}</p>
            </div>
            <Button size="sm" className="min-h-9 shrink-0" disabled={!!pending}
              onClick={() => act('task/start', { assignmentId: t.id, text: [t.title, t.description].filter(Boolean).join('. ') }, 'Reading context and checking for conflicts')}>
              Start
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const WAITING = ['needs_conflict_decision', 'awaiting_plan_approval', 'needs_context_decision'];

function Stepper({ task, pending }) {
  const idx = task ? AGENT_STEPS.findIndex((s) => s.statuses.includes(task.status)) : -1;
  const waiting = task && WAITING.includes(task.status);
  return (
    <ol className="m-0 list-none space-y-1 p-0">
      {AGENT_STEPS.map((s, i) => {
        const state = idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'now' : 'todo';
        return (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              state === 'done' ? 'bg-ok text-white'
                : state === 'now' ? (waiting ? 'bg-mark text-ink' : 'animate-pulse bg-accent text-accent-ink')
                  : 'bg-line text-dim')}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={cx(state === 'now' ? 'font-semibold text-ink' : state === 'done' ? 'text-dim' : 'text-dim/70')}>
              {s.label}{state === 'now' && waiting ? ' · needs you' : ''}{state === 'now' && pending ? '…' : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ConflictCard({ task, act }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.text);
  const decide = (choice, newText) => act('task/conflict-decision', { taskId: task.id, choice, newText });
  return (
    <Card tone="amber">
      <div className="mb-2 font-semibold text-ink">⚠ Before I start: this conflicts with the context</div>
      <ul className="m-0 mb-3 list-none space-y-2 p-0">
        {task.conflicts.map((c, i) => (
          <li key={i} className="rounded-lg bg-surface/80 p-2 text-sm text-ink">
            <div className="mb-1 flex gap-1">
              <Badge tone={c.kind === 'outdated' ? 'red' : 'amber'}>{c.kind === 'outdated' ? 'Outdated info' : 'Conflict'}</Badge>
              <Badge>{scopeName(c.scope)} › {c.sectionTitle}</Badge>
            </div>
            {c.explanation}
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="space-y-2">
          <textarea className={textareaClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide('change', text)}>Send changed request</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => decide('proceed')}>Go ahead anyway</Button>
          <Button size="sm" onClick={() => setEditing(true)}>Change request</Button>
          <Button size="sm" variant="ghost" onClick={() => decide('cancel')}>Cancel</Button>
        </div>
      )}
    </Card>
  );
}

function PlanCard({ task, act }) {
  const plan = task.plan;
  const [editing, setEditing] = useState(false);
  const [understanding, setUnderstanding] = useState(plan.understanding);
  const [steps, setSteps] = useState(plan.steps.join('\n'));
  const confirm = (p) => act('task/plan-decision', { taskId: task.id, plan: p });
  return (
    <Card tone="blue">
      <div className="mb-2 font-semibold text-ink">Here is what I understood and what I will do</div>
      {editing ? (
        <div className="space-y-2 text-sm">
          <label className="block text-xs font-medium text-dim">What I understood</label>
          <textarea className={textareaClass} rows={3} value={understanding} onChange={(e) => setUnderstanding(e.target.value)} />
          <label className="block text-xs font-medium text-dim">Steps (one per line)</label>
          <textarea className={textareaClass} rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => confirm({ ...plan, understanding, steps: steps.split('\n').map((s) => s.trim()).filter(Boolean) })}>Confirm edited plan</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Back</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="m-0 mb-2 text-sm text-ink">{plan.understanding}</p>
          <ol className="m-0 mb-2 ml-4 list-decimal space-y-1 p-0 text-sm text-ink">
            {plan.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <div className="mb-3 flex flex-wrap gap-1">
            {plan.files.map((f) => <span key={f} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-dim ring-1 ring-line">{f}</span>)}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => confirm()}>Confirm plan</Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ContextAlertCard({ task, act }) {
  const alert = task.contextAlert;
  const mine = alert.changes.filter((c) => task.relevantSectionIds.includes(c.sectionId));
  const others = alert.changes.filter((c) => !task.relevantSectionIds.includes(c.sectionId));
  const [adjusting, setAdjusting] = useState(false);
  const [text, setText] = useState(alert.suggestedTask ?? task.text);
  const decide = (choice, newText) => act('task/context-decision', { taskId: task.id, choice, newText });
  return (
    <Card tone="red">
      <div className="mb-1 font-semibold text-err">⚡ The context changed while I was working</div>
      <p className="m-0 mb-2 text-sm font-medium text-ink">{alert.relation}</p>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Changed sections your task uses</div>
      <ul className="m-0 mb-2 list-none space-y-1 p-0">
        {mine.map((c) => (
          <li key={c.sectionId} className="rounded-lg bg-surface/80 p-2 text-xs text-ink">
            <span className="font-semibold">{scopeName(c.scope)} › {c.title}</span> v{c.fromVersion} → v{c.toVersion}
            <div className="text-dim">{c.why}</div>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <p className="m-0 mb-3 text-[11px] text-dim">Also changed (not used by your task): {others.map((c) => `${scopeName(c.scope)} › ${c.title}`).join(', ')}.</p>
      )}
      {adjusting ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-dim">Adjust the task to the new context (I will re-read the context and redo the work)</label>
          <textarea className={textareaClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide('adjust', text)}>Redo with new context</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdjusting(false)}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => decide('continue')} title="Keep the work as it is. It will be marked as built on the old context.">Continue as is</Button>
          <Button size="sm" variant="warning" onClick={() => setAdjusting(true)}>Pause and adjust</Button>
          <Button size="sm" variant="ghost" onClick={() => decide('cancel')}>Cancel task</Button>
        </div>
      )}
      <div className="mt-2 text-[11px] text-dim">Noticed {timeAgo(alert.createdAt)} · your choice is logged</div>
    </Card>
  );
}

function ReworkCard({ task, act }) {
  const [text, setText] = useState(task.text);
  const [open, setOpen] = useState(false);
  return (
    <Card tone="amber">
      <div className="mb-1 font-semibold text-ink">Sent back by your manager</div>
      <p className="m-0 mb-2 text-sm text-ink">{task.reviewNote}</p>
      {open ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-dim">Rework the task (I will re-read the current context, bring in the latest main project and redo it)</label>
          <textarea className={textareaClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => act('task/rework', { taskId: task.id, newText: text })}>Rework with current context</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="warning" onClick={() => setOpen(true)}>Rework with current context</Button>
          <Button size="sm" variant="ghost" onClick={() => act('task/cancel', { taskId: task.id })}>Drop it</Button>
        </div>
      )}
      <p className="m-0 mt-2 text-[11px] text-dim">Or ask for a small change below and resubmit.</p>
    </Card>
  );
}

function WhatIKnowCard({ data, onClose }) {
  return (
    <Card tone="green">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-ink">What I know (rebuilt from context + log)</span>
        <button type="button" className="cursor-pointer border-0 bg-transparent text-xs text-dim underline" onClick={onClose}>Hide</button>
      </div>
      {data.mode === 'mock' && <div className="mb-2"><SimulatedTag>Assembled by the simulated agent</SimulatedTag></div>}
      <div className="space-y-2">
        {data.points.map((p) => (
          <div key={p.heading}>
            <div className="text-xs font-semibold uppercase tracking-wide text-ok">{p.heading}</div>
            <ul className="m-0 ml-4 list-disc p-0 text-xs text-ink">{p.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AgentPanel({ task, onChanged }) {
  const { boot, me, post } = useTeam();
  const [text, setText] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [error, setError] = useState('');
  const [known, setKnown] = useState(null);
  const [pending, setPending] = useState('');
  useEffect(() => setError(''), [task?.status]);

  /** Every agent step runs inside the request, so show it as working until it answers. */
  const act = async (path, body, label = 'Agent working') => {
    setPending(label);
    setError('');
    try { const r = await post(path, body); onChanged?.(); return r; } catch (e) { setError(e.message); } finally { setPending(''); }
  };

  const canStart = !task || ['submitted', 'approved', 'rejected', 'cancelled', 'failed'].includes(task.status);
  const showTask = task && task.status !== 'cancelled';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{me.name}'s agent</PanelTitle>
        <div className="flex items-center gap-1">
          {boot.agentMode === 'mock' && <SimulatedTag />}
          <Button
            size="sm" variant="ghost" disabled={!!pending}
            onClick={() => act('agent/restart', {}, 'Restarting').then((r) => r && setKnown(r))}
            title="Start a fresh agent: it rebuilds what it knows from the context and the log"
          >
            ↻ Restart agent
          </Button>
        </div>
      </div>

      {known && <WhatIKnowCard data={known} onClose={() => setKnown(null)} />}
      {pending && <div className="animate-pulse rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{pending}…</div>}

      {canStart && <AssignedTasks act={act} pending={pending} />}

      {canStart && (
        <Card>
          <label className="mb-1 block text-sm font-medium text-ink">{showTask ? 'Start a new task' : 'What should your agent do?'}</label>
          <textarea className={textareaClass} rows={3} placeholder="Describe the task in plain words…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1">
            {(SUGGESTIONS[me.department] ?? []).map((s) => (
              <button type="button" key={s} onClick={() => setText(s)} className="cursor-pointer rounded-full border-0 bg-bg px-2 py-0.5 text-[11px] text-dim hover:bg-accent/10 hover:text-accent">{s}</button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-dim">The agent reads the context first and asks before acting.</span>
            <Button size="sm" disabled={!text.trim() || !!pending} onClick={() => act('task/start', { text }, 'Reading context and checking for conflicts').then((r) => r && setText(''))}>Give task</Button>
          </div>
        </Card>
      )}

      {showTask && (
        <>
          <Card className="!p-3">
            <div className="mb-2 text-xs text-dim">Current task</div>
            <p className="m-0 mb-3 text-sm font-medium text-ink">“{task.text}”</p>
            <Stepper task={task} pending={pending} />
          </Card>

          {!pending && task.status === 'needs_conflict_decision' && <ConflictCard task={task} act={act} />}
          {!pending && task.status === 'awaiting_plan_approval' && task.plan && <PlanCard key={task.updatedAt} task={task} act={act} />}
          {!pending && task.status === 'needs_context_decision' && task.contextAlert && <ContextAlertCard key={task.contextAlert.id} task={task} act={act} />}
          {!pending && task.status === 'sent_back' && <ReworkCard task={task} act={act} />}
          {task.status === 'submitted' && <Card className="!p-3 text-sm text-dim">Waiting for your manager's review. You can start another task meanwhile.</Card>}
          {task.status === 'failed' && (
            <Card tone="red">
              <p className="m-0 mb-2 text-sm text-ink">The agent ran into a problem. See the activity below.</p>
              <Button size="sm" onClick={() => act('task/retry', { taskId: task.id })}>Try again</Button>
            </Card>
          )}

          {['done', 'sent_back'].includes(task.status) && (
            <Card className="!p-3">
              <label className="mb-1 block text-xs font-medium text-dim">Ask for more changes</label>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act('task/follow-up', { taskId: task.id, message: followUp }).then((r) => r && setFollowUp('')); }}>
                <input className={`${textareaClass} min-w-0 flex-1`} placeholder="e.g. add a back to menu link" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                <Button size="sm" variant="secondary" type="submit" disabled={!followUp.trim() || !!pending}>Send</Button>
              </form>
            </Card>
          )}

          {!['submitted', 'approved', 'rejected'].includes(task.status) && (
            <div className="text-right">
              <button type="button" className="cursor-pointer border-0 bg-transparent text-xs text-dim hover:text-err" onClick={() => act('task/cancel', { taskId: task.id })}>Cancel this task</button>
            </div>
          )}

          <div>
            <PanelTitle>Agent activity</PanelTitle>
            <ol className="m-0 list-none space-y-1.5 border-l-2 border-line p-0 pl-3">
              {[...task.messages].reverse().slice(0, 12).map((m, i) => (
                <li key={i} className="text-xs">
                  <span className={cx('font-semibold', m.from === 'agent' ? 'text-accent' : m.from === 'manager' ? 'text-pip-b' : m.from === 'developer' ? 'text-ink' : 'text-dim')}>
                    {m.from === 'agent' ? 'Agent' : m.from === 'developer' ? me.name : m.from === 'manager' ? 'Manager' : 'System'}
                  </span>
                  <span className="text-dim"> · {timeAgo(m.at)}</span>
                  <div className="text-dim">{m.text}</div>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
      {error && <div className="rounded-lg bg-err/10 p-2 text-xs text-err">{error}</div>}
    </div>
  );
}
