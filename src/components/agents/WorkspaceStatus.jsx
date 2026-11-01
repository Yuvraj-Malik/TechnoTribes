// The developer's view of the coordination layer around their agent:
// what it may change and what it was blocked from, the status of its
// suggestions (with reasons), conflicts it caused, a timeline, and sharing
// finished work with the department.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { KIND_LABEL, SUGGESTION_LABEL, SUGGESTION_STATUS, scopeName } from '../../constants/statuses';
import { timeAgo } from '../../utils/time';
import { Badge, Button, Card, PanelTitle, cx, textareaClass } from '../common/ui';

export function useWorkspaceStatus() {
  const { get, tick, me } = useTeam();
  const [data, setData] = useState(null);
  useEffect(() => { get('workspace/status').then(setData).catch(() => {}); }, [tick, me.id]);
  return data;
}

function SuggestionRow({ s }) {
  const { nameOf } = useTeam();
  const st = SUGGESTION_STATUS[s.status] ?? { label: s.status, tone: 'slate' };
  const what = s.changes.map((c) => `${c.op === 'add' ? 'Add' : c.op === 'remove' ? 'Remove' : 'Change'} ${KIND_LABEL[c.kind] ?? 'item'} “${c.title}”`).join('; ');
  return (
    <li className="rounded-lg border border-line bg-surface p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={st.tone}>{st.label}</Badge>
        {s.label && s.label !== 'progress' && <Badge>{SUGGESTION_LABEL[s.label] ?? s.label}</Badge>}
        <span className="text-dim">{scopeName(s.scope)} · {timeAgo(s.createdAt)}</span>
      </div>
      <p className="m-0 mt-1 text-ink">{what}</p>
      {s.status !== 'applied' && s.reasons.length > 0 && (
        <p className="m-0 mt-1 text-dim"><span className="font-medium">Why it needed approval:</span> {s.reasons.join(' ')}</p>
      )}
      {s.managerNote && <p className="m-0 mt-1 text-dim"><span className="font-medium">Escalated:</span> {s.managerNote}</p>}
      {s.decision?.reason && (
        <p className={cx('m-0 mt-1', s.status === 'rejected' ? 'text-err' : 'text-ink')}>
          <span className="font-medium">{nameOf(s.decision.by)}:</span> {s.decision.reason}
        </p>
      )}
    </li>
  );
}

