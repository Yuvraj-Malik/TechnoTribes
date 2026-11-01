// After approval: the agent's proposed context update (editable) and the
// system's impact decision (department only or cross-department, reasons,
// who will be notified). The manager confirms before anything changes.
import { useEffect, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { scopeName } from '../../constants/statuses';
import { Avatar, Badge, Button, Card, SimulatedTag, cx, textareaClass } from '../common/ui';

const LEVEL_LABEL = { central: 'Central context', own: 'Your department', other: 'Other departments' };

export default function ImpactStep({ proposal: initial, onDone }) {
  const { boot, personById, deptById, post } = useTeam();
  const [p, setP] = useState(initial);
  const [changes, setChanges] = useState(initial.changes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setP(initial); setChanges(initial.changes); }, [initial.id]);

  const toggle = async (id, include) => {
    const next = changes.map((c) => (c.sectionId === id ? { ...c, include } : c));
    setChanges(next);
    setP(await post('proposals/preview', { proposalId: p.id, changes: next }));
  };
  const run = async (path) => {
    setBusy(true);
    try { await post(path, { proposalId: p.id, changes }); onDone(); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const impact = p.impact;
  const cross = impact.scope === 'cross_department';
  const levels = ['central', 'own', 'other'].filter((l) => changes.some((c) => c.level === l));
  const person = (id) => personById(id) ?? { id, name: 'Someone' };

  return (
    <Card tone="blue" className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">Step 2 of 2 · Update the context</div>
          <h3 className="m-0 text-lg font-semibold text-ink">{p.summary}</h3>
          <p className="m-0 text-sm text-dim">Approved and merged. The agent proposes these context updates. Edit them, then confirm who gets told.</p>
        </div>
        {boot.agentMode === 'mock' && <SimulatedTag>Proposal by simulated agent</SimulatedTag>}
      </div>

      {levels.map((level) => (
        <div key={level}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{LEVEL_LABEL[level]}</div>
          <div className="space-y-2">
            {changes.filter((c) => c.level === level).map((c) => (
              <div key={c.sectionId} className={cx('rounded-lg border bg-surface p-3', c.include ? 'border-line' : 'border-dashed border-line opacity-60')}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={c.include} onChange={(e) => toggle(c.sectionId, e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{scopeName(c.scope)} › {c.title}</span>
                      <Badge tone={level === 'central' ? 'violet' : level === 'own' ? 'teal' : 'amber'}>{level === 'other' ? deptById(c.scope)?.name : LEVEL_LABEL[level]}</Badge>
                    </div>
                    <div className="text-xs text-dim">{c.reason}</div>
                  </div>
                </label>
                {c.include && (
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <div className="mb-0.5 font-medium text-dim">Now</div>
                      <div className="whitespace-pre-line rounded bg-err/10 p-2 text-ink">{c.oldContent}</div>
                    </div>
                    <div>
                      <div className="mb-0.5 font-medium text-dim">Proposed (editable)</div>
                      <textarea
                        className={`${textareaClass} min-h-24 border-ok/50 bg-ok/10 text-xs`}
                        value={c.newContent}
                        onChange={(e) => setChanges(changes.map((x) => (x.sectionId === c.sectionId ? { ...x, newContent: e.target.value } : x)))}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={cx('rounded-xl border-2 p-4', cross ? 'border-mark bg-mark/10' : 'border-ok/50 bg-ok/5')}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-dim">System impact decision</span>
          <Badge tone={cross ? 'amber' : 'teal'} className="text-sm">{cross ? 'Cross-department (major)' : 'Department only'}</Badge>
          {impact.affectedDepartments.map((d) => <Badge key={d}>{deptById(d)?.name}</Badge>)}
        </div>
        <ul className="m-0 mb-3 ml-4 list-disc space-y-0.5 p-0 text-sm text-ink">
          {impact.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        {cross && <p className="m-0 mb-3 text-xs text-dim">Order: the Central context updates first, then each affected department's context picks it up.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-dim">Will be notified ({impact.notify.length})</div>
            <ul className="m-0 list-none space-y-1 p-0">
              {impact.notify.map((n) => (
                <li key={n.userId} className="flex items-start gap-2 text-xs">
                  <Avatar person={person(n.userId)} size={18} />
                  <div>
                    <span className="font-medium text-ink">{person(n.userId).name}</span>
                    {n.affectsActiveWork && <Badge tone="red" className="ml-1">mid-task alert</Badge>}
                    <div className="text-dim">{n.reason}</div>
                  </div>
                </li>
              ))}
              {!impact.notify.length && <li className="text-xs text-dim">Nobody else needs to be told.</li>}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-dim">Checked and not affected</div>
            <ul className="m-0 list-none space-y-1 p-0">
              {impact.unaffected.map((n) => (
                <li key={n.userId} className="flex items-start gap-2 text-xs">
                  <Avatar person={person(n.userId)} size={18} />
                  <div><span className="font-medium text-ink">{person(n.userId).name}</span><div className="text-dim">{n.reason}</div></div>
                </li>
              ))}
              {!impact.unaffected.length && <li className="text-xs text-dim">—</li>}
            </ul>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-err">{error}</div>}
      <div className="flex items-center gap-2">
        <Button onClick={() => run('proposals/confirm')} disabled={busy || !changes.some((c) => c.include)}>
          {busy ? 'Applying…' : `Confirm and update ${changes.filter((c) => c.include).length} section(s)`}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run('proposals/discard')}>Skip context update</Button>
      </div>
    </Card>
  );
}