export function StatusPanel({ data }) {
  const [prefill, setPrefill] = useState(null);
  if (!data) return <div className="text-sm text-dim">Loading…</div>;
  const resolved = (s) => !['pending_manager', 'pending_founder'].includes(s.status);
  return (
    <div className="space-y-4">
      <section>
        <PanelTitle>What your agent may change</PanelTitle>
        <ul className="m-0 list-disc space-y-0.5 pl-5 text-xs text-ink">
          <li>Files: <span className="font-mono">{data.area.files.join(', ')}</span></li>
          {data.area.context.map((c) => <li key={c}>{c}</li>)}
          <li className="text-dim">Anything else: blocked and logged. Ask that department with a request.</li>
        </ul>
      </section>

      <section>
        <PanelTitle right={data.blocked.length > 0 && <Badge tone="red">{data.blocked.length}</Badge>}>Blocked</PanelTitle>
        {data.blocked.length === 0 ? <p className="m-0 text-xs text-dim">Nothing blocked.</p> : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {data.blocked.map((e) => (
              <li key={e.id} className="rounded-lg bg-err/10 p-2 text-xs text-ink">
                {e.plain ?? e.summary} <span className="text-dim">· {timeAgo(e.at)}</span>
                {e.data?.ownerDepartment && (
                  <button
                    type="button" className="ml-1 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent underline"
                    onClick={() => setPrefill({ toDepartment: e.data.ownerDepartment, title: `Change ${e.data.files.join(', ')}`.slice(0, 120), body: 'My agent needs this for my task. ' })}
                  >
                    Send a request
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <RequestsSection prefill={prefill} onPrefillUsed={() => setPrefill(null)} />

      <section>
        <PanelTitle>Suggestions</PanelTitle>
        {data.suggestions.length === 0 ? <p className="m-0 text-xs text-dim">None yet. Share finished work from the agent panel.</p> : (
          <ul className="m-0 list-none space-y-1.5 p-0">{data.suggestions.map((s) => <SuggestionRow key={s.id} s={s} />)}</ul>
        )}
      </section>

      <section>
        <PanelTitle>Conflicts your work caused</PanelTitle>
        {data.conflicts.length === 0 ? <p className="m-0 text-xs text-dim">None.</p> : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {data.conflicts.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-2.5 text-xs">
                <div className="flex flex-wrap gap-1">
                  {s.ruleHits.map((h, i) => <Badge key={i} tone="red">{scopeName(h.scope)} › {h.sectionTitle}</Badge>)}
                </div>
                <p className="m-0 mt-1 text-ink">“{s.changes[0]?.title}”: {resolved(s) ? (SUGGESTION_STATUS[s.status]?.label ?? s.status) : 'waiting for a decision'}</p>
                {s.decision?.reason && <p className="m-0 mt-1 text-dim">{s.decision.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const TIMELINE_TONE = (type) => (type === 'permission.blocked' || type.endsWith('rejected') ? 'red'
  : type.startsWith('suggestion') || type.startsWith('context') ? 'violet'
    : type.startsWith('agent') ? 'blue' : 'slate');

export function TimelinePanel({ data, task, onChanged }) {
  const { post } = useTeam();
  const [error, setError] = useState('');
  if (!data) return <div className="text-sm text-dim">Loading…</div>;
  // Developers can undo their own agent's work while it is not shared or submitted; shared context and merges are reverted by the manager or founder.
  const canUndo = task && !task.shared && !['submitted', 'approved'].includes(task.status) && task.changedFiles?.length > 0;
  const undo = async () => {
    if (!window.confirm(`Undo your agent's changes to ${task.changedFiles.join(', ')}? Your copy goes back to how it was before.`)) return;
    try { await post('task/undo-edits', { taskId: task.id }); onChanged?.(); } catch (e) { setError(e.message); }
  };
  return (
    <>
    {error && <p className="m-0 mb-2 text-xs text-err">{error}</p>}
    <p className="m-0 mb-2 text-[11px] text-dim">Shared context and merged code are reverted from the Story page by your manager or the founder, who see what depends on the change first.</p>
    <ol className="m-0 list-none space-y-2 border-l-2 border-line p-0 pl-3">
      {data.timeline.map((e) => (
        <li key={e.id} className="text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={TIMELINE_TONE(e.type)}>{e.title ?? e.type}</Badge>
            <span className="text-dim">{timeAgo(e.at)}</span>
          </div>
          <div className="mt-0.5 text-ink">{e.summary}</div>
          {canUndo && e.type === 'agent.edits' && e.taskId === task.id && e.id === data.timeline.find((x) => x.type === 'agent.edits' && x.taskId === task.id)?.id && (
            <button type="button" className="mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent underline" onClick={undo}>Undo my agent's changes</button>
          )}
        </li>
      ))}
    </ol>
    </>
  );
}

/** Search past notes, decisions and rejected suggestions (by meaning when available). */
export function SearchPast() {
  const { get } = useTeam();
  const [qText, setQ] = useState('');
  const [res, setRes] = useState(null);
  const run = async (e) => {
    e.preventDefault();
    if (qText.trim().length < 2) return;
    setRes(await get('search', { q: qText }).catch((err) => ({ error: err.message })));
  };
  return (
    <section className="mb-4">
      <form onSubmit={run} className="flex gap-1">
        <input className={textareaClass} placeholder="Search past notes and decisions…" value={qText} onChange={(e) => setQ(e.target.value)} aria-label="Search past notes" />
        <Button size="sm" variant="secondary" type="submit">Search</Button>
      </form>
      {res?.error && <p className="m-0 mt-1 text-xs text-err">{res.error}</p>}
      {res?.results && (
        <div className="mt-2 space-y-1.5">
          <div className="text-[11px] text-dim">{res.mode === 'meaning' ? 'Matched by meaning' : 'Matched by keywords (no embeddings key set)'}</div>
          {res.results.length === 0 && <p className="m-0 text-xs text-dim">Nothing found.</p>}
          {res.results.map((r, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1"><Badge tone={r.type === 'rejected suggestion' ? 'red' : 'slate'}>{r.type}</Badge><span className="text-dim">{timeAgo(r.at)}</span></div>
              <div className="mt-0.5 font-medium text-ink">{r.title}</div>
              <div className="text-dim">{r.text}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const REQUEST_STATE = {
  waiting: { label: 'Waiting for their manager', tone: 'amber' },
  in_progress: { label: 'Being worked on', tone: 'blue' },
  in_review: { label: 'In review', tone: 'violet' },
  done: { label: 'Done', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
};

function RequestRow({ r, incoming }) {
  const { deptById } = useTeam();
  const st = REQUEST_STATE[r.state] ?? { label: r.state, tone: 'slate' };
  return (
    <li className="rounded-lg border border-line bg-surface p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-dim">{incoming ? `from ${deptById(r.fromDepartment)?.name}` : `to ${deptById(r.toDepartment)?.name}`} · {timeAgo(r.createdAt)}</span>
      </div>
      <p className="m-0 mt-1 font-medium text-ink">{r.title}</p>
      {r.assignee && <p className="m-0 text-dim">{r.assignee} is on it.</p>}
      {r.result && <p className="m-0 mt-1 text-ink"><span className="font-medium">Result:</span> {r.result}</p>}
      {r.declinedReason && <p className="m-0 mt-1 text-err"><span className="font-medium">Declined:</span> {r.declinedReason}</p>}
    </li>
  );
}

/** Requests with other departments: short, concrete asks, never conversations. */
export function RequestsSection({ prefill, onPrefillUsed }) {
  const { boot, me, get, post, tick } = useTeam();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { get('requests/list').then(setData).catch(() => {}); }, [tick, me.id]);
  useEffect(() => { if (prefill) { setForm(prefill); onPrefillUsed?.(); } }, [prefill]);
  const others = boot.departments.filter((d) => d.id !== me.department);
  const send = async () => {
    setError('');
    try { await post('requests/create', form); setForm(null); setData(await get('requests/list')); } catch (e) { setError(e.message); }
  };
  return (
    <section>
      <PanelTitle right={!form && others.length > 0 && <Button size="sm" variant="ghost" onClick={() => setForm({ toDepartment: others[0].id, title: '', body: '' })}>New request</Button>}>Requests with other departments</PanelTitle>
      {form && (
        <Card className="mb-2 space-y-2 !p-3">
          <select className={textareaClass} value={form.toDepartment} onChange={(e) => setForm({ ...form, toDepartment: e.target.value })} aria-label="To department">
            {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input className={textareaClass} placeholder="What you need, in one line" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="What you need" />
          <textarea className={textareaClass} rows={2} placeholder="Why, and anything they need to know" maxLength={600} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-label="Details" />
          {error && <p className="m-0 text-xs text-err">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!form.title.trim() || !form.body.trim()} onClick={send}>Send request</Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </Card>
      )}
      {!data ? <p className="m-0 text-xs text-dim">Loading…</p> : (
        <>
          <div className="mb-1 text-[11px] text-dim">Sent by {me.department ? boot.departments.find((d) => d.id === me.department)?.name : 'you'}</div>
          {data.outgoing.length ? <ul className="m-0 mb-2 list-none space-y-1.5 p-0">{data.outgoing.map((r) => <RequestRow key={r.id} r={r} />)}</ul> : <p className="m-0 mb-2 text-xs text-dim">None.</p>}
          <div className="mb-1 text-[11px] text-dim">Asked of {me.department ? boot.departments.find((d) => d.id === me.department)?.name : 'you'}</div>
          {data.incoming.length ? <ul className="m-0 list-none space-y-1.5 p-0">{data.incoming.map((r) => <RequestRow key={r.id} r={r} incoming />)}</ul> : <p className="m-0 text-xs text-dim">None.</p>}
        </>
      )}
    </section>
  );
}

const lines = (text) => text.split('\n').map((x) => x.trim()).filter(Boolean);

/**
 * After the agent finishes: its structured summary. The developer reviews and
 * edits the words; the checkable facts (files) come from the diff. Sharing puts
 * it into the department progress through the change router, and sends the
 * ticked needs to other departments as requests. The agent's full working
 * history stays private.
 */
export function SummaryCard({ task, status, onShared }) {
  const { dept, deptById, post } = useTeam();
  const draft = task.shared?.summary ?? task.summaryDraft ?? { whatChanged: task.summary, changed: task.changedFiles, decisions: [], open: [], dependsOn: [], forOtherDepartments: [] };
  const [what, setWhat] = useState(draft.whatChanged ?? '');
  const [decisions, setDecisions] = useState((draft.decisions ?? []).map((d) => `${d.decision}${d.why ? ` — ${d.why}` : ''}`).join('\n'));
  const [open, setOpen] = useState((draft.open ?? []).join('\n'));
  const [needs, setNeeds] = useState(draft.forOtherDepartments ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setWhat(draft.whatChanged ?? ''); setOpen((draft.open ?? []).join('\n')); setNeeds(draft.forOtherDepartments ?? []);
    setDecisions((draft.decisions ?? []).map((d) => `${d.decision}${d.why ? ` — ${d.why}` : ''}`).join('\n'));
  }, [task.id, task.summaryDraft?.checkedAt]);

  if (task.shared) {
    const s = status?.suggestions.find((x) => x.id === task.shared.suggestionId);
    const st = SUGGESTION_STATUS[s?.status] ?? { label: s?.status ?? 'Shared', tone: 'green' };
    return (
      <Card className="!p-3 text-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">Summary shared with {dept?.name}</span><Badge tone={st.tone}>{st.label}</Badge></div>
        <p className="m-0 text-xs text-dim">{s?.status === 'applied' ? 'It is in the department progress and the log.' : s?.reasons?.join(' ')}</p>
        {task.shared.requests?.length > 0 && <p className="m-0 mt-1 text-xs text-dim">{task.shared.requests.length} request(s) sent. Follow them in Status.</p>}
      </Card>
    );
  }

  const share = async () => {
    setBusy(true); setError('');
    try {
      await post('task/share', {
        taskId: task.id,
        summary: {
          ...draft, whatChanged: what.trim(), open: lines(open), forOtherDepartments: needs,
          decisions: lines(decisions).map((l) => { const [decision, ...why] = l.split(' — '); return { decision, why: why.join(' — ') }; }),
        },
      });
      onShared?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Card tone="green" className="space-y-2">
      <div className="font-semibold text-ink">End-of-task summary for {dept?.name}</div>
      <p className="m-0 text-xs text-dim">Your agent drafted this. Edit the words; the files are checked against your changes. Only this summary is shared, not the agent's working history.</p>
      <label className="block text-xs font-medium text-dim">What changed<textarea className={`${textareaClass} mt-1`} rows={2} value={what} onChange={(e) => setWhat(e.target.value)} /></label>
      <div className="text-xs">
        <div className="font-medium text-dim">Files (checked against the diff)</div>
        <div className="mt-0.5 font-mono text-ink">{(draft.changed ?? []).join(', ') || '—'}</div>
        {draft.plannedButNotChanged?.length > 0 && <div className="mt-0.5 text-err">Planned but not changed: {draft.plannedButNotChanged.join(', ')}</div>}
        {draft.dependsOn?.length > 0 && <div className="mt-0.5 text-dim">Others can now rely on: {draft.dependsOn.join('; ')}</div>}
      </div>
      <label className="block text-xs font-medium text-dim">Decisions and why (one per line, “decision — why”)<textarea className={`${textareaClass} mt-1`} rows={2} value={decisions} onChange={(e) => setDecisions(e.target.value)} /></label>
      <label className="block text-xs font-medium text-dim">Still open (one per line)<textarea className={`${textareaClass} mt-1`} rows={2} value={open} onChange={(e) => setOpen(e.target.value)} /></label>
      {needs.length > 0 && (
        <div className="text-xs">
          <div className="font-medium text-dim">Needed from other departments</div>
          {needs.map((n, i) => (
            <label key={i} className="mt-1 flex items-start gap-2 rounded-lg bg-surface p-2">
              <input type="checkbox" className="mt-0.5" checked={!!n.send} onChange={(e) => setNeeds(needs.map((x, j) => (j === i ? { ...x, send: e.target.checked } : x)))} />
              <span><span className="font-medium text-ink">{deptById(n.department)?.name}:</span> {n.need} <span className="text-dim">(send as a request)</span></span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="m-0 text-xs text-err">{error}</p>}
      <Button size="sm" disabled={busy || !what.trim()} onClick={share}>{busy ? 'Sharing…' : 'Share with the department'}</Button>
    </Card>
  );
}
